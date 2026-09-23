import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_PATH=':memory:';
process.env.TOKEN_KEY='a'.repeat(64);
process.env.SLACK_SIGNING_SECRET='slack-security-secret';
process.env.SLACK_CLIENT_ID='slack-security-client';
process.env.SLACK_CLIENT_SECRET='slack-security-secret';

const {server}=await import('../src/server.js');
const {all,get,run,crypt,signature,now}=await import('../src/core.js');
let base,owner,org,pid,tid,ownerId,memberToken,viewerToken;

async function request(path,method='GET',body,token=owner,headers={}){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token||''}`,...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
 const text=await response.text();let parsed=text;try{parsed=JSON.parse(text);}catch{}
 return {status:response.status,body:parsed};
}
async function api(path,method='GET',body,token=owner,headers={}){const result=await request('/api'+path,method,body,token,headers);assert.equal(result.status,200,JSON.stringify(result.body));return result.body;}
async function createUser(email,name){await api('/auth/register','POST',{email,name,password:'long-password-123'},'');return api('/auth/login','POST',{email,password:'long-password-123'},'');}
function signed(raw){const stamp=String(Math.floor(now()/1000));return {raw,headers:{'Content-Type':'application/x-www-form-urlencoded','X-Slack-Request-Timestamp':stamp,'X-Slack-Signature':signature(process.env.SLACK_SIGNING_SECRET,`v0:${stamp}:${raw}`,'v0=')}};}

before(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 base=`http://127.0.0.1:${server.address().port}`;
 owner=(await createUser('slack-owner@test.dev','slack-owner')).token;
 ownerId=(await api('/me')).id;
 org=(await api('/organizations','POST',{name:'Slack Security'})).id;
 pid=(await api(`/organizations/${org}/projects`,'POST',{name:'Slack Project'})).id;
 tid=(await api(`/projects/${pid}/tasks`,'POST',{title:'Slack action'})).id;
 const member=await createUser('slack-member@test.dev','slack-member');memberToken=member.token;
 const viewer=await createUser('slack-viewer@test.dev','slack-viewer');viewerToken=viewer.token;
 await api(`/organizations/${org}/members`,'POST',{email:'slack-member@test.dev',role:'Member'});
 await api(`/organizations/${org}/members`,'POST',{email:'slack-viewer@test.dev',role:'Viewer'});
 run('INSERT INTO integrations VALUES(?,?,?,?)',org,'slack',crypt('slack-secret-token'),'TSEC');
 run('UPDATE projects SET slack_channel=? WHERE id=?','CSEC',pid);
 await api(`/organizations/${org}/slack/identities`,'POST',{user_id:ownerId,slack_user_id:'USEC'});
});
after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));

test('Slack tokens stay encrypted and integration responses omit them',async()=>{
 const stored=get('SELECT token FROM integrations WHERE org_id=? AND provider=?',org,'slack').token;
 assert.notEqual(stored,'slack-secret-token');
 assert.equal(crypt(stored,true),'slack-secret-token');
 assert.deepEqual(await api(`/organizations/${org}/integrations`),[{provider:'slack',external_id:'TSEC'}]);
});

test('interactive action uses the Slack actor and canonical duplicate protection',async()=>{
 const payload={team:{id:'TSEC'},channel:{id:'CSEC'},user:{id:'USEC'},actions:[{action_id:'assign',value:String(tid)}],message:{ts:'1700000000.0001'}};
 const firstPayload=JSON.stringify(payload);
 const reorderedPayload=JSON.stringify({message:payload.message,actions:payload.actions,user:payload.user,channel:payload.channel,team:payload.team});
 const first=signed(new URLSearchParams({payload:firstPayload}).toString());
 const second=signed(new URLSearchParams({payload:reorderedPayload}).toString());
 const before=get('SELECT version FROM tasks WHERE id=?',tid).version;
 assert.equal((await request('/webhooks/slack','POST',first.raw,'',first.headers)).status,200);
 assert.equal((await request('/webhooks/slack','POST',second.raw,'',second.headers)).status,200);
 assert.equal(get('SELECT assignee FROM tasks WHERE id=?',tid).assignee,ownerId);
 assert.equal(get('SELECT version FROM tasks WHERE id=?',tid).version,before+1);
 assert.equal(get("SELECT count(*) AS n FROM events WHERE task_id=? AND type='task.assigned'",tid).n,1);
 assert.equal(get("SELECT actor FROM events WHERE task_id=? AND type='task.assigned'",tid).actor,ownerId);
});

test('malformed Slack interactive payload is rejected as a client error',async()=>{
 const {raw,headers}=signed('payload=%7Bnot-json');
 assert.equal((await request('/webhooks/slack','POST',raw,'',headers)).status,400);
});

test('Slack webhook rejects invalid signatures and mismatched actors or channels',async()=>{
 const payload={team:{id:'TSEC'},channel:{id:'CSEC'},user:{id:'USEC'},actions:[{action_id:'assign',value:String(tid)}]};
 const valid=signed(new URLSearchParams({payload:JSON.stringify(payload)}).toString());
 assert.equal((await request('/webhooks/slack','POST',valid.raw,'',{...valid.headers,'X-Slack-Signature':'v0=invalid'})).status,401);
 const wrongChannel=signed(new URLSearchParams({payload:JSON.stringify({...payload,channel:{id:'COTHER'}})}).toString());
 assert.equal((await request('/webhooks/slack','POST',wrongChannel.raw,'',wrongChannel.headers)).status,403);
 const unknownActor=signed(new URLSearchParams({payload:JSON.stringify({...payload,user:{id:'UUNKNOWN'}})}).toString());
 assert.equal((await request('/webhooks/slack','POST',unknownActor.raw,'',unknownActor.headers)).status,403);
});

test('Member and Viewer cannot manage Slack integration settings',async()=>{
 for(const token of [memberToken,viewerToken]){
  assert.equal((await request(`/api/organizations/${org}/oauth/slack`,'POST',{},token)).status,403);
  assert.equal((await request(`/api/organizations/${org}/slack/identities`,'POST',{user_id:ownerId,slack_user_id:'UOTHER'},token)).status,403);
  assert.equal((await request(`/api/organizations/${org}/integrations/slack`,'DELETE',{},token)).status,403);
  assert.equal((await request(`/api/projects/${pid}`,'PATCH',{slack_channel:'COTHER'},token)).status,403);
 }
 assert.deepEqual(await api(`/organizations/${org}/integrations`,'GET',undefined,memberToken),[{provider:'slack',external_id:'TSEC'}]);
});

test('Slack OAuth rejects a response without a workspace identity',async()=>{
 const start=await api(`/organizations/${org}/oauth/slack`,'POST',{});
 const state=new URL(start.url).searchParams.get('state');
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,options)=>String(url).startsWith(base)?original(url,options):new Response(JSON.stringify({ok:true,access_token:'missing-team-token'}));
  const result=await request(`/oauth/slack/callback?state=${state}&code=missing-team`,'GET',undefined,'');
  assert.equal(result.status,502);
  assert.equal(result.body.error,'slack OAuth response missing workspace');
 }finally{globalThis.fetch=original;}
});
