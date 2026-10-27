'use strict';

// Yalnız test/*.test.js dosyalarını çalıştırır (yardımcı sunucular test sayılmasın). Node 20'de --test glob almaz;
// dosya listesi burada çıkarılır, böylece Windows ve Linux'ta aynı çalışır.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
