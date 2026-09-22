import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH=':memory:';
process.env.TOKEN_KEY='a'.repeat(64);
const {run,get,all,tx,id,crypt,emit}=await import('../src/core.js');
const {ingest,processEvent,resync}=await import('../src/integrations.js');
const {tick}=await import('../src/worker.js');

function fixture(){
 const org=id(),pid=id(),uid=id(),board=id(),columns={};
 run('INSERT INTO organizations VALUES(?,?)',org,'Ordering');
 run('INSERT INTO users VALUES(?,?,?,?)',uid,uid+'@test.dev',uid,'unused');
 run('INSERT INTO members VALUES(?,?,?)',org,uid,'Owner');
 run('INSERT INTO projects(id,org_id,name,repo,slack_channel) VALUES(?,?,?,?,?)',pid,org,'Ordering',`test/${pid}`,'C123');
 run('INSERT INTO boards VALUES(?,?,?)',board,pid,'Board');
 for(const [index,name] of ['In Progress','Review','Done'].entries()){
  columns[name]=id();run('INSERT INTO columns VALUES(?,?,?,?)',columns[name],board,name,index);
 }
 const tid=Number(run('INSERT INTO tasks(project_id,column_id,title,assignee) VALUES(?,?,?,?)',pid,columns['In Progress'],'Ordering task',uid).lastInsertRowid);
 for(const [trigger,condition,action,value] of [['pr.opened',null,'set_status','Review'],['pr.merged','Review','set_status','Done'],['pr.merged','In Progress','set_status','Done'],['ci.failed',null,'comment','CI failed']])run('INSERT INTO rules(id,project_id,trigger,condition_status,action,value) VALUES(?,?,?,?,?,?)',id(),pid,trigger,condition,action,value);
 const sha='sha-'+tid;
 const commit={sha,message:`TASK-${tid} fix`,timestamp:'2026-09-22T09:00:00Z'};
 const pr={number:1,title:'Unreferenced PR',head:{sha},state:'open',merged:false,updated_at:'2026-09-22T10:00:00Z'};
 const check={id:10,head_sha:sha,conclusion:'failure',completed_at:'2026-09-22T10:05:00Z'};
 const review={id:20,pull_request_number:1,state:'approved',submitted_at:'2026-09-22T10:06:00Z'};
 return {org,pid,uid,tid,columns,commit,pr,check,review};
}
const receive=(f,kind,obj)=>tx(()=>ingest(f.pid,kind,obj));
async function drain(){let count=0;while(await tick())assert.ok(++count<100,'Queue settles');}
const status=f=>get('SELECT c.name FROM tasks t JOIN columns c ON c.id=t.column_id WHERE t.id=?',f.tid).name;
const links=f=>all('SELECT kind FROM task_links WHERE task_id=? ORDER BY kind',f.tid).map(l=>l.kind);

test('late commit immediately repairs PR, CI and review links and effects exactly once',async()=>{
 const f=fixture();
 receive(f,'review',f.review);receive(f,'check',f.check);receive(f,'pr',f.pr);await drain();
 assert.deepEqual(links(f),[]);
 receive(f,'commit',f.commit);await drain();
 assert.deepEqual(links(f),['check','commit','pr','review']);
 assert.equal(status(f),'Review');
 assert.equal(get('SELECT count(*) AS n FROM comments WHERE task_id=?',f.tid).n,1);
 const before=get('SELECT count(*) AS n FROM notifications WHERE user_id=?',f.uid).n;
 for(let i=0;i<3;i++)for(const kind of ['commit','pr','check','review'])receive(f,kind,f[kind]);
 await drain();
 assert.equal(get('SELECT count(*) AS n FROM comments WHERE task_id=?',f.tid).n,1);
 assert.equal(get('SELECT count(*) AS n FROM notifications WHERE user_id=?',f.uid).n,before);
});

test('late commit recovers merged state instead of replaying an old PR opening',async()=>{
 const f=fixture(),merged={...f.pr,state:'closed',merged:true,updated_at:'2026-09-22T12:00:00Z'};
 receive(f,'pr',merged);receive(f,'pr',f.pr);receive(f,'commit',f.commit);await drain();
 assert.equal(status(f),'Done');
 assert.equal(get("SELECT count(*) AS n FROM events WHERE task_id=? AND type='pr.opened'",f.tid).n,0);
 receive(f,'pr',f.pr);await drain();assert.equal(status(f),'Done');
});

test('queued old PR and failed CI events do not apply obsolete automation',async()=>{
 const f=fixture();receive(f,'commit',f.commit);receive(f,'pr',f.pr);receive(f,'check',f.check);
 receive(f,'pr',{...f.pr,state:'closed',merged:true,updated_at:'2026-09-22T12:00:00Z'});
 receive(f,'check',{...f.check,conclusion:'success',completed_at:'2026-09-22T12:01:00Z'});
 await drain();
 assert.equal(status(f),'Done');
 assert.equal(get('SELECT count(*) AS n FROM comments WHERE task_id=?',f.tid).n,0);
 assert.equal(get("SELECT count(*) AS n FROM events WHERE task_id=? AND type='task.status_changed' AND json_extract(payload,'$.to')='Review'",f.tid).n,0);
});

