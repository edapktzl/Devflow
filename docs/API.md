# API

Base: `http://localhost:3000/api`. JSON istek/yanıt. Login, register, health dışındaki `/api` uçları `Authorization: Bearer <token>` ister. Callback ve webhook yolları `/api` dışında.

Runtime liste: `GET /api/endpoints`. Başarılı JSON route'ları 200 döner. Hatalar `{ "error": "..." }`: 400 doğrulama, 401 authentication, 403 authorization, 404 yok/silinmiş, 409 concurrency/idempotency, 413 boyut, 429 limit, 502 provider, 503 yapılandırma.

## Endpoint listesi

| Method | Yol | İşlev |
|---|---|---|
| GET | `/health` | DB erişim sağlık kontrolü |
| GET | `/endpoints` | Runtime route listesi |
| POST | `/auth/register` | `{email,name,password}` |
| POST | `/auth/login` | `{email,password}` → token, user |
| POST | `/auth/logout` | Geçerli session'ı sil |
| GET | `/me` | Profil |
| GET, POST | `/organizations` | Üye olunan org'lar / `{name}` ile oluştur |
| GET, POST | `/organizations/:org/members` | Üyeler / `{email,role}` |
| GET, POST | `/organizations/:org/teams` | Takımlar / `{name,members:[userId]}` |
| DELETE | `/organizations/:org/teams/:team` | Owner/Admin: takımı ve takım üyeliklerini sil; kullanıcı hesapları korunur |
| PUT | `/organizations/:org/teams/:team/members/:member` | Owner/Admin: organizasyon üyesini takıma ekle; tekrar ekleme çoğaltmaz |
| DELETE | `/organizations/:org/teams/:team/members/:member` | Owner/Admin: yalnızca takım üyeliğini kaldır |
| GET, POST | `/organizations/:org/projects` | Projeler / `{name}` |
| PATCH | `/projects/:pid` | Admin: `{repo,slack_channel}` eşlemesi; null ile kaldır |
| DELETE | `/projects/:pid` | Admin: soft delete |
| GET | `/projects/:pid/board` | Board, sıralı kolonlar, task'lar |
| POST | `/projects/:pid/columns` | `{board_id,name}` |
| PUT | `/projects/:pid/columns/order` | `{ids:[allColumnIdsInOrder]}` |
| GET | `/tasks/mine` | Atanmış task'lar |
| POST | `/projects/:pid/tasks` | Task / subtask oluştur |
| GET | `/tasks/:tid` | Detay, JSON labels, yorum, bağlantı, son 100 event |
| PATCH | `/tasks/:tid` | Beklenen `version` ile değiştir |
| DELETE | `/tasks/:tid` | `{version}` ile soft delete |
| POST | `/tasks/:tid/comments` | `{body}`; mention destekli |
| POST | `/tasks/:tid/links` | `{kind,external_id,url}`; kind commit/pr/issue |
| GET | `/projects/:pid/messages?before=milliseconds` | Yeni→eski, 100 mesaj |
| POST | `/projects/:pid/messages` | `{body,reply_to?}` |
| GET | `/projects/:pid/activity?after=eventId` | Eski→yeni, en fazla 200 event |
| GET | `/projects/:pid/stream?after=eventId` | Authenticated SSE; `id`, `data`, heartbeat |
| GET | `/notifications` | Son 200 kullanıcı notification'ı |
| PATCH | `/notifications/:nid` | `{read:true|false}` |
| GET, POST | `/projects/:pid/rules` | Liste / admin `{trigger,condition_status?,action,value}` |
| DELETE | `/projects/:pid/rules/:rid` | Admin: disable |
| GET | `/organizations/:org/audit` | Admin: son 200 audit |
| GET | `/organizations/:org/integrations` | Bağlantılar, token olmadan |
| DELETE | `/organizations/:org/integrations/:provider` | Admin: yerel bağlantıyı sil; provider'da revoke ayrıca |
| POST | `/organizations/:org/oauth/:provider` | Admin: github/slack OAuth URL'si oluştur |
| POST | `/organizations/:org/slack/identities` | Admin: `{user_id,slack_user_id}` |
| GET | `/organizations/:org/slack/identities` | Kullanıcının seçili organizasyondaki Slack eşlemeleri |
| GET | `/organizations/:org/github/repositories` | Owner/Admin: organizasyon GitHub bağlantısının erişebildiği repository'ler |
| GET | `/projects/:pid/github/objects` | Yerel branch, commit, issue, PR, review, check, release |
| POST | `/projects/:pid/github/resync` | Admin: kalıcı resync job oluştur |
| POST | `/projects/:pid/github/actions` | Idempotency-Key ile GitHub write action |
| GET | `/projects/:pid/github/actions/:key` | Kullanıcının kendi işleminin durumu/sonucu |
| GET | `/organizations/:org/jobs` | Admin: org kapsamındaki pending/running/dead işler |
| POST | `/projects/:pid/jobs/:jid/retry` | Admin: bu projenin dead job'ını yeniden dene |

