'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, content, sha } = require('./server');
const { tmpDir, fileSha } = require('./helpers');
const { MediaTask } = require('../src/engine/media-task');
const { parseMaster, parseMedia, assertPlain, pickVariant } = require('../src/engine/hls');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv.close());

// /static/<ad>/ altına liste ve parçalar koyar; parça içerikleri belirlenimcidir
function publish(prefix, { count = 5, segSize = 40 * 1024, seed = 1, map = false, extra = '', endList = true, ext = 'ts' } = {}) {
  const segs = [];
  let pl = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n' + extra;
  if (map) {
    const init = content(1000, seed + 100);
    srv.setStatic(`${prefix}/init.mp4`, init, 'video/mp4');
    segs.push(init);
    pl += '#EXT-X-MAP:URI="init.mp4"\n';
  }
  for (let i = 0; i < count; i++) {
    const b = content(segSize + i * 7, seed * 1000 + i);
    srv.setStatic(`${prefix}/seg${i}.${ext}`, b, 'video/mp2t');
    segs.push(b);
    pl += `#EXTINF:4.000,\nseg${i}.${ext}\n`;
  }
  if (endList) pl += '#EXT-X-ENDLIST\n';
  srv.setStatic(`${prefix}/index.m3u8`, pl, 'application/vnd.apple.mpegurl');
  return { playlist: pl, expected: Buffer.concat(segs) };
}

function makeTask(url, extra = {}) {
  const dir = tmpDir();
  const task = new MediaTask({
    id: extra.id || 'h1', url, kind: 'hls', tempDir: path.join(dir, 'tmp'),
    chooseDest: async ({ fileName }) => path.join(dir, 'out', fileName), retryDelay: () => 20, progressMs: 50, ...extra,
  });
  return { task, dir };
}

test('HLS ana liste ayrıştırma: varyantlar, ses grupları, oturum anahtarı', () => {
  const m = parseMaster(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Türkçe",LANGUAGE="tr",DEFAULT=YES,URI="audio/tr.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud"
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,AVERAGE-BANDWIDTH=2000000,RESOLUTION=1280x720,FRAME-RATE=29.970
https://cdn.example/high/index.m3u8?t=1
`, 'http://h.example/v/master.m3u8');
  assert.strictEqual(m.variants.length, 2);
  assert.deepStrictEqual(m.variants[0], {
    url: 'http://h.example/v/low/index.m3u8', bandwidth: 800000, averageBandwidth: null, resolution: '640x360', width: 640, height: 360,
    codecs: 'avc1.4d401e,mp4a.40.2', frameRate: null, audio: 'aud', name: '360p',
  });
  assert.strictEqual(m.variants[1].url, 'https://cdn.example/high/index.m3u8?t=1');
  assert.strictEqual(m.variants[1].frameRate, 29.97);
  assert.deepStrictEqual(m.audio, [{ groupId: 'aud', name: 'Türkçe', language: 'tr', url: 'http://h.example/v/audio/tr.m3u8', default: true }]);
  assert.strictEqual(m.encrypted, false);
  assert.strictEqual(pickVariant(m.variants).height, 720);
  assert.strictEqual(pickVariant(m.variants, 'low/index.m3u8', 'http://h.example/v/master.m3u8').height, 360);
  assert.strictEqual(pickVariant(m.variants, '360p').height, 360);
  assert.throws(() => pickVariant(m.variants, 'yok.m3u8', 'http://h.example/v/'), { code: 'variant_not_found' });
  const drm = parseMaster('#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXT-X-STREAM-INF:BANDWIDTH=1\na.m3u8\n', 'http://h/');
  assert.strictEqual(drm.encrypted, true);
});

test('HLS medya listesi: parçalar, EXT-X-MAP, BYTERANGE devamı, şifre ve canlı bayrakları', () => {
  const p = parseMedia(`#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:10
#EXT-X-KEY:METHOD=NONE
#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"
#EXTINF:6.0,
#EXT-X-BYTERANGE:1000@720
all.mp4
#EXTINF:5.5,
#EXT-X-BYTERANGE:2000
all.mp4
#EXTINF:3,
../other/s3.m4s
#EXT-X-ENDLIST
`, 'http://h/v/x/index.m3u8');
  assert.strictEqual(p.targetDuration, 6);
  assert.strictEqual(p.mediaSequence, 10);
  assert.strictEqual(p.encrypted, false);
  assert.strictEqual(p.endList, true);
  assert.deepStrictEqual(p.map, { url: 'http://h/v/x/init.mp4', byterange: { length: 720, offset: 0 } });
  assert.deepStrictEqual(p.segments, [
    { url: 'http://h/v/x/all.mp4', duration: 6, byterange: { length: 1000, offset: 720 } },
    { url: 'http://h/v/x/all.mp4', duration: 5.5, byterange: { length: 2000, offset: 1720 } },
    { url: 'http://h/v/other/s3.m4s', duration: 3 },
  ]);
  assert.strictEqual(p.duration, 14.5);
  for (const method of ['AES-128', 'SAMPLE-AES', 'SAMPLE-AES-CTR']) {
    const e = parseMedia(`#EXTM3U\n#EXT-X-KEY:METHOD=${method},URI="k.bin"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n`, 'http://h/');
    assert.strictEqual(e.encrypted, true, method);
    assert.throws(() => assertPlain(e), { code: 'encrypted_stream' });
  }
  const live = parseMedia('#EXTM3U\n#EXTINF:4,\na.ts\n', 'http://h/');
  assert.strictEqual(live.endList, false);
  assert.throws(() => assertPlain(live), { code: 'live_stream' });
  assert.throws(() => parseMedia('merhaba', 'http://h/'), { code: 'bad_playlist' });
});

