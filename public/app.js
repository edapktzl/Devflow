import { createTeamManager } from './teams.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token=sessionStorage.getItem('devflow-token'),me,org,pid,board,members=[],selected,tab='board',streamController,preferredPid,orgRoles=new Map();
const notice=(message,error=false)=>{$('#notice').textContent=message;$('#notice').className=error?'error':'success';};
async function api(path,method='GET',body,idempotencyKey){const r=await fetch('/api'+path,{method,headers:{Authorization:`Bearer ${token||''}`,'Content-Type':'application/json',...(method==='GET'?{}:{'Idempotency-Key':idempotencyKey||crypto.randomUUID()})},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
const safe=fn=>async(...args)=>{try{await fn(...args);}catch(e){notice(e.message,true);}};
function options(el,items,value='id',label='name'){el.innerHTML=items.map(i=>`<option value="${esc(i[value])}">${esc(i[label])}</option>`).join('');}
const teamManager=createTeamManager({api,esc,safe,getOrg:()=>org,getMembers:()=>members,getUserId:()=>me?.id,notice,refreshSettings:()=>settings()});
function clearWorkspaceState(){
 streamController?.abort();streamController=null;pid='';board=undefined;selected=undefined;members=[];
 $('#heading').textContent='Engineering workspace';
 $('#kanban').innerHTML='';$('#messages').innerHTML='';$('#feed').innerHTML='';$('#notifications').innerHTML='';
 $('#members').innerHTML='';$('#rules').innerHTML='';$('#repoList').textContent='';
 for(const id of ['repoForm','githubActionForm','slackForm','slackIdentityForm','ruleForm'])document.getElementById(id)?.reset();$('#githubActionResult').textContent='';
}
function authView(register){
 $('#authForm').hidden=register;$('#registerForm').hidden=!register;
 $('#registerNotice').hidden=true;notice('');
 $('#authForm').elements.password.value='';$('#registerForm').elements.password.value='';
 (register?$('#registerForm').elements.name:$('#authForm').elements.email).focus();
}
$('#showRegister').onclick=()=>{const email=$('#authForm').elements.email.value;$('#registerForm').reset();$('#registerForm').elements.email.value=email;authView(true);};
$('#backToLogin').onclick=()=>authView(false);
$('#registerForm').onsubmit=async event=>{
 event.preventDefault();const form=event.target,submit=$('#registerSubmit'),back=$('#backToLogin');
 if(submit.disabled)return;
 const body=Object.fromEntries(new FormData(form));submit.disabled=true;back.disabled=true;submit.textContent='Kaydediliyor…';$('#registerNotice').hidden=true;
 try{
  const account=await api('/auth/register','POST',body);
  form.reset();$('#authForm').elements.email.value=account.email;authView(false);
  notice('Hesabınız oluşturuldu. Şifrenizi girerek giriş yapabilirsiniz.');$('#authForm').elements.password.focus();
 }catch(error){const box=$('#registerNotice');box.textContent=error.message;box.className='error';box.hidden=false;}
 finally{submit.disabled=false;back.disabled=false;submit.textContent='Kaydı tamamla';}
};
$('#authForm').onsubmit=safe(async e=>{e.preventDefault();const data=await api('/auth/login','POST',Object.fromEntries(new FormData(e.target)));token=data.token;sessionStorage.setItem('devflow-token',token);await start();});
$('#logout').onclick=safe(async()=>{await api('/auth/logout','POST',{});sessionStorage.removeItem('devflow-token');location.reload();});
async function start(){if(!token)return;me=await api('/me');$('#identity').textContent='@'+me.name;$('#auth').hidden=true;$('#workspace').hidden=false;const query=new URLSearchParams(location.search);const integration=query.get('integration');if(integration&&query.get('status')==='connected'){notice(`${integration==='slack'?'Slack':'GitHub'} bağlantısı başarıyla tamamlandı.`);history.replaceState({},'',location.pathname);}const orgs=await api('/organizations');orgRoles=new Map(orgs.map(item=>[item.id,item.role]));options($('#org'),orgs);org=$('#org').value;const deep=query.get('task');if(deep){const t=await api(`/tasks/${Number(deep)}`);for(const o of orgs){const projects=await api(`/organizations/${o.id}/projects`);if(projects.some(p=>p.id===t.project_id)){org=o.id;$('#org').value=org;preferredPid=t.project_id;break;}}}await loadOrg();}
async function loadOrg(){streamController?.abort();if(!org){$('#kanban').innerHTML='<p class="empty">İlk organizasyonunuzu oluşturun.</p>';return;}members=await api(`/organizations/${org}/members`);const projects=await api(`/organizations/${org}/projects`);options($('#project'),projects);if(preferredPid){$('#project').value=preferredPid;preferredPid=null;}pid=$('#project').value;await loadProject();}
async function loadProject(){streamController?.abort();$('#heading').textContent=$('#project').selectedOptions[0]?.textContent||'Engineering workspace';if(!pid){$('#kanban').innerHTML='<p class="empty">Organizasyonunuza bir proje ekleyin.</p>';return;}await refresh();connectStream();const deep=new URLSearchParams(location.search).get('task');if(deep){history.replaceState({},'','/');await openTask(Number(deep));}}
async function refresh(){if(tab==='inbox'){await inbox();return;}if(tab==='settings'){await settings();return;}if(!pid)return;if(tab==='board'){board=await api(`/projects/${pid}/board`);renderBoard();}if(tab==='chat')await chat();if(tab==='activity')await activity();}
function connectStream(){streamController=new AbortController();const signal=streamController.signal;const streamPid=pid;(async()=>{let cursor=0;while(!signal.aborted){try{const r=await fetch(`/api/projects/${streamPid}/stream?after=${cursor}`,{headers:{Authorization:`Bearer ${token}`},signal});if(!r.ok)throw Error('Stream unavailable');$('#connection').textContent='● Canlı bağlantı';const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';while(!signal.aborted){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const parts=buffer.split('\n\n');buffer=parts.pop();let changed=false;for(const part of parts){const line=part.split('\n').find(x=>x.startsWith('id: '));if(line){cursor=Number(line.slice(4));changed=true;}}if(changed||tab==='inbox')await refresh();}}catch(e){if(signal.aborted)return;$('#connection').textContent='○ Yeniden bağlanıyor';}await new Promise(r=>setTimeout(r,2500));}})();}
$('#org').onchange=safe(async()=>{clearWorkspaceState();org=$('#org').value;await loadOrg();});$('#project').onchange=safe(async()=>{pid=$('#project').value;await loadProject();});
$('#newOrg').onclick=safe(async()=>{const name=prompt('Organizasyon adı');if(!name)return;await api('/organizations','POST',{name});await start();});
$('#newProject').onclick=safe(async()=>{if(!org)throw Error('Önce organizasyon oluşturun');const name=prompt('Proje adı');if(!name)return;await api(`/organizations/${org}/projects`,'POST',{name});await loadOrg();});
document.querySelectorAll('[data-tab]').forEach(btn=>btn.onclick=safe(async()=>{tab=btn.dataset.tab;document.querySelectorAll('.tab').forEach(el=>el.hidden=el.id!==tab);document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===btn));await refresh();}));
function renderBoard(){$('#kanban').innerHTML=board.columns.map((c,i)=>{const tasks=board.tasks.filter(t=>t.column_id===c.id);return `<section class="column"><div class="column-head">${esc(c.name)} <small>${tasks.length}</small>${i?`<button data-left="${esc(c.id)}" title="Sola taşı">←</button>`:''}</div>${tasks.map(t=>`<button class="card" data-task="${t.id}"><small>TASK-${t.id}${t.parent_id?` · alt görev / TASK-${t.parent_id}`:''}</small><strong>${esc(t.title)}</strong>${JSON.parse(t.labels).map(l=>`<span class="tag">${esc(l)}</span>`).join('')}<div class="card-foot"><span>${esc(t.priority)} · ${esc(members.find(m=>m.id===t.assignee)?.name||'Atanmamış')}</span><span>${esc(t.due_date||'')}</span></div></button>`).join('')||'<div class="empty">Henüz görev yok</div>'}</section>`;}).join('');$('#kanban').querySelectorAll('[data-task]').forEach(b=>b.onclick=safe(()=>openTask(Number(b.dataset.task))));$('#kanban').querySelectorAll('[data-left]').forEach(b=>b.onclick=safe(async()=>{const ids=board.columns.map(c=>c.id),i=ids.indexOf(b.dataset.left);[ids[i-1],ids[i]]=[ids[i],ids[i-1]];await api(`/projects/${pid}/columns/order`,'PUT',{ids});await refresh();}));}
const activityNames={'task.created':'Görev oluşturuldu','task.assigned':'Görev atandı','task.updated':'Görev güncellendi','task.status_changed':'Görev durumu değişti','task.comment':'Göreve yorum eklendi','task.linked':'Göreve bağlantı eklendi','task.deleted':'Görev silindi','github.action':'GitHub işlemi yapıldı','pr.opened':'Pull request açıldı','pr.merged':'Pull request birleştirildi','ci.failed':'CI başarısız oldu','ci.updated':'CI sonucu güncellendi','review.updated':'Kod incelemesi güncellendi'};
function taskActivityMarkup(events){
 if(!events?.length)return '<h3>Aktivite geçmişi</h3><p class="muted">Henüz aktivite yok.</p>';
 return `<h3>Aktivite geçmişi</h3><div class="task-activity">${events.map(event=>{let payload={};try{payload=JSON.parse(event.payload||'{}');}catch{}const actor=members.find(member=>member.id===event.actor)?.name||(event.source==='github'?'GitHub':'Sistem');const detail=event.type==='task.status_changed'&&payload.from&&payload.to?`${payload.from} → ${payload.to}`:payload.body||payload.title||payload.action||'';return `<div class="item" data-activity-type="${esc(event.type)}"><strong>${esc(activityNames[event.type]||event.type)}</strong><small>${esc(actor)} · ${esc(new Date(event.created_at).toLocaleString())} · ${esc(event.source)}</small>${detail?`<span>${esc(detail)}</span>`:''}</div>`;}).join('')}</div>`;
}
$('#newColumn').onclick=safe(async()=>{if(!pid)throw Error('Proje seçin');const name=prompt('Kolon adı');if(name){await api(`/projects/${pid}/columns`,'POST',{name,board_id:board.boards[0].id});await refresh();}});
$('#newTask').onclick=safe(()=>openTask());$('#closeDialog').onclick=()=>$('#taskDialog').close();
async function openTask(tid){if(!pid)throw Error('Proje seçin');selected=tid?await api(`/tasks/${tid}`):null;if(selected&&selected.project_id!==pid)throw Error('Görev başka projede; ilgili projeyi seçin');board=await api(`/projects/${pid}/board`);const f=$('#taskForm');f.reset();options(f.elements.column_id,board.columns);options(f.elements.assignee,[{id:'',name:'Atanmamış'},...members]);if(selected){for(const k of ['title','description','column_id','assignee','priority','due_date','parent_id'])f.elements[k].value=selected[k]||'';f.elements.labels.value=selected.labels.join(', ');}$('#taskTitle').textContent=selected?`TASK-${selected.id}`:'Yeni görev';$('#deleteTask').hidden=!selected;$('#commentForm').hidden=!selected;$('#taskDetails').innerHTML=selected?`<h3>Bağlantılar</h3>${selected.links.map(l=>`<p><a href="${esc(/^https:\/\/github\.com\//.test(l.url||'')?l.url:'#')}" target="_blank" rel="noreferrer">${esc(l.kind)} ${esc(l.external_id)}</a></p>`).join('')}<h3>Yorumlar</h3>${selected.comments.map(c=>`<div class="item">${esc(c.body)}</div>`).join('')}`:'';if(!$('#taskDialog').open)$('#taskDialog').showModal();}
const openTaskWithActivity=openTask;
openTask=async function(tid){await openTaskWithActivity(tid);if(selected)$('#taskDetails').insertAdjacentHTML('beforeend',taskActivityMarkup(selected.activity));};
$('#taskForm').onsubmit=safe(async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));b.labels=b.labels.split(',').map(x=>x.trim()).filter(Boolean);b.parent_id=Number(b.parent_id)||null;b.assignee=b.assignee||null;b.due_date=b.due_date||null;if(selected){b.version=selected.version;await api(`/tasks/${selected.id}`,'PATCH',b);}else await api(`/projects/${pid}/tasks`,'POST',b);$('#taskDialog').close();await refresh();});
$('#deleteTask').onclick=safe(async()=>{if(confirm('Görev arşivlensin mi?')){await api(`/tasks/${selected.id}`,'DELETE',{version:selected.version});$('#taskDialog').close();await refresh();}});
$('#commentForm').onsubmit=safe(async e=>{e.preventDefault();await api(`/tasks/${selected.id}/comments`,'POST',Object.fromEntries(new FormData(e.target)));e.target.reset();await openTask(selected.id);});
async function chat(){const messages=await api(`/projects/${pid}/messages`);$('#messages').innerHTML=messages.reverse().map(m=>`<div class="item"><strong>@${esc(m.name)}</strong><small>${esc(new Date(m.created_at).toLocaleString())} · ${esc(m.id)}${m.reply_to?` · yanıt: ${esc(m.reply_to)}`:''}</small><p>${esc(m.body)}</p>${JSON.parse(m.links).tasks.map(t=>`<button data-chat-task="${t}">TASK-${t}</button>`).join('')}</div>`).join('')||'<p class="muted">Konuşmayı başlatın.</p>';$('#messages').querySelectorAll('[data-chat-task]').forEach(b=>b.onclick=safe(()=>openTask(Number(b.dataset.chatTask))));}
$('#chatForm').onsubmit=safe(async e=>{e.preventDefault();await api(`/projects/${pid}/messages`,'POST',Object.fromEntries(new FormData(e.target)));e.target.reset();await chat();});
async function activity(){let events=[],cursor=0;for(;;){const batch=await api(`/projects/${pid}/activity?after=${cursor}`);events.push(...batch);if(batch.length<200)break;cursor=batch.at(-1).id;}$('#feed').innerHTML=events.reverse().slice(0,200).map(e=>`<div class="item"><span class="tag">${esc(e.source)}</span> <strong>${esc(e.type)}</strong> ${e.task_id?`TASK-${e.task_id}`:''}<small>${esc(new Date(e.created_at).toLocaleString())}</small><code>${esc(e.payload)}</code></div>`).join('')||'<p>Henüz aktivite yok.</p>';}
async function inbox(){const ns=await api('/notifications');$('#notifications').innerHTML=ns.map(n=>`<div class="item">${n.read_at?'':'● '}${esc(n.type)} ${n.task_id?`TASK-${n.task_id}`:''}<small>${esc(new Date(n.created_at).toLocaleString())}</small><button data-read="${esc(n.id)}">${n.read_at?'Okundu':'Okundu işaretle'}</button></div>`).join('')||'<p>Bildirim yok.</p>';$('#notifications').querySelectorAll('[data-read]').forEach(b=>b.onclick=safe(async()=>{await api(`/notifications/${b.dataset.read}`,'PATCH',{read:true});await inbox();}));}
async function settings(){
 const githubActionForm=$('#githubActionForm');
 if(githubActionForm)githubActionForm.hidden=!pid;
 const canManageIntegrations=['Owner','Admin'].includes(orgRoles.get(org));
 for(const id of ['githubConnect','repos','repoForm','resync','slackConnect','slackForm','slackIdentityForm']){const element=$('#'+id);if(element)element.hidden=!canManageIntegrations;}
 if(!org){$('#members').innerHTML='<p class="empty">Önce bir organizasyon oluşturup seçin.</p>';$('#rules').innerHTML='';await teamManager.render();return;}
 members=await api(`/organizations/${org}/members`);
 $('#members').innerHTML=members.map(m=>`<div class="item">${esc(m.name)} · ${esc(m.role)}<small>${esc(m.id)}</small></div>`).join('');
 await teamManager.render();
 $('#slackIdentityForm').reset();
 const slackIdentities=await api(`/organizations/${org}/slack/identities`);
 const slackIdentity=slackIdentities[0];
 if(slackIdentity){$('#slackIdentityForm').elements.user_id.value=slackIdentity.user_id;$('#slackIdentityForm').elements.slack_user_id.value=slackIdentity.slack_user_id;}
 if(!pid){$('#rules').innerHTML='<p class="empty">Önce bir proje oluşturup seçin.</p>';return;}
 const rules=await api(`/projects/${pid}/rules`);
 $('#rules').innerHTML=rules.filter(r=>r.enabled).map(r=>`<div class="item">${esc(r.trigger)} → ${esc(r.action)}: ${esc(r.value)}<small>Koşul: ${esc(r.condition_status||'Yok')}</small><button data-rule="${esc(r.id)}">Devre dışı bırak</button></div>`).join('');
 $('#rules').querySelectorAll('[data-rule]').forEach(b=>b.onclick=safe(async()=>{await api(`/projects/${pid}/rules/${b.dataset.rule}`,'DELETE',{});await settings();}));
}
const githubActionFields={
 create_issue:['title','body'],
 close_issue:['number'],
 comment:['number','body'],
 labels:['number','labels'],
 branch:['name','sha'],
 merge:['number','sha']
};
function updateGithubActionFields(){
 const form=$('#githubActionForm');if(!form)return;
 const action=form.elements.action.value,visible=githubActionFields[action]||[];
 form.querySelectorAll('[data-github-field]').forEach(label=>{
  const input=label.querySelector('input,textarea');
  const show=visible.includes(label.dataset.githubField);
  label.hidden=!show;if(input)input.required=show;
 });
 const bodyLabel=form.querySelector('[data-github-body-label]');
 if(bodyLabel)bodyLabel.textContent=action==='comment'?'Yorum':'Açıklama';
}
function githubActionPayload(form){
 const action=form.elements.action.value;
 const payload={action};
 if(action==='create_issue'){
  payload.title=form.elements.title.value.trim();payload.body=form.elements.body.value;
 }else if(action==='close_issue'||action==='comment'||action==='labels'||action==='merge'){
  payload.number=Number(form.elements.number.value);
  if(action==='comment')payload.body=form.elements.body.value;
  if(action==='labels')payload.labels=form.elements.labels.value.split(',').map(value=>value.trim()).filter(Boolean);
  if(action==='merge')payload.sha=form.elements.sha.value.trim();
 }else if(action==='branch'){
  payload.name=form.elements.name.value.trim();payload.sha=form.elements.sha.value.trim();
 }
 return payload;
}
$('#githubActionType').onchange=()=>{const form=$('#githubActionForm');delete form.dataset.key;updateGithubActionFields();};
$('#githubActionForm').addEventListener('input',event=>{if(event.target.name!=='action')delete event.currentTarget.dataset.key;});
$('#githubActionForm').onsubmit=safe(async e=>{
 e.preventDefault();if(!pid)throw Error('Önce bir proje oluşturup seçin.');
 if(!confirm('Bu işlem gerçek GitHub verisini değiştirebilir. Devam etmek istiyor musunuz?'))return;
 const form=e.target,key=form.dataset.key||crypto.randomUUID();form.dataset.key=key;
 const result=await api(`/projects/${pid}/github/actions`,'POST',githubActionPayload(form),key);
 $('#githubActionResult').textContent=JSON.stringify(result,null,2);notice('GitHub işlemi tamamlandı.');
 delete form.dataset.key;form.reset();updateGithubActionFields();
});
updateGithubActionFields();
for(const provider of ['github','slack'])$('#'+provider+'Connect').onclick=safe(async()=>{if(!org)throw Error('Önce bir organizasyon oluşturun.');const r=await api(`/organizations/${org}/oauth/${provider}`,'POST',{});location.href=r.url;});
for(const [form,path,method] of [['repoForm',()=>`/projects/${pid}`,'PATCH'],['slackForm',()=>`/projects/${pid}`,'PATCH'],['memberForm',()=>`/organizations/${org}/members`,'POST'],['slackIdentityForm',()=>`/organizations/${org}/slack/identities`,'POST'],['ruleForm',()=>`/projects/${pid}/rules`,'POST']])$('#'+form).onsubmit=safe(async e=>{e.preventDefault();if(['repoForm','slackForm','ruleForm'].includes(form)&&!pid)throw Error('Önce bir proje oluşturup seçin.');if(['memberForm','slackIdentityForm'].includes(form)&&!org)throw Error('Önce bir organizasyon oluşturup seçin.');await api(path(),method,Object.fromEntries(new FormData(e.target)));notice('Kaydedildi');await settings();});
$('#repos').onclick=safe(async()=>{const repos=await api(`/organizations/${org}/github/repositories`);$('#repoList').textContent=repos.map(r=>r.full_name).join('\n');});$('#resync').onclick=safe(async()=>{await api(`/projects/${pid}/github/resync`,'POST',{});notice('Senkronizasyon kuyruğa alındı');});
$('#jobsRefresh').onclick=safe(async()=>{const jobs=await api(`/organizations/${org}/jobs`);$('#jobs').innerHTML=jobs.map(j=>`<div class="item">#${j.id} ${esc(j.kind)} · ${esc(j.status)} · ${j.attempts} deneme<small>${esc(j.error||'')}</small>${j.status==='dead'?`<button data-retry="${j.id}">Bu projede yeniden dene</button>`:''}</div>`).join('')||'Bekleyen iş yok';$('#jobs').querySelectorAll('[data-retry]').forEach(b=>b.onclick=safe(async()=>{await api(`/projects/${pid}/jobs/${b.dataset.retry}/retry`,'POST',{});$('#jobsRefresh').click();}));});
safe(start)();
