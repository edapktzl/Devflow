import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const directory=mkdtempSync(join(tmpdir(),'devflow-github-actions-'));
process.env.DATABASE_PATH=join(directory,'test.db');
process.env.TOKEN_KEY='b'.repeat(64);
const {server}=await import('../src/server.js');
const {run,get,all,hash,crypt,db,now}=await import('../src/core.js');
const realFetch=globalThis.fetch;
let base,calls=[],provider;
const issue={action:'create_issue',title:'TASK-1 Example',body:'Details'};
const sha='a'.repeat(40);
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
async function request(key,body=issue,token='owner',pid='project'){
 const r=await realFetch(base+'/api/projects/'+pid+'/github/actions',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(key===undefined?{}:{'Idempotency-Key':key})},body:JSON.stringify(body)});
 return {status:r.status,body:await r.json()};
}
async function status(key,token='owner',pid='project'){
 const r=await realFetch(base+'/api/projects/'+pid+'/github/actions/'+key,{headers:{Authorization:'Bearer '+token}});
 return {status:r.status,body:await r.json()};
}
before(async()=>{
 run("INSERT INTO organizations VALUES('org','Engineering'),('other-org','Other')");
 for(const [user,org,role] of [['owner','org','Owner'],['member','org','Member'],['viewer','org','Viewer'],['outsider','other-org','Owner']]){
  run('INSERT INTO users VALUES(?,?,?,?)',user,user+'@example.test',user,'unused');
  run('INSERT INTO members VALUES(?,?,?)',org,user,role);
  run('INSERT INTO sessions VALUES(?,?,?)',hash(user),user,now()+86400000);
 }
 run("INSERT INTO projects(id,org_id,name,repo) VALUES('project','org','Test','fixture/repo'),('second','org','Second','fixture/second'),('other','other-org','Other','fixture/other')");
 run('INSERT INTO integrations VALUES(?,?,?,?)','org','github',crypt('fixture-only-token'),'fixture');
 globalThis.fetch=async(url,options)=>{
  assert.ok(String(url).startsWith('https://api.github.com/repos/fixture/'),String(url));
  calls.push({url,method:options.method,body:JSON.parse(options.body||'null')});
  return provider(url,options);
 };
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 base='http://127.0.0.1:'+server.address().port;
});
beforeEach(()=>{calls=[];provider=()=>response({number:12,id:120,html_url:'https://github.com/fixture/repo/issues/12'});});
after(async()=>{
 globalThis.fetch=realFetch;
 await new Promise(r=>{server.closeAllConnections();server.close(r);});
 db.close();
 for(const suffix of ['','-wal','-shm'])rmSync(process.env.DATABASE_PATH+suffix,{force:true});
 rmdirSync(directory);
});
test('a repeated issue returns the original result and emits one event, audit and resync',async()=>{
 const first=await request('issue-once');
 assert.equal(first.status,200);
 const reordered={body:issue.body,title:issue.title,action:issue.action};
 assert.deepEqual(await request('issue-once',reordered),first);
 assert.equal(calls.length,1);
 const saved=get("SELECT * FROM github_commands WHERE key='issue-once'");
 assert.equal(saved.status,'completed');
 assert.equal(get('SELECT count(*) n FROM events WHERE event_key=?','github-action:'+saved.id).n,1);
 assert.equal(get('SELECT count(*) n FROM jobs WHERE job_key=?','resync:github-action:'+saved.id).n,1);
 assert.equal(all("SELECT * FROM audit WHERE action='github.action' AND json_extract(payload,'$.command_id')=?",saved.id).length,1);
 const view=await status('issue-once');
 assert.equal(view.body.status,'completed');
 assert.deepEqual(view.body.result,first.body);
 assert.equal(JSON.stringify(view.body).includes('fixture-only-token'),false);
});
test('concurrent requests claim a key once, while a later retry gets the result',async()=>{
 let release,entered;
 const arrived=new Promise(r=>{entered=r;});
 provider=async()=>{entered();await new Promise(r=>{release=r;});return response({id:121,number:13});};
 const pending=request('concurrent');
 await arrived;
 try{
  assert.equal((await request('concurrent')).status,409);
  assert.equal((await status('concurrent')).body.status,'running');
  assert.equal(calls.length,1);
 }finally{release();}
 const done=await pending;
 assert.deepEqual(await request('concurrent'),done);
 assert.equal(calls.length,1);
});
test('missing or invalid keys and invalid actions do not dispatch or reserve commands',async()=>{
 for(const key of [undefined,'bad key','a'.repeat(129)])assert.equal((await request(key)).status,400);
 for(const body of [{action:'unknown'},{action:'comment',number:0,body:'test'},{action:'merge',number:1,sha:'bad'}])assert.equal((await request('invalid',body)).status,400);
 assert.equal(calls.length,0);
 assert.equal(get("SELECT count(*) n FROM github_commands WHERE key='invalid'").n,0);
});
test('a key cannot be reused for another body, project or repository mapping',async()=>{
 assert.equal((await request('conflict')).status,200);
 assert.equal((await request('conflict',{...issue,title:'Different'})).status,409);
 assert.equal((await request('conflict',issue,'owner','second')).status,409);
 run("UPDATE projects SET repo='fixture/remapped' WHERE id='project'");
 try{assert.equal((await request('conflict')).status,409);}
 finally{run("UPDATE projects SET repo='fixture/repo' WHERE id='project'");}
 assert.equal(calls.length,1);
});
test('cached results and operation status still enforce current permissions and ownership',async()=>{
 assert.equal((await request('permission')).status,200);
 for(const token of ['viewer','outsider']){
  assert.equal((await request('permission',issue,token)).status,403);
  assert.equal((await status('permission',token)).status,403);
 }
 assert.equal((await status('permission','member')).status,404);
 assert.equal((await status('permission','owner','second')).status,404);
 run("UPDATE members SET role='Viewer' WHERE user_id='owner' AND org_id='org'");
 try{
  assert.equal((await request('permission')).status,403);
  assert.equal((await status('permission')).status,403);
 }finally{run("UPDATE members SET role='Owner' WHERE user_id='owner' AND org_id='org'");}
 assert.equal(calls.length,1);
 // Different users have independent operation keys.
 assert.equal((await request('permission',issue,'member')).status,200);
 assert.equal(calls.length,2);
});
test('comments, issue closure, labels and branches each dispatch once per operation',async()=>{
 for(const [body,result,method] of [
  [{action:'comment',number:12,body:'Review requested'},{id:20},'POST'],
  [{action:'close_issue',number:12},{id:120,number:12,state:'closed'},'PATCH'],
  [{action:'labels',number:12,labels:['bug']},[{name:'bug'}],'POST'],
  [{action:'branch',name:'task/1-test',sha},{ref:'refs/heads/task/1-test',object:{sha}},'POST']
 ]){
  provider=()=>response(result);
  const key='once-'+body.action,first=await request(key,body),count=calls.length;
  assert.equal(first.status,200,JSON.stringify(first));
  assert.equal(calls.at(-1).method,method);
  assert.deepEqual(await request(key,body),first);
  assert.equal(calls.length,count);
 }
 assert.equal(calls.length,4);
});
test('merge replay does not recheck a now-closed PR and retains admin authorization',async()=>{
 const body={action:'merge',number:74,sha};
 provider=(_,options)=>options.method==='GET'?response({draft:false,state:'open',mergeable:true,mergeable_state:'clean',head:{sha}}):response({merged:true,sha});
 const first=await request('merge-once',body);
 assert.equal(first.status,200);
 assert.deepEqual(calls.map(x=>x.method),['GET','PUT']);
 provider=()=>{throw Error('No further provider request allowed');};
 assert.deepEqual(await request('merge-once',body),first);
 assert.equal((await request('member-merge',body,'member')).status,403);
 run("UPDATE members SET role='Member' WHERE user_id='owner' AND org_id='org'");
 try{
  assert.equal((await request('merge-once',body)).status,403);
  assert.equal((await status('merge-once')).status,403);
 }finally{run("UPDATE members SET role='Owner' WHERE user_id='owner' AND org_id='org'");}
 assert.equal(calls.length,2);
});
test('merge preflight rejection performs no write and its failure is replayed',async()=>{
 provider=()=>response({draft:true,state:'open',head:{sha}});
 const body={action:'merge',number:74,sha},first=await request('draft-merge',body);
 assert.equal(first.status,409);
 assert.deepEqual(await request('draft-merge',body),first);
 assert.equal(calls.length,1);
 assert.equal(calls[0].method,'GET');
 assert.equal((await status('draft-merge')).body.status,'rejected');
});
test('permission or repository changes during merge preflight prevent the write',async()=>{
 for(const change of ['permission','repository']){
  provider=()=>{
   if(change==='permission')run("UPDATE members SET role='Viewer' WHERE user_id='owner' AND org_id='org'");
   else run("UPDATE projects SET repo='fixture/remapped' WHERE id='project'");
   return response({draft:false,state:'open',mergeable:true,mergeable_state:'clean',head:{sha}});
  };
  try{assert.equal((await request('changed-'+change,{action:'merge',number:74,sha})).status,change==='permission'?403:409);}
  finally{
   run("UPDATE members SET role='Owner' WHERE user_id='owner' AND org_id='org'");
   run("UPDATE projects SET repo='fixture/repo' WHERE id='project'");
  }
 }
 assert.deepEqual(calls.map(x=>x.method),['GET','GET']);
});
test('definite provider rejections are stored and never resent with the same key',async()=>{
 for(const code of [403,422,429]){
  provider=()=>response({message:'Rejected by fixture'},code);
  const key='rejected-'+code,first=await request(key);
  assert.equal(first.status,502);
  assert.deepEqual(await request(key),first);
  assert.equal((await status(key)).body.status,'rejected');
 }
 assert.equal(calls.length,3);
});
test('timeouts, server failures and unreadable responses remain uncertain without another write',async()=>{
 const fixtures=[
  ()=>{throw new DOMException('Timed out','TimeoutError');},
  ()=>response({message:'Unavailable'},503),
  ()=>response({message:'Timeout'},408),
  ()=>new Response('not JSON',{status:200}),
  ()=>response(null),
  ()=>response({})
 ];
 for(let i=0;i<fixtures.length;i++){
  provider=fixtures[i];const key='uncertain-'+i;
  const first=await request(key);
  assert.equal(first.status,409);
  assert.match(first.body.error,/uncertain/);
  assert.deepEqual(await request(key),first);
  assert.equal((await status(key)).body.status,'uncertain');
 }
 assert.equal(calls.length,fixtures.length);
});
test('local persistence failure after a provider success cannot send the action again',async()=>{
 run("CREATE TEMP TRIGGER fail_action_event BEFORE INSERT ON events WHEN NEW.type='github.action' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 try{
  assert.equal((await request('local-failure')).status,409);
  assert.equal((await request('local-failure')).status,409);
 }finally{run('DROP TRIGGER fail_action_event');}
 const row=get("SELECT * FROM github_commands WHERE key='local-failure'");
 assert.equal(row.status,'uncertain');
 assert.equal(get('SELECT count(*) n FROM events WHERE event_key=?','github-action:'+row.id).n,0);
 assert.equal(get('SELECT count(*) n FROM jobs WHERE job_key=?','resync:github-action:'+row.id).n,0);
 assert.equal(calls.length,1);
});
function child(script){
 return execFileSync(process.execPath,['--input-type=module','--eval',script],{cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:15000,windowsHide:true});
}
test('completed responses survive a fresh process using the same database',async()=>{
 const first=await request('restart');
 const output=child("globalThis.fetch=()=>{throw Error('Provider must not be called');};const {githubAction}=await import('./src/github-actions.js');console.log(JSON.stringify(await githubAction('owner','project',"+JSON.stringify(issue)+",'restart')));");
 assert.deepEqual(JSON.parse(output.trim()),first.body);
 assert.equal(calls.length,1);
});
test('a crash during dispatch leaves a durable claim that is never reclaimed for another write',async()=>{
 const script="globalThis.fetch=()=>process.exit(33);const {githubAction}=await import('./src/github-actions.js');await githubAction('owner','project',"+JSON.stringify(issue)+",'crash');";
 assert.throws(()=>child(script),error=>error.status===33);
 assert.equal(get("SELECT status FROM github_commands WHERE key='crash'").status,'running');
 assert.equal((await request('crash')).status,409);
 run("UPDATE github_commands SET created_at=? WHERE key='crash'",now()-61000);
 assert.equal((await status('crash')).body.status,'uncertain');
 assert.match((await request('crash')).body.error,/uncertain/);
 assert.equal(calls.length,0);
});
