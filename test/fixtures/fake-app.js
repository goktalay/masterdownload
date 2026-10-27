'use strict';

// Sahte "Master Download" uygulaması: nmhost uygulamayı başlatma yolunu sınamak için.
// Yalnız MD_FIXTURE_PIDFILE tanımlıysa çalışır (node --test bu dosyayı da test diye yükler; o zaman hiçbir şey yapmaz).
// Biraz bekleyip MD_PIPE üzerinde köprü açar, PID'ini dosyaya yazar, 20 sn sonra kendiliğinden kapanır.

const fs = require('fs');
const path = require('path');

if (process.env.MD_FIXTURE_PIDFILE) {
  const { createBridge } = require(path.join(__dirname, '..', '..', 'src', 'bridge'));
  const pidFile = process.env.MD_FIXTURE_PIDFILE;
  setTimeout(async () => {
    const bridge = createBridge({
      onMessage: async (msg) => ({
        ok: true, id: 'fake-1', type: msg.type, args: process.argv.slice(2),
        electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE === undefined ? null : process.env.ELECTRON_RUN_AS_NODE,
      }),
    });
    await bridge.listen();
    fs.writeFileSync(pidFile, String(process.pid));
    setTimeout(() => { bridge.close().then(() => process.exit(0)); }, 20000).unref();
    setInterval(() => {}, 1000).unref();
    setTimeout(() => {}, 20000);
  }, 600);
}
