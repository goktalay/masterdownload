# Internet Download Manager (IDM) Özellik İncelemesi ve Master Download Kararları

> Mimari ve uygulama ayrıntıları: [mimari.md](mimari.md). Karar tablosu (Bölüm 4) bağlayıcıdır; metindeki öneriler onunla çelişirse tablo geçerlidir.

> Hazırlanma: 2026-10-27 · Hedef: **Master Download** (Mastertool ailesi, Electron, Windows masaüstü)
> Yöntem: IDM'in resmi sitesi (özellikler, yardım, SSS, sürüm notları) ve gerekli yerlerde ikincil kaynaklar.
> Resmi kaynakta doğrulanamayan bilgiler **(doğrulanamadı)** ya da **(ikincil kaynak)** diye işaretlenmiştir.

Karar etiketleri:

- **v1** — ilk sürümde var
- **sonra** — ilk sürümden sonra (v1.x / v2)
- **yapılmayacak** — gerekçesiyle birlikte

---

## 1. Giriş

**Internet Download Manager (IDM)**, Tonec Inc. tarafından 1999'dan beri geliştirilen, yalnız Windows'ta çalışan (Windows 7/8/8.1/10/11) ücretli bir indirme yöneticisidir (30 günlük deneme sürümü var). Temel vaadi şudur: "dinamik bölümleme" ile dosyayı birden çok bağlantı üzerinden paralel indirmek ("8 kata kadar hızlanma" iddiası), kopan indirmeleri kaldığı yerden sürdürmek ve tarayıcıdaki indirmeleri yakalayıp üstlenmek.

Bilinen durum (sürüm notlarına göre):

| Sürüm | Tarih | Öne çıkan değişiklik |
|---|---|---|
| 6.43 Build 16 | 23.10.2026 | Bazı videolarda indirme panelinin görünmemesi düzeltildi; video dönüştürme hızlandırıldı |
| 6.43 Build 15 | 08.10.2026 | İndirme paneli düzeltmeleri |
| 6.43 Build 12 | 01.10.2026 | "403 Forbidden" düzeltmesi; MP4'te ses/görüntünün ayrı iz olarak kaydedilmesi düzeltildi |
| 6.43 Build 10 | 20.08.2026 | HTTP/2 indirme iyileştirmesi; TS → MP4 dönüştürme düzeltmeleri |
| 6.43 Build 8 | 08.08.2026 | MKV birleştirme (mux) hataları; TS → MP4'te ses/görüntü kayması |

Bu notlardan anlaşılanlar: IDM artık **HTTP/2** konuşuyor. HLS (TS parçaları) ve DASH (ayrı ses ve görüntü akışları) indirip **MP4/MKV'ye birleştiriyor**. Tarayıcı eklentisi "IDM Integration Module" adını taşıyor. Ayrıca "Gelişmiş tarayıcı bütünleşmesi" denen sistem düzeyi bir yakalama modu var; bu mod herhangi bir uygulamadan çıkan indirmeyi yakalayabiliyor.

---

## 2. Özellikler

### 2.1 Çok parçalı hızlandırılmış indirme (dinamik bölümleme)

**IDM'deki davranış**

- **Dinamik bölümleme:** Dosya, indirme başlamadan sabit parçalara bölünmez; bölme işlemi indirme sürerken yapılır. Başlangıçta kaç bağlantı açılabileceği bilinmez.
- **Yeni bağlantı açıldığında:** IDM sürmekte olan **en büyük kalan parçayı ikiye böler**. Yeni bağlantı ikinci yarıyı, orta noktadan başlayarak indirir.
- **Bağlantının yeniden kullanılması:** Parçasını bitiren bağlantı kapatılmaz. Yeniden bağlanma ve oturum açma adımları atlanarak aynı bağlantı yeni işe verilir.
- **Bitmiş parçanın yük devralması:**
  - Sıradaki parçanın indirilmesine henüz başlanmadıysa, bitiren bağlantı o parçayı üstlenir.
  - Sıradaki parça zaten indiriliyorsa, bitiren bağlantı yavaş bağlantılara yardım eder: **en büyük kalan parçayı ikiye böler.** Parça, o bağlantı türü için fazla küçükse bölme yapılmaz.
- **Birleştirme:** Tüm parçalar bitince dosya tek parça halinde birleştirilir.
- **Kurtarma:** Dosyadaki konumlar dakikada birkaç kez diske yazılır. Duraklatma, durdurma ya da elektrik kesintisinden sonra başlangıç konumları yeniden hesaplanır ve indirme sürer.
- **İlerleme çubuğu:** Pembe çizgiler parça başlangıçlarını, mavi alan inmiş veriyi, beyaz alan kalan veriyi gösterir.
- **Bağlantı sayısı:** "Seçenekler → Bağlantı" sekmesindeki "Default max. conn. number" ayarıyla belirlenir. Resmi SSS, geniş bantta 16 ya da 32 denenmesini, çevirmeli bağlantıda 1–2 kullanılmasını önerir. **Varsayılan 8, en çok 32** değerleri yaygın kaynaklarda geçiyor; resmi sayfada açık bir varsayılan yazmıyor **(ikincil kaynak)**. Seçenekler listesi 1/2/4/8/16/24/32 olabilir **(doğrulanamadı)**. Aynı sekmede bir "bağlantı türü/hızı" seçimi de vardır **(ikincil kaynak)**.
- **Sunucuya özel istisnalar:** "Exceptions" tablosunda sunucu başına bağlantı sayısı verilebilir. Bu, örneğin yalnız 1–2 bağlantıya izin veren FTP sunucuları için kullanılır.

**Master Download kararı**

| Özellik | Karar | Not |
|---|---|---|
| Dinamik bölümleme (en büyük kalanı ikiye bölme, yük devralma) | **v1** | Ana çekirdek. Bölme için en küçük parça eşiği (ör. 256 KiB) |
| Bağlantının yeniden kullanılması (keep-alive) | **v1** | Node `http.Agent` keepAlive ya da undici havuzu |
| Varsayılan 8, en çok 32 bağlantı | **v1** | Ayarlanabilir; istisna tablosu sunucu başına |
| Konumu düzenli kaydetme (çökme sonrası kurtarma) | **v1** | Parça durumu JSON/SQLite'a birkaç saniyede bir yazılır |
| Parçalı ilerleme çubuğu | **v1** | |
| HTTP/2 üzerinden çoklu akış | **sonra** | v1'de HTTP/1.1 ile çoklu bağlantı yeterli |

