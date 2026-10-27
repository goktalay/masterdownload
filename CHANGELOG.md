# Değişiklik günlüğü

Her sürümün "## <sürüm>" bölümü, mastertool.download'daki sürüm notu olarak olduğu gibi yayınlanır (yalnız kullanıcıya dönük metin).

## 0.1.0

İlk sürüm.

- Çok bağlantılı hızlandırılmış indirme: dosya 8 parçaya (1–32 arası ayarlanabilir) bölünür; biten bağlantı kalan en büyük parçayı ikiye bölerek devralır.
- Duraklatma ve kaldığı yerden sürdürme; uygulama ya da bilgisayar kapansa da indirme sürer. Sunucu sürdürmeyi desteklemiyorsa uyarı verilir.
- Bağlantı koparsa otomatik yeniden deneme; süresi dolan bağlantıyı yeni adresle değiştirip sürdürme (Bağlantıyı yenile).
- HTTP, HTTPS ve FTP; yönlendirme, çerez, kullanıcı adı/parola, sistem/HTTP/SOCKS5 proxy, kullanıcı aracısı.
- Chrome, Edge ve Firefox eklentisi: tarayıcıdaki indirmeleri yakalar, sağ tık menüsü ("Master Download ile indir", "Tüm bağlantıları indir"), sayfadaki korumasız video/ses akışları için "İndir" düğmesi (HLS ve DASH). DRM'li içerik ve indirmeyi yasaklayan siteler desteklenmez.
- Kategoriler (Sıkıştırılmış, Belgeler, Müzik, Programlar, Video) ve uzantıya göre klasör.
- Kuyruklar ve zamanlayıcı: başlama/durma saati, günler, eşzamanlı indirme sayısı; kuyruk bitince çık, uyku, hazırda beklet ya da bilgisayarı kapat.
- Toplam ve indirme başına hız sınırı.
- Site yakalayıcı (robots.txt kurallarına uyar), toplu indirme (dosya*001-100* kalıbı), panodan bağlantı ekleme ve pano izleme.
- İndirme bitince virüs taraması (Microsoft Defender ya da başka bir program), "internetten geldi" işareti, dosyayı/klasörü açma.
- IDM .ef2 ve metin listesi içe/dışa aktarma; IDM ile uyumlu komut satırı (/d /p /f /q /n /a /s).
- Sürükle-bırak, her zaman üstte bırakma hedefi, IDM tarzı indirme ilerleme penceresi (bölüm haritası, bağlantı tablosu).
- Gece/Gündüz/Sistem teması, 8 dil, sistem tepsisi, Mastertool hesabıyla tek giriş.
