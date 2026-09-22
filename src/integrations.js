import {all,get,run,tx,id,now,crypt,fail,enqueue,emit,move,mentions,access} from './core.js';
import {slackNotification,githubUrl} from './slack-notifications.js';
export async function external(provider,org,path,method='GET',body){
 const integration=get('SELECT * FROM integrations WHERE org_id=? AND provider=?',org,provider);if(!integration)fail(409,`${provider} is not connected`);
 const url=provider==='github'?`https://api.github.com${path}`:`https://slack.com/api/${path}`;
 const response=await fetch(url,{method,headers:{Authorization:`Bearer ${crypt(integration.token,true)}`,Accept:'application/json','Content-Type':'application/json',...(provider==='github'?{'X-GitHub-Api-Version':'2022-11-28'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok||(provider==='slack'&&!data.ok)){
 const reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
 const retryAfter=Number(response.headers.get('retry-after'))*1000;
 throw Object.assign(new Error(`${provider} ${response.status}: ${data.error||data.message||'Request failed'}`),{retryAt:Math.max(now()+retryAfter,reset||0),status:502});
 }return data;
}
export async function pages(org,path){let result=[];for(let page=1;page<=100;page++){const items=await external('github',org,`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);if(!Array.isArray(items))throw Error('Expected GitHub collection');result.push(...items);if(items.length<100)return result;}throw Error('Pagination limit exceeded; narrow reconciliation scope');}
function references(p,obj){const content=[obj.title,obj.body,obj.message||obj.commit?.message,obj.head?.ref,obj.ref].filter(Boolean).join(' ');const tids=mentions(p.id,content).tasks;const sha=obj.head?.sha||obj.head_sha;
 if(sha)for(const t of all('SELECT l.task_id FROM task_links l JOIN tasks t ON t.id=l.task_id WHERE t.project_id=? AND l.kind=? AND l.external_id=? AND t.deleted_at IS NULL',p.id,'commit',sha))tids.push(t.task_id);
 return [...new Set(tids)];
}
const objectId=obj=>String(obj.number??obj.sha??obj.id??obj.name);
const objectStamp=obj=>obj.updated_at||obj.completed_at||obj.submitted_at||obj.published_at||obj.started_at||obj.commit?.committer?.date||obj.timestamp||'1970-01-01T00:00:00Z';
const laterThan=(a,b)=>Number.isFinite(Date.parse(a))&&Number.isFinite(Date.parse(b))?Date.parse(a)>Date.parse(b):a>b;
const objectType=(kind,obj)=>kind==='pr'?(obj.merged?'pr.merged':obj.state==='open'?'pr.opened':'pr.closed'):kind==='check'?(obj.conclusion==='failure'?'ci.failed':'ci.updated'):kind==='release'?'release.created':`${kind}.updated`;

function linkSnapshot(p,kind,obj,stamp,type,changed){
 const eid=objectId(obj),pid=p.id;
 const payload={kind,external_id:eid,object_stamp:stamp,url:obj.html_url||obj.url,title:obj.title||obj.message||obj.commit?.message||obj.name||obj.tag_name,author:obj.user?.login||obj.author?.name||obj.commit?.author?.name,state:obj.state,conclusion:obj.conclusion,branch:obj.head?.ref||obj.ref};
 const tids=new Set(references(p,obj));
 if(kind==='review')for(const link of all('SELECT l.task_id FROM task_links l JOIN tasks t ON t.id=l.task_id WHERE t.project_id=? AND l.kind=? AND l.external_id=? AND t.deleted_at IS NULL',pid,'pr',String(obj.pull_request_number)))tids.add(link.task_id);
 const eventStamp=kind==='commit'?'immutable':stamp;
 let linked=false;
 for(const tid of tids){
  const added=!!run('INSERT OR IGNORE INTO task_links VALUES(?,?,?,?)',tid,kind,eid,obj.html_url||obj.url||null).changes;
  linked ||= added;
  if(!changed&&!added)continue;
  // Recover the current lifecycle for a newly associated task, not an old PR opening.
  const taskType=added?objectType(kind,obj):type;
  if(kind==='commit'&&get("SELECT 1 FROM events WHERE project_id=? AND task_id=? AND type='commit.updated' AND json_extract(payload,'$.external_id')=?",pid,tid,eid))continue;
  emit(pid,taskType,payload,tid,null,'github',`github:${pid}:${kind}:${eid}:${eventStamp}:${taskType}:${tid}`);
 }
 if(changed&&!tids.size&&(kind!=='commit'||!get("SELECT 1 FROM events WHERE project_id=? AND type='commit.updated' AND json_extract(payload,'$.external_id')=?",pid,eid)))emit(pid,type,payload,null,null,'github',`github:${pid}:${kind}:${eid}:${eventStamp}:${type}`);
 return linked;
}

function reconcileLinks(p){
 // PRs must be linked before reviews that refer only to their PR number.
 for(const row of all("SELECT * FROM external_objects WHERE project_id=? AND kind IN ('pr','check','review') ORDER BY CASE kind WHEN 'pr' THEN 0 ELSE 1 END",p.id)){
  const obj=JSON.parse(row.payload);
  linkSnapshot(p,row.kind,obj,row.updated_at,objectType(row.kind,obj),false);
 }
}

export function ingest(pid,kind,obj,overrideType){
 const p=get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL',pid);if(!p)return;
 const eid=objectId(obj),previous=get('SELECT * FROM external_objects WHERE project_id=? AND kind=? AND external_id=?',pid,kind,eid);
 const old=previous?JSON.parse(previous.payload):null;
 let stamp=objectStamp(obj),changed=!previous||previous.payload!==JSON.stringify(obj);
 // Even an unchanged/stale delivery can repair missing links using the newest stored snapshot.
 if(previous&&(laterThan(previous.updated_at,stamp)||(kind==='pr'&&old.merged&&!obj.merged))){obj=old;stamp=previous.updated_at;changed=false;}
 if(changed)run('INSERT INTO external_objects VALUES(?,?,?,?,?) ON CONFLICT(project_id,kind,external_id) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload',pid,kind,eid,stamp,JSON.stringify(obj));
 const samePrState=kind==='pr'&&old&&old.state===obj.state&&!!old.merged===!!obj.merged;
 const type=overrideType||(samePrState?'pr.updated':objectType(kind,obj));
 const linked=linkSnapshot(p,kind,obj,stamp,type,changed);
 if(linked&&['commit','pr'].includes(kind))reconcileLinks(p);
}
export function githubDelivery(data){
 const p=get('SELECT * FROM projects WHERE repo=? AND deleted_at IS NULL',data.body.repository?.full_name||'');if(!p)return;
 const b=data.body;
 if(data.event==='push')for(const c of b.commits||[])ingest(p.id,'commit',{...c,sha:c.id,message:c.message,html_url:c.url});
 if(b.pull_request&&data.event==='pull_request')ingest(p.id,'pr',b.pull_request);
 if(b.issue)ingest(p.id,'issue',b.issue);
 if(b.review)ingest(p.id,'review',{...b.review,pull_request_number:b.pull_request.number,head:b.pull_request.head,title:b.pull_request.title});
 if(b.check_run)ingest(p.id,'check',b.check_run);
 if(b.check_suite)ingest(p.id,'check',b.check_suite);
 if(b.release)ingest(p.id,'release',b.release,'release.created');
}
export async function resync(pid){
 const p=get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL',pid);if(!p?.repo)return;
 const root=`/repos/${p.repo}`;
 const branches=await pages(p.org_id,`${root}/branches`);for(const b of branches)tx(()=>ingest(pid,'branch',b));
 // Walk all current branches; duplicate commits collapse at their SHA.
 for(const branch of branches){const commits=await pages(p.org_id,`${root}/commits?sha=${encodeURIComponent(branch.name)}`);for(const c of commits)tx(()=>ingest(pid,'commit',{...c,message:c.commit.message,updated_at:c.commit.committer.date}));}
 for(const issue of await pages(p.org_id,`${root}/issues?state=all`))if(!issue.pull_request)tx(()=>ingest(pid,'issue',issue));
 for(const item of await pages(p.org_id,`${root}/pulls?state=all`)){
 const pr=await external('github',p.org_id,`${root}/pulls/${item.number}`);tx(()=>ingest(pid,'pr',pr));
 for(const r of await pages(p.org_id,`${root}/pulls/${item.number}/reviews`))tx(()=>ingest(pid,'review',{...r,pull_request_number:pr.number,head:pr.head,title:pr.title,updated_at:r.submitted_at}));
 for(let page=1;page<=100;page++){const checks=await external('github',p.org_id,`${root}/commits/${pr.head.sha}/check-runs?per_page=100&page=${page}`);for(const c of checks.check_runs)tx(()=>ingest(pid,'check',c));if(checks.check_runs.length<100)break;if(page===100)throw Error('Check pagination limit');}
 }
 for(const release of await pages(p.org_id,`${root}/releases`))tx(()=>ingest(pid,'release',release,'release.created'));
}
export function processEvent(eid){
 const e=get('SELECT * FROM events WHERE id=?',eid),payload=JSON.parse(e.payload),p=get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL',e.project_id);if(!p)return;
 const t=e.task_id?get('SELECT t.*,c.name AS status FROM tasks t JOIN columns c ON c.id=t.column_id WHERE t.id=? AND t.deleted_at IS NULL',e.task_id):null;
 const users=new Set([t?.assignee,...(payload.mentions?.users||[])]);if(e.type==='task.comment'&&t)for(const c of all('SELECT DISTINCT user_id FROM comments WHERE task_id=?',t.id))users.add(c.user_id);
 for(const uid of users)if(uid&&get('SELECT 1 FROM members WHERE org_id=? AND user_id=?',p.org_id,uid))run('INSERT OR IGNORE INTO notifications(id,event_id,user_id) VALUES(?,?,?)',id(),eid,uid);
 const notification=slackNotification(e,payload,p,t);
 const slack=(text,url,ruleId)=>{if(p.slack_channel&&get('SELECT 1 FROM integrations WHERE org_id=? AND provider=?',p.org_id,'slack'))enqueue(ruleId?`slack:${eid}:rule:${ruleId}`:`slack:${eid}`,'slack',{project_id:p.id,task_id:t?.id||null,text,url});};
 const rules=all('SELECT * FROM rules WHERE project_id=? AND trigger=? AND enabled=1 ORDER BY id',p.id,e.type).filter(r=>!r.condition_status||t?.status===r.condition_status);
 if(notification&&!rules.some(r=>r.action==='slack'))slack(notification.text,notification.url);
 const current=e.source==='github'&&payload.kind?get('SELECT * FROM external_objects WHERE project_id=? AND kind=? AND external_id=?',p.id,payload.kind,String(payload.external_id)):null;
 const stale=current&&(payload.kind==='pr'
  ?e.type!=='pr.updated'&&objectType('pr',JSON.parse(current.payload))!==e.type
  :(payload.object_stamp&&laterThan(current.updated_at,payload.object_stamp))||(payload.kind==='check'&&JSON.parse(current.payload).conclusion!==payload.conclusion));
 for(const r of rules){
 if(stale&&['set_status','comment'].includes(r.action))continue;
 if(r.action==='set_status'&&t&&e.source!=='automation'){
 // Delayed PR-open events cannot reopen a completed task.
 if(!(e.type==='pr.opened'&&t.status==='Done'))move(t,r.value,null,'automation');
 }
 if(r.action==='comment'&&t&&e.source!=='automation'){run('INSERT INTO comments VALUES(?,?,?,?,?)',id(),t.id,null,r.value,now());emit(p.id,'task.comment',{body:r.value},t.id,null,'automation',`rule:${r.id}:${eid}`);}
 if(r.action==='slack')slack(r.value,notification?.url,r.id);
 }
}
export async function sendSlack(data){const p=get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL',data.project_id);if(!p?.slack_channel)return;
 const blocks=[{type:'section',text:{type:'plain_text',text:data.text.slice(0,2900)}}];
 if(githubUrl(data.url))blocks.push({type:'actions',elements:[{type:'button',text:{type:'plain_text',text:'GitHub’da aç'},url:data.url}]});
 if(data.task_id)blocks.push({type:'actions',elements:[{type:'button',text:{type:'plain_text',text:'Approve'},action_id:'approve',value:String(data.task_id)},{type:'button',text:{type:'plain_text',text:'Reject'},style:'danger',action_id:'reject',value:String(data.task_id)},{type:'button',text:{type:'plain_text',text:'Assign to Me'},action_id:'assign',value:String(data.task_id)},{type:'button',text:{type:'plain_text',text:'Open Task'},url:`${process.env.PUBLIC_URL||'http://localhost:3000'}/?task=${data.task_id}`} ]});
 await external('slack',p.org_id,'chat.postMessage','POST',{channel:p.slack_channel,text:data.text,blocks});
}
export function slackAction(body){
 const action=body.actions?.[0];if(!['assign','approve','reject'].includes(action?.action_id))fail(400,'Unsupported action');
 const t=get('SELECT t.*,c.name AS status FROM tasks t JOIN columns c ON c.id=t.column_id WHERE t.id=? AND t.deleted_at IS NULL',Number(action.value));if(!t)fail(404,'Task not found');
 const p=get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL',t.project_id);if(!p)fail(404,'Project not found');
 const integration=get('SELECT * FROM integrations WHERE org_id=? AND provider=?',p.org_id,'slack');if(integration?.external_id!==body.team?.id||p.slack_channel!==body.channel?.id)fail(403,'Slack workspace/channel mismatch');
 const identity=get('SELECT * FROM identities WHERE provider=? AND external_id=? AND org_id=?','slack',body.user?.id||'',p.org_id);if(!identity)fail(403,'Link Slack identity first');access(identity.user_id,p.org_id,true);
 if(action.action_id==='assign'){
  run('UPDATE tasks SET assignee=?,version=version+1 WHERE id=?',identity.user_id,t.id);emit(p.id,'task.assigned',{assignee:identity.user_id},t.id,identity.user_id,'slack');return;
 }
 const approved=action.action_id==='approve',bodyText=approved?'Approved in Slack.':'Rejected in Slack; returning to In Progress.';
 run('INSERT INTO comments VALUES(?,?,?,?,?)',id(),t.id,identity.user_id,bodyText,now());
 emit(p.id,approved?'task.review_approved':'task.review_rejected',{body:bodyText},t.id,identity.user_id,'slack');
 if(!approved&&t.status!=='In Progress'&&get('SELECT 1 FROM columns c JOIN boards b ON c.board_id=b.id WHERE b.project_id=? AND c.name=?',p.id,'In Progress'))move(t,'In Progress',identity.user_id,'slack');
}