### 2.2 Duraklatma/sürdürme, otomatik yeniden deneme

**IDM'deki davranış**

- İlerleme penceresinde, duraklatılmış indirmenin sürdürülüp sürdürülemeyeceği gösterilir ("Resume capability: Yes/No"). Sunucu Range desteklemiyorsa sürdürme başa döner.
- "Sürdürürken dosya değiştirme zamanındaki değişiklikleri yok say" seçeneği var. Bu seçenek, sunucu zaman damgasını değiştirdiğinde indirmenin baştan başlamasını önler.
- Kuyruktaki dosya başarısız olursa kuyruğun sonuna atılır ve sıradakine geçilir. Kuyrukta tek dosya kaldıysa **30 saniyede bir, sınırsız** yeniden denenir. "Başarısızlıkta dosya başına yeniden deneme sayısı" ile sınır konabilir.
- Geçici bağlantılar sona erdiyse bağlantı yenileme gerekir (bkz. 2.10).

**Master Download kararı**

| Özellik | Karar | Not |
|---|---|---|
| HTTP `Range` + `If-Range` (ETag/Last-Modified) ile sürdürme | **v1** | |
| Sürdürme desteklenmiyorsa uyarı (Accept-Ranges yok, 200 döndü) | **v1** | Duraklat düğmesinde uyarı ve rozet |
| Otomatik yeniden deneme (üstel bekleme, sayı sınırı ayarlanabilir) | **v1** | Varsayılan: sınırsız, 30 sn (IDM ile uyumlu); ayarla sınırlanabilir |
| Zaman damgası değişikliğini yok sayma seçeneği | **v1** | |

### 2.3 Protokoller, kimlik doğrulama, proxy, kullanıcı aracısı

**IDM'deki davranış**

- Resmi listede **HTTP, HTTPS, FTP ve MMS** desteklenir. Proxy tarafında Microsoft ISA ve FTP proxy'leri desteklenir. Kimlik doğrulama yöntemleri **Basic, Negotiate, NTLM, Kerberos**'tur.
- **Proxy/Socks sekmesi:**
  - "Get System" ile sistemdeki ya da tarayıcıdaki proxy alınır.
  - Otomatik yapılandırma betiği (PAC) kullanılabilir.
  - Proxy, protokol başına ayrı ayrı elle girilebilir.
  - "İndirmeyi başlatan tarayıcının proxy'sini kullan" seçeneği var.
  - Atlama listesi `*` jokerini destekler.
  - Proxy için kullanıcı adı ve parola girilebilir.
  - "Use FTP in PASV" ile pasif FTP açılır.
- **Site Logins sekmesi:** URL başına kullanıcı adı ve parola tutulur. Aynı sitenin farklı dizinleri için farklı bilgiler verilebilir.
- **Kullanıcı aracısı (User-Agent):** Elle eklenen indirmeler için ayarlanabilir (6.35 ile geldi). Tarayıcıdan yakalanan indirmelerde tarayıcının kendi UA'sı kullanılır.
- Tarayıcıdan yakalanan indirmelerde çerez ve referer tarayıcıdan aktarılır. IDM'in COM API'si de URL, referer, çerez, POST verisi, kullanıcı/parola, yerel yol, dosya adı ve UA alanlarını kabul eder.

**Master Download kararı**

| Özellik | Karar | Not |
|---|---|---|
| HTTP/HTTPS, yönlendirmeleri izleme (301/302/303/307/308, sınır 10) | **v1** | Son URL'den dosya adı ve `Content-Disposition` alınır |
| FTP (düz FTP, PASV, `REST` ile sürdürme, çok bağlantı = birden çok oturum) | **v1** | FTPS (açık TLS) **sonra** |
| SFTP | **sonra** | Mastertool SSH çekirdeği yeniden kullanılabilir |
| MMS / RTSP | **yapılmayacak** | Eskimiş protokoller; modern sitelerde karşılığı yok |
| Çerez (tarayıcıdan aktarılan + elle) | **v1** | Diskte şifreli tutulur (Electron `safeStorage`) |
| Basic / Digest kimlik doğrulama | **v1** | |
| NTLM / Negotiate (Kerberos) | **sonra** | Kurumsal ortam; Electron `net` modülü üzerinden değerlendirilecek |
| Site girişleri listesi (URL/dizin başına) | **v1** | |
| Proxy: sistem proxy'si, HTTP, SOCKS4/5, PAC, atlama listesi, proxy kimlik doğrulama | **v1** | PAC desteği **v1**, Electron `session.resolveProxy` ile |
| Kullanıcı aracısı (genel + indirme başına) | **v1** | |
| Microsoft ISA / FTP proxy türleri | **yapılmayacak** | Eskimiş kurumsal ürünler |

### 2.4 Tarayıcı bütünleşmesi

**IDM'deki davranış**

- Eklentinin adı **IDM Integration Module**: Chrome, Edge, Firefox ve Opera'da çalışır (Edge kullanıcıları Chrome Web Mağazası'na yönlendirilir; InPrivate için "Allow in InPrivate" açılmalıdır).
- **Manifest V3:** IDM SSS'sinin eski bir sürümünde Google'ın gereken bir yeteneği MV3'te yasakladığı, bu yüzden MV2'de kalındığı yazıyordu. Ayrıca "Extend the availability of Manifest 2 Chrome extensions" diye bir IDM ayarı vardı. Sayfanın şimdiki sürümü MV3'ten hiç söz etmiyor; güncel eklentinin manifest sürümü **(doğrulanamadı)**.
- **İki yakalama modu:**
  - **Temel bütünleşme:** eklenti üzerinden çalışır.
  - **Gelişmiş bütünleşme:** sistem düzeyindedir, her uygulamanın indirmesini yakalar.
- **Yakalanan uzantılar:** "Seçenekler → Dosya Türleri" listesindeki uzantılar yakalanır.
- **İstisnalar:**
  - "Şu sitelerden otomatik indirme yapma" listesi `*` jokerini destekler (ör. `*.tonec.com`).
  - Ayrı bir "adres istisnaları" listesi vardır.
