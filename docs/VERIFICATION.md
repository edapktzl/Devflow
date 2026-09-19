# Doğrulama kaydı

- `npm.cmd test`: **14/14 başarılı**. Gerçek Node HTTP sunucusu ve SQLite; provider fixture'ları yalnızca test içinde.
- Backend, frontend ve extension JavaScript syntax kontrolleri başarılı.
- `docker compose --env-file .env config --quiet`: başarılı. Docker engine çalışmadığı için image build/container runtime doğrulanamadı.
- Yerel API + worker başlatıldı; `GET http://localhost:3000/api/health` → `{ "ok": true }`.
- Chrome/Edge headless tarayıcı smoke testi: renderer CDP `Runtime.enable` yanıtı zaman aşımına uğradı. UI asset HTTP kontrolleri geçti, interaktif görsel kabul tamamlanmadı.
- VS Code extension kodu syntax kontrolünden geçti; Extension Development Host'ta interaktif Git işlemleri denenmedi.
- GitHub/Slack OAuth client bilgileri ve gerçek hesap bağlantıları sağlanmadı; canlı provider kabul testi yapılmadı. Runtime adapter'ları gerçek provider URL'lerini kullanır. OAuth exchange, HMAC, resync, Slack failure/retry otomatik testlerde fixture ile doğrulandı.

Bu kayıt production hazır olma iddiası değildir. Canlı kabul için README'deki adımları tamamlayın.
