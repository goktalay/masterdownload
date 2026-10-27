// Çeviri motoru ve sözlükler. Hem ana süreçte (require) hem pencerelerde (<script>) çalışır.
// Yeni metin eklerken sekiz dilin hepsine ekleyin (test/i18n.test.js anahtar eşliğini denetler);
// eksik anahtarlar İngilizceye, o da yoksa anahtarın kendisine düşer.
(function (root) {
  'use strict';

  const LANGUAGES = {
    tr: { name: 'Türkçe', dir: 'ltr' },
    en: { name: 'English', dir: 'ltr' },
    fr: { name: 'Français', dir: 'ltr' },
    de: { name: 'Deutsch', dir: 'ltr' },
    es: { name: 'Español', dir: 'ltr' },
    ar: { name: 'العربية', dir: 'rtl' },
    zh: { name: '中文', dir: 'ltr' },
    ru: { name: 'Русский', dir: 'ltr' },
  };

  const STRINGS = {};

  // ---------------------------------------------------------------------------
  STRINGS.tr = {
    'common.cancel': 'İptal', 'common.save': 'Kaydet', 'common.ok': 'Tamam', 'common.close': 'Kapat', 'common.show': 'Göster',
    'common.browse': 'Gözat',

    'auth.subtitle': 'Hesabınızla giriş yapın',
    'auth.ssoHint': 'Bir kez giriş yapmanız yeter: Master Tool ailesindeki diğer uygulamalar yeniden giriş istemez.',
    'auth.email': 'E-posta', 'auth.password': 'Şifre', 'auth.forgot': 'Şifremi unuttum',
    'auth.noAccount': 'Hesabınız yok mu?', 'auth.register': 'Hesap oluştur', 'auth.submit': 'Giriş yap',
    'auth.working': 'Giriş yapılıyor…',
    'auth.errRequired': 'E-posta ve şifre gerekli.',
    'auth.errBadCredentials': 'E-posta veya şifre hatalı.',
    'auth.errUnverified': 'E-posta adresiniz henüz doğrulanmadı. Gelen kutunuzdaki bağlantıya tıklayın.',
    'auth.errSuspended': 'Hesabınız askıya alınmış.',
    'auth.errRateLimited': 'Çok fazla deneme yapıldı. Bir dakika sonra tekrar deneyin.',
    'auth.errOffline': 'Sunucuya ulaşılamıyor. İnternet bağlantınızı kontrol edin.',
    'auth.errSessionExpired': 'Oturumunuzun süresi doldu ya da şifreniz değişti. Lütfen yeniden giriş yapın.',
    'auth.errAppDisabled': 'Master Download bu hesapta kullanıma kapalı.',
    'auth.errWrongApp': 'Bu oturum Master Download için geçerli değil. Lütfen yeniden giriş yapın.',
    'auth.errServer': 'Giriş yapılamadı: {msg}',
    'auth.signedOutElsewhere': 'Başka bir Mastertool uygulamasında çıkış yapıldı.',

    'acct.signedInAs': '{email} olarak giriş yapıldı',
    'acct.myAccount': 'Hesabım (web)',
    'acct.logoutAll': 'Tüm uygulamalardan çıkış yap',
    'acct.logoutTitle': 'Çıkış yap',
    'acct.logoutConfirm': 'Bu bilgisayardaki tüm Mastertool uygulamalarında oturum kapanacak. Süren indirmeler duraklatılır; listeniz ve dosyalarınız silinmez.',
    'acct.ssoInfo': 'Bu bilgisayarda bir kez giriş yaptınız: Master Tool ailesindeki uygulamalar yeniden şifre sormadan açılır. Birinde çıkış yapınca hepsinde oturum kapanır.',

    'update.available': 'Yeni Master Download sürümü hazır: {version}',
    'update.install': 'Güncelle',
    'update.downloading': 'Güncelleme indiriliyor… %{pct}',
    'update.failed': 'Güncelleme indirilemedi: {msg}',
    'update.installing': 'Kurulum başlatıldı; Master Download kapanıyor…',

    'set.title': 'Ayarlar', 'set.general': 'Genel', 'set.account': 'Hesap', 'set.connection': 'Bağlantı', 'set.downloads': 'İndirmeler',
    'set.categories': 'Kategoriler', 'set.browser': 'Tarayıcı bütünleşmesi', 'set.limit': 'Hız sınırı', 'set.queues': 'Kuyruklar ve zamanlayıcı',
    'set.about': 'Hakkında',
    'set.language': 'Dil', 'set.languageHint': 'Açık Master Download pencereleri yeni dille yeniden yüklenir.',
    'set.theme': 'Tema', 'set.themeDark': 'Gece', 'set.themeLight': 'Gündüz', 'set.themeSystem': 'Sistem tercihi',
    'set.startup': 'Başlangıç',
    'set.openAtLogin': 'Windows oturumu açılınca başlat', 'set.openAtLoginHint': 'Tepsiye küçültme açıksa uygulama tepside başlar; zamanlanmış kuyruklar böylece kaçmaz.',
    'set.minTray': 'Küçültüldüğünde sistem tepsisinde göster',
    'set.closeTray': 'Kapatıldığında tepsiye gizle', 'set.closeTrayHint': 'Kapat (X) düğmesi uygulamayı tepsiye gizler; indirmeler sürer. Çıkmak için tepsi menüsündeki “Çıkış”ı kullanın.',
    'set.updates': 'Güncellemeler', 'set.autoUpdate': 'Açılışta güncellemeleri denetle',
    'set.quit': 'Master Download’dan çık',
    'set.saved': 'Ayarlar kaydedildi',
    'set.maxConn': 'İndirme başına bağlantı sayısı', 'set.maxConnHint': 'Dosya bu kadar parçaya bölünür; biten bağlantı en büyük kalan parçayı ikiye bölerek devralır. Bazı sunucular çok bağlantıyı sınırlar.',
    'set.retries': 'Yeniden deneme sayısı', 'set.timeout': 'Bağlantı zaman aşımı (sn)',
    'set.ua': 'Kullanıcı aracısı (User-Agent)', 'set.uaDefault': 'Varsayılan (tarayıcıdan gelen ya da Chrome uyumlu)',
    'set.proxy': 'Proxy', 'set.proxy.system': 'Sistem', 'set.proxy.none': 'Yok', 'set.proxy.http': 'HTTP', 'set.proxy.socks5': 'SOCKS5',
    'set.proxyHost': 'Sunucu', 'set.proxyPort': 'Bağlantı noktası',
    'set.dir': 'Ana indirme klasörü', 'set.dirHint': 'Kategoriler bu klasörün altındaki kendi klasörlerine iner (ör. Video, Müzik).',
    'set.temp': 'Geçici klasör', 'set.tempDefault': 'Varsayılan (uygulama verileri)',
    'set.duplicate': 'Aynı adlı dosya varsa', 'set.dup.rename': 'Yeni ad ver: “ad (2).uzantı”', 'set.dup.overwrite': 'Üzerine yaz',
    'set.dialogs': 'Pencereler ve bildirimler',
    'set.startDialog': 'İndirme eklenirken “Yeni indirme” penceresini göster', 'set.startDialogHint': 'Kapalıysa tarayıcıdan gelen indirmeler sormadan başlar.',
    'set.progressWin': 'İndirme başlayınca ilerleme penceresini aç',
    'set.completeWin': 'İndirme bitince “Tamamlandı” penceresini göster',
    'set.notify': 'Pencere arka plandayken Windows bildirimi göster',
    'set.sound': 'İndirme bitince ses çal',
    'set.resumeOnStart': 'Uygulama açılınca yarıda kalan indirmeleri sürdür',
    'set.clipboard': 'Panoyu izle', 'set.clipboardHint': 'Kopyalanan tek bir dosya bağlantısı (izlenen uzantılarla) için indirme önerilir.',
    'set.security': 'Güvenlik',
    'set.motw': 'İndirilen dosyaları “internetten geldi” diye işaretle', 'set.motwHint': 'Windows SmartScreen ve Office korumalı görünüm bu işarete göre çalışır.',
    'set.scan': 'İndirme bitince virüs taraması yap', 'set.scanHint': 'Varsayılan olarak Microsoft Defender kullanılır.',
    'set.scanner': 'Tarayıcı program', 'set.scannerCustom': 'Başka bir program', 'set.scannerArgs': 'Argümanlar ([File] = dosya yolu)',
    'set.catHint': 'Uzantıya göre kategori ve klasör. Klasör boşsa ana indirme klasörünün altında kategori adıyla bir klasör kullanılır.',
    'set.catAdd': 'Kategori ekle', 'set.catName': 'Kategori adı', 'set.catExts': 'Uzantılar (ör. zip rar 7z)', 'set.catDir': 'Klasör (boş = otomatik)',
    'set.bEnabled': 'Tarayıcıdaki indirmeleri Master Download ile yakala', 'set.bEnabledHint': 'Chrome, Edge ve Firefox eklentisi gerekir.',
    'set.bExts': 'Yakalanacak dosya türleri', 'set.bExtsHint': 'Boşlukla ayırın. Bu uzantılardaki indirmeler tarayıcı yerine Master Download’a gelir.',
    'set.bMin': 'En küçük boyut (KB)', 'set.bSkip': 'Yakalanmayacak siteler',
    'set.bVideo': 'Video ve ses için “İndir” düğmesini göster', 'set.bVideoHint': 'Yalnız korumasız, doğrudan erişilebilen akışlar. DRM’li içerik ve indirmeyi yasaklayan siteler desteklenmez.',
    'set.bInstall': 'Eklentiyi kur',
    'set.bInstallHint': 'Tarayıcının eklentiler sayfasında Geliştirici modunu açın ve “Paketlenmemiş öğe yükle” ile eklenti klasörünü seçin. Sayfa adresi panoya kopyalanır.',
    'set.bFolder': 'Eklenti klasörü', 'set.bRegister': 'Bağlantıyı yeniden kaydet',
    'set.bAlt': 'İpucu: Alt tuşuna basılıyken tıklanan bağlantı tarayıcıda iner; Ctrl ile tıklanan bağlantı Master Download’a zorla gönderilir.',
    'set.bCopied': '{url} panoya kopyalandı; tarayıcının adres çubuğuna yapıştırın.',
    'set.bRegistered': 'Tarayıcı bağlantısı kaydedildi.', 'set.bRegisterDev': 'Kayıt yalnız kurulu uygulamada yapılır.',
    'set.lEnabled': 'Toplam indirme hızını sınırla', 'set.lHint': 'Tepsi menüsünden ve araç çubuğundan da açılıp kapatılabilir.',
    'set.lValue': 'En yüksek hız (KB/s)', 'set.lPerFile': 'Tek bir indirmeye ayrı sınır vermek için ilerleme penceresini ya da Özellikler’i kullanın.',
    'set.queuesHint': 'Kuyruklar sırayla ve belirlediğiniz sayıda eşzamanlı indirme yapar; zamanlayıcı kuyruğu belirli saat ve günlerde başlatıp durdurur.',

    'about.version': 'Sürüm {version}',
    'about.family': 'Mastertool ailesinin bir parçasıdır: SSH Master · FTP Masters · SQL Master · Notepad Master · Convert Master · Master Download',
    'about.checkUpdate': 'Güncellemeleri denetle', 'about.checking': 'Denetleniyor…', 'about.upToDate': 'Master Download güncel.',
    'about.checkFailed': 'Güncelleme denetlenemedi: {msg}',
    'about.licenses': 'Açık kaynak lisansları', 'about.licensesIntro': 'Master Download şu açık kaynak bileşenleri kullanır:',
    'about.chromium': 'Chromium lisanslarını aç',

    'tool.add': 'Adres ekle', 'tool.resume': 'Sürdür', 'tool.pause': 'Durdur', 'tool.pauseAll': 'Tümünü durdur', 'tool.delete': 'Sil',
    'tool.queue': 'Kuyruk', 'tool.scheduler': 'Zamanlayıcı', 'tool.limit': 'Hız sınırı', 'tool.grabber': 'Site yakalayıcı',
    'tool.batch': 'Toplu indirme', 'tool.more': 'Diğer',

    'side.all': 'Tüm indirmeler', 'side.categories': 'Kategoriler', 'side.status': 'Durum', 'side.unfinished': 'Bitmemiş',
    'side.finished': 'Bitmiş', 'side.queues': 'Kuyruklar',
    'cat.compressed': 'Sıkıştırılmış', 'cat.documents': 'Belgeler', 'cat.music': 'Müzik', 'cat.programs': 'Programlar', 'cat.video': 'Video', 'cat.general': 'Genel',

    'col.name': 'Dosya adı', 'col.size': 'Boyut', 'col.status': 'Durum', 'col.speed': 'Hız', 'col.eta': 'Kalan süre',
    'col.added': 'Eklenme', 'col.desc': 'Açıklama',
    'st.paused': 'Durduruldu', 'st.queued': 'Kuyrukta', 'st.connecting': 'Bağlanıyor…', 'st.downloading': 'İndiriliyor',
    'st.assembling': 'Birleştiriliyor…', 'st.completed': 'Tamamlandı', 'st.error': 'Hata', 'st.canceled': 'İptal edildi', 'st.idle': 'Bekliyor',
    'time.sec': '{n} sn', 'time.min': '{m} dk {s} sn', 'time.hour': '{h} sa {m} dk',
    'stats.active': '{n} indirme sürüyor', 'stats.items': 'Listede {n} indirme',

    'list.search': 'Ara', 'list.noMatch': 'Bu görünümde indirme yok.',
    'list.emptyTitle': 'Henüz indirme yok',
    'list.emptyHint': 'Bir adres ekleyin, bağlantıyı pencereye sürükleyin ya da tarayıcı eklentisiyle indirmeleri yakalayın.',

    'det.url': 'Adres', 'det.saveTo': 'Kaydedilecek yer', 'det.resumable': 'Sürdürme desteği', 'det.connections': 'Bağlantılar',
    'det.yes': 'Evet', 'det.no': 'Hayır', 'det.unknown': 'Bilinmiyor',
    'det.notResumableHint': 'duraklatılırsa baştan iner', 'det.segments': '{done} / {total} parça',

    'menu.open': 'Aç', 'menu.openWith': 'Birlikte aç…', 'menu.reveal': 'Klasörde göster', 'menu.resume': 'Sürdür', 'menu.pause': 'Durdur',
    'menu.progress': 'İlerleme penceresi', 'menu.redownload': 'Yeniden indir', 'menu.refreshUrl': 'Bağlantıyı yenile…',
    'menu.moveQueue': 'Kuyruğa taşı', 'menu.noQueue': 'Kuyruktan çıkar', 'menu.copyUrl': 'Adresi kopyala', 'menu.copied': 'Adres kopyalandı',
    'menu.scan': 'Virüs taraması yap', 'menu.properties': 'Özellikler', 'menu.delete': 'Sil',

    'del.title': 'İndirmeleri sil', 'del.message': '{n} indirme listeden silinecek. Bitmemiş indirmelerin geçici dosyaları da silinir.',
    'del.alsoFile': 'Tamamlanan dosyaları diskten de sil',

    'more.fromClipboard': 'Panodaki bağlantıları ekle', 'more.noLinks': 'Panoda bağlantı yok.',
    'more.import': 'İçe aktar (.ef2, .txt)…', 'more.exportEf2': 'Dışa aktar (IDM .ef2)…', 'more.exportTxt': 'Dışa aktar (metin)…',
    'more.exported': '{n} indirme dışa aktarıldı', 'more.dropTarget': 'Bırakma hedefini göster', 'more.browser': 'Tarayıcı eklentisi…',
    'more.removeFinished': 'Bitenleri listeden kaldır',

    'limit.on': 'Hız sınırı: {v}', 'limit.off': 'Hız sınırını kapat', 'limit.disabled': 'Hız sınırı kapatıldı', 'limit.custom': 'Özel değer…',

    'add.title': 'Yeni indirme', 'add.url': 'Adres', 'add.fileName': 'Dosya adı', 'add.autoName': 'Sunucudan alınır',
    'add.category': 'Kategori', 'add.autoCategory': 'Otomatik (uzantıya göre)', 'add.saveTo': 'Kaydedilecek klasör', 'add.autoDir': 'Kategori klasörü',
    'add.queue': 'Kuyruk', 'add.noQueue': 'Kuyruk yok', 'add.connections': 'Bağlantı', 'add.advanced': 'Kimlik bilgisi ve diğer',
    'add.user': 'Kullanıcı adı', 'add.pass': 'Parola', 'add.referrer': 'Yönlendiren sayfa (Referer)', 'add.desc': 'Açıklama',
    'add.size': 'Boyut: {size}', 'add.cookies': 'tarayıcı çerezleriyle',
    'add.later': 'Sonra indir', 'add.start': 'Şimdi başlat',
    'add.duplicate': 'Bu adres listede zaten var; mevcut indirme seçildi.', 'add.queued': '“{queue}” kuyruğuna eklendi',

    'batch.title': 'Toplu indirme', 'batch.titleList': 'Bağlantıları ekle', 'batch.pattern': 'Kalıp', 'batch.paste': 'Metinden',
    'batch.patternUrl': 'Joker (*) içeren adres', 'batch.from': 'Başlangıç', 'batch.to': 'Bitiş', 'batch.width': 'Basamak', 'batch.step': 'Adım',
    'batch.patternHint': 'Örnek: https://example.com/resim*.jpg, 1’den 50’ye, 3 basamak → resim001.jpg … resim050.jpg. Harf aralığı da olur (a–z). Adrese [001-050] da yazabilirsiniz.',
    'batch.pasteHint': 'Bağlantıları içeren metni yapıştırın', 'batch.count': '{n} / {total} seçili', 'batch.none': 'Bağlantı yok',
    'batch.addOnly': 'Kuyruğa ekle', 'batch.addStart': 'Ekle ve başlat', 'batch.added': '{n} indirme eklendi',

    'grab.title': 'Site yakalayıcı', 'grab.url': 'Başlangıç sayfası', 'grab.types': 'Dosya türleri', 'grab.depth': 'Derinlik',
    'grab.scope': 'Sayfa sınırı', 'grab.scopeHost': 'Yalnız bu site', 'grab.scopePath': 'Yalnız bu klasör ve altı', 'grab.scopeAny': 'Bağlantılı tüm siteler',
    'grab.hint': 'Sayfalar sırayla ve kısa aralıklarla gezilir; sitenin robots.txt kurallarına uyulur. Yalnız indirme hakkınız olan dosyaları toplayın.',
    'grab.empty': 'Taramayı başlatın; bulunan dosyalar burada listelenir.', 'grab.scan': 'Tara', 'grab.stop': 'Durdur', 'grab.download': 'Seçilenleri ekle',
    'grab.progress': '{pages} sayfa tarandı · {files} dosya', 'grab.done': '{pages} sayfa tarandı, {files} dosya bulundu', 'grab.robots': '{n} sayfa robots.txt nedeniyle atlandı',

    'q.title': 'Kuyruklar ve zamanlayıcı', 'q.main': 'Ana kuyruk', 'q.new': 'Yeni kuyruk', 'q.newName': 'Kuyruk {n}',
    'q.name': 'Kuyruk adı', 'q.parallel': 'Eşzamanlı indirme', 'q.schedule': 'Zamanlayıcı', 'q.scheduleOn': 'Kuyruğu zamanla başlat',
    'q.startAt': 'Başlangıç saati', 'q.stopAt': 'Durma saati', 'q.daysHint': 'Gün seçilmezse her gün.', 'q.once': 'Yalnız bir kez (çalıştıktan sonra zamanlama kapanır)',
    'q.after': 'Kuyruk bitince', 'q.next': 'Sonraki başlama: {when}', 'q.files': 'Kuyruktaki dosyalar ({n}) — sürükleyerek sıralayın',
    'q.empty': 'Kuyruk boş. İndirmeleri listeden kenar çubuğundaki kuyruğa sürükleyin.', 'q.start': 'Kuyruğu başlat', 'q.stop': 'Kuyruğu durdur', 'q.delete': 'Kuyruğu sil',
    'after.none': 'Hiçbir şey yapma', 'after.exit': 'Master Download’dan çık', 'after.sleep': 'Bilgisayarı uyku moduna al',
    'after.hibernate': 'Bilgisayarı hazırda beklet', 'after.shutdown': 'Bilgisayarı kapat',
    'after.countdown.exit': 'Kuyruk bitti; Master Download {n} sn içinde kapanacak.', 'after.countdown.sleep': 'Kuyruk bitti; bilgisayar {n} sn içinde uyku moduna geçecek.',
    'after.countdown.hibernate': 'Kuyruk bitti; bilgisayar {n} sn içinde hazırda bekletilecek.', 'after.countdown.shutdown': 'Kuyruk bitti; bilgisayar {n} sn içinde kapanacak.',

    'refresh.title': 'Bağlantıyı yenile',
    'refresh.hint': 'Süresi dolan ya da değişen adres yerine yeni adresi girin. Dosya aynıysa (boyut ve sürüm) indirme kaldığı yerden sürer; değilse baştan iner.',
    'refresh.old': 'Eski adres', 'refresh.new': 'Yeni adres', 'refresh.apply': 'Yenile ve sürdür', 'refresh.done': 'Adres yenilendi',

    'prop.title': 'Özellikler', 'prop.finalUrl': 'Son adres (yönlendirmeden sonra)', 'prop.finished': 'Bitiş', 'prop.limit': 'Hız sınırı (KB/s, 0 = yok)',

    'pw.size': 'Dosya boyutu', 'pw.downloaded': 'İnen', 'pw.speed': 'Hız', 'pw.eta': 'Kalan süre', 'pw.map': 'Bağlantılar',
    'pw.range': 'Aralık', 'pw.segDone': 'Bitti', 'pw.segActive': 'İndiriyor', 'pw.segWait': 'Bekliyor',
    'pw.limit': 'Hızı sınırla', 'pw.closeWhenDone': 'Bitince kapat', 'pw.hide': 'Gizle', 'pw.open': 'Aç', 'pw.openFolder': 'Klasörü aç',

    'scan.scanning': 'taranıyor…', 'scan.threat': 'tehdit bulundu', 'scan.clean': 'Virüs taraması temiz',
    'scan.threatTitle': 'Tehdit bulundu', 'scan.threatBody': '{name} dosyasında tehdit algılandı. Microsoft Defender’ı açarak inceleyin.',
    'note.completed': 'İndirme tamamlandı', 'note.failed': 'İndirme başarısız',
    'drop.hint': 'Bağlantıyı ya da .ef2/.txt listesini bırakın',

    'warn.changed': 'Dosya sunucuda değişmiş; indirme baştan başlatıldı.',
    'warn.not_resumable_restart': 'Sunucu sürdürmeyi desteklemiyor; indirme baştan başlatıldı.',

    'err.generic': 'Hata ({code})', 'err.not_found': 'Dosya bulunamadı (404). Bağlantıyı yenileyin.', 'err.forbidden': 'Erişim reddedildi (403). Bağlantı süresi dolmuş olabilir.',
    'err.auth_required': 'Kimlik doğrulama gerekli ya da bilgiler hatalı.', 'err.network': 'Ağ hatası; bağlantı koptu.', 'err.timeout': 'Sunucu yanıt vermedi (zaman aşımı).',
    'err.refused': 'Sunucu bağlantıyı reddetti.', 'err.too_many_redirects': 'Çok fazla yönlendirme.', 'err.changed': 'Dosya sunucuda değişti.',
    'err.encrypted_stream': 'Bu akış şifreli ya da DRM korumalı; indirilemez.', 'err.live_stream': 'Canlı yayınlar desteklenmiyor.',
    'err.unsupported_stream': 'Bu akış biçimi desteklenmiyor.', 'err.invalid_url': 'Geçersiz adres.', 'err.ENOSPC': 'Diskte yer kalmadı.',
    'err.EACCES': 'Klasöre yazma izni yok.', 'err.EPERM': 'Dosyaya erişilemedi (başka bir program kullanıyor olabilir).',
    'err.assemble_failed': 'Parçalar birleştirilemedi.', 'err.incomplete': 'İndirme eksik kaldı.', 'err.range_not_satisfiable': 'Sunucu istenen aralığı veremedi.',
    'err.proxy': 'Proxy hatası.', 'err.proxy_auth': 'Proxy kimlik doğrulaması başarısız.', 'err.unsupported_protocol': 'Desteklenmeyen protokol.',
    'err.offline': 'Sunucuya ulaşılamıyor.',

    'tray.show': 'Master Download’ı göster', 'tray.addUrl': 'Adres ekle…', 'tray.fromClipboard': 'Panodaki bağlantıyı indir',
    'tray.startQueue': 'Ana kuyruğu başlat', 'tray.stopQueue': 'Ana kuyruğu durdur', 'tray.pauseAll': 'Tümünü durdur',
    'tray.speedLimit': 'Hız sınırı', 'tray.clipboard': 'Panoyu izle', 'tray.dropTarget': 'Bırakma hedefi', 'tray.quit': 'Çıkış',
    'tray.active': '{n} indirme',
    'tray.balloonTitle': 'Master Download arka planda çalışıyor',
    'tray.balloonBody': 'İndirmeler sürüyor. Pencereyi açmak için saatin yanındaki simgeye çift tıklayın.',
  };

  // ---------------------------------------------------------------------------
  STRINGS.en = {
    'common.cancel': 'Cancel', 'common.save': 'Save', 'common.ok': 'OK', 'common.close': 'Close', 'common.show': 'Show',
    'common.browse': 'Browse',

    'auth.subtitle': 'Sign in with your account',
    'auth.ssoHint': 'Sign in once: the other apps in the Master Tool family won’t ask again.',
    'auth.email': 'Email', 'auth.password': 'Password', 'auth.forgot': 'Forgot password',
    'auth.noAccount': 'Don’t have an account?', 'auth.register': 'Create account', 'auth.submit': 'Sign in',
    'auth.working': 'Signing in…',
    'auth.errRequired': 'Email and password are required.',
    'auth.errBadCredentials': 'Incorrect email or password.',
    'auth.errUnverified': 'Your email address isn’t verified yet. Click the link in your inbox.',
    'auth.errSuspended': 'Your account has been suspended.',
    'auth.errRateLimited': 'Too many attempts. Try again in a minute.',
    'auth.errOffline': 'Can’t reach the server. Check your internet connection.',
    'auth.errSessionExpired': 'Your session expired or your password changed. Please sign in again.',
    'auth.errAppDisabled': 'Master Download is disabled for this account.',
    'auth.errWrongApp': 'This session isn’t valid for Master Download. Please sign in again.',
    'auth.errServer': 'Sign-in failed: {msg}',
    'auth.signedOutElsewhere': 'You signed out in another Mastertool app.',

    'acct.signedInAs': 'Signed in as {email}',
    'acct.myAccount': 'My account (web)',
    'acct.logoutAll': 'Sign out of all apps',
    'acct.logoutTitle': 'Sign out',
    'acct.logoutConfirm': 'You’ll be signed out of every Mastertool app on this computer. Running downloads are paused; your list and files are kept.',
    'acct.ssoInfo': 'You’ve signed in once on this computer: apps in the Master Tool family open without asking for your password. Signing out in one signs you out of all.',

    'update.available': 'A new Master Download version is ready: {version}',
    'update.install': 'Update',
    'update.downloading': 'Downloading update… {pct}%',
    'update.failed': 'Couldn’t download the update: {msg}',
    'update.installing': 'Setup started; Master Download is closing…',

    'set.title': 'Settings', 'set.general': 'General', 'set.account': 'Account', 'set.connection': 'Connection', 'set.downloads': 'Downloads',
    'set.categories': 'Categories', 'set.browser': 'Browser integration', 'set.limit': 'Speed limiter', 'set.queues': 'Queues and scheduler',
    'set.about': 'About',
    'set.language': 'Language', 'set.languageHint': 'Open Master Download windows reload in the new language.',
    'set.theme': 'Theme', 'set.themeDark': 'Night', 'set.themeLight': 'Day', 'set.themeSystem': 'System preference',
    'set.startup': 'Startup',
    'set.openAtLogin': 'Start when I sign in to Windows', 'set.openAtLoginHint': 'If minimize to tray is on, the app starts in the tray, so scheduled queues aren’t missed.',
    'set.minTray': 'Show in the system tray when minimized',
    'set.closeTray': 'Hide to tray when closed', 'set.closeTrayHint': 'The close (X) button hides the app to the tray and downloads keep running. Use “Quit” in the tray menu to exit.',
    'set.updates': 'Updates', 'set.autoUpdate': 'Check for updates at startup',
    'set.quit': 'Quit Master Download',
    'set.saved': 'Settings saved',
    'set.maxConn': 'Connections per download', 'set.maxConnHint': 'The file is split into this many parts; a finished connection takes over by splitting the largest remaining part in half. Some servers limit multiple connections.',
    'set.retries': 'Retry count', 'set.timeout': 'Connection timeout (s)',
    'set.ua': 'User agent', 'set.uaDefault': 'Default (from the browser or Chrome-compatible)',
    'set.proxy': 'Proxy', 'set.proxy.system': 'System', 'set.proxy.none': 'None', 'set.proxy.http': 'HTTP', 'set.proxy.socks5': 'SOCKS5',
    'set.proxyHost': 'Server', 'set.proxyPort': 'Port',
    'set.dir': 'Main download folder', 'set.dirHint': 'Categories download into their own folders under this folder (e.g. Video, Music).',
    'set.temp': 'Temporary folder', 'set.tempDefault': 'Default (app data)',
    'set.duplicate': 'If a file with the same name exists', 'set.dup.rename': 'Rename: “name (2).ext”', 'set.dup.overwrite': 'Overwrite',
    'set.dialogs': 'Windows and notifications',
    'set.startDialog': 'Show the “New download” window when adding', 'set.startDialogHint': 'When off, downloads from the browser start without asking.',
    'set.progressWin': 'Open the progress window when a download starts',
    'set.completeWin': 'Show the “Completed” window when a download finishes',
    'set.notify': 'Show a Windows notification when the window is in the background',
    'set.sound': 'Play a sound when a download finishes',
    'set.resumeOnStart': 'Resume interrupted downloads when the app starts',
    'set.clipboard': 'Watch the clipboard', 'set.clipboardHint': 'A download is offered for a single copied file link (with a monitored extension).',
    'set.security': 'Security',
    'set.motw': 'Mark downloaded files as coming from the internet', 'set.motwHint': 'Windows SmartScreen and Office Protected View rely on this mark.',
    'set.scan': 'Scan for viruses when a download finishes', 'set.scanHint': 'Microsoft Defender is used by default.',
    'set.scanner': 'Scanner', 'set.scannerCustom': 'Another program', 'set.scannerArgs': 'Arguments ([File] = file path)',
    'set.catHint': 'Category and folder by extension. If the folder is empty, a folder named after the category under the main download folder is used.',
    'set.catAdd': 'Add category', 'set.catName': 'Category name', 'set.catExts': 'Extensions (e.g. zip rar 7z)', 'set.catDir': 'Folder (empty = automatic)',
    'set.bEnabled': 'Take over browser downloads with Master Download', 'set.bEnabledHint': 'Requires the Chrome, Edge or Firefox extension.',
    'set.bExts': 'File types to capture', 'set.bExtsHint': 'Separate with spaces. Downloads with these extensions go to Master Download instead of the browser.',
    'set.bMin': 'Minimum size (KB)', 'set.bSkip': 'Sites not to capture',
    'set.bVideo': 'Show a “Download” button for video and audio', 'set.bVideoHint': 'Only unprotected, directly accessible streams. DRM content and sites that prohibit downloading are not supported.',
    'set.bInstall': 'Install the extension',
    'set.bInstallHint': 'On the browser’s extensions page, turn on Developer mode and choose the extension folder with “Load unpacked”. The page address is copied to the clipboard.',
    'set.bFolder': 'Extension folder', 'set.bRegister': 'Re-register connection',
    'set.bAlt': 'Tip: links clicked while holding Alt download in the browser; links clicked with Ctrl are forced to Master Download.',
    'set.bCopied': '{url} copied to the clipboard; paste it into the browser’s address bar.',
    'set.bRegistered': 'Browser connection registered.', 'set.bRegisterDev': 'Registration only works in the installed app.',
    'set.lEnabled': 'Limit total download speed', 'set.lHint': 'Can also be toggled from the tray menu and the toolbar.',
    'set.lValue': 'Maximum speed (KB/s)', 'set.lPerFile': 'To limit a single download, use its progress window or Properties.',
    'set.queuesHint': 'Queues download in order with the number of simultaneous downloads you choose; the scheduler starts and stops a queue at set times and days.',

    'about.version': 'Version {version}',
    'about.family': 'Part of the Mastertool family: SSH Master · FTP Masters · SQL Master · Notepad Master · Convert Master · Master Download',
    'about.checkUpdate': 'Check for updates', 'about.checking': 'Checking…', 'about.upToDate': 'Master Download is up to date.',
    'about.checkFailed': 'Couldn’t check for updates: {msg}',
    'about.licenses': 'Open-source licenses', 'about.licensesIntro': 'Master Download uses these open-source components:',
    'about.chromium': 'Open Chromium licenses',

    'tool.add': 'Add URL', 'tool.resume': 'Resume', 'tool.pause': 'Stop', 'tool.pauseAll': 'Stop all', 'tool.delete': 'Delete',
    'tool.queue': 'Queue', 'tool.scheduler': 'Scheduler', 'tool.limit': 'Speed limit', 'tool.grabber': 'Site grabber',
    'tool.batch': 'Batch download', 'tool.more': 'More',

    'side.all': 'All downloads', 'side.categories': 'Categories', 'side.status': 'Status', 'side.unfinished': 'Unfinished',
    'side.finished': 'Finished', 'side.queues': 'Queues',
    'cat.compressed': 'Compressed', 'cat.documents': 'Documents', 'cat.music': 'Music', 'cat.programs': 'Programs', 'cat.video': 'Video', 'cat.general': 'General',

    'col.name': 'File name', 'col.size': 'Size', 'col.status': 'Status', 'col.speed': 'Speed', 'col.eta': 'Time left',
    'col.added': 'Added', 'col.desc': 'Description',
    'st.paused': 'Stopped', 'st.queued': 'Queued', 'st.connecting': 'Connecting…', 'st.downloading': 'Downloading',
    'st.assembling': 'Assembling…', 'st.completed': 'Completed', 'st.error': 'Error', 'st.canceled': 'Canceled', 'st.idle': 'Waiting',
    'time.sec': '{n} s', 'time.min': '{m} min {s} s', 'time.hour': '{h} h {m} min',
    'stats.active': '{n} downloading', 'stats.items': '{n} downloads in the list',

    'list.search': 'Search', 'list.noMatch': 'No downloads in this view.',
    'list.emptyTitle': 'No downloads yet',
    'list.emptyHint': 'Add a URL, drag a link onto the window, or capture downloads with the browser extension.',

    'det.url': 'Address', 'det.saveTo': 'Save to', 'det.resumable': 'Resume capability', 'det.connections': 'Connections',
    'det.yes': 'Yes', 'det.no': 'No', 'det.unknown': 'Unknown',
    'det.notResumableHint': 'restarts from the beginning if stopped', 'det.segments': '{done} / {total} segments',

    'menu.open': 'Open', 'menu.openWith': 'Open with…', 'menu.reveal': 'Show in folder', 'menu.resume': 'Resume', 'menu.pause': 'Stop',
    'menu.progress': 'Progress window', 'menu.redownload': 'Redownload', 'menu.refreshUrl': 'Refresh download address…',
    'menu.moveQueue': 'Move to queue', 'menu.noQueue': 'Remove from queue', 'menu.copyUrl': 'Copy address', 'menu.copied': 'Address copied',
    'menu.scan': 'Scan for viruses', 'menu.properties': 'Properties', 'menu.delete': 'Delete',

    'del.title': 'Delete downloads', 'del.message': '{n} downloads will be removed from the list. Temporary files of unfinished downloads are deleted too.',
    'del.alsoFile': 'Also delete completed files from disk',

    'more.fromClipboard': 'Add links from clipboard', 'more.noLinks': 'No links on the clipboard.',
    'more.import': 'Import (.ef2, .txt)…', 'more.exportEf2': 'Export (IDM .ef2)…', 'more.exportTxt': 'Export (text)…',
    'more.exported': '{n} downloads exported', 'more.dropTarget': 'Show drop target', 'more.browser': 'Browser extension…',
    'more.removeFinished': 'Remove finished from list',

    'limit.on': 'Speed limit: {v}', 'limit.off': 'Turn off speed limit', 'limit.disabled': 'Speed limit turned off', 'limit.custom': 'Custom value…',

    'add.title': 'New download', 'add.url': 'Address', 'add.fileName': 'File name', 'add.autoName': 'From the server',
    'add.category': 'Category', 'add.autoCategory': 'Automatic (by extension)', 'add.saveTo': 'Save to folder', 'add.autoDir': 'Category folder',
    'add.queue': 'Queue', 'add.noQueue': 'No queue', 'add.connections': 'Connections', 'add.advanced': 'Credentials and more',
    'add.user': 'User name', 'add.pass': 'Password', 'add.referrer': 'Referring page (Referer)', 'add.desc': 'Description',
    'add.size': 'Size: {size}', 'add.cookies': 'with browser cookies',
    'add.later': 'Download later', 'add.start': 'Start now',
    'add.duplicate': 'This address is already in the list; the existing download is selected.', 'add.queued': 'Added to the “{queue}” queue',

    'batch.title': 'Batch download', 'batch.titleList': 'Add links', 'batch.pattern': 'Pattern', 'batch.paste': 'From text',
    'batch.patternUrl': 'Address with a wildcard (*)', 'batch.from': 'From', 'batch.to': 'To', 'batch.width': 'Digits', 'batch.step': 'Step',
    'batch.patternHint': 'Example: https://example.com/image*.jpg, 1 to 50, 3 digits → image001.jpg … image050.jpg. Letter ranges work too (a–z). You can also write [001-050] in the address.',
    'batch.pasteHint': 'Paste text that contains links', 'batch.count': '{n} / {total} selected', 'batch.none': 'No links',
    'batch.addOnly': 'Add to queue', 'batch.addStart': 'Add and start', 'batch.added': '{n} downloads added',

    'grab.title': 'Site grabber', 'grab.url': 'Start page', 'grab.types': 'File types', 'grab.depth': 'Depth',
    'grab.scope': 'Page scope', 'grab.scopeHost': 'This site only', 'grab.scopePath': 'This folder and below', 'grab.scopeAny': 'All linked sites',
    'grab.hint': 'Pages are visited one by one with short pauses, following the site’s robots.txt rules. Only collect files you have the right to download.',
    'grab.empty': 'Start a scan; files found are listed here.', 'grab.scan': 'Scan', 'grab.stop': 'Stop', 'grab.download': 'Add selected',
    'grab.progress': '{pages} pages scanned · {files} files', 'grab.done': '{pages} pages scanned, {files} files found', 'grab.robots': '{n} pages skipped because of robots.txt',

    'q.title': 'Queues and scheduler', 'q.main': 'Main queue', 'q.new': 'New queue', 'q.newName': 'Queue {n}',
    'q.name': 'Queue name', 'q.parallel': 'Simultaneous downloads', 'q.schedule': 'Scheduler', 'q.scheduleOn': 'Start the queue on a schedule',
    'q.startAt': 'Start time', 'q.stopAt': 'Stop time', 'q.daysHint': 'Every day if no day is selected.', 'q.once': 'Only once (scheduling turns off after it runs)',
    'q.after': 'When the queue finishes', 'q.next': 'Next start: {when}', 'q.files': 'Files in the queue ({n}) — drag to reorder',
    'q.empty': 'The queue is empty. Drag downloads from the list onto the queue in the sidebar.', 'q.start': 'Start queue', 'q.stop': 'Stop queue', 'q.delete': 'Delete queue',
    'after.none': 'Do nothing', 'after.exit': 'Quit Master Download', 'after.sleep': 'Put the computer to sleep',
    'after.hibernate': 'Hibernate the computer', 'after.shutdown': 'Shut down the computer',
    'after.countdown.exit': 'Queue finished; Master Download will quit in {n} s.', 'after.countdown.sleep': 'Queue finished; the computer will sleep in {n} s.',
    'after.countdown.hibernate': 'Queue finished; the computer will hibernate in {n} s.', 'after.countdown.shutdown': 'Queue finished; the computer will shut down in {n} s.',

    'refresh.title': 'Refresh download address',
    'refresh.hint': 'Enter a new address in place of the expired or changed one. If the file is the same (size and version), the download resumes; otherwise it starts over.',
    'refresh.old': 'Old address', 'refresh.new': 'New address', 'refresh.apply': 'Refresh and resume', 'refresh.done': 'Address refreshed',

    'prop.title': 'Properties', 'prop.finalUrl': 'Final address (after redirects)', 'prop.finished': 'Finished', 'prop.limit': 'Speed limit (KB/s, 0 = none)',

    'pw.size': 'File size', 'pw.downloaded': 'Downloaded', 'pw.speed': 'Speed', 'pw.eta': 'Time left', 'pw.map': 'Connections',
    'pw.range': 'Range', 'pw.segDone': 'Done', 'pw.segActive': 'Downloading', 'pw.segWait': 'Waiting',
    'pw.limit': 'Limit speed', 'pw.closeWhenDone': 'Close when done', 'pw.hide': 'Hide', 'pw.open': 'Open', 'pw.openFolder': 'Open folder',

    'scan.scanning': 'scanning…', 'scan.threat': 'threat found', 'scan.clean': 'Virus scan clean',
    'scan.threatTitle': 'Threat found', 'scan.threatBody': 'A threat was detected in {name}. Open Microsoft Defender to review it.',
    'note.completed': 'Download complete', 'note.failed': 'Download failed',
    'drop.hint': 'Drop a link or an .ef2/.txt list',

    'warn.changed': 'The file changed on the server; the download restarted.',
    'warn.not_resumable_restart': 'The server doesn’t support resuming; the download restarted.',

    'err.generic': 'Error ({code})', 'err.not_found': 'File not found (404). Refresh the address.', 'err.forbidden': 'Access denied (403). The link may have expired.',
    'err.auth_required': 'Authentication required or credentials are wrong.', 'err.network': 'Network error; the connection dropped.', 'err.timeout': 'The server didn’t respond (timeout).',
    'err.refused': 'The server refused the connection.', 'err.too_many_redirects': 'Too many redirects.', 'err.changed': 'The file changed on the server.',
    'err.encrypted_stream': 'This stream is encrypted or DRM-protected and can’t be downloaded.', 'err.live_stream': 'Live streams aren’t supported.',
    'err.unsupported_stream': 'This stream format isn’t supported.', 'err.invalid_url': 'Invalid address.', 'err.ENOSPC': 'The disk is full.',
    'err.EACCES': 'No permission to write to the folder.', 'err.EPERM': 'Couldn’t access the file (another program may be using it).',
    'err.assemble_failed': 'Couldn’t assemble the parts.', 'err.incomplete': 'The download is incomplete.', 'err.range_not_satisfiable': 'The server couldn’t provide the requested range.',
    'err.proxy': 'Proxy error.', 'err.proxy_auth': 'Proxy authentication failed.', 'err.unsupported_protocol': 'Unsupported protocol.',
    'err.offline': 'Can’t reach the server.',

    'tray.show': 'Show Master Download', 'tray.addUrl': 'Add URL…', 'tray.fromClipboard': 'Download link from clipboard',
    'tray.startQueue': 'Start main queue', 'tray.stopQueue': 'Stop main queue', 'tray.pauseAll': 'Stop all',
    'tray.speedLimit': 'Speed limit', 'tray.clipboard': 'Watch clipboard', 'tray.dropTarget': 'Drop target', 'tray.quit': 'Quit',
    'tray.active': '{n} downloads',
    'tray.balloonTitle': 'Master Download is running in the background',
    'tray.balloonBody': 'Downloads keep running. Double-click the icon next to the clock to open the window.',
  };

  // ---------------------------------------------------------------------------
  // Dil kodunu (ör. "tr-TR", "zh-CN") desteklenen bir dile çevirir
  function resolveLanguage(code) {
    const c = String(code || '').toLowerCase().split(/[-_]/)[0];
    return LANGUAGES[c] ? c : 'en';
  }

  function createT(lang) {
    const dict = STRINGS[lang] || STRINGS.en;
    return function t(key, vars) {
      let s = dict[key] ?? STRINGS.en[key] ?? key;
      if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
      return s;
    };
  }

  const api = { LANGUAGES, STRINGS, resolveLanguage, createT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof self !== 'undefined' ? self : this);
