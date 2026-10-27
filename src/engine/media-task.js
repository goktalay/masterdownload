'use strict';

// Akış (HLS / DASH tek temsil) indirmesi. DownloadTask ile aynı yaşam döngüsü ve olaylar:
//   status: idle → connecting → downloading → (paused) → assembling → completed / error / canceled
//   Olaylar: 'status' (status), 'progress' (snapshot()), 'resolved' ({fileName,size:null,resumable,dest,finalUrl,variant,segmentsTotal}),
//            'warning' (code), 'retry' ({segment,attempt,code}), 'done' ({file,size}), 'error' (err)
//
// Geçici klasör: <tempDir>/<id>/
//   state.json  plan özeti + tamamlanan parça listesi (1 sn'de bir ve duraklatmada, geçici dosya + rename ile)
//   <n>.seg     tamamlanmış parça n (init/EXT-X-MAP varsa 0. parçadır). İndirme <n>.seg.tmp'ye yapılır, bitince
//               yeniden adlandırılır: bu yüzden var olan her .seg dosyası eksiksizdir. Yarım .tmp sürdürmede baştan iner.
// Bitince parçalar sırayla birleştirilir: fMP4 (EXT-X-MAP) → .mp4, MPEG-TS → .ts; DASH'te init + parçalar (uzantı MIME'dan).
// Windows: her dosya tanıtıcısı kapanması BEKLENEREK kapatılır (await fh.close()), sonra taşınır/silinir.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter, setMaxListeners } = require('events');
const { request, fetchText, createJar } = require('./http');
const { takeAll, createBucket } = require('./throttle');
const { sanitize, fromUrl } = require('./filename');
const { renameRetry, sleep } = require('./task');
const hls = require('./hls');
const dash = require('./dash');

const defaultRetryDelay = (attempt) => Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
const TRANSIENT = ['network', 'timeout', 'refused', 'short_read', 'ECONNRESET', 'aborted'];

class MediaTask extends EventEmitter {
  constructor(opts) {
    super();
    this.id = String(opts.id);
    this.url = opts.url;
    this.kind = opts.kind === 'dash' ? 'dash' : 'hls';
    this.variant = opts.variant ?? null;    // HLS: varyant adresi / ad / sıra no; DASH: temsil id'si
    this.tempDir = path.join(opts.tempDir, this.id);
    this.dest = opts.dest || null;
    this.chooseDest = opts.chooseDest || null; // async ({fileName,size,mime}) → yol
    this.suggestedName = opts.fileName || '';
    this.connections = Math.max(1, Math.min(32, opts.connections || 8));
    this.retries = opts.retries ?? 20;
    this.retryDelay = opts.retryDelay || defaultRetryDelay;
    this.globalBuckets = opts.buckets || [];
    this.bucket = createBucket(opts.speedLimit || 0);
    this.progressMs = opts.progressMs || 250;
    const h = opts.http || {};
    this.http = { referrer: h.referrer || '', userAgent: h.userAgent || '', auth: h.auth || null, proxy: h.proxy ?? null, resolveProxy: h.resolveProxy || null, timeout: h.timeout || 30000 };
    this.jar = createJar(h.cookies || '');
    this.status = 'idle';
    this.size = null;            // birleştirmeden önce bilinmez
    this.resumable = true;
    this.received = 0;
    this.speed = 0;
    this.items = [];             // [{url, byterange?}] — init varsa 0. öğe
    this.done = new Set();
    this.selected = null;        // seçilen varyant/temsil bilgisi
    this.finalUrl = this.url;
    this._doneBytes = 0;
    this._inflight = new Map();  // parça no → alınan bayt
    this._ctl = null;
    this._samples = [];
  }

  setSpeedLimit(bps) { this.bucket.setRate(bps || 0); }

  stateFile() { return path.join(this.tempDir, 'state.json'); }
  segFile(n) { return path.join(this.tempDir, `${n}.seg`); }

  get segmentsTotal() { return this.items.length; }
  get segmentsDone() { return this.done.size; }

  _req(signal, extra = {}) {
    return { jar: this.jar, ...this.http, signal, ...extra };
  }

  async loadState() {
    try {
      const s = JSON.parse(await fsp.readFile(this.stateFile(), 'utf8'));
      return s && s.v === 1 && s.kind === this.kind ? s : null;
    } catch {
      return null;
    }
  }

