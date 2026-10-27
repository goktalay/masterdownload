# Master Download tarayıcı eklentisi

Tek kaynak (`src/`), iki paket: Chrome/Edge (MV3 service worker) ve Firefox 115+ (MV3, `background.scripts`).
Mimari: [../docs/mimari.md §3](../docs/mimari.md); yasal sınır: [../docs/idm-ozellikleri.md §3](../docs/idm-ozellikleri.md).

```
node extension/build.js          # → extension/dist/chromium, extension/dist/firefox
node extension/make-icons.js     # simgeleri (src/icons/icon-{16,32,48,128}.png) yeniden üretir
```

| Dosya | Görevi |
| --- | --- |
| `src/rules.js` | Saf kurallar (UMD; tarayıcıda `MDRules`, Node'da `require`): `shouldCapture`, `isBlockedSite`, `detectKind`, ayar normalleştirme. Testleri `test/extension.test.js`. |
| `src/background.js` | İndirme yakalama (`downloads.onCreated` + Chromium'da `onDeterminingFilename`), native messaging, sağ tık menüsü, `webRequest` ile medya algılama. |
| `src/content.js` | Alt/Ctrl durumu, Ctrl ile tıklanan dosya bağlantısı, bağlantı toplama, video üstü “⬇ İndir” rozeti. |
| `src/popup.*`, `src/options.*`, `src/ui.css` | Araç çubuğu penceresi ve seçenekler. |
| `src/_locales/{tr,en,fr,de,es,ar,zh,ru}` | 8 dil, eşit anahtar. Chromium `zh` klasörünü tanımadığı için derleme onu `zh_CN` ve `zh_TW` olarak kopyalar. |

## Davranış özeti

- Uyan indirme (uzantı listesi, boyut ≥ en küçük, istisna site değil, http/https/ftp) tarayıcıda hemen iptal edilip
  listeden silinir ve `com.mastertool.masterdownload` host'una `{v:1,type:'add',…}` gönderilir. Host hata verir ya da
  5 sn içinde yanıt vermezse bildirim gösterilir ve aynı adres `downloads.download` ile tarayıcıya geri verilir; o adres
  60 sn içinde bir kez daha yakalanmaz (döngü olmaz).
- Tıklarken **Alt** basılıysa (bırakıldıktan sonraki 1,5 sn dahil) yakalama atlanır; **Ctrl** ile tıklanan dosya
  bağlantısı koşullara bakılmadan Master Download'a verilir.
- Bilinen DRM'li ya da koşulları indirmeyi yasaklayan sitelerde (`rules.js` → `BLOCKED_SITES`) ve sayfada EME
  (`video.mediaKeys` / `encrypted` olayı) görülürse video düğmesi gösterilmez, medya gönderilmez.
- Uygulama kapalıysa host onu `--hidden` ile başlatır ve 15 sn'ye kadar bekler; eklentinin 5 sn'lik sınırı bundan kısa
  olduğundan ilk istekte dosya tarayıcıya geri verilebilir (uygulama açıldıktan sonra gelen istekler anında yanıtlanır).

## Sabit Chromium eklenti kimliği (`key.pem`)

Chromium, paketlenmemiş eklentinin kimliğini manifestteki `key` alanından (yoksa yükleme klasörünün yolundan) türetir.
Native messaging host manifesti yalnız `allowed_origins` içindeki kimliklere izin verdiğinden kimliğin sabit olması gerekir.

- `extension/key.pem` (RSA özel anahtar, PEM) varsa `build.js` açık anahtarı `"key"` olarak Chromium manifestine yazar
  ve kimliği ekrana basar. Firefox manifestine `key` yazılmaz (Firefox kimliği `masterdownload@mastertool.download`).
- `key.pem` yoksa alan atlanır; kimlik klasöre göre değişir. Geliştirmede `chrome://extensions`'ta görünen kimliği
  uygulamanın host manifestine (`chromiumIds`) eklemek gerekir.
- Anahtar üretmek: `openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out extension/key.pem`
- `key.pem` **gizlidir**, depoya girmez (`.gitignore`). Mağaza yayınında kimliği mağaza verir; yayından önce
  mağazanın verdiği açık anahtar kullanılır.

## Geliştirmede yükleme

**Chrome / Edge:** `node extension/build.js` → `chrome://extensions` (Edge: `edge://extensions`) → “Geliştirici modu”
açık → “Paketlenmemiş öğe yükle” → `extension/dist/chromium`. Native host kaydını uygulama yapar (Ayarlar › Tarayıcı
bütünleşmesi); kimlik `key.pem`'den gelmiyorsa host manifestindeki `allowed_origins`'e eklenmelidir.

**Firefox:** `about:debugging#/runtime/this-firefox` → “Geçici eklenti yükle” → `extension/dist/firefox/manifest.json`.
Firefox MV3'te `<all_urls>` site izni kurulumdan sonra kullanıcı onayı ister (`about:addons` › eklenti › İzinler).
