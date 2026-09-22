# DevFlow

DevFlow, GitHub, Slack ve VS Code ile çalışan bir Engineering Collaboration Platform PoC'sidir. Proje takibi, Kanban görevleri, kod değişiklikleri ve ekip bildirimlerini tek akışta birleştirir.

Repository: <https://github.com/edapktzl/Devflow>

Geliştirme demosu: <https://devflow.edanurpektezel.com>

Bu adres, yerel API ve worker süreçleri çalışırken Cloudflare Tunnel üzerinden erişilebilir.

## Özellikler

- Kullanıcı, organizasyon, ekip ve rol yönetimi
- Proje bazlı Kanban panosu, görev, alt görev, yorum ve due date
- Activity feed, notification inbox ve proje içi mesajlaşma
- GitHub OAuth, repository eşleme ve webhook senkronizasyonu
- Commit, issue, PR, review, CI ve release olaylarını görevlere bağlama
- Slack OAuth, proje kanalı bildirimleri ve interaktif aksiyonlar
- Pull request ve CI olayları için temel automation kuralları
- Atanmış görevleri gösteren temel VS Code extension
- SQLite WAL, kalıcı job kuyruğu, retry, dead-letter ve idempotency

## Teknoloji

- Node.js 24+
- Yerleşik `node:sqlite` ve SQLite WAL
- REST API ve SSE canlı akışı
- Ayrı API ve worker süreçleri
- Bağımsız HTML/CSS/JavaScript arayüzü
- JavaScript VS Code extension

## Yerel çalıştırma

Gereksinim: Node.js 24 veya üzeri.

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Üretilen değeri `.env` içindeki `TOKEN_KEY` alanına yazın. Entegrasyon kullanacaksanız ilgili GitHub ve Slack değişkenlerini de doldurun.

API'yi ve worker'ı ayrı terminallerde çalıştırın:

```powershell
npm.cmd start
npm.cmd run worker
```

Arayüz: <http://localhost:3000>

## Ortam değişkenleri

`.env` dosyasını commit etmeyin. Secret değerlerini yalnızca yerel ortamda veya deployment secret store içinde tutun.

| Değişken | Kullanım |
| --- | --- |
| `PUBLIC_URL` | OAuth callback ve Slack butonlarındaki dış adres |
| `TOKEN_KEY` | OAuth tokenlarını AES-256-GCM ile şifrelemek için 64 hex karakter |
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App secret |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook imza secret'ı |
| `SLACK_CLIENT_ID` | Slack App Client ID |
| `SLACK_CLIENT_SECRET` | Slack App secret |
| `SLACK_SIGNING_SECRET` | Slack request doğrulama secret'ı |

## GitHub kurulumu

1. GitHub Developer settings içinde bir OAuth App oluşturun.
2. Homepage URL olarak `PUBLIC_URL` değerini, callback olarak aşağıdaki adresi kullanın:

   `https://YOUR_HOST/oauth/github/callback`

3. `GITHUB_CLIENT_ID` ve `GITHUB_CLIENT_SECRET` değerlerini `.env` dosyasına ekleyip API ve worker'ı yeniden başlatın.
4. DevFlow'da **Bağlantılar ve ekip → GitHub bağla** seçeneğini kullanın.
5. **Repository listele** ile repository'leri görüntüleyin ve `owner/repository` biçiminde bir projeyle eşleyin.
6. Repository ayarlarında **Webhooks → Add webhook** bölümünü açın:

   - Payload URL: `https://YOUR_HOST/webhooks/github`
   - Content type: `application/json`
   - Secret: `.env` içindeki `GITHUB_WEBHOOK_SECRET` ile aynı değer
   - SSL verification: açık
   - Push, pull request, issues, pull request review, check run, check suite ve release olaylarını seçin

Commit veya PR başlığı/açıklamasında `TASK-1` gibi bir görev referansı kullanılırsa GitHub olayı ilgili DevFlow görevine bağlanır. PR açıldığında varsayılan automation görevi Review'a, uygun PR merge edildiğinde Done'a taşıyabilir.

## Slack kurulumu

Slack App ayarları:

- OAuth redirect: `https://YOUR_HOST/oauth/slack/callback`
- Interactivity Request URL: `https://YOUR_HOST/webhooks/slack`
- Bot scope: `chat:write`

DevFlow'da Slack hesabını bağlayın, botu proje kanalına davet edin ve kanal ID'sini proje ayarlarına kaydedin. Slack butonlarının çalışması için platform kullanıcı UUID'sini Slack member ID'si (`U...`) ile **Slack kimliği eşle** bölümünden bağlayın.

Desteklenen aksiyonlar: **Approve**, **Reject**, **Assign to Me** ve **Open Task**.

## VS Code extension

```powershell
code extension
```

VS Code'da extension klasörünü açın ve **F5 → Run DevFlow Extension** seçin. Extension Development Host içinde:

- `DevFlow: Sign in`
- `DevFlow: Select assigned task`
- `DevFlow: Show active task`
- `DevFlow: Change task status`
- `DevFlow: Create task branch`
- `DevFlow: Prepare commit message`
- `DevFlow: Commit staged changes`
- `DevFlow: Push current branch`

Extension tokeni VS Code SecretStorage'da tutar; GitHub kimlik doğrulaması yerel Git credential helper veya SSH üzerinden yapılır.

## Testler

```powershell
npm.cmd test
```

Test paketi login, tenant izolasyonu, görev/yorum akışı, GitHub webhook ve task eşleme, Slack doğrulama ve aksiyonları, retry/dead-letter, SSE, automation ve deadline akışlarını kontrol eder.

İsteğe bağlı tarayıcı testi:

```powershell
node test/browser-smoke.mjs
```

## Docker

`.env` hazırlandıktan sonra:

```powershell
docker compose up --build -d
docker compose logs -f api worker
```

API ve worker aynı named volume içindeki SQLite veritabanını kullanır. Dış OAuth ve webhook adresleri için HTTPS reverse proxy veya tunnel gerekir.

## Belgeler

- [Mimari ve event modeli](docs/ARCHITECTURE.md)
- [API endpoint listesi](docs/API.md)
- [Doğrulama notları](docs/VERIFICATION.md)
- [SQL şeması](src/schema.sql)

## PoC sınırları

Bu proje production seviyesinde Jira, Slack veya GitHub alternatifi değildir. GitHub OAuth App token yenileme döngüsü, PostgreSQL migration sistemi, project-specific ACL, observability ve kalıcı deployment operasyonu sonraki geliştirme alanlarıdır.