- **Özel tuşlar:**
  - Tıklarken **Alt** basılıysa indirmeyi tarayıcı yapar (yakalama atlanır).
  - **Ctrl** basılıysa IDM zorla yakalar.
  - "Keys" iletişim kutusundan tuşlar değiştirilebilir.
- **Sağ tık menüsü:**
  - Bağlantı üzerinde "Download with IDM" çıkar.
  - Seçili metindeki tüm bağlantılar IDM'e eklenebilir.
  - Özellikler sayfasına göre bir de "Download All" vardır: sayfadaki tüm bağlantılar kuyruğa alınır.
- **Video/ses indirme paneli:**
  - Sayfadaki oynatıcının üzerinde "Download this video" düğmesi çıkar.
  - Hangi uzantılarda panel gösterileceği "Seçenekler → Genel → Customize IDM Download panels in browsers" ile düzenlenir.
  - Site istisnaları olan sitelerde panel gösterilmez.
  - Bazı korumalı protokoller yasal nedenlerle desteklenmez (resmi SSS).
  - Sürüm notlarından HLS (TS → MP4) ve ayrı ses/görüntü (DASH benzeri) birleştirmesi yapıldığı anlaşılıyor.
- **Pano izleme:** Belirli uzantıda bir URL kopyalanınca indirme iletişim kutusu açılır.
- **"Download File Info" iletişim kutusu:** Kategori önerisi, kayıt klasörü, ZIP içeriği önizlemesi, "Download Later" ve "Start Download" düğmeleri.

**Master Download kararı**

| Özellik | Karar | Not |
|---|---|---|
| Chrome/Edge eklentisi (MV3) | **v1** | `chrome.downloads.onDeterminingFilename` / `onCreated` ile yakalama + iptal; çerez/referer/UA iletimi |
| Firefox eklentisi | **v1** | Aynı kod tabanı; `browser_specific_settings.gecko.id`; native host manifestinde `allowed_extensions` |
| Native messaging host (Windows kayıt defteri `HKCU\Software\Google\Chrome\NativeMessagingHosts\...`, Edge ve Firefox eşdeğerleri) | **v1** | Küçük host süreci, uygulamaya yerel IPC (named pipe) ile bağlanır; kurulumcu kaydeder |
| Uzantı listesi + site istisna listesi (joker) | **v1** | |
| Alt ile yakalamayı atlama, Ctrl ile zorlama | **v1** | İçerik betiği değiştirici tuşu yakalar |
| Sağ tık: "Master Download ile indir", "Tüm bağlantıları indir", "Seçimdeki bağlantıları indir" | **v1** | |
| Video/ses algılama düğmesi (doğrudan MP4/WebM/MP3 + korumasız HLS/DASH) | **v1** | `webRequest` ile manifest (`.m3u8`, `.mpd`) algılama; bilinen engelli siteler listesi (bkz. Bölüm 3) |
| HLS indirme (TS/fMP4) + DASH tek temsil | **v1** | Parçalar paralel, uç uca eklenir; ffmpeg ile ses+görüntü birleştirme ve MP4'e çevirme **sonra** |
| Sistem düzeyi "gelişmiş bütünleşme" (her uygulamayı yakalama) | **yapılmayacak** | Ağ katmanı kancası/sürücü gerektirir; güvenlik ve antivirüs sorunu |
| Pano izleme | **v1** | Varsayılan kapalı, ayardan açılır |
| Opera / eski tarayıcılar (IE, Maxthon, AOL) | **yapılmayacak** | Opera Chromium eklentisini zaten kullanabilir; diğerleri ölü |

### 2.5 Kategoriler ve uzantıya göre klasör

**IDM'deki davranış**

- Sol ağaçta kategoriler bulunur. Hazır olanlar: Müzik, Video, Programlar, Belgeler, Sıkıştırılmış.
- Her kategorinin adı, varsayılan klasörü ve dosya uzantıları vardır. Kategori **belirli sitelerle de sınırlanabilir** (ör. `*.googlevideo.com`).
- Kayıt iletişim kutusu kapalıysa dosya otomatik olarak kategorisinin klasörüne gider.
- "Son seçilen klasörü kategorinin varsayılanı yap" seçeneği var.
- Ağaçta ayrıca durum düğümleri ("Tamamlanmamış", "Tamamlanmış"), kuyruklar ve "Grabber projeleri" bulunur.

**Karar:** Kategoriler, uzantı eşlemesi, site filtresi ve son klasörü hatırlama **v1**. Ağaçta durum ve kuyruk düğümleri **v1**.

### 2.6 Kuyruklar ve zamanlayıcı

**IDM'deki davranış**

- İki ana kuyruk vardır: **Ana İndirme Kuyruğu** ve **Senkronizasyon Kuyruğu**. Kullanıcı ek kuyruk da açabilir.
- **İndirme kuyruğu ("One-time downloading"):** Biten dosya kuyruktan çıkar.
- **Senkronizasyon kuyruğu ("Periodic synchronization"):**
  - Sunucudaki dosyanın değişip değişmediğine bakılır; yenisi varsa eskisinin yerine yazılır. Dosyalar kuyrukta kalır.
  - Belirli aralıklarla (dakika ya da saat) çalışır; durma saati yoksa gün sonuna kadar sürer.
  - Kuyruk türü yalnız ek kuyruklarda değiştirilebilir.
- **Zamanlama:**
  - "Start Now" ile kuyruk hemen başlatılır.
  - Başlangıç saati ve günler seçilebilir. Haftanın günü seçimi resmi sayfada açıkça yazmıyor **(doğrulanamadı; arayüzde var olduğu biliniyor)**.
  - "Stop download at" ile durma saati verilir.
- **Eşzamanlılık:** Her kuyrukta "aynı anda indirilecek dosya sayısı" ayrı ayarlanır. Bağlantı kısıtlayan siteler için ayrı kuyruk ve tek dosya önerilir.
- **Kota:** Örneğin "saatte 40 MB" ya da "4 saatte 150 MB" gibi kota konabilir. Kota dolunca IDM indirmeyi duraklatır ve sonra kendiliğinden sürdürür.
- **Bitince yapılacaklar:**
  - modemi kapat (hang up)
  - bilgisayarı kapat
  - süreçleri zorla sonlandır
  - bir dosya ya da program aç (çoklu iş için `.bat`)
  - Bu eylemler kuyruk elle durdurulduysa çalışmaz.
  - Resmi sayfada uyku, hazırda bekletme ve çıkış geçmiyor **(doğrulanamadı)**.
