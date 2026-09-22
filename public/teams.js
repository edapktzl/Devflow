export function createTeamManager({api,esc,safe,getOrg,getMembers,getUserId,notice,refreshSettings}){
 const $=selector=>document.querySelector(selector);

 function ensurePanel(){
  if($('#teamPanel'))return;
  $('#members').closest('.panel').insertAdjacentHTML('afterend',`
   <section id="teamPanel" class="panel">
    <h3>Takımlar</h3>
    <p class="muted">Takıma yalnızca organizasyon üyeleri eklenebilir. Yeni kişi önce DevFlow'a kayıt olmalı, ardından “Organizasyon üyeleri” bölümünden e-postasıyla eklenmelidir.</p>
    <p id="teamPermission" class="muted" hidden>Takımları yalnızca organizasyon sahibi ve yöneticileri değiştirebilir.</p>
    <div id="teams"></div>
    <form id="teamForm">
     <label>Takım adı<input name="name" placeholder="Örn. Backend ekibi" required></label>
     <fieldset><legend>Üyeler</legend><div id="teamMembers"></div></fieldset>
     <button>Takım oluştur</button>
    </form>
   </section>`);
  $('#teamForm').onsubmit=safe(async event=>{
   event.preventDefault();
   const org=getOrg();
   if(!org)throw Error('Önce bir organizasyon oluşturun.');
   const members=[...$('#teamMembers').querySelectorAll('input:checked')].map(input=>input.value);
   await api(`/organizations/${org}/teams`,'POST',{name:event.target.elements.name.value,members});
   event.target.reset();
   notice('Takım oluşturuldu.');
   await refreshSettings();
  });
 }

 async function render(){
  ensurePanel();
  const org=getOrg();
  const members=getMembers();
  const canManage=!!org&&['Owner','Admin'].includes(members.find(member=>member.id===getUserId())?.role);
  $('#teamForm').hidden=!canManage;
  $('#teamPermission').hidden=!org||canManage;
  if(!org){$('#teams').innerHTML='<p class="empty">Önce bir organizasyon seçin.</p>';$('#teamMembers').innerHTML='';return;}
  $('#teamMembers').innerHTML=members.map(member=>`<label class="team-member-choice"><input type="checkbox" name="members" value="${esc(member.id)}"> ${esc(member.name)}</label>`).join('');
  const teams=await api(`/organizations/${org}/teams`);
  $('#teams').innerHTML=teams.map(team=>{
   const available=members.filter(member=>!team.members.some(current=>current.id===member.id));
   return `<div class="item" data-team="${esc(team.id)}">
    <div class="row"><strong>${esc(team.name)}</strong>${canManage?'<button type="button" data-delete-team>Takımı sil</button>':''}</div>
    ${team.members.map(member=>`<div class="row"><span>${esc(member.name)}</span>${canManage?`<button type="button" data-remove-member="${esc(member.id)}" aria-label="${esc(member.name)} adlı üyeyi takımdan çıkar">Takımdan çıkar</button>`:''}</div>`).join('')||'<small>Henüz üye eklenmemiş</small>'}
    ${canManage?(available.length?`<form data-add-member><label>Takıma eklenecek üye<select name="member" required><option value="">Üye seçin</option>${available.map(member=>`<option value="${esc(member.id)}">${esc(member.name)}</option>`).join('')}</select></label><button>Üye ekle</button></form>`:'<small>Organizasyondaki tüm üyeler bu takımda.</small>'):''}
   </div>`;
  }).join('')||'<p class="empty">Henüz takım yok.</p>';
  $('#teams').querySelectorAll('[data-team]').forEach(card=>{
   const path=`/organizations/${org}/teams/${card.dataset.team}`;
   const add=card.querySelector('[data-add-member]');
   if(add)add.onsubmit=safe(async event=>{
    event.preventDefault();
    await api(`${path}/members/${encodeURIComponent(add.elements.member.value)}`,'PUT',{});
    notice('Üye takıma eklendi.');await refreshSettings();
   });
   card.querySelectorAll('[data-remove-member]').forEach(button=>button.onclick=safe(async()=>{
    await api(`${path}/members/${encodeURIComponent(button.dataset.removeMember)}`,'DELETE',{});
    notice('Üye takımdan çıkarıldı; organizasyon üyeliği devam ediyor.');await refreshSettings();
   }));
   const remove=card.querySelector('[data-delete-team]');
   if(remove)remove.onclick=safe(async()=>{
    if(!confirm(`“${card.querySelector('strong').textContent}” takımı silinsin mi? Kullanıcı hesapları ve organizasyon üyelikleri korunur.`))return;
    await api(path,'DELETE',{});notice('Takım silindi.');await refreshSettings();
   });
  });
 }

 return {render};
}
