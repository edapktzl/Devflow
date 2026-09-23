# Doğrulama kaydı

## Otomatik doğrulama

- `npm.cmd test`: **54/54 başarılı**. Gerçek Node HTTP sunucusu, bellek içi SQLite ve yeniden başlatma testlerinde geçici SQLite dosyası kullanılır; harici provider yanıtları test fixture'larıdır.
- Kapsam: login, roller/tenant izolasyonu, takım üyeliği/silme, görevler, yorum/mention, özel Kanban kolonu ve sıralaması, GitHub imzası ve görev ilişkileri, Slack imzası/aksiyonları, retry/dead-letter, SSE, automation, deadline, migration, proxy rate-limit ve transaction kilidi.
- Olay sıralaması: PR/CI/review commit'ten önce gelse de bağlantılar tamamlanır; değişmemiş resync snapshot'ları eksik ilişkileri onarır; tekrar işleme görev bildirimi ve CI yorumunu çoğaltmaz.
- Gecikmiş olaylar: eski PR açılışı merge edilmiş görevi geri taşımaz; başarıyla sonuçlanmış check için bekleyen eski hata automation'ı çalışmaz. PR başlığı güncellemesi bekleyen geçerli açılış/merge işlemini engellemez.
- Slack kuralları: birden fazla eşleşen özel mesaj ayrı işler oluşturur; eşleşen özel kural yoksa varsayılan bildirim kullanılır.
- `node test/browser-smoke.mjs`: önceki doğrulama kaydında gerçek Chromium ile kayıt/giriş, organizasyon/proje, boş organizasyona geçiş ve geri dönüş, takım oluşturma/üye çıkarma-ekleme/yenileme/silme, görev/durum, sohbet/mention ve inbox akışı başarılıydı. Bu değişiklikten sonraki tekrar denemesi uygulamaya ulaşmadan yerel Chrome CDP `Runtime.enable` timeout'u ile tamamlanamadı; test canlı hesapları kullanmaz.

- Kayıt akışı: aynı sayfada ayrı kayıt kutusu, başarılı kayıt sonrası e-posta dolu ve şifre boş giriş formuna dönüş, hatalı/tekrarlanan kayıtta hata gösterimi doğrulandı. Sunucu bozuk e-postaları ve uygunsuz kullanıcı adı/şifreleri reddeder.

- GitHub outbound tekrar koruması: issue/yorum/label/branch/kapatma/merge tekrarları, eşzamanlı istekler, değişen içerik/proje/repository, güncel yetkiler, merge ön kontrolü, 4xx/timeout/5xx/geçersiz yanıt ve yerel kayıt hatası test edildi. Yeni süreç aynı SQLite dosyasından tamamlanan sonucu okur; gönderim sırasında öldürülen sürecin işlemi yeniden gönderilmez. Başarı olayı ve resync işi tek kez oluşur.
- Görev detay ekranı: bağlantılar ve yorumların altında aktivite geçmişi, olay türü, kaynak, aktör ve zaman bilgisi gösterilir. Gerçek Chromium akışında görev oluşturma olayı doğrulandı.
- SQLite migration: eski nullable `members.role` ve dört kolonlu idempotency tablosu geçici eski veritabanında migration ile güncellendi; canlı `data/devflow.db` üzerinde `schema_migrations=1`, `integrity_check=ok` ve foreign-key hatası `0` görüldü.
- Rate limit: `TRUST_PROXY=cloudflare` açıkken `CF-Connecting-IP` kullanımı, kapalıyken proxy başlığının yok sayılması doğrulandı. Okuma transaction'ı bağımsız yazarı bloklamıyor.

## Canlı bağlantılarda doğrulananlar

- GitHub OAuth ile repository listeleme/eşleme ve webhook alımı görüldü.
- Slack kanalına gerçek bildirim teslimi ile kullanıcı tarafından denenen Assign to Me / Approve akışları görüldü.
- VS Code Extension Development Host'ta giriş, görev seçimi/detayı ve branch oluşturma kullanıcı tarafından denendi.
- Bu parçaların ayrı ayrı çalışması, tek görevde bütün canlı kabul senaryosunun tamamlandığı anlamına gelmez.

## Açık doğrulamalar ve sınırlar

- VS Code'dan gerçek commit/push → PR → Review → CI/review → merge → Done zinciri tek görev üzerinde baştan sona kabul edilmedi.
- Docker Compose yapılandırma kontrolü başarılı; Docker engine erişilebilir olmadığı için container build/runtime doğrulaması tamamlanmadı.
- GitHub outbound işlemlerinin belirsiz sonuçları otomatik uzlaştırılmaz. Timeout/5xx veya çökme sonrası aynı anahtar yeniden gönderilmez; GitHub'da sonuç kontrolü gerekir. Bu davranış izole testlerle doğrulandı; canlı issue/yorum oluşturulmadı.
- OAuth token yenileme, bazı ekran iyileştirmeleri ve otomatik GitHub Actions test çalıştırması henüz tamamlanmadı.
- Dış GitHub resync'i PR/review/check/release snapshot'larını halen proje kapsamındaki deduplication ile tarar; commit ve issue listeleri son başarılı taramadan sonra artımlı alınır ve aynı proje için eşzamanlı resync engellenir.
- API/worker yerel makinede, dış erişim Cloudflare Tunnel üzerinden çalışır; kalıcı deployment değildir.

Bu kayıt production hazır olma iddiası değildir. Test senaryoları canlı entegrasyon kabulünden ayrı değerlendirilir.