test('timestamps with timezone offsets cannot replace newer snapshots',async()=>{
 const f=fixture();receive(f,'commit',f.commit);
 receive(f,'check',{...f.check,conclusion:'success',completed_at:'2026-09-22T10:30:00Z'});
 receive(f,'check',{...f.check,completed_at:'2026-09-22T12:00:00+02:00'});await drain();
 assert.equal(JSON.parse(get("SELECT payload FROM external_objects WHERE project_id=? AND kind='check'",f.pid).payload).conclusion,'success');
 assert.equal(get('SELECT count(*) AS n FROM comments WHERE task_id=?',f.tid).n,0);
});

test('PR metadata updates do not swallow pending open or merge automation',async()=>{
 const f=fixture();receive(f,'commit',f.commit);receive(f,'pr',f.pr);
 receive(f,'pr',{...f.pr,title:'Renamed PR',updated_at:'2026-09-22T11:00:00Z'});
 await drain();assert.equal(status(f),'Review');
 const merged={...f.pr,state:'closed',merged:true,updated_at:'2026-09-22T12:00:00Z'};
 receive(f,'pr',merged);receive(f,'pr',{...merged,title:'Final title',updated_at:'2026-09-22T13:00:00Z'});
 await drain();assert.equal(status(f),'Done');
});

test('unchanged resync snapshots repair links after a commit was manually associated',async()=>{
 const f=fixture();for(const kind of ['pr','check','review'])receive(f,kind,f[kind]);await drain();
 run('INSERT INTO task_links VALUES(?,?,?,?)',f.tid,'commit',f.commit.sha,null);
 run('INSERT INTO integrations VALUES(?,?,?,?)',f.org,'github',crypt('fixture'),'1');
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{
   const path=new URL(url).pathname;
   const body=path.endsWith('/pulls/1/reviews')?[f.review]:path.endsWith('/check-runs')?{check_runs:[f.check]}:path.endsWith('/pulls/1')?f.pr:path.endsWith('/pulls')?[f.pr]:[];
   return new Response(JSON.stringify(body));
  };
  await resync(f.pid);await drain();assert.deepEqual(links(f),['check','commit','pr','review']);assert.equal(status(f),'Review');
  const count=get('SELECT count(*) AS n FROM events WHERE task_id=?',f.tid).n;
  await resync(f.pid);await drain();assert.equal(get('SELECT count(*) AS n FROM events WHERE task_id=?',f.tid).n,count);
 }finally{globalThis.fetch=original;}
});

test('recovered links remain project scoped and exclude deleted tasks',async()=>{
 const a=fixture(),b=fixture();receive(a,'pr',a.pr);
 receive(b,'commit',{...a.commit,message:`TASK-${b.tid} fix`});
 assert.deepEqual(links(a),[]);
 run('UPDATE tasks SET deleted_at=1 WHERE id=?',a.tid);receive(a,'commit',a.commit);await drain();
 assert.deepEqual(links(a),[]);
});

test('matching Slack rules override default independently and deduplicate event retries',()=>{
 const f=fixture();run('INSERT INTO integrations VALUES(?,?,?,?)',f.org,'slack',crypt('fixture'),'T123');
 for(const [rule,condition,text,enabled] of [['one','In Progress','First custom message',1],['two',null,'Second custom message',1],['wrong','Done','Wrong status',1],['disabled',null,'Disabled',0]])run('INSERT INTO rules(id,project_id,trigger,condition_status,action,value,enabled) VALUES(?,?,?,?,?,?,?)',f.pid+rule,f.pid,'task.created',condition,'slack',text,enabled);
 const eid=emit(f.pid,'task.created',{},f.tid);
 tx(()=>processEvent(eid));tx(()=>processEvent(eid));
 assert.equal(get('SELECT count(*) AS n FROM jobs WHERE job_key=?',`slack:${eid}`).n,0);
 const jobs=all("SELECT payload FROM jobs WHERE kind='slack' AND json_extract(payload,'$.project_id')=?",f.pid);
 assert.deepEqual(jobs.map(j=>JSON.parse(j.payload).text).sort(),['First custom message','Second custom message']);
 // Remove pending fixture jobs; no live provider calls are used in this test.
 run("UPDATE jobs SET status='done' WHERE kind='slack'");run("UPDATE jobs SET status='done' WHERE job_key=?",`event:${eid}`);
});

test('unmatched Slack conditions retain the default notification',()=>{
 const f=fixture();run('INSERT INTO integrations VALUES(?,?,?,?)',f.org,'slack',crypt('fixture'),'T123');
 run('INSERT INTO rules(id,project_id,trigger,condition_status,action,value) VALUES(?,?,?,?,?,?)',id(),f.pid,'task.created','Done','slack','Not applicable');
 const eid=emit(f.pid,'task.created',{},f.tid);tx(()=>processEvent(eid));
 assert.match(JSON.parse(get('SELECT payload FROM jobs WHERE job_key=?',`slack:${eid}`).payload).text,/Yeni görev/);
});
