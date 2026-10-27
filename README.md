# Master Download

Mastertool ailesinin Windows indirme yöneticisi: çok bağlantılı, sürdürülebilir indirme; Chrome/Edge/Firefox eklentisi;
kuyruklar, zamanlayıcı, hız sınırı, site yakalayıcı, toplu indirme. Internet Download Manager'ın yaptığı işi yapar.

- Özellik incelemesi ve sürüm kararları: [docs/idm-ozellikleri.md](docs/idm-ozellikleri.md)
- Mimari: [docs/mimari.md](docs/mimari.md)
- Tarayıcı eklentisi: [extension/README.md](extension/README.md)
- Tanıtım: https://mastertool.download/master-download

## Geliştirme

```bash
npm ci
npm test                         # motor, FTP/HLS/DASH, kuyruk, eklenti/host, SSO, i18n (yerel sunucularla)
node test/mock-server.js 8787    # sahte hesap sunucusu: test@example.com / Test1234!
MD_API=http://127.0.0.1:8787 npm start
node extension/build.js          # extension/dist/{chromium,firefox}
DISPLAY=:95 node scripts/e2e-electron.js   # gerçek Electron ile uçtan uca (Xvfb)
npm run screenshots              # docs/screenshots (TR) + docs/screenshots/en
```

## Yayın

`v<sürüm>` etiketi → GitHub Actions Windows'ta derler, Release'e ekler ve `scripts/upload-masterdownload.sh` ile
mastertool.download'a yükler (sürüm notu `CHANGELOG.md`'nin "## <sürüm>" bölümünden, UTF-8 dosyayla). Depo secret'ı:
`MD_RELEASE_KEY`. Etiket yalnız açık onayla gönderilir.

Kurulum: `Program Files\Mastertool\Master Download`, Başlat menüsü klasörü "Master Tool".