Slack interactive action payload'ında desteklenen action ID'leri `assign`, `approve`, `reject` ve `Open Task` linkidir. `approve`, task'a `Approved in Slack.` yorumu ve `task.review_approved` eventi ekler. `reject`, `Rejected in Slack; returning to In Progress.` yorumu ve `task.review_rejected` eventi ekler; projede `In Progress` kolonu varsa task'ı oraya taşır. Tüm aksiyonlar imza, timestamp, workspace, kanal, Slack identity ve güncel organizasyon üyeliği doğrulamasından geçer.

## Public provider uçları

| Method | Yol | Doğrulama |
|---|---|---|
| GET | `/oauth/github/callback?code=...&state=...` | Tek kullanımlık OAuth state |
| GET | `/oauth/slack/callback?code=...&state=...` | Tek kullanımlık OAuth state |
| POST | `/webhooks/github` | HMAC SHA-256 raw body, X-GitHub-Delivery, X-GitHub-Event |
| POST | `/webhooks/slack` | Slack v0 HMAC + timestamp; JSON challenge veya URL-encoded payload |

## Örnek task isteği

```http
POST /api/projects/PROJECT_UUID/tasks
Authorization: Bearer TOKEN
Content-Type: application/json
Idempotency-Key: create-login-task-001

{
  "title": "Login validation",
  "description": "Handle invalid input",
  "column_id": "COLUMN_UUID",
  "priority": "high",
  "assignee": "USER_UUID",
  "labels": ["bug", "auth"],
  "due_date": "2026-10-01",
  "parent_id": null
}
```

Priority: low/normal/high/urgent. `column_id` verilmezse ilk kolon. `assignee` null olabilir; org üyeliği gerekir. `parent_id` yalnızca oluştururken kullanılır, aynı projede olmalıdır. Yanıttaki `id: 142`, UI'da `TASK-142` olarak gösterilir. Liste yanıtlarında `labels` JSON string; detay endpointinde array'dir.

```http
PATCH /api/tasks/142
Authorization: Bearer TOKEN
Content-Type: application/json

{"version":1,"column_id":"REVIEW_COLUMN_UUID"}
```

Bir başka kullanıcı/automation versiyonu değiştirdiyse 409. GET ile yenileyin, değişikliği güncel state üzerinden uygulayın.

## GitHub outbound action body'leri

Bu POST için `Idempotency-Key` zorunludur: 1–128 karakter; harf, rakam, nokta, alt çizgi, iki nokta ve tire kabul edilir. İstemci yeni bir işlem için bir UUID oluşturmalı ve yanıt kaybolduğunda **aynı anahtarı ve aynı isteği** tekrar kullanmalıdır. Anahtar kullanıcıya bağlıdır; proje, repository, aksiyon veya gönderilecek içerik değişirse 409 döner. JSON alan sırası farkı yeni işlem sayılmaz.

