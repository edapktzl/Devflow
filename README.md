# DevFlow — Engineering Collaboration PoC

GitHub, Slack, VS Code ve platform içi görev/mesaj akışlarını ortak event modeliyle birleştiren, çalıştırılabilir backend PoC.

**Stack:** Node.js 24+, yerleşik `node:sqlite`, SQLite WAL, REST API, SSE, ayrı worker süreci, bağımlılıksız web arayüzü ve JavaScript VS Code extension. NPM paketi kurulumu gerektirmez. SQLite bu Node sürümünde deneysel uyarı verebilir.

## Hızlı başlangıç

PowerShell:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Çıktıyı .env içindeki TOKEN_KEY alanına yazın.
npm.cmd start
```

İkinci terminalde:

```powershell
npm.cmd run worker
```

macOS/Linux üzerinde aynı komutların `npm` sürümünü kullanın. `.env` oluşturmak için `cp .env.example .env` yeterli.

Arayüz: **http://localhost:3000**. Hesap oluşturun (en az 10 karakter şifre), giriş yapın, organizasyon ve proje ekleyin. Hazır kullanıcı veya sabit şifre yoktur. Worker, bildirimler ve otomasyonlar için gereklidir.

## Docker

`.env` ve `TOKEN_KEY` hazırladıktan sonra:

```sh
docker compose up --build -d
docker compose logs -f api worker
docker compose down
```

API ve worker aynı named volume içindeki `/app/data/devflow.db` dosyasını kullanır. `down` veriyi korur; `down -v` veriyi siler. API yalnızca hostun `127.0.0.1:3000` adresine yayınlanır. Webhook/OAuth için HTTPS reverse proxy veya tunnel kullanın ve `PUBLIC_URL` değerini dış adresle değiştirin. `.env` imaja kopyalanmaz.

## GitHub kurulumu

Bu proje gerçek GitHub REST API ve OAuth uçlarını çağırır; çalışma zamanında sahte GitHub servisi yoktur. Bu çalışma ortamına ait bir GitHub hesabı veya OAuth uygulama anahtarı sağlanmadığından canlı hesap yetkilendirmesi ayrıca yapılmalıdır.

1. GitHub Developer settings altında bir **OAuth App** oluşturun. Callback: `https://YOUR_HOST/oauth/github/callback`.
2. `.env` içindeki `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` ve `PUBLIC_URL` alanlarını doldurun. API ve worker süreçlerini yeniden başlatın.
3. DevFlow → Bağlantılar ve ekip → GitHub bağla. Organizasyon Owner/Admin rolü gereklidir. OAuth `repo read:user` scope'larını ister; private repository erişimi için geniş `repo` izni PoC tercihidir.
4. Repository listele ile erişilebilir repoları görüntüleyin. `owner/repo` değerini projeyle eşleyin. Bir repo bu PoC'de yalnızca bir projeye eşlenebilir.
5. Repository settings → Webhooks: URL `https://YOUR_HOST/webhooks/github`; Content type `application/json`; Secret `.env` ile aynı. `push`, `pull_request`, `issues`, `pull_request_review`, `check_run`, `check_suite`, `release` eventlerini seçin.
6. Bir göreve `TASK-1` referansı taşıyan commit gönderin. PR başlığı veya açıklamasında da `TASK-1` kullanın. Branch adının `task/1-login` olması tek başına task eşleştirme garantisi değildir; commit mesajı veya PR metni referansı kullanılır.

Token organizasyon düzeyinde AES-256-GCM ile şifrelenir; kullanıcı tokeni API yanıtlarında dönmez. OAuth App kullanıcı tokenleri kullanılır, GitHub App installation token/refresh döngüsü uygulanmamıştır. Token iptal olursa bağlantıyı yenileyin. `TOKEN_KEY` kaybolursa kayıtlı tokenler çözülemez.

GitHub'a yazma: issue aç/kapat, PR/issue yorum ekle, label ekle, branch oluştur, temiz ve merge edilebilir PR'ı beklenen head SHA ile squash merge et. Merge Owner/Admin gerektirir; GitHub branch protection kuralları son otoritedir. Outbound yazma endpointi senkron çalışır ve ağ zaman aşımından sonra sonucu GitHub üzerinden kontrol etmek gerekir; bu endpoint için exactly-once garantisi yoktur.