- **Kuyruk içi düzen:** "Files in the queue" sekmesinde sıra oklarla ya da sürükle-bırakla değiştirilir. Biten dosyalar yalnız senkronizasyon kuyruğuna taşınabilir.
- **Dial-Up/VPN sekmesi:** Telefon defteri girdisi, yeniden arama sayısı ve arama aralığı ayarlanır.

**Master Download kararı**

| Özellik | Karar | Not |
|---|---|---|
| Ana kuyruk + ek kuyruklar, kuyruk başına eşzamanlı sınır | **v1** | |
| Başlangıç/durma saati, haftanın günleri, "Şimdi başlat" | **v1** | |
| Başarısızlıkta sona atma, yeniden deneme sayısı | **v1** | |
| Senkronizasyon kuyruğu (periyodik, değişeni yeniden indir) | **sonra** | `ETag`/`Last-Modified` ile koşullu GET |
| Bitince: kapat / uyku / hazırda beklet / uygulamadan çık / komut çalıştır | **v1** | Windows `shutdown`, `SetSuspendState`; geri sayımlı iptal penceresiyle |
| Süreçleri zorla sonlandırma | **yapılmayacak** | Veri kaybı riski; kapatma işlemi bunu zaten yönetir |
| Kota (MB / saat) | **sonra** | |
| Modemi kapat, çevirmeli bağlantı/telefon defteri | **yapılmayacak** | Eskimiş |

### 2.7 Hız sınırlayıcı

**IDM'deki davranış**

- "İndirmeler → Hız Sınırlayıcı → Aç/Kapat/Ayarlar" yoluyla ya da tepsi simgesinden kullanılır.
- "Maximum Download Speed for One File" (KB/sn) değeri **dosya başınadır**. Toplam hız = indirme sayısı × sınır.
- Varsayılan değer 10 KB/sn **(ikincil kaynak)**.
- "IDM açılışında hız sınırlayıcıyı her zaman aç" seçeneği var.
- Çok düşük hızda bazı sunucuların bağlantıyı kopardığı uyarısı yapılır.

**Karar:** **v1**. Hem genel (toplam) hem indirme başına sınır olacak (token bucket, tüm bağlantılara paylaştırılır), tepsiden hızlı aç/kapat ve açılışta etkin seçeneğiyle. Saate göre değişen sınır **sonra**.

### 2.8 Site yakalayıcı (Grabber)

**IDM'deki davranış:** Dört adımlı bir sihirbazdır; proje şablonları vardır: tüm resimler, video, ses, tüm site.

1. **Başlangıç sayfası:**
   - URL girilir; site adı bu URL'den belirlenir.
   - Kullanıcı adı ve parola verilebilir. "Gelişmiş" altında elle giriş sayfası tanımlanabilir (4. adımdan sonra tarayıcı penceresi açılır) ve çıkış sayfaları listelenebilir (bunlar açılmaz).
   - Proje adı girilirse proje kaydedilir.
2. **Kayıt yolları:**
   - Dosyalar kategori klasörlerine, tek bir klasöre ya da "özgün göreli alt klasörlerle" kaydedilebilir.
   - Çevrimdışı gezinti için bağlantılar yerele çevrilebilir.
   - Üzerine yazma seçeneği var; yazılmazsa `index_2.html` gibi adlar verilir.
   - "İşaretli dosyaları IDM'e ekle" seçeneği var.
3. **Keşif:**
   - Derinlik, mevcut site ve diğer siteler için ayrı ayrı verilir.
   - "Ana alan adındaki tüm siteleri keşfet" (alt alan adları dahil) seçeneği var.
   - Açılır pencereler yok sayılabilir.
   - "Üst dizinleri keşfetme" seçeneği var.
   - JavaScript çalıştırılabilir.
   - Sayfa içerme/dışlama filtreleri `*` jokerini destekler.
4. **Dosya filtreleri:**
   - Tür ya da konum içerme/dışlama yapılır (virgülle ayrılır, `image*.jpg`, `<start page>`).
   - "Yalnız bu sitedeki dosyalar" ve "farklı konumdaki yinelenenleri gizle" seçenekleri var.
   - "Eşleşenlerin hepsini hemen indir" seçeneği var.
   - En küçük ve en büyük boyut verilebilir.

Projeler kaydedilir, zamanlanır (bir kez, belirli saatte durdurma, değişiklikleri izlemek için yineleme) ve herhangi bir adıma dönülüp sürdürülebilir.

**Master Download kararı**

| Özellik | Karar | Not |
|---|---|---|
| Basit tarayıcı: tek sayfa + derinlik, uzantı/boyut filtresi, önizleme listesi, seçip indir | **v1** | Kullanıcı açıkça istedi; tam sihirbaz v2 |
| Tam sihirbaz, proje kaydetme, zamanlama, çevrimdışı ayna, bağlantı yerelleştirme | **sonra (v2)** | |
| Giriş sayfası ile oturum açma | **sonra** | Gömülü BrowserWindow ile çerez alınır |
| JavaScript çalıştırarak bağlantı bulma | **sonra** | Gizli BrowserWindow |
| `robots.txt`'ye uyma, istek hızı sınırı | **v1 (zorunlu)** | Etik sınır (Bölüm 3) |

### 2.9 Toplu indirme ve pano

**IDM'deki davranış**

- "Görevler → Toplu indirme ekle" ile joker şablon tanımlanır, örneğin `http://site/img*.jpg`. Ayarlar şunlardır **(ikincil kaynak; resmi yardım sayfası bulunamadı)**:
  - `*` sayı ya da harfle değiştirilir
  - başlangıç–bitiş aralığı verilir
  - joker genişliği ile baştaki sıfırlar ayarlanır (ör. `001`)
- "Panodan toplu indirme ekle" ile panodaki birden çok URL alınır. Menü adı sürüme göre değişebilir **(doğrulanamadı)**.
- "Görevler → İçe aktar → Metin dosyasından" seçeneği metindeki URL'leri tarar; liste düzenlendikten sonra eklenir.
- Pano izleme: bkz. 2.4.

