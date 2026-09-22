export function createTeamManager({api,esc,safe,options,getOrg,getMembers,notice,refreshSettings}){
 const $=selector=>document.querySelector(selector);

 function ensurePanel(){
  if($('#teamPanel'))return;
  $('#members').closest('.panel').insertAdjacentHTML('afterend',`
   <section id="teamPanel" class="panel">
    <h3>Takımlar</h3>
    <div id="teams"></div>
    <form id="teamForm">
     <label>Takım adı<input name="name" placeholder="Örn. Backend ekibi" required></label>
     <label>Üyeler<select id="teamMembers" name="members" multiple size="4"></select></label>
     <button>Takım oluştur</button>
    </form>
   </section>`);
  $('#teamForm').onsubmit=safe(async event=>{
   event.preventDefault();
   const org=getOrg();
   if(!org)throw Error('Önce bir organizasyon oluşturun.');
   const members=[...$('#teamMembers').selectedOptions].map(option=>option.value);
   await api(`/organizations/${org}/teams`,'POST',{name:event.target.elements.name.value,members});
   event.target.reset();
   notice('Takım oluşturuldu.');
   await refreshSettings();
  });
 }

 async function render(){
  ensurePanel();
  const org=getOrg();
  if(!org){$('#teams').innerHTML='<p class="empty">Önce bir organizasyon seçin.</p>';return;}
  options($('#teamMembers'),getMembers());
  const teams=await api(`/organizations/${org}/teams`);
  $('#teams').innerHTML=teams.map(team=>{
   const names=(team.members||[]).map(member=>esc(member.name)).join(', ');
   return `<div class="item"><strong>${esc(team.name)}</strong><small>${names||'Henüz üye eklenmemiş'}</small></div>`;
  }).join('')||'<p class="empty">Henüz takım yok.</p>';
 }

 return {render};
}
