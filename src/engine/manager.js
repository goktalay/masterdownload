'use strict';

// İndirme yöneticisi: liste, kalıcılık, görev başlatma/durdurma, kuyruklar, hız sınırı, kategoriler.
// Electron'a bağlı değildir; ana süreç (main.js) ayarları, şifreleme ve bitiş kancalarını verir.
//
// Kayıt (downloads.json → items[]):
//   { id, url, finalUrl, kind: 'file'|'hls'|'dash', variant?, referrer, ua, fileName, dir, dest, category, queue, order,
//     size, received, resumable, status, error, connections, speedLimit (B/sn, 0 = yok), addedAt, finishedAt, description,
//     secret: şifreli { cookies, auth } (encrypt/decrypt dışarıdan; tamamlanınca silinir) }
// Durumlar: 'paused' (durdurulmuş / henüz başlatılmamış), 'queued' (kuyrukta sıra bekliyor), 'connecting', 'downloading',
//           'assembling', 'completed', 'error'.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { DownloadTask } = require('./task');
const { createHttpTransport } = require('./transport-http');
const { createBucket } = require('./throttle');
const { categorize, dirFor, defaultCategories } = require('./categories');
const { sanitize, uniquePath } = require('./filename');
const { createQueueRunner, defaultQueues, MAIN, ACTIVE } = require('./queue');

const SAVE_DEBOUNCE_MS = 800;

class DownloadManager extends EventEmitter {
  // opts: { dataDir, tempDir, getSettings(), categoryLabel(id), encrypt(str)→str, decrypt(str)→str, resolveProxy(url), now() }
  constructor(opts) {
    super();
    this.opts = opts;
    this.file = path.join(opts.dataDir, 'downloads.json');
    this.items = [];
    this.tasks = new Map();
    this.bucket = createBucket(0);
    this._saveTimer = null;
    this.load();
    this.applySpeedLimit();
    this.runner = createQueueRunner({
      getDownloads: () => this.items,
      getQueues: () => this.settings().queues,
      start: (id) => this.start(id, { fromQueue: true }),
      stop: (id) => this.pause(id),
      onQueueDone: (q) => this.emit('queueDone', q),
      onChange: () => { this.emit('queues'); this.emit('settingsChanged'); },
      now: opts.now,
    });
  }

  settings() {
    const s = this.opts.getSettings();
    return { ...s, categories: s.categories || defaultCategories(), queues: s.queues || defaultQueues() };
  }