**Karar:** Joker şablon (sayı/harf, adım, sıfır doldurma, birden çok joker), panodan çoklu URL, metinden URL ayıklama **v1**. Ekleme öncesi önizleme listesi ve kuyruk seçimi **v1**.

### 2.10 Bağlantı yenileme (Refresh download address)

**IDM'deki davranış**

- Geçici ya da süresi dolan bağlantılarda sürdürme bir HTML hata sayfası ya da beklenmedik bir giriş isteğiyle karşılaşabilir.
- Bu durumda sağ tık → "Refresh download address" seçilir. IDM özgün sayfayı tarayıcıda açar ve kullanıcının aynı dosyayı yeniden indirmeye başlamasını bekler.
- Yeni bağlantı yakalanınca eski indirmeye bağlanır. Eşleşme belirsizse onay istenir. Ardından indirme kaldığı yerden sürer.

**Karar:** **v1**. Bekleme modunda gelen ilk yakalama, boyut (`Content-Length`) ve dosya adı eşleşmesiyle doğrulanır; eşleşmezse kullanıcıya sorulur. Elle URL değiştirme de olacak. Yanıt `text/html` olup boyut beklenenden farklıysa otomatik algılanır ve "bağlantı süresi doldu, yenileyin" uyarısı gösterilir.

### 2.11 Bitince: virüs taraması, açma, klasör, tamamlandı penceresi

**IDM'deki davranış**

- **Virüs taraması:** "Seçenekler → İndirmeler → Virüs denetimi" bölümünde antivirüs programının yolu ve parametreleri girilir; `[File]` yer tutucusu kullanılır. Bilinen programlar için parametre otomatik doldurulur; parametre yoksa dosyanın tam yolu sona eklenir.
- **"İndirme tamamlandı" penceresi:**
  - "Aç", "Birlikte aç", "Klasörü aç", "Kapat" düğmeleri vardır. Resmi sayfa yalnız "Aç" düğmesini adıyla anar; diğerleri **(ikincil kaynak)**.
  - "Bu pencereyi bir daha gösterme" seçeneği var.
  - Sağ alt köşedeki simge sürüklenip başka programa bırakılabilir.
  - Pencere "Seçenekler → İndirmeler" altından yeniden açılabilir.

**Karar:** Hepsi **v1**. Ek olarak Windows Defender için hazır şablon (`MpCmdRun.exe -Scan -ScanType 3 -File "[File]"`) ve Windows'un "Mark of the Web" (Zone.Identifier ADS) etiketi eklenecek. Tamamlandı penceresi ve Windows bildirimi (toast) birlikte olacak; ikisi ayrı ayrı kapatılabilir.

### 2.12 İçe/dışa aktarma (.ef2 ve metin)

**IDM'deki davranış**

- "Görevler → Dışa aktar / İçe aktar" ile **.ef2** (IDM dışa aktarma dosyası) ya da düz metin kullanılır. Resmi yardımda .ef2'nin iç yapısı **yayımlanmamıştır**.
- Üçüncü taraf araçlardan (MotooriKashin/ef2, Video-Watch-Archive-Downloader, reIDM) elde edilen yapı şöyledir **(ikincil kaynak; gerçek bir IDM dışa aktarımıyla doğrulanmalı)**:
  - Dosya düz metindir; **UTF-8** kodlamalıdır (bazı araçlar ANSI kullanabilir; doğrulanamadı).
  - Satır sonu **CRLF**'dir ve dosya son CRLF ile biter.
  - Her kayıt tek başına `<` içeren bir satırla açılır, tek başına `>` içeren bir satırla kapanır.
  - Açılıştan sonraki ilk satır anahtarsız **URL**'dir.
  - URL'den sonra isteğe bağlı `anahtar: değer` satırları gelir:

```
<
https://ornek.com/dosyalar/paket.zip
referer: https://ornek.com/indir.html
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...
>
<
https://ornek.com/dosyalar/ikinci.iso
referer: https://ornek.com/
>
```

| Anahtar | Durum |
|---|---|
| (ilk satır) URL | ikincil kaynakta doğrulandı |
| `referer:` | ikincil kaynakta doğrulandı (küçük harf) |
| `User-Agent:` | ikincil kaynakta doğrulandı |
| `cookie:` / `cookies:` | **doğrulanamadı**; yazım ve iki nokta biçimi belirsiz |
| `postdata:`, `username:`, `password:`, `filepath:`, `filename:` | **doğrulanamadı**; MotooriKashin bunların IDM'in resmi anahtarları olmayıp kendi uzantısı olduğunu belirtiyor |

- Güvenlik notu: IDM 6.37.11.1'de bozuk referer ya da URL içeren .ef2 dosyasıyla yığın taşması açığı yayımlanmıştı (Exploit-DB 48397). Okuyucu, bu tür girdilere karşı sağlam olmalıdır.

**Karar**

| Özellik | Karar | Not |
|---|---|---|
| .ef2 içe aktarma (URL, referer, User-Agent; diğer anahtarlar hoşgörüyle) | **v1** | Bilinmeyen anahtarlar yok sayılır; uzunluk sınırları; BOM/ANSI/LF hoşgörüsü |
| .ef2 dışa aktarma (yalnız doğrulanmış alanlar: URL, referer, User-Agent) | **v1** | Çerez dışa aktarımı varsayılan kapalı (gizlilik) |
| Metin listesi içe/dışa aktarma | **v1** | |
| Kendi JSON yedekleme biçimimiz (tüm alanlar, kuyruklar, ayarlar) | **v1** | |
| FlashGet ve benzeri eski yöneticilerden içe aktarma | **yapılmayacak** | Ölü ürünler |

### 2.13 Komut satırı parametreleri

**IDM'deki davranış (resmi)**

Sözdizimi: `idman /s` ya da `idman /d URL [/p yerel_yol] [/f yerel_dosya_adı] [/q] [/h] [/n] [/a]`

| Parametre | Anlamı |
|---|---|
| `/d URL` | Verilen URL'yi indirir |
| `/s` | Zamanlayıcıdaki kuyruğu başlatır |
| `/p yerel_yol` | Kayıt klasörü |
| `/f dosya_adı` | Kayıt dosya adı |
| `/q` | Başarılı indirmeden sonra IDM'den çıkar (yalnız ilk çalışan kopyada) |
| `/h` | Başarılı indirmeden sonra bağlantıyı kapatır (hang up) |
| `/n` | Sessiz kip; hiçbir soru sorulmaz |
| `/a` | `/d` ile verilen dosyayı başlatmadan kuyruğa ekler |

