'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, sha } = require('./server');
const { tmpDir, fileSha, waitFor } = require('./helpers');
const { DownloadManager } = require('../src/engine/manager');
const { defaultCategories } = require('../src/engine/categories');
const { defaultQueues } = require('../src/engine/queue');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv.close());

function makeManager(dir, over = {}) {
  const settings = {
    connection: { maxConnections: 4, retries: 3, timeoutSec: 10, proxy: { mode: 'none' } },
    downloads: { dir: path.join(dir, 'Downloads'), duplicate: 'rename' },
    speedLimit: { enabled: false, kbps: 100 },
    categories: defaultCategories(), queues: defaultQueues(), ...over,
  };
  const m = new DownloadManager({
    dataDir: dir, tempDir: path.join(dir, 'tmp'), getSettings: () => settings,
    categoryLabel: (id) => ({ compressed: 'Sıkıştırılmış', video: 'Video' }[id] || id),
    encrypt: (s) => Buffer.from(s).toString('base64'), decrypt: (s) => Buffer.from(s, 'base64').toString(),
  });
  return { m, settings };
}

test('ekle → kategori klasörüne indir → tamamlandı; liste kalıcı; çerez tamamlanınca silinir', async () => {
  const dir = tmpDir();
  const { m } = makeManager(dir);
  const size = 300 * 1024;
  const done = new Promise((r) => m.once('completed', r));
  const it = m.add({ url: `${srv.base}/cookie/arsiv.zip?size=${size}`, cookies: 'sid=ok', start: true });
  assert.strictEqual(it.hasCookies, true);
  const c = await done;
  assert.strictEqual(c.dest, path.join(dir, 'Downloads', 'Sıkıştırılmış', 'arsiv.zip'));
  assert.strictEqual(fileSha(c.dest), sha(srv.body(size)));
  m.saveNow();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'downloads.json'), 'utf8'));
  assert.strictEqual(saved.items[0].status, 'completed');
  assert.strictEqual(saved.items[0].secret, null);
  // aynı adres yeniden: tamamlanmış olduğundan yeni kayıt, aynı ad → "(2)"
  const done2 = new Promise((r) => m.once('completed', r));
  m.add({ url: `${srv.base}/cookie/arsiv.zip?size=${size}`, cookies: 'sid=ok', start: true });
  assert.strictEqual(path.basename((await done2).dest), 'arsiv (2).zip');
});

test('yinelenen tamamlanmamış adres aynı kaydı döner; kuyruk sırayla ve sınırla çalışır', async () => {
  const dir = tmpDir();
  const { m, settings } = makeManager(dir);
  settings.queues[0].maxParallel = 1;
  const a = m.add({ url: `${srv.base}/file/q1.bin?size=60000`, queue: 'main' });
  assert.strictEqual(m.add({ url: a.url }).duplicate, true);
  m.add({ url: `${srv.base}/file/q2.bin?size=60000`, queue: 'main' });
  m.add({ url: `${srv.base}/file/q3.bin?size=60000`, queue: 'main' });
  let maxActive = 0;
  m.on('changed', () => { maxActive = Math.max(maxActive, m.activeCount()); });
  const qd = new Promise((r) => m.once('queueDone', r));
  m.startQueue('main');
  await qd;
  assert.strictEqual(maxActive, 1);
  assert.deepStrictEqual(m.list().map((x) => x.status), ['completed', 'completed', 'completed']);
});

test('duraklat, yeniden başlatılan yöneticiyle sürdür; bağlantı yenileme; sil', async () => {
  const dir = tmpDir();
  const size = 500 * 1024;
  const { m } = makeManager(dir);
  const it = m.add({ url: `${srv.base}/slow/v.mp4?size=${size}&bps=150000`, start: true });
  await waitFor(() => m.get(it.id).received > 50000);
  await m.pause(it.id);
  await waitFor(() => m.get(it.id).status === 'paused');
  await m.shutdown();
  // yeni süreç gibi
  const { m: m2 } = makeManager(dir);
  const rec = m2.get(it.id);
  assert.strictEqual(rec.status, 'paused');
  assert.ok(rec.dest.endsWith(path.join('Video', 'v.mp4')));
  assert.ok(await m2.refreshUrl(it.id, { url: `${srv.base}/file/v.mp4?size=${size}` }));
  const done = new Promise((r) => m2.once('completed', r));
  m2.start(it.id);
  const c = await done;
  assert.strictEqual(fileSha(c.dest), sha(srv.body(size)));
  await m2.remove(it.id, { deleteFile: true });
  assert.strictEqual(fs.existsSync(c.dest), false);
  assert.strictEqual(m2.list().length, 0);
});