  // --- Kalıcılık -------------------------------------------------------------
  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.items = Array.isArray(d.items) ? d.items : [];
    } catch {
      this.items = [];
    }
    // Uygulama kapanırken süren indirmeler duraklatılmış sayılır (açılışta kuyruk/otomatik sürdürme karar verir)
    for (const it of this.items) {
      if (ACTIVE.has(it.status) || it.status === 'queued') { it.wasActive = true; it.status = 'paused'; }
    }
  }

  saveNow() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, items: this.items }), 'utf8');
    try { fs.renameSync(tmp, this.file); } catch { fs.writeFileSync(this.file, JSON.stringify({ v: 1, items: this.items }), 'utf8'); }
  }

  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS);
  }

  changed(item) {
    this.save();
    this.emit('changed', item || null);
  }

  get(id) { return this.items.find((x) => x.id === id) || null; }

  // Arayüze giden görünüm (gizli alanlar yok)
  view(it) {
    const { secret, wasActive, ...rest } = it;
    const t = this.tasks.get(it.id);
    return { ...rest, hasCookies: !!(secret && secret.c), hasAuth: !!(secret && secret.a), progress: t ? t.snapshot() : null };
  }
  list() { return this.items.map((x) => this.view(x)); }

  // --- Ekleme -----------------------------------------------------------------
  // req: { url, referrer, cookies, ua, fileName, dir, category, queue, kind, variant, auth: {user,pass}, connections,
  //        description, start: true|false, size, mime }
  // Dönen: kayıt. Aynı adres listede tamamlanmamış duruyorsa o kayıt { duplicate: true } ile döner.
  add(req) {
    const url = String(req.url || '').trim();
    if (!/^(https?|ftp):\/\//i.test(url)) throw Object.assign(new Error('invalid_url'), { code: 'invalid_url' });
    const existing = this.items.find((x) => x.url === url && x.status !== 'completed');
    if (existing && !req.allowDuplicate) return { ...this.view(existing), duplicate: true };

    const s = this.settings();
    const fileName = req.fileName ? sanitize(req.fileName) : '';
    const category = req.category || (fileName ? categorize(fileName, s.categories, url) : null);
    const queue = req.queue === undefined ? null : req.queue;
    const it = {
      id: crypto.randomUUID(),
      url, finalUrl: null,
      kind: req.kind || (/^ftp:/i.test(url) ? 'ftp' : 'file'),
      variant: req.variant || null,
      referrer: req.referrer || '', ua: req.ua || '',
      fileName, dir: req.dir || '', dest: null, category,
      queue, order: Date.now(),
      size: req.size || null, received: 0, resumable: null,
      status: 'paused', error: null,
      connections: req.connections || null, speedLimit: 0,
      addedAt: Date.now(), finishedAt: null,
      description: req.description || '', pageUrl: req.pageUrl || '', title: req.title || '',
      secret: this._seal({ cookies: req.cookies || '', auth: req.auth && req.auth.user ? req.auth : null }),
    };
    this.items.push(it);
    this.changed(it);
    if (req.start) this.start(it.id);
    else if (queue && this.runner.isRunning(queue)) { it.status = 'queued'; this.runner.pump(); }
    return this.view(it);
  }

  _seal(sec) {
    if (!sec || (!sec.cookies && !sec.auth)) return null;
    try { return { enc: this.opts.encrypt(JSON.stringify(sec)), c: !!sec.cookies, a: !!sec.auth }; } catch { return null; }
  }
  _unseal(it) {
    if (!it.secret || !it.secret.enc) return { cookies: '', auth: null };
    try { return JSON.parse(this.opts.decrypt(it.secret.enc)); } catch { return { cookies: '', auth: null }; }
  }

  // --- Görevler ---------------------------------------------------------------
  _makeTask(it) {
    const s = this.settings();
    const conn = s.connection || {};
    const sec = this._unseal(it);
    const proxy = proxyFromSettings(conn.proxy);
    const http = {
      url: it.url,
      referrer: it.referrer, cookies: sec.cookies, userAgent: it.ua || conn.userAgent || '', auth: sec.auth,
      proxy: proxy === 'system' ? null : proxy, resolveProxy: proxy === 'system' ? this.opts.resolveProxy : null,
      timeout: (conn.timeoutSec || 30) * 1000,
    };
    const common = {
      id: it.id, tempDir: this.opts.tempDir, dest: it.dest, fileName: it.fileName,
      chooseDest: (info) => this._chooseDest(it, info),
      connections: it.connections || conn.maxConnections || 8, retries: conn.retries ?? 20,
      buckets: [this.bucket], speedLimit: it.speedLimit || 0,
    };
    if (it.kind === 'hls' || it.kind === 'dash') {
      const { MediaTask } = require('./media-task');
      return new MediaTask({ ...common, url: it.url, kind: it.kind, variant: it.variant, http });
    }
    let transport;
    if (it.kind === 'ftp') {
      const { createFtpTransport } = require('./transport-ftp');
      transport = createFtpTransport({ url: it.url, auth: sec.auth, timeout: http.timeout });
    } else {
      transport = createHttpTransport(http);
    }
    return new DownloadTask({ ...common, transport });
  }

  async _chooseDest(it, { fileName }) {
    const s = this.settings();
    const name = it.fileName || fileName;
    if (!it.category) it.category = categorize(name, s.categories, it.url);
    const dir = it.dir || dirFor(it.category, s.categories, s.downloads.dir, this.opts.categoryLabel || ((x) => x));
    it.fileName = name;
    it.dir = dir;
    const policy = (s.downloads && s.downloads.duplicate) || 'rename';
    // Başka bir indirmenin hedefi de dolu sayılır
    const taken = (p) => this.items.some((x) => x !== it && x.dest === p && x.status !== 'completed');
    it.dest = policy === 'overwrite' ? path.join(dir, name) : uniquePath(dir, name, taken);
    it.fileName = path.basename(it.dest);
    this.changed(it);
    return it.dest;
  }

  start(id, { fromQueue = false } = {}) {
    const it = this.get(id);
    if (!it || this.tasks.has(id) || it.status === 'completed') return false;
    // Elle başlatılan indirme kuyruk sırasını beklemez
    if (!fromQueue && it.status === 'queued') it.order = 0;
    const task = this._makeTask(it);
    this.tasks.set(id, task);
    it.status = 'connecting';
    it.error = null;
    delete it.wasActive;
    task.on('status', (st) => {
      if (st === 'paused' || st === 'canceled') return; // aşağıda ele alınır
      it.status = st === 'idle' ? 'connecting' : st;
      this.changed(it);
    });
    task.on('resolved', (r) => {
      it.size = r.size;
      it.resumable = r.resumable;
      it.finalUrl = r.finalUrl || it.finalUrl;
      if (r.dest) { it.dest = r.dest; it.fileName = path.basename(r.dest); }
      this.changed(it);
    });
    task.on('warning', (code) => this.emit('warning', { id, code }));
    task.on('progress', (p) => {
      it.received = p.received;
      if (p.size) it.size = p.size;
      this.emit('progress', { id, ...p });
    });
    task.on('error', () => {});
    task.start().then(() => {
      this.tasks.delete(id);
      if (task.status === 'completed') {
        it.status = 'completed';
        it.received = task.size || it.received;
        it.size = task.size || it.size;
        it.finishedAt = Date.now();
        it.secret = null; // çerez/parola tamamlanınca tutulmaz
        this.changed(it);
        this.emit('completed', this.view(it));
      } else if (task.status === 'error') {
        it.status = 'error';
        it.error = (task.error && (task.error.code || task.error.message)) || 'error';
        this.changed(it);
        this.emit('failed', this.view(it));
      } else if (task.status !== 'canceled') {
        it.status = it._requeue ? 'queued' : 'paused';
        delete it._requeue;
        this.changed(it);
      }
      this.runner.pump();
    });
    this.changed(it);
    return true;
  }

  async pause(id) {
    const it = this.get(id);
    if (!it) return;
    const t = this.tasks.get(id);
    if (t) await t.pause();
    else if (it.status === 'queued') { it.status = 'paused'; this.changed(it); }
  }

  async pauseAll() {
    for (const q of this.runner.running()) this.runner.stopQueue(q, { pauseActive: false });
    await Promise.all([...this.tasks.keys()].map((id) => this.pause(id)));
    for (const it of this.items) if (it.status === 'queued') it.status = 'paused';
    this.changed();
  }

  // Duraklatılmış / hatalı tüm indirmeleri sürdür (IDM: "Tümünü başlat" yok; kuyruk dışındakiler için kolaylık)
  resumeAll() {
    for (const it of this.items) if (it.status === 'paused' || it.status === 'error') this.start(it.id);
  }

  // deleteFile: tamamlanmışsa diskteki dosya da silinir; tamamlanmamışların geçici dosyaları her zaman silinir
  async remove(ids, { deleteFile = false } = {}) {
    for (const id of [].concat(ids)) {
      const it = this.get(id);
      if (!it) continue;
      const t = this.tasks.get(id);
      if (t) { await t.cancel(); this.tasks.delete(id); }
      else await fs.promises.rm(path.join(this.opts.tempDir, id), { recursive: true, force: true }).catch(() => {});
      if (deleteFile && it.status === 'completed' && it.dest) await fs.promises.rm(it.dest, { force: true }).catch(() => {});
      this.items = this.items.filter((x) => x.id !== id);
    }
    this.changed();
  }

  // Baştan indir (dosya değişmiş ya da bozulmuş)
  async redownload(id) {
    const it = this.get(id);
    if (!it) return;
    const t = this.tasks.get(id);
    if (t) await t.cancel();
    await fs.promises.rm(path.join(this.opts.tempDir, id), { recursive: true, force: true }).catch(() => {});
    Object.assign(it, { status: 'paused', received: 0, finishedAt: null, error: null });
    this.changed(it);
    this.start(id);
  }

  // Bağlantı yenileme: süresi dolan adres yerine yeni adres; bölümler korunur (boyut/ETag görevde denetlenir)
  async refreshUrl(id, { url, referrer, cookies, ua }) {
    const it = this.get(id);
    if (!it || !/^(https?|ftp):\/\//i.test(String(url || ''))) return false;
    const t = this.tasks.get(id);
    if (t) await t.pause();
    it.url = url;
    it.finalUrl = null;
    if (referrer !== undefined) it.referrer = referrer;
    if (ua) it.ua = ua;
    if (cookies !== undefined) it.secret = this._seal({ ...this._unseal(it), cookies });
    it.error = null;
    this.changed(it);
    return true;
  }

  update(id, patch) {
    const it = this.get(id);
    if (!it) return null;
    for (const k of ['description', 'queue', 'connections', 'category']) if (k in patch) it[k] = patch[k];
    if ('speedLimit' in patch) {
      it.speedLimit = Math.max(0, Number(patch.speedLimit) || 0);
      const t = this.tasks.get(id);
      if (t) t.setSpeedLimit(it.speedLimit);
    }
    if ('fileName' in patch && !it.dest) it.fileName = sanitize(patch.fileName);
    if ('dir' in patch && !it.dest) it.dir = patch.dir;
    this.changed(it);
    return this.view(it);
  }

  // Kuyruklar ---------------------------------------------------------------
  moveToQueue(ids, queue) {
    for (const id of [].concat(ids)) {
      const it = this.get(id);
      if (!it || it.status === 'completed') continue;
      it.queue = queue;
      it.order = Date.now();
      if (queue && this.runner.isRunning(queue) && it.status === 'paused') it.status = 'queued';
      if (!queue && it.status === 'queued') it.status = 'paused';
    }
    this.changed();
    this.runner.pump();
  }

  reorder(queue, orderedIds) {
    orderedIds.forEach((id, i) => { const it = this.get(id); if (it && it.queue === queue) it.order = i + 1; });
    this.changed();
  }

  startQueue(qid = MAIN) {
    for (const it of this.items) if (it.queue === qid && (it.status === 'paused' || it.status === 'error')) it.status = 'queued';
    this.changed();
    this.runner.startQueue(qid);
  }

  stopQueue(qid = MAIN) {
    this.runner.stopQueue(qid);
    for (const it of this.items) if (it.queue === qid && it.status === 'queued') it.status = 'paused';
    this.changed();
  }

  applySpeedLimit() {
    const s = this.opts.getSettings();
    const lim = s.speedLimit || {};
    this.bucket.setRate(lim.enabled ? Math.max(1, Number(lim.kbps) || 0) * 1024 : 0);
  }

  activeCount() { return this.tasks.size; }
  totalSpeed() { let n = 0; for (const t of this.tasks.values()) n += t.speed || 0; return n; }

  // Uygulama kapanırken: durumu kaydet, görevleri duraklat (bölümler state.json'da kalır)
  async shutdown() {
    this.runner.end();
    const ids = [...this.tasks.keys()];
    await Promise.all(ids.map((id) => this.tasks.get(id).pause()));
    for (const id of ids) { const it = this.get(id); if (it) it.wasActive = true; }
    this.saveNow();
  }
}

// connection.proxy → 'system' | null | { type, host, port, user, pass }
function proxyFromSettings(p) {
  if (!p || p.mode === 'system' || !p.mode) return 'system';
  if (p.mode === 'none') return null;
  if (!p.host || !p.port) return null;
  return { type: p.mode === 'socks5' ? 'socks5' : 'http', host: p.host, port: Number(p.port), user: p.user || '', pass: p.pass || '' };
}

module.exports = { DownloadManager, proxyFromSettings };