`/a /h /n /q /f /p` yalnız `/d` ile birlikte çalışır. IDM, mağaza eklentilerinin komut satırını kullanmasını yasaklıyor ve bunu yapan eklentileri engelleyeceğini söylüyor. Bunlara ek olarak bir **COM API** de vardır: `SendLinkToIDM2` (referer, çerez, POST verisi, kullanıcı/parola, yol, dosya adı, UA).

**Karar:** IDM ile uyumlu `/d /p /f /q /n /a /s` parametreleri **v1** (tek örnek kilidi; ikinci örnek parametreleri ilk örneğe IPC ile iletir). Ayrıca okunaklı uzun biçimler de olacak (`--url --dir --name --referer --cookie --user-agent --queue --silent`). `/h` (hang up) **yapılmayacak**, çünkü çevirmeli bağlantı eskimiştir; parametre sessizce yok sayılır. COM API **yapılmayacak**; onun yerine yerel HTTP/named-pipe API (belirteçli) **sonra**.

### 2.14 Sürükle-bırak, bırakma hedefi, ilerleme penceresi

**IDM'deki davranış**

- Bağlantı ana pencereye, **bırakma hedefine** (küçük, her zaman üstte duran yüzer pencere) ya da "indirme sepetine" sürüklenebilir. Bırakma hedefi kapatılırsa "Görevler → Bırakma hedefini göster" ile geri getirilir. Biten dosya IDM'den dışarı sürüklenebilir.
- **İndirme ilerleme penceresi:**
  - **İndirme durumu sekmesi:** URL, durum, dosya boyutu, inen miktar, aktarım hızı, kalan süre, sürdürme desteği (Evet/Hayır) gösterilir.
  - Parçalı ilerleme çubuğu (bkz. 2.1) bulunur.
  - Bağlantı tablosunda her bağlantının inen miktarı ve durumu yer alır **(ikincil kaynak)**.
  - "Hız sınırlayıcı" sekmesi ve "bitince" seçenekleri (bildirim penceresi, bilgisayarı kapat ve benzeri) vardır **(ikincil kaynak)**.
  - Düğmeler: Duraklat ve İptal.
  - Pencere "Gösterme" ya da "Küçültülmüş göster" olarak ayarlanabilir; sessiz kip için başlangıç iletişim kutusu da kapatılabilir.

**Karar:** Ana pencereye sürükle-bırak (URL, metin, `.ef2`, `.txt`), dışarı dosya sürükleme (Electron `webContents.startDrag`), ilerleme penceresi (parça çubuğu + bağlantı tablosu + indirme başına hız sınırı + bitince eylemi) **v1**. Yüzer bırakma hedefi (çerçevesiz, her zaman üstte, saydam BrowserWindow) **v1**, varsayılan kapalı.

### 2.15 Diğer

| IDM özelliği | IDM'deki davranış | Karar |
|---|---|---|
| Ses bildirimleri | "Sesler" sekmesi: her olay (indirme bitti, başarısız, kuyruk başladı vb.) için `.wav` atanır, "Çal" ile denenir | **v1** (hazır ses + özel dosya) |
| Tema / görünüm | Koyu tema; araç çubuğu kaplamaları (4 hazır + özel) | **v1** koyu/açık (Mastertool ortak teması); araç çubuğu kaplamaları **yapılmayacak** |
| Güncelleme | Haftalık denetim, yenilikleri gösterip sorar | **v1** (Mastertool ortak güncelleyicisi, electron-updater) |
| Dil | Çok dilli | **v1**: 8 dil (Mastertool standardı) |
| Ana pencere sütunları | Ad, boyut, durum, kalan süre, hız, son deneme, açıklama; sıralama, gizleme/gösterme, sürükleyerek yerini değiştirme, genişlik | **v1** |
| Araç çubuğu | Düğme sırası özelleştirilebilir | **v1** sabit araç çubuğu; özelleştirme **sonra** |
| İndirme özellikleri penceresi | Kayıt yeri, URL (düzenlenebilir), açıklama, Aç düğmesi; çift tıkla açılır | **v1** + referer, çerez, UA, kimlik doğrulama, bağlantı sayısı alanları |
| Yinelenen dosya adı / bağlantı | Aynı bağlantı yeniden eklenirse uyarı verir: numaralı ad ile ekle / üzerine yaz / mevcutu göster **(ikincil kaynak; seçenek adları doğrulanamadı)** | **v1**: Sor / otomatik numarala `ad (1).ext` / üzerine yaz / atla |
| Geçici klasör | "Kayıt yeri" sekmesinde ayarlanır; parçalar burada tutulur | **v1**: varsayılan, hedef klasörde `.mdpart` uzantılı tek seyrek dosya; isteğe bağlı ayrı geçici klasör |
| Dial-Up / VPN sekmesi | Çevirmeli bağlantı yönetimi | **yapılmayacak** (eskimiş). VPN/ağ değişimi algılanınca bağlantılar yeniden kurulur ve "ağ değişti" bildirimi gösterilir: **sonra** |
| Windows ile başlama | "Genel" sekmesi | **v1** (`app.setLoginItemSettings`) |
| ZIP önizleme | İndirmeden önce ZIP içeriğini gösterir (merkezi dizin Range ile çekilir) | **sonra** |
| Grabber projelerinin ağaçta görünmesi | Kategoriler ağacında | **sonra** (Grabber ile birlikte) |
| Kurulum sihirbazı / bağlantı testi | Kurulumdan sonra ayarları yapar | **v1** basit ilk açılış sihirbazı (eklenti kurulum bağlantıları) |
| Mobil cihaz | IDM'in mobil sürümü yok | Mastertool mobil uygulamasına "uzaktan kuyruğa ekle" **sonra** |
| Ölçülü bağlantı (metered) algılama | IDM'de yok **(doğrulanamadı)** | **sonra**: Windows ölçülü ağda kuyruğu duraklat |

---

## 3. Yasal ve etik sınır

Master Download **yalnız doğrudan erişilebilen ve korumasız içerikleri** indirir:

