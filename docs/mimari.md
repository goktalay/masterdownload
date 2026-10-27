# Master Download — mimari plan

Master Download, Mastertool ailesinin Windows indirme yöneticisidir (Internet Download Manager'ın yaptığı işi yapar).
Özellik kapsamı ve sürüm kararları: [idm-ozellikleri.md](idm-ozellikleri.md). Arayüz ve iskelet: Mastertool standardı
(goktalay/sshmasters `docs/mastertool-standard.md`, en yeni örnek goktalay/mastertool).

- Uygulama kodu: **`md`** (ana oturum onayladı; grup "apps") → `/api/md/*`, `/brand/md.svg|png`.
- Electron 33 + electron-builder NSIS (+ portable), `Master Download.exe`, appId `com.mastertool.masterdownload`.
- Kurulum: `Program Files\Mastertool\Master Download`, Başlat menüsü klasörü `Master Tool` (`build/installer.nsh` sshmasters `5cc0578`'den birebir).
- 8 dil (tr, en, fr, de, es, ar-RTL, zh, ru), tema Gece/Gündüz/Sistem (varsayılan Sistem), tepside her zaman simge.

## 1. Süreçler

```
┌──────────────── Tarayıcı (Chrome / Edge / Firefox) ────────────────┐
│ Eklenti (MV3): indirme yakalama, sağ tık menüsü, video/ses algılama │
└───────────────┬────────────────────────────────────────────────────┘
                │ native messaging (stdio, 4 bayt uzunluk + JSON)
┌───────────────▼──────────────────┐
│ md-host (Master Download.exe,     │  ELECTRON_RUN_AS_NODE=1 ile düz Node olarak çalışır;
│ ELECTRON_RUN_AS_NODE, nmhost.js)  │  pencere açmaz, tek örnek kilidine girmez
└───────────────┬──────────────────┘
                │ adlandırılmış kanal \\.\pipe\master-download-<kullanıcı> (satır başına JSON)
┌───────────────▼─────────────────────────────────────────────────────┐
│ Ana süreç (src/main.js)                                              │
│  ├─ İndirme motoru (src/engine/*) — Electron'dan bağımsız, testlenir  │
│  ├─ Kuyruk + zamanlayıcı, hız sınırlayıcı, kategori kuralları         │
│  ├─ Pano izleyici, komut satırı (/d /p /f /q /h /n /a /s)             │
│  ├─ Hesap + ortak oturum (account.js, sso.js — /api/md/*)             │
│  └─ Tepsi, pencereler, IPC                                            │
└───────────────┬─────────────────────────────────────────────────────┘
                │ contextBridge (preload.js)
┌───────────────▼─────────────────────────────────────────────────────┐
│ Arayüz: ana pencere, Yeni indirme, İlerleme penceresi, Tamamlandı,    │
│ Toplu indirme, Site yakalayıcı, Kuyruklar/Zamanlayıcı, Ayarlar,       │
│ Bırakma hedefi (küçük her zaman üstte pencere), giriş ekranı          │
└──────────────────────────────────────────────────────────────────────┘
```

Uygulama açık değilken eklentiden istek gelirse host `Master Download.exe --hidden` ile uygulamayı başlatır ve kanal
açılana kadar (en çok 15 sn) yeniden dener. Ailedeki diğer uygulamalar gibi Master Download da **girişsiz açılmaz**:
oturum yoksa ortak oturumla (`/api/md/auth/sso`) şifresiz girmeyi dener; o da yoksa giriş penceresi açılır ve gelen
istekler girişten sonra işlenmek üzere bekletilir.

## 2. İndirme motoru (`src/engine/`)

Electron'a bağımlı değildir (ağ, dosya, saat dışarıdan verilebilir), `node --test` ile doğrudan test edilir.

| Modül | Görevi |
| --- | --- |
| `probe.js` | İlk istek: `GET` + `Range: bytes=0-` (gövde ilk bölüm olarak kullanılır). Yönlendirmeleri izler (en çok 10), son adres, boyut, `Accept-Ranges`/`206` ile sürdürme desteği, `ETag`/`Last-Modified`, `Content-Disposition` dosya adı, MIME. |
| `http.js` | `http`/`https` modülleriyle istek: çerez başlığı, Referer, kullanıcı aracısı, Temel/Digest kimlik doğrulama, HTTP proxy (CONNECT) ve SOCKS5, sistem proxy (Electron `session.resolveProxy` dışarıdan verilir), zaman aşımı, keep-alive havuzu. |
| `segments.js` | Dinamik bölümleme (saf mantık): başta N bölüm; bir bağlantı bitince **kalan en büyük bölüm ikiye bölünür** ve boşalan bağlantı ikinci yarıyı devralır (bölüm en küçük 256 KB altına inmez). Bölüm durumu `{start, end, done}`. |
| `task.js` | Tek indirmenin yaşam döngüsü: `queued → connecting → downloading → (paused) → assembling → completed / error`. Her bölüm aynı geçici dosyaya **konumlu yazma** (`FileHandle.write(buf, 0, n, pos)`) yapar; ayrı parça dosyası ve kopyalama yoktur. Bitince dosya tanıtıcısı **kapanması beklenerek** (`await fh.close()`) hedefe taşınır (aynı birimde `rename`, değilse kopyala + doğrula + sil). |
| `retry.js` | Bağlantı kopması / 5xx / zaman aşımı: bölüm bazında üstel bekleme (1, 2, 4… en çok 30 sn), ayarlanabilir deneme sayısı (varsayılan 20). 4xx kalıcı hatadır (401/403/404/410 → “bağlantı yenile” önerisi). |
| `throttle.js` | Belirteç kovası: genel sınır + indirme başına sınır; bağlantılar arasında adil paylaşım. |
| `ftp.js` | FTP/FTPS (basic-ftp, MIT): `SIZE`, `REST` ile sürdürme ve çok bağlantılı bölümleme, pasif kip. |
| `hls.js` | HLS: ana liste → varyant seçimi (çözünürlük/bit hızı), parçalar sırayla ve paralel indirilir, `.ts` olarak uç uca eklenir (fMP4'te `#EXT-X-MAP` başlığı + parçalar → `.mp4`). Şifreli (`#EXT-X-KEY`) listeler v1'de reddedilir. |
| `dash.js` | DASH (`.mpd`): `SegmentTemplate`/`SegmentList`/`BaseURL`; v1'de tek temsil (ses ya da görüntü, ya da ikisi ayrı dosya); `ContentProtection` varsa reddedilir. Ses+görüntü birleştirme sonra. |
| `queue.js` | Kuyruklar (Ana kuyruk + kullanıcı kuyrukları), kuyruk başına eşzamanlı indirme sınırı, sıralama, zamanlayıcı (başlangıç/bitiş saati, günler, tek sefer/günlük), bitince eylem (çıkış, uyku, hazırda bekletme, kapat — `shutdown.exe` / `rundll32 powrprof`). Saat dışarıdan verilir (test). |
| `categories.js` | Uzantı → kategori → klasör kuralları (Sıkıştırılmış, Belgeler, Müzik, Programlar, Video, Genel), kullanıcı kategorileri. |
| `batch.js` | Toplu kalıp: `dosya[001-100].zip`, `resim[a-z].jpg`, adım/basamak dolgusu; panodan/metinden bağlantı ayıklama. |
| `grabber.js` | Site yakalayıcı: başlangıç adresi, derinlik, aynı alan / alt klasör sınırı, uzantı/MIME filtreleri, en çok sayfa; HTML'den `a/img/source/link` adresleri; robots.txt'ye uyar. |
| `ef2.js` | IDM `.ef2` içe/dışa aktarma ve düz metin liste. |
| `filename.js` | Dosya adı: `Content-Disposition` (RFC 5987/6266), adres, MIME'dan uzantı; Windows'a yasak karakter/ad temizliği; yinelenen adda `ad (2).ext` / üzerine yaz / sor. |
| `store.js` | Kalıcı liste: `%APPDATA%\Master Download\downloads.json` (geçici dosya + rename ile atomik); bölüm ilerlemesi geçici klasörde `<id>.mdstate` (2 sn'de bir), uygulama çökse de kaldığı yerden sürer. |

Sürdürme: sunucu `206` vermiyorsa ya da `ETag`/`Last-Modified`/boyut değiştiyse indirme “sürdürülemez” işaretlenir;
duraklatmada kullanıcı uyarılır (IDM'deki “sürdürme yeteneği: Hayır”), yeniden başlatmada baştan iner.
Bağlantı yenileme: kullanıcı yeni adresi yapıştırır ya da eklentiden “bağlantıyı yenile” kipinde aynı dosyayı
yeniden tıklar; boyut ve (varsa) ETag eşleşirse bölümler korunarak yeni adresle sürer.

## 3. Tarayıcı bütünleşmesi (`extension/`, `src/nmhost.js`, `src/bridge.js`)

- **Eklenti (Manifest V3)**, tek kaynak, iki manifest: Chromium (Chrome/Edge, service worker) ve Firefox (`background.scripts`, `browser_specific_settings.gecko.id`).
  - `downloads.onCreated`/`onDeterminingFilename`: uygun indirmeyi (uzantı listesi, en küçük boyut, istisna siteler, Alt basılıysa atla) iptal edip Master Download'a verir; uygulama yanıt vermezse tarayıcının indirmesine geri döner.
  - `contextMenus`: “Master Download ile indir”, “Tüm bağlantıları Master Download ile indir”, “Bu videoyu/sesi indir”.
  - `webRequest.onHeadersReceived`: sayfadaki `.m3u8`/`.mpd`/video-ses MIME yanıtlarını not eder; içerik betiği videonun üzerinde “Bu videoyu indir” düğmesi gösterir (seçenekli, site istisnaları). DRM'li (EME) oynatıcılarda ve koşulları indirmeyi yasaklayan bilinen sitelerde (ör. YouTube) düğme gösterilmez.
  - Çerezler `chrome.cookies.getAll({url})`, Referer, kullanıcı aracısı istekle gönderilir.
- **Native messaging host** `com.mastertool.masterdownload`: manifest `%LOCALAPPDATA%\Master Download\nmhost\*.json`;
  `HKCU\Software\{Google\Chrome, Microsoft\Edge, Mozilla}\NativeMessagingHosts\...` kayıtları uygulama açılışında ve
  Ayarlar › Tarayıcı bütünleşmesi'nden yazılır. Host bir `.cmd` sarmalayıcıdır: `ELECTRON_RUN_AS_NODE=1` ile
  `Master Download.exe resources\app.asar\src\nmhost.js` — ayrı derlenmiş ikili gerekmez.
- **Kanal protokolü** (satır başına JSON, `v:1`): `hello`, `add {url, referrer, cookies, ua, filename, size, mime, kind:"file"|"hls"|"dash", media:{…}}`, `addMany {items}`, `ping`. Yanıt `{ok, id}` / `{ok:false, code}`.
- Eklenti mağaza yayını (Chrome Web Store, Edge Add-ons, Firefox AMO) hesap ve inceleme gerektirir: kullanıcı onayıyla, sonra. Geliştirmede “paketlenmemiş yükle”; Chromium için sabit `key` ile sabit eklenti kimliği.

## 4. Veri modeli

`%APPDATA%\Master Download\store.json` — ayarlar:

```js
{
  appTheme: 'system', language: null, openAtLogin: false, minimizeToTray: true, closeToTray: true, checkUpdates: true,
  connection: { maxConnections: 8 /*1–32*/, retries: 20, timeoutSec: 30, userAgent: '', proxy: { mode: 'system'|'none'|'http'|'socks5', host, port, user } },
  downloads: { dir: '%USERPROFILE%\\Downloads\\Master Download', tempDir: '', duplicate: 'rename'|'overwrite'|'ask',
               showStartDialog: true, showCompleteDialog: true, virusScan: false, scanner: 'defender'|'custom', scannerArgs: '' },
  speedLimit: { enabled: false, kbps: 1024 },
  browser: { enabled: true, exts: ['zip','rar','7z','exe','msi','iso','mp4','mkv','mp3','pdf',…], minSizeKB: 0, skipSites: [], videoButton: true },
  clipboard: { watch: false },
  categories: [{ id, name, exts: [...], dir }],
  queues: [{ id: 'main', name, maxParallel: 1, schedule: { enabled, start: '02:00', stop: '07:00', days: [1..7], once: false }, after: 'none'|'exit'|'sleep'|'hibernate'|'shutdown' }],
}
```

`downloads.json` — liste:

```js
{ id, url, finalUrl, referrer, cookies?, ua?, auth?: {user, passEnc /* safeStorage */}, kind: 'file'|'hls'|'dash'|'ftp',
  media?: { variant, segments }, fileName, dir, category, queue, size, received, resumable, etag, lastModified,
  status: 'queued'|'downloading'|'paused'|'completed'|'error', error?, connections, speedLimitKbps?,
  addedAt, finishedAt, description }
```

Çerezler ve parolalar diske Electron `safeStorage` (DPAPI) ile şifreli yazılır; tamamlanan indirmelerde çerez silinir.

## 5. Arayüz

Ana pencere (1180×760, en az 860×540), Master Tool üst çubuğu:

- **Üst çubuk**: simge + “Master Download” + özet (“3 indiriliyor · 4,2 MB/sn”), araç düğmeleri (Adres ekle, Sürdür,
  Durdur, Tümünü durdur, Sil, Kuyruğu başlat/durdur, Zamanlayıcı, Hız sınırı, Site yakalayıcı, Toplu indirme), Ayarlar,
  hesap rozeti, sağ üstte **mastertool.download** bağlantısı.
- **Sol kenar**: Tümü / Kategoriler (Sıkıştırılmış, Belgeler, Müzik, Programlar, Video) / Bitmemiş / Bitmiş / Kuyruklar (sürükle-bırak ile kuyruğa taşıma).
- **Liste**: Dosya adı (tür simgesi), Boyut, Durum/ilerleme çubuğu, Hız, Kalan süre, Eklenme tarihi, Açıklama; sütunlar sıralanır/gizlenir; çoklu seçim, sağ tık menüsü (Aç, Klasörü göster, Sürdür, Durdur, Yeniden indir, Bağlantıyı yenile, Kuyruğa taşı, Adresi kopyala, Özellikler, Sil).
- **Alt bilgi paneli** (seçili indirme): bölüm haritası (her bağlantı ayrı renk), bağlantı tablosu (bayt, durum), adres, yol, sürdürme desteği.
- **Pencereler**: Yeni indirme (adres, ad, klasör, kategori, kuyruk, bağlantı sayısı, kimlik bilgisi; “Şimdi başlat / Sonra / Kuyruğa ekle”), İndirme ilerleme penceresi (IDM'deki gibi küçük ayrı pencere: hız, kalan süre, bölüm haritası, hız sınırı, “bitince kapat”), İndirme tamamlandı (Aç, Birlikte aç, Klasörü aç), Toplu indirme, Site yakalayıcı sihirbazı (4 adım), Kuyruklar/Zamanlayıcı, Özellikler.
- **Bırakma hedefi**: isteğe bağlı küçük, her zaman üstte, sürüklenebilir yuvarlak pencere; bağlantı/metin bırakılınca Yeni indirme.
- Ana pencereye bağlantı/`.ef2`/metin dosyası sürükle-bırak.
- **Tepsi**: her zaman görünür; tek tık menü (Adres ekle, Panodan ekle, Kuyruğu başlat/durdur, Hız sınırı aç/kapat, Bırakma hedefi, Göster, Çık), çift tık pencere; araç ipucunda toplam hız.
- **Ayarlar**: Genel (dil, tema, Windows ile başlat, tepsi, güncelleme denetimi) · Hesap · Bağlantı · İndirmeler · Kategoriler · Tarayıcı bütünleşmesi · Hız sınırı · Kuyruklar ve zamanlayıcı · Hakkında (sürüm, aile, güncelleme, açık kaynak lisansları).

## 6. Hesap ve ortak oturum

Convert Master/Master Tool'daki `src/sso.js` ve `src/account.js` uyarlanır (senkron kütüphanesi yok):

- `POST /api/md/auth/prelogin {email}` → `kdf` → PBKDF2-SHA256 → `POST /api/md/auth/login {email, auth_hash, device, app_version, sso:true}` → `{token, user, sso_token, kdf}`.
- Ortak kimlik `@napi-rs/keyring` `Entry('Mastertool','sso')`, JSON ≤ 1200 karakter; `%APPDATA%\Mastertool\sso-state.json` geçici dosya + rename; asıl durum ortak kimlikten okunur, `fs.watch` + 5 sn yoklama.
- `POST /api/md/auth/sso {sso_token, device, app_version}` ile şifresiz giriş; çıkış ortak kimliği silip durumu `out` yapar (tüm aile kapanır).
- `GET /api/md/me`, `GET /api/md/releases/latest`, `GET /api/md/apps/md/download?kind=setup` (kendi güncellemesi).
- Uygulama token'ı “Beni hatırla” ile `safeStorage` şifreli saklanır.

## 7. Test ve CI

`npm test` = `node --test test/` (Electron gerektirmez). Gerçek yerel HTTP sunucusu (`test/server.js`: Range, 200-yalnız,
kesinti enjeksiyonu, yönlendirme, çerez/kimlik doğrulama kontrolü, yavaş yanıt, değişen ETag) ve küçük bir FTP sunucusu.

- çok parçalı indirme + birleştirme (SHA-256 eşitliği), dinamik bölme (biten bağlantı en büyük parçayı devralır)
- duraklat/sürdür (Range), uygulama yeniden başlamış gibi `.mdstate`'ten sürdürme, sürdürme desteklenmeyen sunucu
- bağlantı kopması → yeniden deneme, kalıcı 404, değişen ETag
- hız sınırı (ölçülen hız ±%25), kuyruk eşzamanlılığı, zamanlayıcı (sahte saat), bitince eylem
- kategori kuralları, dosya adı temizliği, yinelenen ad, toplu kalıp, `.ef2` gidiş-dönüş, komut satırı ayrıştırma
- HLS (ana liste + varyant + parçalar), DASH tek temsil
- native messaging çerçeveleme, kanal protokolü
- SSO akışları (bellek içi keyring + sahte sunucu), i18n anahtar eşliği (8 dil)

CI (`.github/workflows/release.yml`): her itmede ubuntu + windows'ta `npm test`; `v*` etiketinde Windows derlemesi,
GitHub Release ve `scripts/upload-masterdownload.sh` ile mastertool.download'a parçalı yükleme (notlar `CHANGELOG.md`
“## <sürüm>” bölümünden UTF-8 dosyayla). Etiket/yayın yalnız kullanıcının açık onayıyla.

## 8. Sunucu tarafı (ana oturumdan istenecek)

APPS'e `md` (ad “Master Download”, exe `Master Download.exe`, kurulum klasörü `Mastertool\Master Download`, site
mastertool.download/master-download), lisans, `/brand/md.svg|png`, sürüm yükleme anahtarı (`MD_RELEASE_KEY`
GitHub secret), tanıtım sayfası (ekran görüntüleri `docs/screenshots/manifest.json`'dan).