## Slack kurulumu

1. Bir Slack App oluşturun. OAuth redirect: `https://YOUR_HOST/oauth/slack/callback`. Bot scope: `chat:write`.
2. Interactivity açın. Request URL: `https://YOUR_HOST/webhooks/slack`. Events API challenge aynı uçta doğrulanır; PoC'nin temel aksiyonu için ayrıca Events API subscription gerekmez.
3. `.env`: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`; süreçleri yeniden başlatın.
4. Owner/Admin olarak Slack bağla'yı seçin. Uygulamayı projenin kanalına davet edin, kanal ID'sini (`C…`) kaydedin. Private kanal için bot üyeliği gerekir.
5. OAuth'u yapan Slack kullanıcısı, kurulumu başlatan platform kullanıcısıyla eşlenir. Diğer kullanıcılar için bir organizasyon yöneticisi, Slack profilindeki member ID (`U…`) ile platform kullanıcı UUID'sini eşler. Bu yönetici kontrollü eşleme PoC'nin güven sınırıdır; kullanıcı kendi adına keyfi Slack kimliği talep edemez.
6. Atanmış bir task oluşturun. Worker Slack mesajını gönderir. **Assign to Me** butonu imza, zaman damgası, workspace, kanal, identity ve güncel rol kontrolünden sonra task atar. **Open Task** platformu açar.

Approve/Reject butonları uygulanmadı; minimum etkileşim Assign to Me ile sağlanır. Slack bildirim gönderiminde en az bir kez teslim yaklaşımı kullanılır: Slack isteği kabul edip worker yanıtı alamazsa tekrar mesaj oluşabilir. Platform notification inbox ve webhook işleme deduplication'ı bundan bağımsızdır.

## VS Code extension

```powershell
code extension
```

Extension klasörünü VS Code'da açın, **F5 → Run DevFlow Extension**. Açılan Extension Development Host içinde Git repository'nizi açın. Command Palette:

- `DevFlow: Sign in`: platform e-posta/şifresi; token VS Code SecretStorage'a kaydedilir.
- `DevFlow: Select assigned task`: kendinize atanmış task'ları seçin.
- `DevFlow: Show active task` / `Change task status`.
- `DevFlow: Create task branch`: `task/{id}-{slug}` önerir; yerel Git branch oluşturur.
- `DevFlow: Prepare commit message`: `TASK-{id} …` formatını panoya, tek repo açıkken Source Control alanına yazar.
- `DevFlow: Commit staged changes`: önce Source Control üzerinden dosyaları stage edin; onaydan sonra commit yapar.
- `DevFlow: Push current branch`: onaydan sonra `origin` remote'una push eder.

Git işlemleri `execFile` argüman dizileriyle, shell açmadan çalışır. Workspace Trust gerekir. Tokenler backend origin'ine göre ayrı saklanır. Uzaktaki backend için HTTPS zorunludur. GitHub kimlik doğrulaması yerel Git credential helper/SSH üzerinden yapılır. Extension platform tokenini Git'e vermez. F5 ile çalıştırma için marketplace veya paketleme gerekmez.

## Uçtan uca demo

1. Owner hesabını oluşturun → organizasyon → proje. Geliştirici ayrı hesap açar; Owner e-posta ile organizasyona Member olarak ekler.
2. GitHub repo ve Slack kanal bağlantılarını yukarıdaki gibi kurun.
3. `Login validation` görevi açın, geliştiriciye atayın. Oluşan `TASK-{id}` referansını kullanın.
4. Worker assignment notification'ını inbox ve Slack'e gönderir.
5. Extension'da geliştirici giriş yapar, task seçer, durumu In Progress yapar, branch oluşturur, staged değişiklikleri commit/push eder.
6. GitHub webhook commit'i task ile bağlar. PR açılması `pr.opened` eventini üretir; DB kuralı task'ı Review'a taşır.
7. CI/review olayları activity feed'e girer. CI failure commit SHA üzerinden task'la eşleşirse otomatik yorum eklenir.
8. PR merge → `pr.merged` → koşul `Review` → `Done`. Activity, audit, notification ve Slack işleri kalıcı şekilde üretilir.
9. Aynı webhook delivery'sini tekrar gönderin: yeni duplicate job veya task link oluşmaz.
10. Worker'ı durdurun, task oluşturun, worker'ı yeniden başlatın: bekleyen işler kaybolmaz. Başarısız işler altı denemeden sonra `dead` olur; admin arayüzünden ilgili projede yeniden deneyebilir.

## Testler

```powershell
npm.cmd test
```

Testler gerçek HTTP sunucusu ve gerçek SQLite kullanır; GitHub/Slack webhook fixture'ları geçerli HMAC ile imzalanır. External HTTP adapter testi ağ çağrısını test içinde değiştirir. Hiçbir test gerçek Slack kanalına mesaj veya GitHub repo'suna değişiklik göndermez.

Kapsam: login/roller/tenant izolasyonu, görev versiyon çakışması, idempotency, kolon/subtask doğrulama, mention/reply, commit→PR→merge, stale webhook ve duplicate notification, CI automation, Slack replay ve yetkisiz workspace, retry/dead-letter/lease, HTTP rate limit, SSE, deadline ve soft delete.

Canlı GitHub/Slack ve VS Code Extension Host kabul testi için hesap bağlantıları ve interaktif VS Code oturumu gerekir; otomatik backend testleri bunların yerine geçmez.

İsteğe bağlı gerçek tarayıcı testi: `node test/browser-smoke.mjs`. Chrome/Chromium yolu için `CHROME_PATH` kullanılabilir. Ayrı in-memory DB ile register/login, org/proje/task, durum değişimi, sohbet ve inbox'ı dener; başarılıysa `data/browser-smoke.png` üretir. Bu ortamdaki Chrome ve Edge denemeleri CDP `Runtime.enable` aşamasında zaman aşımına uğradı; görsel/UI kabul testi tamamlanmış sayılmamalıdır.

## Tasarım ve sınırlar

- [Mimari, event modeli, state machine ve ölçekleme](docs/ARCHITECTURE.md)
- [API endpoint listesi ve örnekler](docs/API.md)
- [SQL şeması](src/schema.sql)
- Tek local disk üzerinde bir API ve bir worker önerilir. SQLite dosyasını ağ dosya sisteminde veya bağımsız hostlar arasında paylaşmayın. OneDrive senkronizasyonu yerine normal local disk/ Docker named volume kullanmak daha uygundur.
- PoC'de organizasyon rolü proje erişimini belirler. Project-specific ACL, SSO, e-posta doğrulama, şifre sıfırlama, token rotation, dosya ekleri, task sıralaması, workflow görsel editörü ve production operasyon paneli yoktur.
- Basit bir default board vardır; kolonlar eklenir/sıralanır. Özel workflow durumlarına geçişte kullanıcı kaynaklı tüm geçişlere izin verilir. Task soft delete alt görevleri otomatik silmez.
- Merkezî feed proje bağlamında tüm kaynakları birleştirir. Organizasyon çapında birleşik feed görünümü eklenmemiştir. Inbox kullanıcıya bağlıdır.
- GitHub resync her 5 dakikalık slotta tüm mevcut branch commitlerini, issue/PR/review/check/release listesini tarar. Küçük PoC repoları içindir; pagination koleksiyon başına 100 sayfa ile sınırlıdır ve sınır aşımı hata verir. Silinen branch/issue tombstone reconciliation ve incremental cursor yoktur. Eksik gelen webhook'un temsil ettiği hâlâ erişilebilir nesne sonraki taramada bulunur; taramalar arasında oluşup silinen nesne geri getirilemez.
- Çökme sırasında outbound Slack teslimi tekrarlanabilir. GitHub senkron outbound yazmalar kalıcı outbox'a alınmaz. Lokal event/notification deduplication exactly-once dış servis yan etkisi anlamına gelmez.
- Audit kayıtları uygulama yoluyla append-only'dir; DBA değişikliklerine karşı değiştirilemez bir denetim sistemi değildir. Veri saklama/temizleme politikası yoktur. Rate limit API süreci içindedir; reverse proxy arkasında tüm kullanıcılar aynı IP limitini paylaşabilir.

## Resmî entegrasyon kaynakları

- [GitHub webhook signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [Slack OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth/)
- [Slack request verification](https://api.slack.com/authentication/verifying-requests-from-slack)
- [Slack chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/)