1. **Desteklenen:**
   - Doğrudan dosya bağlantıları (HTTP/HTTPS/FTP)
   - Kullanıcının zaten erişim hakkı olan oturumlu indirmeler (çerez ya da giriş ile)
   - **Şifresiz** HLS (`.m3u8`, TS/fMP4 parçaları)
   - **Şifresiz** DASH (`.mpd`)
2. **Desteklenmeyen (yapılmayacak):**
   - **DRM'li akışlar: Widevine, PlayReady, FairPlay.** Lisans sunucusu ile konuşma, CDM kullanma ya da anahtar çıkarma kesinlikle yapılmayacak. Manifestte `#EXT-X-KEY:METHOD=SAMPLE-AES`, `ContentProtection` (cenc/Widevine/PlayReady UUID'leri) varsa indirme reddedilir ve "Bu içerik koruma altındadır" mesajı gösterilir.
   - **Kullanım koşulları indirmeyi yasaklayan platformlar** (ör. YouTube, Netflix, Spotify, Disney+ vb.). Video algılama düğmesi bu alan adlarında gösterilmez (kodda sabit engelli liste + eklenti tarafında aynı liste). IDM'in kendi SSS'si de bazı korumalı protokolleri yasal nedenlerle desteklemediğini belirtir.
   - Akış imzası, belirteç (token) üretme ya da obfuscation çözme gibi koruma aşma işlemleri.