test('HLS ana liste → en yüksek bant genişlikli varyant, parçalar paralel, .ts birleştirme', async () => {
  const low = publish('/a/low', { seed: 1 });
  publish('/a/mid', { seed: 2 });
  const high = publish('/a/high', { seed: 3, count: 7 });
  srv.setStatic('/a/master.m3u8', `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=426x240
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
high/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720
mid/index.m3u8
`);
  const { task } = makeTask(`${srv.base}/static/a/master.m3u8`, { connections: 4 });
  const resolved = [];
  const progress = [];
  task.on('resolved', (r) => resolved.push(r));
  task.on('progress', (p) => progress.push(p));
  await task.start();
  assert.strictEqual(task.status, 'completed', task.error && task.error.message);
  assert.strictEqual(path.basename(task.dest), 'a.ts');
  assert.strictEqual(fileSha(task.dest), sha(high.expected));
  assert.strictEqual(task.size, high.expected.length);
  assert.strictEqual(resolved[0].size, null);
  assert.strictEqual(resolved[0].segmentsTotal, 7);
  assert.strictEqual(resolved[0].variant.resolution, '1920x1080');
  const last = progress[progress.length - 1];
  assert.strictEqual(last.segmentsDone, 7);
  assert.strictEqual(last.segmentsTotal, 7);
  assert.ok(!srv.stats.byPath['/static/a/low/seg0.ts'], 'düşük varyant indirilmedi');
  assert.ok(!fs.existsSync(task.tempDir), 'geçici klasör silindi');

  // Varyant seçimi: adresle
  const sel = makeTask(`${srv.base}/static/a/master.m3u8`, { id: 'sel', variant: 'low/index.m3u8', fileName: 'düşük' });
  await sel.task.start();
  assert.strictEqual(sel.task.status, 'completed', sel.task.error && sel.task.error.message);
  assert.strictEqual(path.basename(sel.task.dest), 'düşük.ts');
  assert.strictEqual(fileSha(sel.task.dest), sha(low.expected));
});

test('HLS fMP4: EXT-X-MAP başlığı + parçalar → .mp4', async () => {
  const f = publish('/fm/video', { seed: 5, map: true, ext: 'm4s' });
  const { task } = makeTask(`${srv.base}/static/fm/video/index.m3u8`, { id: 'fm', connections: 3 });
  await task.start();
  assert.strictEqual(task.status, 'completed', task.error && task.error.message);
  assert.strictEqual(path.basename(task.dest), 'video.mp4');
  assert.strictEqual(fileSha(task.dest), sha(f.expected));
});

test('HLS BYTERANGE: tek dosyadan aralıklarla parçalar', async () => {
  const size = 300000;
  srv.setStatic('/br/index.m3u8', `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4,
#EXT-X-BYTERANGE:100000@0
/file/br.bin?size=${size}
#EXTINF:4,
#EXT-X-BYTERANGE:120000
/file/br.bin?size=${size}
#EXTINF:4,
#EXT-X-BYTERANGE:80000
/file/br.bin?size=${size}
#EXT-X-ENDLIST
`);
  const { task } = makeTask(`${srv.base}/static/br/index.m3u8`, { id: 'br', fileName: 'aralik.ts' });
  await task.start();
  assert.strictEqual(task.status, 'completed', task.error && task.error.message);
  assert.strictEqual(fileSha(task.dest), sha(srv.body(size)));
});

