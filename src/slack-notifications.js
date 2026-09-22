export function githubUrl(value){
 try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='github.com'&&!url.username&&!url.password;}catch{return false;}
}

export function slackNotification(event,payload,project,task){
 // Snapshot refreshes remain in the activity feed but are not new PR openings.
 if(['pr.updated','branch.updated'].includes(event.type))return null;
 const labels={
  'pr.opened':'Pull request açıldı','pr.closed':'Pull request kapatıldı','pr.merged':'Pull request birleştirildi',
  'commit.updated':'Yeni commit','issue.updated':'Issue güncellendi','review.updated':'Kod incelemesi güncellendi',
  'ci.failed':'CI kontrolü başarısız','ci.updated':'CI kontrolü güncellendi','release.created':'Release yayımlandı',
  'task.created':'Yeni görev oluşturuldu','task.assigned':'Görev atandı','task.updated':'Görev güncellendi',
  'task.status_changed':'Görev durumu değişti','task.comment':'Göreve yorum eklendi','task.linked':'Göreve bağlantı eklendi',
  'task.deleted':'Görev silindi','task.deadline':'Görevin son tarihi geçti',
  'task.review_approved':'Görev Slack üzerinden onaylandı','task.review_rejected':'Görev Slack üzerinden reddedildi',
  'message.created':'Yeni proje mesajı','project.created':'Proje oluşturuldu','column.created':'Kolon oluşturuldu',
  'github.action':'GitHub işlemi gerçekleştirildi','job.retried':'İş yeniden denemeye alındı'
 };
 const reference=payload.external_id?(payload.kind==='commit'?String(payload.external_id).slice(0,7):['pr','issue'].includes(payload.kind)?`#${payload.external_id}`:String(payload.external_id)):'';
 const title=String(payload.title||'').split(/\r?\n/)[0].slice(0,300);
 const lines=[`${project.name} · ${labels[event.type]||'Proje etkinliği'}${reference?` ${reference}`:''}`];
 if(project.repo&&event.source==='github')lines.push(`Repository: ${project.repo}`);
 if(title)lines.push(title);
 if(task)lines.push(`TASK-${task.id} · ${task.title}`);
 if(payload.author)lines.push(`Gönderen: ${payload.author}`);
 if(payload.from&&payload.to)lines.push(`${payload.from} → ${payload.to}`);
 if(payload.conclusion)lines.push(`Sonuç: ${payload.conclusion}`);
 if(payload.body)lines.push(String(payload.body).slice(0,500));
 const url=githubUrl(payload.url)?payload.url:undefined;
 if(url)lines.push(url);
 return {text:lines.join('\n'),url};
}
