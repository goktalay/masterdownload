'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, sha } = require('./server');
const { tmpDir, fileSha } = require('./helpers');
const { DownloadTask } = require('../src/engine/task');
const { createHttpTransport } = require('../src/engine/transport-http');
const { createBucket } = require('../src/engine/throttle');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv.close());

function makeTask(url, extra = {}) {
  const dir = tmpDir();
  const task = new DownloadTask({
    id: extra.id || 'd1', transport: createHttpTransport({ url, ...(extra.http || {}) }), tempDir: path.join(dir, 'tmp'),
    chooseDest: async ({ fileName }) => path.join(dir, 'out', fileName), minSegment: 16 * 1024, retryDelay: () => 20, progressMs: 50, ...extra,
  });
  return { task, dir };
}

test('çok parçalı indirme ve birleştirme: içerik birebir aynı', async () => {
  const size = 3 * 1024 * 1024 + 123;
  const { task } = makeTask(`${srv.base}/file/a.bin?size=${size}`, { connections: 8 });
  const done = [];
  task.on('done', (d) => done.push(d));
  await task.start();
  assert.strictEqual(task.status, 'completed', task.error && task.error.message);
  assert.strictEqual(fileSha(done[0].file), sha(srv.body(size)));
  assert.ok(srv.stats.ranges.length >= 8, 'en az 8 aralık isteği');
  assert.strictEqual(path.basename(done[0].file), 'a.bin');
  assert.ok(!fs.existsSync(task.tempDir), 'geçici klasör silindi');
});

test('dinamik bölme: biten bağlantı en büyük kalanı devralır', async () => {
  const size = 600 * 1024;
  const { task } = makeTask(`${srv.base}/slow/b.bin?size=${size}&bps=400000`, { connections: 4, id: 'split' });
  await task.start();
  assert.strictEqual(task.status, 'completed', task.error && task.error.message);
  assert.ok(task.segments.length > 4, `bölüm sayısı ${task.segments.length}`);
});

test('duraklat ve sürdür (Range); yeni görevle state.json’dan devam', async () => {
  const size = 800 * 1024;
  const url = `${srv.base}/slow/c.bin?size=${size}&bps=150000`;
  const dir = tmpDir();
  const opts = { id: 'pr', tempDir: path.join(dir, 'tmp'), chooseDest: async ({ fileName }) => path.join(dir, fileName), minSegment: 16 * 1024, connections: 4, progressMs: 50 };
  const t1 = new DownloadTask({ ...opts, transport: createHttpTransport({ url }) });
  const p = t1.start();
  await new Promise((r) => setTimeout(r, 400));
  await t1.pause();
  await p;
  assert.strictEqual(t1.status, 'paused');
  const got = t1.received;
  assert.ok(got > 0 && got < size, `yarım: ${got}`);
  // uygulama yeniden açılmış gibi: yeni görev nesnesi
  const t2 = new DownloadTask({ ...opts, transport: createHttpTransport({ url: url.replace('bps=150000', 'bps=4000000') }) });
  const before = srv.stats.ranges.length;
  await t2.start();
  assert.strictEqual(t2.status, 'completed', t2.error && t2.error.message);
  assert.strictEqual(fileSha(path.join(dir, 'c.bin')), sha(srv.body(size)));
  const resumed = srv.stats.ranges.slice(before).filter((r) => r !== 'bytes=0-');
  assert.ok(resumed.some((r) => !r.startsWith('bytes=0-')), 'kaldığı yerden aralık istendi');
});

test('sürdürme desteklemeyen sunucu: tek bağlantı, resumable=false', async () => {
  const size = 300 * 1024;
  const { task } = makeTask(`${srv.base}/norange/d.bin?size=${size}`, { id: 'nr' });
  const resolved = [];
  task.on('resolved', (r) => resolved.push(r));
  await task.start();
  assert.strictEqual(task.status, 'completed');
  assert.strictEqual(resolved[0].resumable, false);
  assert.strictEqual(task.segments.length, 1);
});

