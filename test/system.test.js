import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH=':memory:';
process.env.TOKEN_KEY='a'.repeat(64);
process.env.GITHUB_WEBHOOK_SECRET='test-github-secret';
process.env.SLACK_SIGNING_SECRET='test-slack-secret';
process.env.SLACK_CLIENT_ID='fixture-slack-client';
process.env.SLACK_CLIENT_SECRET='fixture-slack-secret';
const {server}=await import('../src/server.js');
const {all,get,run,tx,signature,crypt,enqueue,now,id}=await import('../src/core.js');
const {tick,schedule}=await import('../src/worker.js');
const {ingest,external,resync}=await import('../src/integrations.js');
let base,owner,outsider,viewer,org,pid,tid,columns;
async function request(path,method='GET',body,token=owner,headers={},fetchOptions={}){const response=await fetch(base+path,{method,redirect:fetchOptions.redirect||'follow',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token||''}`,...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});const text=await response.text();let parsed=text;try{parsed=JSON.parse(text);}catch{}return {status:response.status,headers:response.headers,body:parsed};}
async function api(path,method='GET',body,token=owner,headers={}){const result=await request('/api'+path,method,body,token,headers);assert.equal(result.status,200,JSON.stringify(result.body));return result.body;}
async function drain(){let n=0;while(await tick()){if(++n>100)throw Error('Queue did not settle');}}
async function user(email,name){await api('/auth/register','POST',{email,name,password:'long-password-123'},'');return api('/auth/login','POST',{email,password:'long-password-123'},'');}
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;owner=(await user('owner@test.dev','owner')).token;outsider=(await user('outside@test.dev','outside')).token;viewer=(await user('viewer@test.dev','viewer')).token;org=(await api('/organizations','POST',{name:'Engineering'})).id;pid=(await api(`/organizations/${org}/projects`,'POST',{name:'DevFlow'})).id;columns=(await api(`/projects/${pid}/board`)).columns;await api(`/organizations/${org}/members`,'POST',{email:'viewer@test.dev',role:'Viewer'});tid=(await api(`/projects/${pid}/tasks`,'POST',{title:'Login validation',assignee:(await api('/me')).id})).id;});
after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
test('team membership changes and deletion preserve accounts and enforce tenant and role boundaries',async()=>{
 const ownerId=(await api('/me')).id,viewerId=(await api('/me','GET',undefined,viewer)).id;
 const outsiderId=(await api('/me','GET',undefined,outsider)).id;
 const admin=(await user('team-admin@test.dev','team-admin')).token;
 const member=(await user('team-member@test.dev','team-member')).token;
 await api(`/organizations/${org}/members`,'POST',{email:'team-admin@test.dev',role:'Admin'});
 await api(`/organizations/${org}/members`,'POST',{email:'team-member@test.dev',role:'Member'});
 const {id:team}=await api(`/organizations/${org}/teams`,'POST',{name:'Lifecycle',members:[ownerId,ownerId]});
 const path=`/organizations/${org}/teams/${team}`;
 const otherOrg=(await api('/organizations','POST',{name:'Other tenant'},outsider)).id;
 for(const token of [viewer,member,outsider]){
  assert.equal((await request(`/api${path}/members/${viewerId}`,'PUT',{},token)).status,403);
  assert.equal((await request(`/api${path}/members/${ownerId}`,'DELETE',{},token)).status,403);
  assert.equal((await request(`/api${path}`,'DELETE',{},token)).status,403);
 }
 for(const [suffix,method] of [[`/members/${outsiderId}`,'PUT'],[`/members/${ownerId}`,'DELETE'],['','DELETE']]){
  assert.equal((await request(`/api/organizations/${otherOrg}/teams/${team}${suffix}`,method,{},outsider)).status,404);
 }
 assert.equal((await request(`/api${path}/members/${outsiderId}`,'PUT',{})).status,400);
 await api(`${path}/members/${viewerId}`,'PUT',{},admin);
 await api(`${path}/members/${viewerId}`,'PUT',{},admin);
 const saved=(await api(`/organizations/${org}/teams`)).find(t=>t.id===team);
 assert.deepEqual(new Set(saved.members.map(m=>m.id)),new Set([ownerId,viewerId]));
 assert.equal(get("SELECT count(*) AS n FROM audit WHERE action='team.member_added' AND json_extract(payload,'$.id')=?",team).n,1);
 await api(`${path}/members/${viewerId}`,'DELETE',{},admin);
 assert.equal((await api(`/organizations/${org}/teams`)).find(t=>t.id===team).members.length,1);
 await api(path,'DELETE',{},admin);
 assert.ok(!(await api(`/organizations/${org}/teams`)).some(t=>t.id===team));
 assert.equal(get('SELECT count(*) AS n FROM team_members WHERE team_id=?',team).n,0);
 assert.ok(get('SELECT 1 FROM users WHERE id=?',ownerId));
 assert.ok((await api(`/organizations/${org}/members`)).some(m=>m.id===viewerId));
 assert.equal((await request(`/api${path}/members/${ownerId}`,'PUT',{})).status,404);
 assert.ok(get("SELECT 1 FROM audit WHERE action='team.deleted' AND json_extract(payload,'$.id')=?",team));
});
test('invalid team membership rolls back the whole team creation',async()=>{
 const before=get('SELECT count(*) AS n FROM teams WHERE org_id=?',org).n;
 const ownerId=(await api('/me')).id,outsiderId=(await api('/me','GET',undefined,outsider)).id;
 for(const members of ['invalid',[null],[''],[ownerId,outsiderId]]){
  assert.equal((await request(`/api/organizations/${org}/teams`,'POST',{name:'Invalid',members})).status,400);
 }
 assert.equal(get('SELECT count(*) AS n FROM teams WHERE org_id=?',org).n,before);
});
test('login, organization, board and tenant boundaries',async()=>{assert.equal((await request(`/api/projects/${pid}/board`,'GET',undefined,outsider)).status,403);assert.equal((await request(`/api/tasks/${tid}`,'GET',undefined,outsider)).status,403);assert.equal((await request(`/api/projects/${pid}/tasks`,'POST',{title:'forbidden'},viewer)).status,403);assert.equal((await request('/api/me','GET',undefined,'')).status,401);assert.equal((await api(`/projects/${pid}/board`, 'GET',undefined,viewer)).columns.length,5);});
test('organization teams list assigned members and enforce organization roles',async()=>{const ownerId=(await api('/me')).id;const created=await api(`/organizations/${org}/teams`,'POST',{name:'Platform',members:[ownerId]});const teams=await api(`/organizations/${org}/teams`);assert.deepEqual(teams.find(team=>team.id===created.id),{id:created.id,org_id:org,name:'Platform',members:[{id:ownerId,name:'owner'}]});assert.equal((await request(`/api/organizations/${org}/teams`,'GET',undefined,outsider)).status,403);assert.equal((await request(`/api/organizations/${org}/teams`,'POST',{name:'Forbidden'},viewer)).status,403);});
test('task validation, idempotency and optimistic concurrency',async()=>{const payload={title:'Idempotent task'};const headers={'Idempotency-Key':'create-once'};const a=await api(`/projects/${pid}/tasks`,'POST',payload,owner,headers);const b=await api(`/projects/${pid}/tasks`,'POST',payload,owner,headers);assert.equal(a.id,b.id);assert.equal((await request(`/api/projects/${pid}/tasks`,'POST',{title:'Different'},owner,headers)).status,409);const t=await api(`/tasks/${tid}`);await api(`/tasks/${tid}`,'PATCH',{version:t.version,description:'Updated'});assert.equal((await request(`/api/tasks/${tid}`,'PATCH',{version:t.version,title:'Stale'})).status,409);assert.equal((await request(`/api/projects/${pid}/tasks`,'POST',{title:'Bad',assignee:(await api('/me','GET',undefined,outsider)).id})).status,400);});
test('project-scoped columns, subtasks, messages and mentions',async()=>{const other=(await api(`/organizations/${org}/projects`,'POST',{name:'Other project'})).id;const col=(await api(`/projects/${other}/board`)).columns[0].id;assert.equal((await request(`/api/projects/${pid}/tasks`,'POST',{title:'Bad',column_id:col})).status,400);const sub=await api(`/projects/${pid}/tasks`,'POST',{title:'Subtask',parent_id:tid});assert.equal(sub.parent_id,tid);const m=await api(`/projects/${pid}/messages`,'POST',{body:`@owner TASK-${tid} hazır`});assert.deepEqual(m.links.tasks,[tid]);assert.equal(m.links.users.length,1);assert.equal((await request(`/api/projects/${other}/messages`,'POST',{body:'Cross project',reply_to:m.id})).status,400);await drain();assert.ok((await api('/notifications')).length);});
test('custom Kanban columns can be created and fully reordered',async()=>{
 const board=await api(`/projects/${pid}/board`);
 const created=await api(`/projects/${pid}/columns`,'POST',{board_id:board.boards[0].id,name:'QA'});
 const withCustom=await api(`/projects/${pid}/board`);
 assert.equal(withCustom.columns.at(-1).id,created.id);
 const reversed=withCustom.columns.map(column=>column.id).reverse();
 await api(`/projects/${pid}/columns/order`,'PUT',{ids:reversed});
 assert.deepEqual((await api(`/projects/${pid}/board`)).columns.map(column=>column.id),reversed);
 assert.equal((await request(`/api/projects/${pid}/columns/order`,'PUT',{ids:reversed.slice(1)})).status,400);
 assert.equal((await request(`/api/projects/${pid}/columns/order`,'PUT',{ids:[...reversed.slice(0,-1),reversed.at(-1),reversed.at(-1)]})).status,400);
});
async function webhook(event,body,delivery=id()){const raw=JSON.stringify(body);return request('/webhooks/github','POST',raw,'',{'X-GitHub-Event':event,'X-GitHub-Delivery':delivery,'X-Hub-Signature-256':signature(process.env.GITHUB_WEBHOOK_SECRET,raw)});}
test('signed GitHub commit → PR → merge workflow; replay dedup and ordering',async()=>{run('UPDATE projects SET repo=? WHERE id=?','test/repo',pid);const repo={full_name:'test/repo'};assert.equal((await request('/webhooks/github','POST',{repository:repo},'',{'X-Hub-Signature-256':'bad'})).status,401);const commit={id:'abc123',message:`TASK-${tid} fix login`,url:'https://github.com/test/repo/commit/abc123',timestamp:'2026-09-20T10:00:00Z'};for(let i=0;i<5;i++)assert.equal((await webhook('push',{repository:repo,commits:[commit]},'same-delivery')).status,200);await drain();assert.equal(get('SELECT count(*) AS n FROM task_links WHERE task_id=? AND kind=?',tid,'commit').n,1);const pr={number:74,title:`TASK-${tid} Login`,state:'open',merged:false,head:{sha:'abc123',ref:`task/${tid}-login`},updated_at:'2026-09-20T11:00:00Z',html_url:'https://github.com/test/repo/pull/74'};await webhook('pull_request',{repository:repo,pull_request:pr});await drain();assert.equal((await api(`/tasks/${tid}`)).status,'Review');await webhook('pull_request',{repository:repo,pull_request:{...pr,state:'closed',merged:true,updated_at:'2026-09-20T12:00:00Z'}});await drain();assert.equal((await api(`/tasks/${tid}`)).status,'Done');await webhook('pull_request',{repository:repo,pull_request:pr});await drain();assert.equal((await api(`/tasks/${tid}`)).status,'Done');const count=get('SELECT count(*) AS n FROM notifications').n;await webhook('pull_request',{repository:repo,pull_request:{...pr,state:'closed',merged:true,updated_at:'2026-09-20T12:00:00Z'}});await drain();assert.equal(get('SELECT count(*) AS n FROM notifications').n,count);});
test('CI failure links by commit and executes database-defined automation',async()=>{tx(()=>ingest(pid,'check',{id:10,head_sha:'abc123',conclusion:'failure',completed_at:'2026-09-20T13:00:00Z',html_url:'https://github.com/test/repo/actions/runs/10'}));await drain();assert.ok((await api(`/tasks/${tid}`)).comments.some(c=>c.body.includes('CI failed')));});
test('Slack signature, timestamp, identity, tenant and duplicate action protection',async()=>{const uid=(await api('/me')).id;run('INSERT INTO integrations VALUES(?,?,?,?)',org,'slack',crypt('test-token'),'T123');run('UPDATE projects SET slack_channel=? WHERE id=?','C123',pid);await api(`/organizations/${org}/slack/identities`,'POST',{user_id:uid,slack_user_id:'U123'});assert.deepEqual(await api(`/organizations/${org}/slack/identities`),[{user_id:uid,slack_user_id:'U123'}]);const payload={team:{id:'T123'},channel:{id:'C123'},user:{id:'U123'},actions:[{action_id:'assign',value:String(tid)}]};const raw=new URLSearchParams({payload:JSON.stringify(payload)}).toString();const stamp=String(Math.floor(now()/1000));const headers={'Content-Type':'application/x-www-form-urlencoded','X-Slack-Request-Timestamp':stamp,'X-Slack-Signature':signature(process.env.SLACK_SIGNING_SECRET,`v0:${stamp}:${raw}`,'v0=')};const version=(await api(`/tasks/${tid}`)).version;assert.equal((await request('/webhooks/slack','POST',raw,'',headers)).status,200);assert.equal((await request('/webhooks/slack','POST',raw,'',headers)).status,200);assert.equal((await api(`/tasks/${tid}`)).version,version+1);payload.actions[0].action_id='approve';const approved=new URLSearchParams({payload:JSON.stringify(payload)}).toString();assert.equal((await request('/webhooks/slack','POST',approved,'',{...headers,'X-Slack-Signature':signature(process.env.SLACK_SIGNING_SECRET,`v0:${stamp}:${approved}`,'v0=')})).status,200);assert.ok((await api(`/tasks/${tid}`)).comments.some(c=>c.body==='Approved in Slack.'));payload.actions[0].action_id='reject';const rejected=new URLSearchParams({payload:JSON.stringify(payload)}).toString();assert.equal((await request('/webhooks/slack','POST',rejected,'',{...headers,'X-Slack-Signature':signature(process.env.SLACK_SIGNING_SECRET,`v0:${stamp}:${rejected}`,'v0=')})).status,200);assert.equal((await api(`/tasks/${tid}`)).status,'In Progress');assert.equal((await request('/webhooks/slack','POST',raw,'',{...headers,'X-Slack-Request-Timestamp':'1'})).status,401);payload.team.id='OTHER';const wrong=new URLSearchParams({payload:JSON.stringify(payload)}).toString();assert.equal((await request('/webhooks/slack','POST',wrong,'',{...headers,'X-Slack-Signature':signature(process.env.SLACK_SIGNING_SECRET,`v0:${stamp}:${wrong}`,'v0=')})).status,403);run('DELETE FROM integrations WHERE org_id=? AND provider=?',org,'slack');await drain();});
test('durable retries, dead letters and expired lease recovery',async()=>{enqueue('test-failed','unknown',{});await tick();let job=get('SELECT * FROM jobs WHERE job_key=?','test-failed');assert.equal(job.status,'pending');assert.equal(job.attempts,1);for(let i=0;i<5;i++){run('UPDATE jobs SET available_at=0 WHERE id=?',job.id);await tick();}assert.equal(get('SELECT status FROM jobs WHERE id=?',job.id).status,'dead');enqueue('lease-test','event',{id:get('SELECT id FROM events LIMIT 1').id});run("UPDATE jobs SET status='running',lease_until=0 WHERE job_key='lease-test'");await tick();assert.equal(get("SELECT status FROM jobs WHERE job_key='lease-test'").status,'done');});
test('external adapter sends real API-shaped request and honors rate-limit headers',async()=>{run('INSERT INTO integrations VALUES(?,?,?,?)',org,'github',crypt('fixture-token'),'123');const original=globalThis.fetch;try{globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.github.com/user');assert.equal(options.headers.Authorization,'Bearer fixture-token');return new Response(JSON.stringify({message:'rate limited'}),{status:429,headers:{'Retry-After':'60'}});};await assert.rejects(()=>external('github',org,'/user'),e=>e.retryAt>now()+50000);}finally{globalThis.fetch=original;}run('DELETE FROM integrations WHERE org_id=? AND provider=?',org,'github');});
test('SSE requires auth and emits project events',async()=>{const controller=new AbortController();const response=await fetch(`${base}/api/projects/${pid}/stream`,{headers:{Authorization:`Bearer ${owner}`},signal:controller.signal});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);const {value}=await response.body.getReader().read();assert.match(new TextDecoder().decode(value),/data:.*project.created/);controller.abort();assert.equal((await request(`/api/projects/${pid}/stream`,'GET',undefined,outsider)).status,403);});
test('OAuth callback exchanges code, encrypts token, binds org and consumes state once',async()=>{
 process.env.GITHUB_CLIENT_ID='fixture-client';process.env.GITHUB_CLIENT_SECRET='fixture-secret';
 assert.equal((await request(`/api/organizations/${org}/oauth/github`,'POST',{},viewer)).status,403);
 const slackStart=await api(`/organizations/${org}/oauth/slack`,'POST',{});assert.match(slackStart.url,/slack\.com\/oauth\/v2\/authorize/);assert.equal(new URL(slackStart.url).searchParams.get('client_id'),'fixture-slack-client');
 const {url}=await api(`/organizations/${org}/oauth/github`,'POST',{}),state=new URL(url).searchParams.get('state');
 const original=globalThis.fetch;try{globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith(base))return original(url,options);
 if(url==='https://github.com/login/oauth/access_token'){assert.equal(options.body.get('client_id'),'fixture-client');return new Response(JSON.stringify({access_token:'oauth-test-token'}));}
 if(url==='https://api.github.com/user')return new Response(JSON.stringify({id:99}));if(url==='https://api.github.com/repos/TEST/REPO')return new Response(JSON.stringify({full_name:'test/repo'}));throw Error('Unexpected fixture URL '+url);
 };assert.equal((await request(`/oauth/github/callback?state=${state}&code=valid`)).status,200);assert.equal((await request(`/oauth/github/callback?state=${state}&code=valid`)).status,400);await api(`/projects/${pid}`,'PATCH',{repo:'TEST/REPO'});assert.equal(get('SELECT repo FROM projects WHERE id=?',pid).repo,'test/repo');
 }finally{globalThis.fetch=original;}
 const integration=get('SELECT * FROM integrations WHERE org_id=? AND provider=?',org,'github');assert.equal(crypt(integration.token,true),'oauth-test-token');assert.equal(integration.external_id,'99');assert.ok(!JSON.stringify(await api(`/organizations/${org}/integrations`)).includes('token'));
});
test('OAuth provider failures return safe actionable errors without secrets',async()=>{
 const start=await api(`/organizations/${org}/oauth/slack`,'POST',{}),state=new URL(start.url).searchParams.get('state');const original=globalThis.fetch;try{globalThis.fetch=async(url,options)=>String(url).startsWith(base)?original(url,options):new Response(JSON.stringify({ok:false,error:'invalid_code'}),{status:200});const rejected=await request(`/oauth/slack/callback?state=${state}&code=bad`);assert.equal(rejected.status,502);assert.equal(rejected.body.error,'slack OAuth authorization failed: invalid_code');
 const retry=await api(`/organizations/${org}/oauth/slack`,'POST',{}),retryState=new URL(retry.url).searchParams.get('state');globalThis.fetch=async(url,options)=>{if(String(url).startsWith(base))return original(url,options);throw Object.assign(new Error('network unavailable'),{cause:{code:'EACCES'}})};const unavailable=await request(`/oauth/slack/callback?state=${retryState}&code=network`);assert.equal(unavailable.status,502);assert.equal(unavailable.body.error,'slack OAuth token exchange unavailable');}finally{globalThis.fetch=original;}
});
test('GitHub OAuth identity failures return a safe provider error',async()=>{
 process.env.GITHUB_CLIENT_ID='fixture-client';process.env.GITHUB_CLIENT_SECRET='fixture-secret';
 const start=await api(`/organizations/${org}/oauth/github`,'POST',{}),state=new URL(start.url).searchParams.get('state');
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,options)=>{
   if(String(url).startsWith(base))return original(url,options);
   if(url==='https://github.com/login/oauth/access_token')return new Response(JSON.stringify({access_token:'identity-test-token'}));
   if(url==='https://api.github.com/user')throw Object.assign(new Error('network unavailable'),{cause:{code:'ETIMEDOUT'}});
   throw Error('Unexpected fixture URL '+url);
  };
  const result=await request(`/oauth/github/callback?state=${state}&code=identity-network`);
  assert.equal(result.status,502);
  assert.equal(result.body.error,'github OAuth identity lookup unavailable');
 }finally{globalThis.fetch=original;}
});
test('resync recovers missed PR merge through real adapter and deduplicates repeat scans',async()=>{
 const t=await api(`/projects/${pid}/tasks`,'POST',{title:'Resync recovery',column_id:columns.find(c=>c.name==='In Progress').id,assignee:(await api('/me')).id});
 const pr={number:88,title:`TASK-${t.id} recover missed merge`,state:'closed',merged:true,updated_at:'2026-09-20T15:00:00Z',head:{sha:'resync-sha'},html_url:'https://github.com/test/repo/pull/88'};
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(url,options)=>{if(String(url).startsWith(base))return original(url,options);calls++;const u=new URL(url);assert.equal(u.origin,'https://api.github.com');let body=[];if(u.pathname.endsWith('/pulls'))body=[pr];if(u.pathname.endsWith('/pulls/88'))body=pr;if(u.pathname.endsWith('/check-runs'))body={check_runs:[]};return new Response(JSON.stringify(body));};await resync(pid);await drain();assert.equal((await api(`/tasks/${t.id}`)).status,'Done');const n=get('SELECT count(*) AS n FROM events WHERE task_id=?',t.id).n;await resync(pid);await drain();assert.equal(get('SELECT count(*) AS n FROM events WHERE task_id=?',t.id).n,n);assert.ok(calls>=12);}finally{globalThis.fetch=original;}
});
test('resync queue prevents overlapping jobs for one project',()=>{
 run("DELETE FROM jobs WHERE kind='resync'");
 const first=enqueue('resync-test-1','resync',{project_id:pid});
 assert.equal(first,undefined);
 schedule();
 const active=all("SELECT * FROM jobs WHERE kind='resync' AND status IN ('pending','running') AND json_extract(payload,'$.project_id')=?",pid);
 assert.equal(active.length,1);
 run("DELETE FROM jobs WHERE kind='resync'");
});
test('Slack outbound failure remains durable, then sends interactive message on retry',async()=>{
 run('INSERT INTO integrations VALUES(?,?,?,?)',org,'slack',crypt('slack-adapter-token'),'T123');enqueue('outbound-fixture','slack',{project_id:pid,task_id:tid,text:'task assigned'});
 const original=globalThis.fetch;let attempts=0;
 try{globalThis.fetch=async(url,options)=>{assert.equal(url,'https://slack.com/api/chat.postMessage');assert.equal(options.headers.Authorization,'Bearer slack-adapter-token');const payload=JSON.parse(options.body);assert.equal(payload.channel,'C123');assert.ok(payload.blocks[1].elements.some(action=>action.action_id==='assign'));assert.ok(payload.blocks[1].elements.some(action=>action.action_id==='approve'));if(++attempts===1)return new Response(JSON.stringify({ok:false,error:'ratelimited'}),{status:429,headers:{'Retry-After':'1'}});return new Response(JSON.stringify({ok:true,ts:'123.123'}));};await tick();assert.equal(get("SELECT status FROM jobs WHERE job_key='outbound-fixture'").status,'pending');run("UPDATE jobs SET available_at=0 WHERE job_key='outbound-fixture'");await tick();assert.equal(get("SELECT status FROM jobs WHERE job_key='outbound-fixture'").status,'done');assert.equal(attempts,2);}finally{globalThis.fetch=original;run('DELETE FROM integrations WHERE org_id=? AND provider=?',org,'slack');}
});
test('frontend assets and their module imports are served without authentication',async()=>{
 const pending=['/','/app.js','/style.css'],visited=new Set();
 for(const path of pending){
  if(visited.has(path))continue;
  visited.add(path);
  const response=await fetch(base+path);
  assert.equal(response.status,200,`Frontend asset unavailable: ${path}`);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const source=await response.text();
  assert.ok(source.length>100);
  if(path.endsWith('.js')){
   assert.match(response.headers.get('content-type'),/application\/javascript/);
   for(const match of source.matchAll(/\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)){
    pending.push(new URL(match[1],base+path).pathname);
   }
  }
 }
});
test('deadline scheduling dedup, token encryption and soft deletion',async()=>{const t=await api(`/projects/${pid}/tasks`,'POST',{title:'Overdue',due_date:'2020-01-01'});schedule();schedule();assert.equal(get('SELECT count(*) AS n FROM events WHERE task_id=? AND type=?',t.id,'task.deadline').n,1);const secret='my-secret';assert.notEqual(crypt(secret),secret);assert.equal(crypt(crypt(secret),true),secret);await api(`/tasks/${t.id}`,'DELETE',{version:t.version});assert.equal((await request(`/api/tasks/${t.id}`)).status,404);assert.ok(get('SELECT deleted_at FROM tasks WHERE id=?',t.id).deleted_at);});
