import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slackNotification} from '../src/slack-notifications.js';
process.env.DATABASE_PATH=':memory:';
process.env.TOKEN_KEY='a'.repeat(64);
const {run,all,get,crypt,tx}=await import('../src/core.js');
const {ingest,processEvent,sendSlack}=await import('../src/integrations.js');
run('INSERT INTO organizations VALUES(?,?)','org','Engineering');
run('INSERT INTO projects(id,org_id,name,repo,slack_channel) VALUES(?,?,?,?,?)','project','org','DevFlow','test/repo','C123');
run('INSERT INTO integrations VALUES(?,?,?,?)','org','slack',crypt('fixture-token'),'T123');

test('PR updates and resync do not repeat opened or merged notifications; genuine reopening does',async()=>{
 const pr={number:2,title:'Team management',state:'open',merged:false,head:{ref:'feature/teams'},user:{login:'developer'},html_url:'https://github.com/test/repo/pull/2',updated_at:'2026-09-22T10:00:00Z'};
 const snapshots=[pr,{...pr,updated_at:'2026-09-22T11:00:00Z'},
  {...pr,updated_at:'2026-09-22T11:00:00Z',extra_api_field:true},
  {...pr,state:'closed',updated_at:'2026-09-22T12:00:00Z'},
  {...pr,updated_at:'2026-09-22T13:00:00Z'},
  {...pr,state:'closed',merged:true,updated_at:'2026-09-22T14:00:00Z'},
  {...pr,state:'closed',merged:true,updated_at:'2026-09-22T15:00:00Z'},pr];
 for(const snapshot of snapshots)tx(()=>ingest('project','pr',snapshot));
 const events=all("SELECT * FROM events WHERE json_extract(payload,'$.kind')='pr'");
 assert.equal(events.filter(e=>e.type==='pr.opened').length,2);
 assert.equal(events.filter(e=>e.type==='pr.merged').length,1);
 for(const event of events)tx(()=>processEvent(event.id));
 const jobs=all("SELECT * FROM jobs WHERE kind='slack'");
 assert.equal(jobs.length,4,'Opened, closed, reopened and merged only');
 const first=JSON.parse(jobs[0].payload);
 assert.match(first.text,/DevFlow · Pull request açıldı #2/);
 assert.match(first.text,/Team management/);
 assert.match(first.text,/Repository: test\/repo/);
 assert.match(first.text,/Gönderen: developer/);
 assert.equal(first.url,pr.html_url);
 let sent;
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://slack.com/api/chat.postMessage');sent=JSON.parse(options.body);return new Response(JSON.stringify({ok:true}));};
  await sendSlack({...first,task_id:42});
 }finally{globalThis.fetch=original;}
 assert.equal(sent.blocks[0].text.type,'plain_text');
 const actions=sent.blocks.flatMap(block=>block.elements||[]);
 assert.ok(actions.some(action=>action.url===pr.html_url));
 for(const action of ['approve','reject','assign'])assert.ok(actions.some(item=>item.action_id===action));
 assert.ok(actions.some(action=>action.url?.endsWith('/?task=42')));
});

test('commit webhook and API snapshots with different timestamp shapes create one notification',()=>{
 const sha='abcdef1234567890';
 tx(()=>ingest('project','commit',{id:sha,sha,message:'Fix team management',timestamp:'2026-09-22T10:00:00Z',html_url:`https://github.com/test/repo/commit/${sha}`}));
 tx(()=>ingest('project','commit',{sha,message:'Fix team management',updated_at:'2026-09-22T12:00:00+02:00',commit:{message:'Fix team management'},html_url:`https://github.com/test/repo/commit/${sha}`}));
 assert.equal(get("SELECT count(*) AS n FROM events WHERE type='commit.updated'").n,1);
 const event=get("SELECT * FROM events WHERE type='commit.updated'");
 tx(()=>processEvent(event.id));
 const notification=JSON.parse(get('SELECT payload FROM jobs WHERE job_key=?',`slack:${event.id}`).payload);
 assert.match(notification.text,/Yeni commit abcdef1/);
 assert.match(notification.text,/Fix team management/);
});

test('task changes include task context and unsafe links are not sent to Slack',()=>{
 const project={name:'DevFlow'};
 const task={id:42,title:'Login validation'};
 const notification=slackNotification({type:'task.status_changed'},{from:'In Progress',to:'Review',url:'javascript:alert(1)'},project,task);
 assert.match(notification.text,/TASK-42 · Login validation/);
 assert.match(notification.text,/In Progress → Review/);
 assert.equal(notification.url,undefined);
 assert.ok(!notification.text.includes('javascript:'));
 assert.equal(slackNotification({type:'pr.updated'},{},project,null),null);
});
