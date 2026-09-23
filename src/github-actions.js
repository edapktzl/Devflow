import {get,run,tx,id,now,hash,fail,required,project,access,audit,emit,enqueue} from './core.js';
import {external} from './integrations.js';

const uncertain='GitHub outcome is uncertain. Check GitHub before attempting a new operation; this key will not be sent again.';
function checkedKey(key){
 if(typeof key!=='string'||! /^[A-Za-z0-9._:-]{1,128}$/.test(key))fail(400,'Provide an Idempotency-Key (1-128 letters, digits, ., _, : or -)');
 return key;
}
function command(pr,b){
 const number=Number(b.number),root=`/repos/${pr.repo}`;
 if(['close_issue','comment','labels','merge'].includes(b.action)&&(!Number.isSafeInteger(number)||number<1))fail(400,'Invalid issue/PR number');
 let path,method='POST',body;
 if(b.action==='create_issue'){
  if(b.body!==undefined&&typeof b.body!=='string')fail(400,'Invalid issue body');
  path='/issues';body={title:required(b.title),body:b.body||''};
 }else if(b.action==='close_issue'){path=`/issues/${number}`;method='PATCH';body={state:'closed'};}
 else if(b.action==='comment'){path=`/issues/${number}/comments`;body={body:required(b.body)};}
 else if(b.action==='labels'){
  if(!Array.isArray(b.labels)||b.labels.some(x=>typeof x!=='string'))fail(400,'Invalid labels');
  path=`/issues/${number}/labels`;body={labels:b.labels};
 }else if(b.action==='branch'){
  if(!/^[\w./-]+$/.test(b.name||'')||b.name.includes('..')||! /^[a-f0-9]{40}$/i.test(b.sha||''))fail(400,'Invalid branch or SHA');
  path='/git/refs';body={ref:`refs/heads/${b.name}`,sha:b.sha};
 }else if(b.action==='merge'){
  if(!/^[a-f0-9]{40}$/i.test(b.sha||''))fail(400,'Invalid head SHA');
  path=`/pulls/${number}/merge`;method='PUT';body={sha:b.sha,merge_method:'squash'};
 }else fail(400,'Unknown action');
 return {project_id:pr.id,repo:pr.repo,action:b.action,number:Number.isSafeInteger(number)?number:null,path:root+path,method,body};
}
function confirmed(action,result){
 if(!result||typeof result!=='object')return false;
 if(action==='create_issue'||action==='close_issue')return Number.isSafeInteger(result.number)&&result.number>0;
 if(action==='comment')return typeof result.id==='number'&&result.id>0;
 if(action==='labels')return Array.isArray(result);
 if(action==='branch')return typeof result.ref==='string'&&typeof result.object?.sha==='string';
 return action==='merge'&&result.merged===true;
}
function effectiveStatus(row){
 // An abandoned claim is never leased to another writer: GitHub may have accepted it.
 return row.status==='running'&&now()-row.created_at>60000?'uncertain':row.status;
}
function replay(row){
 const state=effectiveStatus(row);
 if(state==='completed')return JSON.parse(row.response);
 if(state==='rejected')fail(row.error_status,row.error);
 fail(409,state==='running'?'GitHub action is still running; retry with the same key later.':uncertain);
}
export function githubActionStatus(user,pid,key){
 project(user,pid,true);
 const row=get('SELECT * FROM github_commands WHERE user_id=? AND key=? AND project_id=?',user,checkedKey(key),pid);
 if(!row)fail(404,'GitHub action not found');
 if(row.action==='merge')project(user,pid,true,true);
 const status=effectiveStatus(row);
 return {key:row.key,action:row.action,repo:row.repo,status,created_at:row.created_at,updated_at:row.updated_at,
  ...(status==='completed'?{result:JSON.parse(row.response)}:{}),
  ...(status==='rejected'?{error:row.error,error_status:row.error_status}:{}),
  ...(status==='uncertain'?{error:uncertain}:{})};
}
export async function githubAction(user,pid,b,key){
 const pr=project(user,pid,true);
 if(b.action==='merge')access(user,pr.org_id,true,true);
 checkedKey(key);
 if(!pr.repo)fail(409,'Map a repository first');
 const request=command(pr,b),fingerprint=hash(JSON.stringify(request));
 const claimed=tx(()=>{
  const old=get('SELECT * FROM github_commands WHERE user_id=? AND key=?',user,key);
  if(old){
   if(old.request_hash!==fingerprint)fail(409,'Idempotency key reused with another request or repository');
   return {old};
  }
  const cid=id(),stamp=now();
  run("INSERT INTO github_commands(id,user_id,key,project_id,repo,action,request_hash,request,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'running',?,?)",
   cid,user,key,pid,pr.repo,b.action,fingerprint,JSON.stringify(request),stamp,stamp);
  audit(pr.org_id,user,'github.action_started',{command_id:cid,action:b.action,repo:pr.repo});
  return {cid};
 });
 if(claimed.old)return replay(claimed.old);
 const cid=claimed.cid;
 let dispatched=false;
 try{
  if(b.action==='merge'){
   const pull=await external('github',pr.org_id,`/repos/${pr.repo}/pulls/${request.number}`);
   if(pull.draft||pull.state!=='open'||pull.mergeable!==true||pull.mergeable_state!=='clean'||b.sha!==pull.head?.sha)fail(409,'PR must be clean, mergeable and match supplied head SHA');
  }
  // Recheck after an awaited merge preflight, before any external write.
  const current=project(user,pid,true,b.action==='merge');
  if(current.repo!==pr.repo)fail(409,'Repository mapping changed; start a new operation');
  if(!get("SELECT 1 FROM integrations WHERE org_id=? AND provider='github'",pr.org_id))fail(409,'github is not connected');
  dispatched=true;
  const result=await external('github',pr.org_id,request.path,request.method,request.body);
  if(!confirmed(b.action,result))throw Error('GitHub did not confirm the action');
  tx(()=>{
   run("UPDATE github_commands SET status='completed',response=?,updated_at=? WHERE id=?",JSON.stringify(result),now(),cid);
   emit(pid,'github.action',{command_id:cid,action:b.action,number:result.number||request.number},null,user,'platform',`github-action:${cid}`);
   enqueue(`resync:github-action:${cid}`,'resync',{project_id:pid});
  });
  return result;
 }catch(error){
  // Only definite rejections are terminal failures. A timeout/5xx/invalid response can follow a successful write.
  const rejected=!dispatched||(error.providerStatus>=400&&error.providerStatus<500&&error.providerStatus!==408);
  const status=rejected?'rejected':'uncertain';
  const errorStatus=rejected?(error.status||502):409;
  const message=rejected?(error.status?error.message:'GitHub preflight failed; no write was sent.'):uncertain;
  tx(()=>{
   run('UPDATE github_commands SET status=?,error_status=?,error=?,updated_at=? WHERE id=?',status,errorStatus,message,now(),cid);
   audit(pr.org_id,user,`github.action_${status}`,{command_id:cid,action:b.action,repo:pr.repo});
  });
  fail(errorStatus,message);
 }
}
