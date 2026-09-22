# Doğrulama kaydı

## Otomatik doğrulama

- `npm.cmd test`: **30/30 başarılı**. Gerçek Node HTTP sunucusu ve bellek içi SQLite kullanılır; harici provider yanıtları test fixture'larıdır.
- Kapsam: login, roller/tenant izolasyonu, takım üyeliği/silme, görevler, yorum/mention, GitHub imzası ve görev ilişkileri, Slack imzası/aksiyonları, retry/dead-letter, SSE, automation ve deadline.
- Olay sıralaması: PR/CI/review commit'ten önce gelse de bağlantılar tamamlanır; değişmemiş resync snapshot'ları eksik ilişkileri onarır; tekrar işleme görev bildirimi ve CI yorumunu çoğaltmaz.
- Gecikmiş olaylar: eski PR açılışı merge edilmiş görevi geri taşımaz; başarıyla sonuçlanmış check için bekleyen eski hata automation'ı çalışmaz. PR başlığı güncellemesi bekleyen geçerli açılış/merge işlemini engellemez.
- Slack kuralları: birden fazla eşleşen özel mesaj ayrı işler oluşturur; eşleşen özel kural yoksa varsayılan bildirim kullanılır.
- `node test/browser-smoke.mjs`: gerçek Chromium ile kayıt/giriş, organizasyon/proje, takım oluşturma/üye çıkarma-ekleme/yenileme/silme, görev/durum, sohbet/mention ve inbox akışı başarılı. Test canlı hesapları kullanmaz.

## Canlı bağlantılarda doğrulananlar

- GitHub OAuth ile repository listeleme/eşleme ve webhook alımı görüldü.
- Slack kanalına gerçek bildirim teslimi ile kullanıcı tarafından denenen Assign to Me / Approve akışları görüldü.
- VS Code Extension Development Host'ta giriş, görev seçimi/detayı ve branch oluşturma kullanıcı tarafından denendi.
- Bu parçaların ayrı ayrı çalışması, tek görevde bütün canlı kabul senaryosunun tamamlandığı anlamına gelmez.

## Açık doğrulamalar ve sınırlar

- VS Code'dan gerçek commit/push → PR → Review → CI/review → merge → Done zinciri tek görev üzerinde baştan sona kabul edilmedi.
- Docker Compose yapılandırma kontrolü başarılı; Docker engine erişilebilir olmadığı için container build/runtime doğrulaması tamamlanmadı.
- Outbound GitHub işlemleri async route'tadır; yerel API idempotency garantisi bunları kapsamaz. Kalıcı işlem kaydı ve tekrar koruması sonraki pakettir.
- OAuth token yenileme, bazı ekran iyileştirmeleri ve otomatik GitHub Actions test çalıştırması henüz tamamlanmadı.
- API/worker yerel makinede, dış erişim Cloudflare Tunnel üzerinden çalışır; kalıcı deployment değildir.

Bu kayıt production hazır olma iddiası değildir. Test senaryoları canlı entegrasyon kabulünden ayrı değerlendirilir.