3. **Şifreli HLS (AES-128, anahtar URI'si herkese açık sunuluyor): sonra, değerlendirilecek.** Teknik olarak tarayıcının oynatırken yaptığından farkı yoktur. Ancak "teknik koruma önlemi" sayılıp sayılmayacağı hukuki değerlendirme gerektirdiği için v1'de **desteklenmez**: manifestte `METHOD=AES-128` görülürse indirme reddedilir.
4. **Site yakalayıcı:** `robots.txt`'ye uyacak, istek hızını varsayılan olarak sınırlayacak ve kendi kullanıcı aracısını dürüstçe bildirecek.
5. **Kullanıcı bildirimi:** İlk açılışta ve "Hakkında" ekranında, telif hakkı ve site koşullarına uyma sorumluluğunun kullanıcıda olduğu belirtilecek.

---

## 4. Özet karar tablosu

| # | Özellik | Karar | Gerekçe / not |
|---|---|---|---|
| 1 | Dinamik bölümleme, en büyük kalanı ikiye bölme, yük devralma | v1 | Ana çekirdek |
| 2 | Varsayılan 8, en çok 32 bağlantı; sunucu başına istisna | v1 | |
| 3 | Bağlantının yeniden kullanılması (keep-alive) | v1 | |
| 4 | Konumu düzenli kaydetme / çökme sonrası kurtarma | v1 | |
| 5 | HTTP/2 çoklu akış | sonra | |
| 6 | Duraklat/sürdür (Range, If-Range) | v1 | |
| 7 | Sürdürme desteklenmiyorsa uyarı | v1 | |
| 8 | Otomatik yeniden deneme + sayı sınırı | v1 | |
| 9 | HTTP/HTTPS, yönlendirme | v1 | |
| 10 | FTP (PASV, REST ile sürdürme) | v1 | |
| 11 | FTPS | sonra | |
| 12 | SFTP | sonra | Mastertool SSH çekirdeği |
| 13 | MMS / RTSP | yapılmayacak | Eskimiş |
| 14 | Çerez (aktarılan + elle) | v1 | Şifreli saklama |
| 15 | Basic / Digest | v1 | |
| 16 | NTLM / Negotiate / Kerberos | sonra | Kurumsal |
| 17 | Site girişleri listesi | v1 | |
| 18 | Proxy: sistem, HTTP, SOCKS4/5, PAC, atlama, kimlik doğrulama | v1 | |
| 19 | ISA / FTP proxy türleri | yapılmayacak | Eskimiş |
| 20 | Kullanıcı aracısı (genel + indirme başına) | v1 | |
| 21 | Chrome/Edge eklentisi (MV3) | v1 | |
| 22 | Firefox eklentisi | v1 | |
| 23 | Native messaging host | v1 | |
| 24 | Uzantı + site istisna listeleri | v1 | |
| 25 | Alt ile atlama, Ctrl ile zorlama | v1 | |
| 26 | Sağ tık menüsü (bağlantı, tüm bağlantılar, seçim) | v1 | |
| 27 | Video/ses algılama düğmesi (korumasız HLS/DASH dahil) | v1 | Engelli site listesiyle |
| 28 | HLS indirme (TS/fMP4 uç uca) + DASH tek temsil | v1 | ffmpeg'siz; ses+görüntü birleştirme (mux) ve TS→MP4 sonra |
| 29 | Sistem düzeyi gelişmiş yakalama | yapılmayacak | Ağ kancası/sürücü; güvenlik |
| 30 | Pano izleme | v1 | Varsayılan kapalı |
| 31 | Eski tarayıcılar (IE, Maxthon vb.) | yapılmayacak | Ölü |
| 32 | Kategoriler, uzantı/site eşlemesi, klasör | v1 | |
| 33 | Ana kuyruk + ek kuyruklar, eşzamanlı sınır | v1 | |
| 34 | Zamanlayıcı: saat, günler, durma saati | v1 | |
| 35 | Senkronizasyon kuyruğu | sonra | Koşullu GET |
| 36 | Bitince: kapat/uyku/hazırda beklet/çık/komut | v1 | Geri sayımlı iptal |
| 37 | Süreçleri zorla sonlandırma | yapılmayacak | Veri kaybı riski |
| 38 | İndirme kotası (MB/saat) | sonra | |
| 39 | Dial-up, modemi kapat, `/h` | yapılmayacak | Eskimiş |
| 40 | Hız sınırlayıcı (genel + indirme başına) | v1 | |
| 41 | Saate göre hız sınırı | sonra | |
| 42 | Site yakalayıcı: basit (başlangıç adresi + derinlik + alan sınırı + tür filtresi) | v1 | robots.txt'ye uyar; sayfa sınırı |
| 43 | Site yakalayıcı: tam sihirbaz, proje, ayna, JS | sonra (v2) | robots.txt zorunlu |
| 44 | Toplu indirme (joker, aralık, sıfır doldurma) | v1 | |
| 45 | Panodan / metinden toplu ekleme | v1 | |
| 46 | Bağlantı yenileme | v1 | Boyut/ad eşlemesi |
| 47 | Bitince virüs taraması (`[File]`, Defender şablonu) | v1 | |
| 48 | Mark of the Web etiketi | v1 | |
| 49 | Tamamlandı penceresi + bildirim | v1 | |
| 50 | Dosyayı aç / klasörü göster | v1 | |
| 51 | .ef2 içe aktarma | v1 | Hoşgörülü ayrıştırıcı |
| 52 | .ef2 dışa aktarma (URL, referer, UA) | v1 | Çerez varsayılan kapalı |
| 53 | Metin listesi içe/dışa aktarma | v1 | |
| 54 | JSON yedekleme | v1 | |
| 55 | Eski yöneticilerden içe aktarma | yapılmayacak | Ölü ürünler |
| 56 | Komut satırı `/d /p /f /q /n /a /s` + uzun biçimler | v1 | |
| 57 | COM API | yapılmayacak | Yerine yerel API (sonra) |
| 58 | Yerel HTTP/pipe API | sonra | |
| 59 | Sürükle-bırak (içeri/dışarı) | v1 | |
| 60 | Yüzer bırakma hedefi | v1 | Varsayılan kapalı |
| 61 | İlerleme penceresi (parça çubuğu, bağlantı tablosu) | v1 | |
| 62 | Ses bildirimleri | v1 | |
| 63 | Gece/Gündüz/Sistem tema | v1 | Mastertool standardı, varsayılan Sistem |
| 64 | Araç çubuğu kaplamaları | yapılmayacak | Değeri düşük |
| 65 | Araç çubuğu özelleştirme | sonra | |
| 66 | Otomatik güncelleme | v1 | |
| 67 | 8 dil (tr, en, fr, de, es, ar-RTL, zh, ru) | v1 | Mastertool standardı |
| 68 | Sütun özelleştirme | v1 | |
| 69 | İndirme özellikleri penceresi (genişletilmiş) | v1 | |
| 70 | Yinelenen ad/bağlantı davranışı | v1 | |
| 71 | Geçici klasör / `.mdpart` | v1 | |
| 72 | Windows ile başlama | v1 | |
| 73 | ZIP önizleme | sonra | |
| 74 | Ağ/VPN değişimi algılama, ölçülü ağda duraklatma | sonra | |
| 75 | Mobil uzaktan kuyruğa ekleme | sonra | Mastertool mobil |
| 76 | DRM (Widevine/PlayReady/FairPlay) | **yapılmayacak** | Yasal; kesin |
| 77 | Koşulları indirmeyi yasaklayan platformlar (YouTube vb.) | **yapılmayacak** | Engelli liste |
| 78 | Şifreli HLS (AES-128, açık anahtar) | sonra, değerlendirilecek | v1'de reddedilir |

---

## 5. Kaynaklar

Resmi (internetdownloadmanager.com):

- https://www.internetdownloadmanager.com/features2.html — özellik listesi
- https://www.internetdownloadmanager.com/news.html — sürüm notları (6.43 Build 8–16)
- https://www.internetdownloadmanager.com/support/segmentation.html — dinamik bölümleme
- https://www.internetdownloadmanager.com/support/command_line.html — komut satırı
- https://www.internetdownloadmanager.com/support/using_idm/using_idm.html — genel kullanım, kategoriler, ilerleme penceresi
- https://www.internetdownloadmanager.com/support/using_idm/options.html — Seçenekler iletişim kutusu
- https://www.internetdownloadmanager.com/support/using_idm/starting.html — indirme başlatma, Alt/Ctrl, sağ tık, bırakma hedefi
- https://www.internetdownloadmanager.com/support/using_idm/properties.html — indirme özellikleri
- https://www.internetdownloadmanager.com/support/using_idm/completeD.html — tamamlandı penceresi
- https://www.internetdownloadmanager.com/support/idm-scheduler/idm_scheduler.html — zamanlayıcı
- https://www.internetdownloadmanager.com/support/idm-scheduler/idm_queues.html — kuyruklar
- https://www.internetdownloadmanager.com/support/idm-grabber/idm_grabber.html — site yakalayıcı
- https://www.internetdownloadmanager.com/support/idm-grabber/grabber_wizard.html — yakalayıcı sihirbazı
- https://www.internetdownloadmanager.com/support/idm-grabber/filters.html — yakalayıcı filtreleri (joker)
- https://www.internetdownloadmanager.com/support/import_downloads.html — metinden içe aktarma
- https://www.internetdownloadmanager.com/support/idm_api.html — COM API (SendLinkToIDM2)
- https://www.internetdownloadmanager.com/register/new_faq/sites2_3.html — bağlantı yenileme
- https://www.internetdownloadmanager.com/register/new_faq/functions8.html — bağlantı sayısı önerisi
- https://www.internetdownloadmanager.com/register/new_faq/functions11.html — hız sınırlayıcı
- https://www.internetdownloadmanager.com/register/new_faq/video1.html , video2.html — video paneli
- https://www.internetdownloadmanager.com/register/new_faq/chrome-extension-manifest3.html — eklenti / Manifest
- https://www.internetdownloadmanager.com/register/new_faq/edge-extension.html — Edge eklentisi

İkincil:

- https://github.com/MotooriKashin/ef2 — .ef2 biçimi örneği ve anahtarlar
- https://github.com/GitRuozhi/Video-Watch-Archive-Downloader — .ef2 dışa aktarma (CRLF, referer/UA)
- https://github.com/Zektopic/reIDM/pull/1 — .ef2 içe/dışa aktaran açık kaynak klon
- https://www.exploit-db.com/exploits/48397 — .ef2 içe aktarma taşma açığı (IDM 6.37.11.1)
- https://fileinfo.com/extension/ef2 — .ef2 tanımı
- https://itstillworks.com/limit-transfer-rate-internet-download-manager-32908.html — hız sınırlayıcı adımları
- https://forum.httrack.com/readmsg/35637/35632/index.html — toplu indirme joker alanları (kullanıcı anlatımı)
- https://developer.chrome.com/docs/extensions/mv3/nativeMessaging — native messaging
- https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging — Edge native messaging