test('HLS şifreli (AES-128 / SAMPLE-AES / oturum anahtarı) ve canlı listeler reddedilir', async () => {
  publish('/enc1', { extra: '#EXT-X-KEY:METHOD=AES-128,URI="https://k.example/key"\n' });
  publish('/enc2', { extra: '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://abc",KEYFORMAT="com.apple.streamingkeydelivery",KEYFORMATVERSIONS="1"\n' });
  publish('/enc3/v', {});
  srv.setStatic('/enc3/master.m3u8', '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="k"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv/index.m3u8\n');
  publish('/live', { endList: false });
  const cases = [['/static/enc1/index.m3u8', 'encrypted_stream'], ['/static/enc2/index.m3u8', 'encrypted_stream'],
    ['/static/enc3/master.m3u8', 'encrypted_stream'], ['/static/live/index.m3u8', 'live_stream']];
  for (const [p, code] of cases) {
    const { task } = makeTask(`${srv.base}${p}`, { id: 'x' });
    let retries = 0;
    task.on('retry', () => retries++);
    task.on('error', () => {});
    await task.start();
    assert.strictEqual(task.status, 'error', p);
    assert.strictEqual(task.error.code, code, p);
    assert.strictEqual(retries, 0);
  }
  assert.ok(!srv.stats.byPath['/static/enc1/seg0.ts'], 'şifreli listenin parçası istenmedi');
});

test('HLS duraklat ve sürdür: yeni görev tamamlanan parçaları yeniden indirmez', async () => {
  const s = publish('/pr', { seed: 9, count: 12, segSize: 50 * 1024 });
  const url = `${srv.base}/static/pr/index.m3u8`;
  const dir = tmpDir();
  const opts = { id: 'hpr', url, kind: 'hls', tempDir: path.join(dir, 'tmp'), chooseDest: async ({ fileName }) => path.join(dir, fileName), connections: 2, progressMs: 50 };
  const t1 = new MediaTask({ ...opts, speedLimit: 200 * 1024 });
  const p = t1.start();
  await new Promise((r) => setTimeout(r, 900));
  await t1.pause();
  await p;
  assert.strictEqual(t1.status, 'paused');
  const doneBefore = t1.segmentsDone;
  assert.ok(doneBefore > 0 && doneBefore < 12, `yarım: ${doneBefore}`);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'tmp', 'hpr', 'state.json'), 'utf8'));
  assert.strictEqual(state.done.length, doneBefore);
  const counts = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, srv.stats.byPath[`/static/pr/seg${i}.ts`] || 0]));
  // uygulama yeniden açılmış gibi: yeni görev nesnesi
  const t2 = new MediaTask(opts);
  const warns = [];
  t2.on('warning', (w) => warns.push(w));
  await t2.start();
  assert.strictEqual(t2.status, 'completed', t2.error && t2.error.message);
  assert.deepStrictEqual(warns, []);
  assert.strictEqual(fileSha(path.join(dir, 'pr.ts')), sha(s.expected));
  for (const n of state.done) assert.strictEqual(srv.stats.byPath[`/static/pr/seg${n}.ts`], counts[n], `parça ${n} yeniden indirildi`);
});

test('HLS: kalıcı parça hatası (404) yeniden denenmez, geçici kopma yeniden denenir', async () => {
  srv.setStatic('/miss/index.m3u8', '#EXTM3U\n#EXTINF:4,\n/gone\n#EXT-X-ENDLIST\n');
  const { task } = makeTask(`${srv.base}/static/miss/index.m3u8`, { id: 'miss' });
  task.on('error', () => {});
  await task.start();
  assert.strictEqual(task.status, 'error');
  assert.strictEqual(task.error.code, 'not_found');

  srv.resetFlaky();
  const size = 90 * 1024;
  srv.setStatic('/fl/index.m3u8', `#EXTM3U\n#EXTINF:4,\n/flaky/x.bin?size=${size}&cut=3000&fails=2\n#EXT-X-ENDLIST\n`);
  const fl = makeTask(`${srv.base}/static/fl/index.m3u8`, { id: 'fl', fileName: 'fl.ts' });
  let retries = 0;
  fl.task.on('retry', () => retries++);
  await fl.task.start();
  assert.strictEqual(fl.task.status, 'completed', fl.task.error && fl.task.error.message);
  assert.strictEqual(retries, 2);
  assert.strictEqual(fileSha(fl.task.dest), sha(srv.body(size)));
});