  async saveState() {
    if (!this.items.length) return;
    const s = {
      v: 1, kind: this.kind, url: this.url, variant: this._variantKey, count: this.items.length, init: !!this._hasInit,
      ext: this._ext, dest: this.dest, done: [...this.done].sort((a, b) => a - b),
    };
    const file = this.stateFile();
    const tmp = `${file}.tmp`;
    await fsp.mkdir(this.tempDir, { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(s));
    await fsp.rename(tmp, file);
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  snapshot() {
    const n = this.done.size;
    // Boyut bilinmez; biten parçaların ortalamasından kestirilir (ETA için)
    const estimatedSize = n > 0 && this.items.length ? Math.round((this._doneBytes / n) * this.items.length) : null;
    const est = this.size ?? estimatedSize;
    return {
      received: this.received, size: this.size, estimatedSize, speed: this.speed,
      eta: est && this.speed > 0 ? Math.max(0, Math.round((est - this.received) / this.speed)) : null,
      connections: this._inflight.size, segmentsDone: n, segmentsTotal: this.items.length,
    };
  }

  _tickProgress() {
    const now = Date.now();
    let r = this._doneBytes;
    for (const b of this._inflight.values()) r += b;
    this.received = r;
    this._samples.push([now, r]);
    while (this._samples.length > 2 && now - this._samples[0][0] > 3000) this._samples.shift();
    const [t0, r0] = this._samples[0];
    this.speed = now - t0 > 0 ? Math.max(0, ((r - r0) * 1000) / (now - t0)) : 0;
    this.emit('progress', this.snapshot());
  }

  // Başlatır ya da sürdürür. Tamamlanınca / duraklatılınca / hata verince çözülür (hata fırlatmaz; status'a bakın).
  async start() {
    if (this._running) return this._running;
    this._running = this._run().finally(() => { this._running = null; });
    return this._running;
  }

  pause() {
    if (this._ctl) { this._paused = true; this._ctl.abort(); }
    return this._running || Promise.resolve();
  }

  async cancel() {
    await this.pause();
    await fsp.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
    this.setStatus('canceled');
  }

  // Liste/MPD indirilir, varyant seçilir, parça planı çıkarılır
  async _resolvePlan(signal, saved) {
    const want = this.variant ?? (saved ? saved.variant : null);
    const { text, url } = await fetchText(this.url, this._req(signal));
    this.finalUrl = url;
    if (this.kind === 'hls') {
      let media;
      let mediaUrl = url;
      if (hls.isMaster(text)) {
        const master = hls.parseMaster(text, url);
        if (master.encrypted) throw new hls.MediaError('encrypted_stream', 'stream is encrypted / DRM protected');
        const v = hls.pickVariant(master.variants, want, url);
        this._variantKey = master.variants.indexOf(v);
        this.selected = { url: v.url, name: v.name, bandwidth: v.bandwidth, resolution: v.resolution, codecs: v.codecs };
        const r = await fetchText(v.url, this._req(signal));
        mediaUrl = r.url;
        media = hls.parseMedia(r.text, mediaUrl);
      } else {
        this._variantKey = null;
        media = hls.parseMedia(text, url);
      }
      hls.assertPlain(media);
      this._hasInit = !!media.map;
      this.items = [...(media.map ? [media.map] : []), ...media.segments].map((s) => ({ url: s.url, byterange: s.byterange || null }));
      this._ext = media.map ? '.mp4' : '.ts';
      this._mime = media.map ? 'video/mp4' : 'video/mp2t';
      return;
    }
    const mpd = dash.parseMpd(text, url);
    const reps = dash.listRepresentations(mpd);
    const rep = dash.pickRepresentation(reps, want);
    if (!rep) throw new hls.MediaError('bad_manifest', 'no audio/video representation');
    this._variantKey = rep.id;
    this.selected = { id: rep.id, kind: rep.kind, bandwidth: rep.bandwidth, width: rep.width, height: rep.height, codecs: rep.codecs, mime: rep.mime };
    const { init, segments } = dash.segmentsFor(rep);
    this._hasInit = !!init;
    this.items = [...(init ? [init] : []), ...segments].map((s) => ({ url: s.url, byterange: s.byterange || null }));
    this._ext = dash.extForMime(rep.mime);
    this._mime = rep.mime;
  }

  _fileName() {
    let name = this.suggestedName;
    if (!name) {
      name = fromUrl(this.finalUrl || this.url).replace(/\.(m3u8?|mpd)$/i, '');
      if (!name || /^(index|master|playlist|manifest|stream)$/i.test(name)) {
        // Genel adlı listede bir üst klasör adı daha anlamlıdır
        try {
          const parts = new URL(this.url).pathname.split('/').filter(Boolean);
          name = decodeURIComponent(parts[parts.length - 2] || '') || name || 'video';
        } catch { name = name || 'video'; }
      }
    }
    if (path.extname(name).toLowerCase() !== this._ext) name += this._ext;
    return sanitize(name, `video${this._ext}`);
  }

  async _run() {
    this._paused = false;
    this._fatal = null;
    this._ctl = new AbortController();
    const signal = this._ctl.signal;
    setMaxListeners(200, signal);
    let timer = null;
    let saver = null;
    try {
      this.setStatus('connecting');
      const saved = await this.loadState();
      await this._resolvePlan(signal, saved);
      const same = saved && saved.count === this.items.length && saved.init === !!this._hasInit && saved.ext === this._ext
        && (this.variant == null || saved.variant === this._variantKey);
      if (saved && !same) {
        this.emit('warning', 'changed');
        await fsp.rm(this.tempDir, { recursive: true, force: true });
      }
      if (!this.dest) {
        if (same && saved.dest) this.dest = saved.dest;
        else {
          const fileName = this._fileName();
          this.dest = this.chooseDest ? await this.chooseDest({ fileName, size: null, mime: this._mime }) : fileName;
        }
      }
      this.emit('resolved', {
        fileName: path.basename(this.dest), size: null, resumable: true, dest: this.dest, finalUrl: this.finalUrl,
        variant: this.selected, segmentsTotal: this.items.length,
      });

      await fsp.mkdir(this.tempDir, { recursive: true });
      // Tamamlanan parçalar: diskte var olan .seg dosyaları (yalnız eksiksiz parçalar bu adla bulunur)
      this.done = new Set();
      this._doneBytes = 0;
      for (let n = 0; n < this.items.length; n++) {
        try {
          const st = await fsp.stat(this.segFile(n));
          this.done.add(n);
          this._doneBytes += st.size;
        } catch { /* yok */ }
      }
      await this.saveState();

      this.setStatus('downloading');
      this._tickProgress();
      this._samples = [[Date.now(), this.received]];
      timer = setInterval(() => this._tickProgress(), this.progressMs);
      saver = setInterval(() => { this.saveState().catch(() => {}); }, 1000);

      const pending = [];
      for (let n = 0; n < this.items.length; n++) if (!this.done.has(n)) pending.push(n);
      let next = 0;
      const worker = async () => {
        while (!signal.aborted) {
          const n = pending[next++];
          if (n === undefined) return;
          await this._fetchItem(n, signal);
        }
      };
      const workers = [];
      for (let i = 0; i < Math.min(this.connections, pending.length); i++) workers.push(worker());
      const results = await Promise.allSettled(workers);
      clearInterval(timer); timer = null;
      clearInterval(saver); saver = null;
      this._tickProgress();
      if (this._paused) { await this.saveState(); this.setStatus('paused'); return; }
      const failed = results.find((r) => r.status === 'rejected');
      if (this._fatal) throw this._fatal;
      if (failed) throw failed.reason;
      if (this.done.size !== this.items.length) throw Object.assign(new Error('incomplete'), { code: 'incomplete' });

      this.setStatus('assembling');
      await this._assemble();
      this.setStatus('completed');
      this.emit('done', { file: this.dest, size: this.size });
    } catch (e) {
      if (timer) clearInterval(timer);
      if (saver) clearInterval(saver);
      if (this._paused) { await this.saveState().catch(() => {}); this.setStatus('paused'); return; }
      await this.saveState().catch(() => {});
      this.error = e;
      this.setStatus('error');
      this.emit('error', e);
    } finally {
      this._inflight.clear();
      this._ctl = null;
    }
  }

  async _fetchItem(n, signal) {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const bytes = await this._download(n, signal);
        if (signal.aborted) return;
        this.done.add(n);
        this._doneBytes += bytes;
        return;
      } catch (e) {
        if (signal.aborted) return;
        const transient = e.transient !== undefined ? e.transient : TRANSIENT.includes(e.code) || !e.code;
        if (!transient || ++attempt > this.retries) {
          // Kalıcı hata: diğer bağlantılar da durur
          if (!this._fatal) this._fatal = e;
          if (this._ctl) this._ctl.abort();
          return;
        }
        this.emit('retry', { segment: n, attempt, code: e.code });
        await sleep(this.retryDelay(attempt), signal);
      } finally {
        this._inflight.delete(n);
      }
    }
  }