```http
POST /api/projects/PROJECT_UUID/github/actions
Authorization: Bearer TOKEN
Content-Type: application/json
Idempotency-Key: issue-login-001

{"action":"create_issue","title":"TASK-142 Login validation","body":"Details"}
```

Başarıda GitHub'ın JSON yanıtı 200 ile döner; aynı anahtarla tekrarında saklanan yanıt kullanılır. Olay, audit başarı kaydı ve resync işi çoğalmaz. Henüz süren isteğe 409 döner. Anahtar olmadan istek 400 ile reddedilir; GitHub'a gönderilmez. DevFlow ayarlarındaki GitHub işlem formu bu endpointi kullanır ve gönderimden önce kullanıcı onayı ister; VS Code extension akışı henüz kullanmaz.

`GET /projects/:pid/github/actions/:key` işlemi başlatan kullanıcıya durumunu döndürür. Güncel proje yazma yetkisi, merge için ayrıca Owner/Admin rolü gerekir. Durumlar:

| Durum | Anlam / istemci davranışı |
|---|---|
| `running` | İşlem sürüyor; bekleyip aynı anahtarla sorgula veya POST'u tekrarla. |
| `completed` | `result` saklanan GitHub yanıtıdır. |
| `rejected` | Kesin ret veya gönderim öncesi hata; `error` ve `error_status` saklanır. Aynı anahtar hatayı tekrar döndürür. Sebep giderildikten sonra yeni işlem yeni anahtarla başlatılabilir. |
| `uncertain` | Timeout, 5xx, geçersiz yanıt veya başarı sonrası yerel kayıt hatası; GitHub'da işlem gerçekleşmiş olabilir. Otomatik tekrar gönderilmez. Önce GitHub'dan sonucu doğrulayın. |

Çökme sonrası 60 saniyeden eski `running` kayıtları sorgulamada `uncertain` olarak gösterilir; yazma hakkı başka isteğe verilmez. Otomatik sonuç uzlaştırması bu pakette yoktur. Belirsiz işlem için hemen yeni anahtar üretmek çift kayıt riskini geri getirir. Koruma aynı kullanıcının aynı anahtarıyla sınırlıdır; farklı anahtarlar/kullanıcılar ayrı işlemlerdir. Kayıtlar sunucu yeniden başlayınca korunur; otomatik silinmez.


```json
{"action":"create_issue","title":"TASK-142 Login validation","body":"Details"}
{"action":"close_issue","number":12}
{"action":"comment","number":74,"body":"Review requested for TASK-142"}
{"action":"labels","number":74,"labels":["bug"]}
{"action":"branch","name":"task/142-login","sha":"40_CHARACTER_BASE_COMMIT_SHA"}
{"action":"merge","number":74,"sha":"40_CHARACTER_EXPECTED_PR_HEAD_SHA"}
```

Branch oluşturma base SHA'nın geçerli 40 hex karakter olmasını ister. Merge önce PR'ı okur; draft olmayan, açık, `mergeable=true`, `mergeable_state=clean` ve SHA eşleşmesi gerekir. Provider merge sırasında değişen head'i de reddeder. Bu koşul kodun mantıksal doğruluğunu değerlendirmez; GitHub review/check protection politikasını repo tarafında yapılandırın.

## SSE

Web UI cookie veya query token kullanmaz; `fetch` ReadableStream ile Authorization header gönderir. Son görülen event ID `after` cursor olarak iletilir. Bağlantı kesilince istemci yeniden bağlanır. Eventler DB'den 1.5 saniyede bir okunur; worker sonrası bildirimler bir sonraki ilgili yenilemede görünür.

Request body limiti 2 MiB. Auth route'larında IP başına dakikada 30, diğer uçlarda 1000 istek. Paginasyonsuz task/objects/audit/inbox uçları küçük PoC veri hacmi içindir; büyük kullanımda cursor filtreleri genişletilmelidir.