test('kopan bağlantı yeniden denenir ve dosya tamamlanır', async () => {
  srv.resetFlaky();
  const size = 200 * 1024;
  const { task } = makeTask(`${srv.base}/flaky/e.bin?size=${size}&cut=5000&fails=5`, { id: 'fl', connections: 2 });
  let retries = 0;
  task.on('retry', () => retries++);
  task.on('error', () => {});
  await task.start();
  assert.strictEqual(task.status, 'completed', task.error && task.error.message);
  assert.ok(retries >= 1);
  assert.strictEqual(fileSha(task.dest), sha(srv.body(size)));
});

test('kalıcı hata (404) yeniden denenmez', async () => {
  const { task } = makeTask(`${srv.base}/gone`, { id: 'g' });
  task.on('error', () => {});
  await task.start();
  assert.strictEqual(task.status, 'error');
  assert.strictEqual(task.error.code, 'not_found');
});

test('yönlendirme, çerez, Temel ve Digest kimlik doğrulama, Content-Disposition', async () => {
  const size = 50 * 1024;
  const r = makeTask(`${srv.base}/redirect?to=/cookie/f.bin%3Fsize%3D${size}`, { id: 'ck', http: { cookies: 'sid=ok' } });
  await r.task.start();
  assert.strictEqual(r.task.status, 'completed', r.task.error && r.task.error.message);
  const b = makeTask(`${srv.base}/basic/g.bin?size=${size}`, { id: 'ba', http: { auth: { user: 'u', pass: 'p' } } });
  await b.task.start();
  assert.strictEqual(b.task.status, 'completed', b.task.error && b.task.error.message);
  const d = makeTask(`${srv.base}/digest/h.bin?size=${size}`, { id: 'dg', http: { auth: { user: 'u', pass: 'p' } } });
  await d.task.start();
  assert.strictEqual(d.task.status, 'completed', d.task.error && d.task.error.message);
  const cd = makeTask(`${srv.base}/disposition?size=${size}`, { id: 'cd' });
  await cd.task.start();
  assert.strictEqual(path.basename(cd.task.dest), 'örnek dosya.zip');
});

test('dosya sunucuda değişirse (ETag) baştan iner', async () => {
  const size = 400 * 1024;
  const url = `${srv.base}/slow/i.bin?size=${size}&bps=100000`;
  const dir = tmpDir();
  const opts = { id: 'et', tempDir: path.join(dir, 'tmp'), chooseDest: async ({ fileName }) => path.join(dir, fileName), minSegment: 16 * 1024, progressMs: 50 };
  const t1 = new DownloadTask({ ...opts, transport: createHttpTransport({ url }) });
  const p = t1.start();
  await new Promise((r) => setTimeout(r, 300));
  await t1.pause(); await p;
  srv.changeEtag('-v2');
  const t2 = new DownloadTask({ ...opts, transport: createHttpTransport({ url }) });
  const warns = [];
  t2.on('warning', (w) => warns.push(w));
  await t2.start();
  srv.changeEtag('');
  assert.deepStrictEqual(warns, ['changed']);
  assert.strictEqual(t2.status, 'completed');
  assert.strictEqual(fileSha(path.join(dir, 'i.bin')), sha(srv.body(size)));
});

test('hız sınırı: ölçülen ortalama hız sınıra yakın', async () => {
  const size = 600 * 1024;
  const limit = 400 * 1024;
  const { task } = makeTask(`${srv.base}/file/j.bin?size=${size}`, { id: 'lim', connections: 4, buckets: [createBucket(limit)] });
  const t0 = Date.now();
  await task.start();
  const secs = (Date.now() - t0) / 1000;
  const rate = size / secs;
  assert.strictEqual(task.status, 'completed');
  assert.ok(rate < limit * 1.25, `hız ${Math.round(rate)} > ${limit}`);
  assert.ok(rate > limit * 0.5, `hız çok düşük ${Math.round(rate)}`);
});