  // Tek parçayı <n>.seg.tmp'ye indirir, eksiksizse <n>.seg yapar. Dönen: bayt sayısı
  async _download(n, signal) {
    const item = this.items[n];
    const br = item.byterange;
    const range = br ? `bytes=${br.offset}-${br.offset + br.length - 1}` : null;
    const { res } = await request(item.url, this._req(signal, { range }));
    // Aralık istendi ama sunucu tamamını verdiyse (200) baştaki baytlar atlanır
    let skip = br && res.statusCode !== 206 ? br.offset : 0;
    const cl = Number(res.headers['content-length']);
    const expected = br ? br.length : res.headers['content-length'] !== undefined && Number.isFinite(cl) ? cl : null;
    const tmp = `${this.segFile(n)}.tmp`;
    let got = 0;
    this._inflight.set(n, 0);
    const fh = await fsp.open(tmp, 'w');
    try {
      const onAbort = () => res.destroy();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        for await (let chunk of res) {
          if (signal.aborted) break;
          if (skip) {
            const k = Math.min(skip, chunk.length);
            skip -= k;
            chunk = chunk.subarray(k);
            if (!chunk.length) continue;
          }
          if (expected != null && got + chunk.length > expected) chunk = chunk.subarray(0, expected - got);
          await takeAll([...this.globalBuckets, this.bucket], chunk.length);
          if (signal.aborted) break;
          await fh.write(chunk, 0, chunk.length);
          got += chunk.length;
          this._inflight.set(n, got);
          if (expected != null && got >= expected) break;
        }
      } catch (e) {
        if (!signal.aborted) throw Object.assign(e, { transient: e.transient ?? true, code: e.code || 'network' });
      } finally {
        signal.removeEventListener('abort', onAbort);
        res.destroy();
      }
    } finally {
      await fh.close();
    }
    if (signal.aborted) return got;
    if (expected != null && got !== expected) throw Object.assign(new Error(`short read ${got}/${expected}`), { code: 'short_read', transient: true });
    await renameRetry(tmp, this.segFile(n));
    return got;
  }

  async _assemble() {
    await fsp.mkdir(path.dirname(this.dest), { recursive: true });
    const tmpOut = `${this.dest}.mdtmp`;
    await fsp.rm(tmpOut, { force: true });
    // İlk parça hedef klasöre taşınır (aynı birimde kopyalama yok), diğerleri sırayla sonuna eklenir
    const first = this.segFile(0);
    try {
      await fsp.rename(first, tmpOut);
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fsp.copyFile(first, tmpOut);
    }
    if (this.items.length > 1) {
      const out = await fsp.open(tmpOut, 'a');
      try {
        const buf = Buffer.allocUnsafe(1024 * 1024);
        for (let n = 1; n < this.items.length; n++) {
          const inp = await fsp.open(this.segFile(n), 'r');
          try {
            for (;;) {
              const { bytesRead } = await inp.read(buf, 0, buf.length, null);
              if (!bytesRead) break;
              await out.write(buf, 0, bytesRead);
            }
          } finally {
            await inp.close();
          }
        }
      } finally {
        await out.close();
      }
    }
    const st = await fsp.stat(tmpOut);
    if (st.size !== this._doneBytes) throw Object.assign(new Error(`size mismatch ${st.size} != ${this._doneBytes}`), { code: 'assemble_failed' });
    this.size = st.size;
    this.received = st.size;
    await renameRetry(tmpOut, this.dest);
    await fsp.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { MediaTask };
