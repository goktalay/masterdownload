'use strict';

// Ana pencere: üst çubuk (araçlar), kenar çubuğu (kategoriler, durum, kuyruklar), indirme tablosu, ayrıntı paneli.

const $ = (s) => document.querySelector(s);

const state = {
  items: [],
  progress: new Map(), // id → son ilerleme anlık görüntüsü
  queues: [],
  settings: null,
  account: null,
  filter: { kind: 'all', id: null }, // all | cat:<id> | unfinished | finished | queue:<id>
  selected: new Set(),
  anchor: null,
  sort: { col: 'added', dir: -1 },
  search: '',
  scans: new Map(),
};

const CAT_ICONS = { compressed: 'archive', documents: 'doc', music: 'music', programs: 'app', video: 'video', general: 'file' };
const COLS = {
  name: { label: () => t('col.name'), w: '' },
  size: { label: () => t('col.size'), w: '96px' },
  status: { label: () => t('col.status'), w: '190px' },
  speed: { label: () => t('col.speed'), w: '96px' },
  eta: { label: () => t('col.eta'), w: '104px' },
  added: { label: () => t('col.added'), w: '128px' },
  desc: { label: () => t('col.desc'), w: '160px' },
};

// --- Biçimlendirme -----------------------------------------------------------
function formatSpeed(bps) {
  if (!bps) return '';
  return ltr(bps >= 1048576 ? `${(bps / 1048576).toLocaleString(LANG, { maximumFractionDigits: 1 })} MB/s` : `${Math.round(bps / 1024).toLocaleString(LANG)} KB/s`);
}
function formatEta(sec) {
  if (sec == null || !isFinite(sec)) return '';
  if (sec < 60) return ltr(t('time.sec', { n: Math.max(1, Math.round(sec)) }));
  if (sec < 3600) return ltr(t('time.min', { m: Math.floor(sec / 60), s: Math.round(sec % 60) }));
  return ltr(t('time.hour', { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60) }));
}
const formatDate = (ms) => (ms ? new Date(ms).toLocaleString(LANG, { dateStyle: 'short', timeStyle: 'short' }) : '');
const pct = (it, p) => {
  const size = (p && p.size) || it.size;
  const rec = p ? p.received : it.received;
  if (p && p.segmentsTotal && !size) return Math.floor((p.segmentsDone / p.segmentsTotal) * 100);
  return size ? Math.min(100, Math.floor((rec / size) * 100)) : null;
};
const errText = (code) => (t(`err.${code}`) !== `err.${code}` ? t(`err.${code}`) : t('err.generic', { code }));
const catLabel = (c) => c.name || t(`cat.${c.id}`);

// --- Üst çubuk ----------------------------------------------------------------
function toolButton(id, ic, label, onClick, cls = '') {
  const b = h(`<button class="tool ${cls}" id="${id}" title="${esc(label)}">${icon(ic)}<span>${esc(label)}</span></button>`);
  b.onclick = onClick;
  return b;
}

function renderTools() {
  const el = $('#tools');
  el.innerHTML = '';
  el.append(
    toolButton('tAdd', 'plus', t('tool.add'), () => openAddDialog({}), 'accent'),
    toolButton('tResume', 'play', t('tool.resume'), () => window.api.start([...state.selected])),
    toolButton('tPause', 'pause', t('tool.pause'), () => window.api.pause([...state.selected])),
    toolButton('tPauseAll', 'stop', t('tool.pauseAll'), () => window.api.pauseAll()),
    toolButton('tDelete', 'trash', t('tool.delete'), () => deleteSelected()),
    h('<span class="tool-sep"></span>'),
    toolButton('tQueue', 'layers', t('tool.queue'), (e) => queueMenu(e.currentTarget)),
    toolButton('tScheduler', 'clock', t('tool.scheduler'), () => openQueuesDialog()),
    toolButton('tLimit', 'gauge', t('tool.limit'), (e) => speedMenu(e.currentTarget)),
    h('<span class="tool-sep"></span>'),
    toolButton('tGrabber', 'spider', t('tool.grabber'), () => openGrabberDialog()),
    toolButton('tBatch', 'list', t('tool.batch'), () => openBatchDialog({})),
    toolButton('tMore', 'dots', t('tool.more'), (e) => moreMenu(e.currentTarget)),
  );
  updateToolState();
}

function updateToolState() {
  const sel = [...state.selected].map((id) => state.items.find((x) => x.id === id)).filter(Boolean);
  const can = (fn) => sel.some(fn);
  const set = (id, on) => { const b = document.getElementById(id); if (b) b.disabled = !on; };
  set('tResume', can((x) => ['paused', 'error', 'queued'].includes(x.status)));
  set('tPause', can((x) => ['connecting', 'downloading', 'queued'].includes(x.status)));
  set('tPauseAll', state.items.some((x) => ['connecting', 'downloading', 'assembling', 'queued'].includes(x.status)));
  set('tDelete', sel.length > 0);
  const lim = document.getElementById('tLimit');
  if (lim && state.settings) lim.classList.toggle('on', !!state.settings.speedLimit.enabled);
  const q = document.getElementById('tQueue');
  if (q) q.classList.toggle('on', state.queues.some((x) => x.running));
}

function rect(el) { const r = el.getBoundingClientRect(); return [document.dir === 'rtl' ? r.right - 200 : r.left, r.bottom + 4]; }

function queueMenu(btn) {
  const [x, y] = rect(btn);
  contextMenu(x, y, [
    ...state.queues.map((q) => ({
      label: `${q.running ? t('q.stop') : t('q.start')} — ${queueName(q)}`, icon: q.running ? 'stop' : 'play',
      action: () => (q.running ? window.api.stopQueue(q.id) : window.api.startQueue(q.id)),
    })),
    '-',
    { label: t('tool.scheduler'), icon: 'clock', action: () => openQueuesDialog() },
  ]);
}

function speedMenu(btn) {
  const [x, y] = rect(btn);
  const s = state.settings.speedLimit;
  const presets = [128, 256, 512, 1024, 2048, 5120];
  contextMenu(x, y, [
    { label: s.enabled ? t('limit.off') : t('limit.on', { v: kbpsLabel(s.kbps) }), icon: 'gauge', action: () => setLimit({ enabled: !s.enabled }) },
    '-',
    ...presets.map((k) => ({ label: kbpsLabel(k) + (s.enabled && s.kbps === k ? '  ✓' : ''), action: () => setLimit({ enabled: true, kbps: k }) })),
    '-',
    { label: t('limit.custom'), icon: 'edit', action: () => openSettings('limit') },
  ]);
}
const kbpsLabel = (k) => (k >= 1024 ? `${(k / 1024).toLocaleString(LANG)} MB/s` : `${k} KB/s`);
async function setLimit(patch) {
  state.settings = await window.api.setSettings({ speedLimit: { ...state.settings.speedLimit, ...patch } });
  updateToolState();
  toast(state.settings.speedLimit.enabled ? t('limit.on', { v: kbpsLabel(state.settings.speedLimit.kbps) }) : t('limit.disabled'), { type: 'ok' });
}

function moreMenu(btn) {
  const [x, y] = rect(btn);
  contextMenu(x, y, [
    { label: t('more.fromClipboard'), icon: 'clipboard', action: async () => { const links = await window.api.clipboardLinks(); if (!links.length) toast(t('more.noLinks'), { type: 'err' }); else if (links.length === 1) openAddDialog({ url: links[0] }); else openBatchDialog({ items: links.map((url) => ({ url })) }); } },
    { label: t('more.import'), icon: 'import', action: () => window.api.importList() },
    { label: t('more.exportEf2'), icon: 'export', action: async () => { const r = await window.api.exportList([...state.selected], 'ef2'); if (r.ok) toast(t('more.exported', { n: r.count }), { type: 'ok' }); } },
    { label: t('more.exportTxt'), icon: 'export', action: async () => { const r = await window.api.exportList([...state.selected], 'txt'); if (r.ok) toast(t('more.exported', { n: r.count }), { type: 'ok' }); } },
    '-',
    { label: t('more.dropTarget'), icon: 'target', action: () => window.api.dropTarget(true) },
    { label: t('more.browser'), icon: 'puzzle', action: () => openSettings('browser') },
    { label: t('more.removeFinished'), icon: 'done', action: () => { const ids = state.items.filter((x) => x.status === 'completed').map((x) => x.id); if (ids.length) window.api.remove(ids, false); } },
  ]);
}

// --- Kenar çubuğu --------------------------------------------------------------
function counts() {
  const c = { all: state.items.length, unfinished: 0, finished: 0, cat: {}, queue: {} };
  for (const it of state.items) {
    if (it.status === 'completed') c.finished++; else c.unfinished++;
    const cat = it.category || 'general';
    c.cat[cat] = (c.cat[cat] || 0) + 1;
    if (it.queue) c.queue[it.queue] = (c.queue[it.queue] || 0) + 1;
  }
  return c;
}

const queueName = (q) => q.name || (q.id === 'main' ? t('q.main') : q.id);

function renderSide() {
  const c = counts();
  const cats = (state.settings && state.settings.categories) || [];
  const f = state.filter;
  const row = (kind, id, ic, label, n, extra = '') =>
    `<button class="side-item ${f.kind === kind && (f.id || null) === (id || null) ? 'on' : ''}" data-kind="${kind}" data-id="${esc(id || '')}">${icon(ic)}<span class="si-label">${esc(label)}</span>${extra}<span class="si-n">${n || ''}</span></button>`;
  $('#side').innerHTML = `
    <div class="side-group">${row('all', null, 'inbox', t('side.all'), c.all)}</div>
    <div class="side-title">${esc(t('side.categories'))}</div>
    <div class="side-group">${cats.map((cat) => row('cat', cat.id, CAT_ICONS[cat.id] || 'tag', catLabel(cat), c.cat[cat.id])).join('')}
      ${c.cat.general ? row('cat', 'general', 'file', t('cat.general'), c.cat.general) : ''}</div>
    <div class="side-title">${esc(t('side.status'))}</div>
    <div class="side-group">${row('unfinished', null, 'partial', t('side.unfinished'), c.unfinished)}${row('finished', null, 'done', t('side.finished'), c.finished)}</div>
    <div class="side-title">${esc(t('side.queues'))}</div>
    <div class="side-group">${state.queues.map((q) => row('queue', q.id, 'layers', queueName(q), c.queue[q.id], q.running ? '<span class="run-dot"></span>' : '')).join('')}</div>
    <div class="side-foot"><span id="sideSpeed"></span></div>`;
  $('#side').querySelectorAll('.side-item').forEach((b) => {
    b.onclick = () => { state.filter = { kind: b.dataset.kind, id: b.dataset.id || null }; renderSide(); renderList(); };
    // Listeden sürükleyip kuyruğa / kategoriye bırakma
    b.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-md-ids') && b.dataset.kind === 'queue') { e.preventDefault(); b.classList.add('drop'); } });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', (e) => {
      b.classList.remove('drop');
      const ids = JSON.parse(e.dataTransfer.getData('application/x-md-ids') || '[]');
      if (ids.length && b.dataset.kind === 'queue') { e.preventDefault(); e.stopPropagation(); window.api.moveToQueue(ids, b.dataset.id); }
    });
    if (b.dataset.kind === 'queue') b.oncontextmenu = (e) => {
      e.preventDefault();
      const q = state.queues.find((x) => x.id === b.dataset.id);
      contextMenu(e.clientX, e.clientY, [
        { label: q.running ? t('q.stop') : t('q.start'), icon: q.running ? 'stop' : 'play', action: () => (q.running ? window.api.stopQueue(q.id) : window.api.startQueue(q.id)) },
        { label: t('tool.scheduler'), icon: 'clock', action: () => openQueuesDialog(q.id) },
      ]);
    };
  });
  updateSpeed();
}

function updateSpeed() {
  let total = 0, active = 0;
  for (const it of state.items) {
    if (!['connecting', 'downloading', 'assembling'].includes(it.status)) continue;
    active++;
    const p = state.progress.get(it.id);
    total += (p && p.speed) || 0;
  }
  const el = document.getElementById('sideSpeed');
  if (el) el.innerHTML = active ? `${icon('download')}${formatSpeed(total) || ltr('0 KB/s')}` : '';
  $('#stats').textContent = active ? t('stats.active', { n: active }) : t('stats.items', { n: state.items.length });
}

// --- Liste ----------------------------------------------------------------------
function visibleItems() {
  const f = state.filter;
  let list = state.items.filter((it) => {
    if (f.kind === 'cat') return (it.category || 'general') === f.id;
    if (f.kind === 'unfinished') return it.status !== 'completed';
    if (f.kind === 'finished') return it.status === 'completed';
    if (f.kind === 'queue') return it.queue === f.id;
    return true;
  });
  const q = state.search.trim().toLocaleLowerCase(LANG);
  if (q) list = list.filter((it) => `${it.fileName} ${it.url} ${it.description}`.toLocaleLowerCase(LANG).includes(q));
  const { col, dir } = state.sort;
  const key = {
    name: (x) => (x.fileName || x.url).toLocaleLowerCase(LANG), size: (x) => x.size || 0, status: (x) => x.status,
    speed: (x) => (state.progress.get(x.id) || {}).speed || 0, eta: (x) => (state.progress.get(x.id) || {}).eta || 0,
    added: (x) => x.addedAt || 0, desc: (x) => x.description || '',
  }[col] || ((x) => x.addedAt);
  // Kuyruk görünümünde kuyruk sırası
  if (f.kind === 'queue') return list.sort((a, b) => (a.order || 0) - (b.order || 0));
  return list.sort((a, b) => { const ka = key(a), kb = key(b); return (ka > kb ? 1 : ka < kb ? -1 : 0) * dir; });
}

function listTitle() {
  const f = state.filter;
  if (f.kind === 'cat') { const c = ((state.settings && state.settings.categories) || []).find((x) => x.id === f.id); return c ? catLabel(c) : t('cat.general'); }
  if (f.kind === 'queue') { const q = state.queues.find((x) => x.id === f.id); return q ? queueName(q) : ''; }
  return t(`side.${f.kind}`);
}

function renderHead() {
  const cols = (state.settings && state.settings.columns) || Object.keys(COLS);
  $('#thead').innerHTML = cols.filter((c) => COLS[c]).map((c) => `<th data-col="${c}" style="${COLS[c].w ? `width:${COLS[c].w}` : ''}" class="${state.sort.col === c ? `sorted ${state.sort.dir > 0 ? 'asc' : 'desc'}` : ''}">${esc(COLS[c].label())}</th>`).join('');
  $('#thead').querySelectorAll('th').forEach((th) => {
    th.onclick = () => { const c = th.dataset.col; state.sort = { col: c, dir: state.sort.col === c ? -state.sort.dir : c === 'name' ? 1 : -1 }; renderHead(); renderList(); };
    th.oncontextmenu = (e) => { e.preventDefault(); columnsMenu(e.clientX, e.clientY); };
  });
}

function columnsMenu(x, y) {
  const cols = state.settings.columns;
  contextMenu(x, y, Object.keys(COLS).filter((c) => c !== 'name').map((c) => ({
    label: `${cols.includes(c) ? '✓ ' : '   '}${COLS[c].label()}`,
    action: async () => {
      const next = cols.includes(c) ? cols.filter((x2) => x2 !== c) : Object.keys(COLS).filter((k) => k === c || cols.includes(k));
      state.settings = await window.api.setSettings({ columns: next });
      renderHead(); renderList();
    },
  })));
}

function statusCell(it) {
  const p = state.progress.get(it.id);
  const scan = state.scans.get(it.id);
  if (it.status === 'completed') {
    const extra = scan === 'scanning' ? ` · ${t('scan.scanning')}` : scan === 'threat' ? ` · ${t('scan.threat')}` : '';
    return `<span class="st ok">${icon('check')}${esc(t('st.completed'))}${esc(extra)}</span>`;
  }
  if (it.status === 'error') return `<span class="st err" title="${esc(errText(it.error))}">${icon('x')}${esc(errText(it.error))}</span>`;
  const n = pct(it, p);
  const label = it.status === 'downloading' && n != null ? ltr(`${n}%`) : esc(t(`st.${it.status}`));
  const bar = n != null || it.status === 'downloading' ? `<div class="bar ${it.status}"><div style="width:${n || 0}%"></div></div>` : '';
  return `<div class="st-wrap"><span class="st ${it.status}">${label}</span>${bar}</div>`;
}

function cell(col, it) {
  const p = state.progress.get(it.id);
  switch (col) {
    case 'name': {
      const ic = it.kind === 'hls' || it.kind === 'dash' ? 'video' : CAT_ICONS[it.category] || 'file';
      return `<td class="c-name"><span class="fi">${icon(ic)}</span><span class="fn" title="${esc(it.url)}">${esc(it.fileName || it.url)}</span>${it.queue ? `<span class="q-chip">${esc(queueName(state.queues.find((q) => q.id === it.queue) || { id: it.queue }))}</span>` : ''}</td>`;
    }
    case 'size': return `<td class="num">${it.size ? formatSize(it.size) : p && p.estimatedSize ? `~${formatSize(p.estimatedSize)}` : ''}</td>`;
    case 'status': return `<td>${statusCell(it)}</td>`;
    case 'speed': return `<td class="num">${['downloading', 'connecting'].includes(it.status) && p ? formatSpeed(p.speed) : ''}</td>`;
    case 'eta': return `<td class="num">${it.status === 'downloading' && p ? formatEta(p.eta) : ''}</td>`;
    case 'added': return `<td class="muted">${esc(formatDate(it.addedAt))}</td>`;
    case 'desc': return `<td class="muted">${esc(it.description || '')}</td>`;
    default: return '<td></td>';
  }
}

function renderList() {
  $('#listTitle').textContent = listTitle();
  const cols = ((state.settings && state.settings.columns) || Object.keys(COLS)).filter((c) => COLS[c]);
  const items = visibleItems();
  const tb = $('#tbody');
  tb.innerHTML = items.map((it) => `<tr data-id="${it.id}" class="${state.selected.has(it.id) ? 'sel' : ''} s-${it.status}" draggable="true">${cols.map((c) => cell(c, it)).join('')}</tr>`).join('');
  $('#empty').classList.toggle('hidden', items.length > 0);
  $('#empty').innerHTML = state.items.length ? `<div>${esc(t('list.noMatch'))}</div>` : `<div class="empty-big">${icon('download')}</div><div class="empty-t">${esc(t('list.emptyTitle'))}</div><div>${esc(t('list.emptyHint'))}</div><button class="btn primary" id="emptyAdd">${icon('plus')}${esc(t('tool.add'))}</button>`;
  const ea = document.getElementById('emptyAdd');
  if (ea) ea.onclick = () => openAddDialog({});
  updateToolState();
  renderDetails();
}

// Yalnız değişen satırın hücrelerini günceller (ilerleme olaylarında tüm tabloyu yeniden çizmemek için)
function patchRow(id) {
  const tr = document.querySelector(`#tbody tr[data-id="${id}"]`);
  const it = state.items.find((x) => x.id === id);
  if (!tr || !it) return;
  const cols = ((state.settings && state.settings.columns) || Object.keys(COLS)).filter((c) => COLS[c]);
  tr.innerHTML = cols.map((c) => cell(c, it)).join('');
}

function selectRow(id, e) {
  const items = visibleItems();
  if (e && e.shiftKey && state.anchor) {
    const a = items.findIndex((x) => x.id === state.anchor), b = items.findIndex((x) => x.id === id);
    if (!(e.ctrlKey || e.metaKey)) state.selected.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (items[i]) state.selected.add(items[i].id);
  } else if (e && (e.ctrlKey || e.metaKey)) {
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    state.anchor = id;
  } else {
    state.selected = new Set([id]);
    state.anchor = id;
  }
  document.querySelectorAll('#tbody tr').forEach((tr) => tr.classList.toggle('sel', state.selected.has(tr.dataset.id)));
  updateToolState();
  renderDetails();
}

$('#tbody').addEventListener('mousedown', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  if (e.button === 2 && state.selected.has(tr.dataset.id)) return;
  selectRow(tr.dataset.id, e);
});
$('#tbody').addEventListener('dblclick', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const it = state.items.find((x) => x.id === tr.dataset.id);
  if (!it) return;
  if (it.status === 'completed') window.api.open(it.id);
  else window.api.progressWindow(it.id);
});
$('#tbody').addEventListener('contextmenu', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  e.preventDefault();
  rowMenu(e.clientX, e.clientY);
});
$('#tbody').addEventListener('dragstart', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  if (!state.selected.has(tr.dataset.id)) selectRow(tr.dataset.id);
  e.dataTransfer.setData('application/x-md-ids', JSON.stringify([...state.selected]));
  e.dataTransfer.effectAllowed = 'move';
});
$('#tableWrap').addEventListener('mousedown', (e) => {
  if (e.target === $('#tableWrap') || e.target.closest('.empty')) { state.selected.clear(); renderList(); }
});

function rowMenu(x, y) {
  const sel = [...state.selected].map((id) => state.items.find((it) => it.id === id)).filter(Boolean);
  if (!sel.length) return;
  const one = sel.length === 1 ? sel[0] : null;
  const ids = sel.map((s) => s.id);
  const done = one && one.status === 'completed';
  contextMenu(x, y, [
    done && { label: t('menu.open'), icon: 'open', action: () => window.api.open(one.id) },
    done && { label: t('menu.openWith'), icon: 'app', action: () => window.api.openWith(one.id) },
    one && { label: t('menu.reveal'), icon: 'folder', action: () => window.api.reveal(one.id) },
    done && '-',
    sel.some((s) => ['paused', 'error', 'queued'].includes(s.status)) && { label: t('menu.resume'), icon: 'play', action: () => window.api.start(ids) },
    sel.some((s) => ['connecting', 'downloading', 'queued'].includes(s.status)) && { label: t('menu.pause'), icon: 'pause', action: () => window.api.pause(ids) },
    one && one.status !== 'completed' && { label: t('menu.progress'), icon: 'gauge', action: () => window.api.progressWindow(one.id) },
    one && { label: t('menu.redownload'), icon: 'refresh', action: () => window.api.redownload(one.id) },
    one && one.status !== 'completed' && { label: t('menu.refreshUrl'), icon: 'link', action: () => openRefreshDialog(one) },
    '-',
    { label: t('menu.moveQueue'), icon: 'layers', action: () => moveQueueMenu(x, y, ids) },
    one && { label: t('menu.copyUrl'), icon: 'copy', action: () => { window.api.copyUrl(one.id); toast(t('menu.copied'), { type: 'ok' }); } },
    done && { label: t('menu.scan'), icon: 'shield', action: () => window.api.scan(one.id) },
    one && { label: t('menu.properties'), icon: 'info', action: () => openPropertiesDialog(one) },
    '-',
    { label: t('menu.delete'), icon: 'trash', danger: true, action: () => deleteSelected() },
  ].filter((v, i, arr) => v !== false && v !== null && v !== undefined && !(v === '-' && (i === 0 || arr[i - 1] === '-'))));
}

function moveQueueMenu(x, y, ids) {
  contextMenu(x, y, [
    ...state.queues.map((q) => ({ label: queueName(q), icon: 'layers', action: () => window.api.moveToQueue(ids, q.id) })),
    '-',
    { label: t('menu.noQueue'), icon: 'x', action: () => window.api.moveToQueue(ids, null) },
  ]);
}

async function deleteSelected() {
  const ids = [...state.selected];
  if (!ids.length) return;
  const anyDone = ids.some((id) => (state.items.find((x) => x.id === id) || {}).status === 'completed');
  const body = h(`<div class="stack"><div style="color:var(--text-2);line-height:1.5">${esc(t('del.message', { n: ids.length }))}</div>
    ${anyDone ? `<label class="check"><input type="checkbox" id="delFile"><span>${esc(t('del.alsoFile'))}</span></label>` : ''}</div>`);
  const r = await openModal({
    title: t('del.title'), iconName: 'trash', body,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('menu.delete'), cls: 'primary danger-primary', onClick: (m) => ({ file: !!(m.querySelector('#delFile') || {}).checked }) }],
  });
  if (!r) return;
  await window.api.remove(ids, r.file);
  state.selected.clear();
}

// --- Ayrıntı paneli: bölüm haritası ve bağlantılar -------------------------------
function segmentMap(it, p) {
  const size = (p && p.size) || it.size;
  if (p && p.segments && size) {
    return `<div class="segmap">${p.segments.map((s, i) => {
      const end = s.end == null ? size - 1 : s.end;
      const left = (s.start / size) * 100, width = ((end - s.start + 1) / size) * 100;
      const done = Math.min(100, ((s.pos - s.start) / Math.max(1, end - s.start + 1)) * 100);
      return `<div class="seg ${s.active ? 'active' : ''}" style="inset-inline-start:${left}%;width:${width}%"><div class="seg-fill c${i % 8}" style="width:${done}%"></div></div>`;
    }).join('')}</div>`;
  }
  const n = pct(it, p);
  return `<div class="segmap"><div class="seg" style="inset-inline-start:0;width:100%"><div class="seg-fill c0" style="width:${it.status === 'completed' ? 100 : n || 0}%"></div></div></div>`;
}

function renderDetails() {
  const el = $('#details');
  const one = state.selected.size === 1 ? state.items.find((x) => x.id === [...state.selected][0]) : null;
  el.classList.toggle('hidden', !one);
  if (!one) return;
  const p = state.progress.get(one.id);
  const res = one.resumable === true ? t('det.yes') : one.resumable === false ? t('det.no') : t('det.unknown');
  const conns = p && p.segments ? p.segments.filter((s) => s.active).length : 0;
  el.innerHTML = `
    <div class="det-head"><span class="fn">${esc(one.fileName || one.url)}</span>
      <span class="det-meta">${p ? formatProgress(p.received, p.size || one.size) : one.size ? formatSize(one.size) : ''}${p && p.speed ? ` · ${formatSpeed(p.speed)}` : ''}${p && p.eta != null && one.status === 'downloading' ? ` · ${formatEta(p.eta)}` : ''}</span></div>
    ${segmentMap(one, p)}
    <div class="det-grid">
      <span>${esc(t('det.url'))}</span><span class="path ltr" title="${esc(one.url)}">${esc(one.url)}</span>
      <span>${esc(t('det.saveTo'))}</span><span class="path ltr">${esc(one.dest || one.dir || '')}</span>
      <span>${esc(t('det.resumable'))}</span><span class="${one.resumable === false ? 'warn' : ''}">${esc(res)}${one.resumable === false && one.status !== 'completed' ? ` — ${esc(t('det.notResumableHint'))}` : ''}</span>
      <span>${esc(t('det.connections'))}</span><span>${conns ? ltr(`${conns} / ${(p.segments || []).length}`) : '—'}${p && p.segmentsTotal ? ` · ${ltr(t('det.segments', { done: p.segmentsDone, total: p.segmentsTotal }))}` : ''}</span>
    </div>`;
}

// --- Veri akışı -----------------------------------------------------------------
async function refreshAll() {
  const [items, queues, settings, acct] = await Promise.all([window.api.list(), window.api.queues(), window.api.getSettings(), window.api.accountState()]);
  state.items = items;
  state.queues = queues;
  state.settings = settings;
  state.account = acct;
  for (const it of items) if (it.progress) state.progress.set(it.id, it.progress);
  renderAccount();
  renderHead();
  renderSide();
  renderList();
}

window.api.onList((items) => {
  const ids = new Set(items.map((x) => x.id));
  for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
  for (const id of [...state.progress.keys()]) if (!ids.has(id)) state.progress.delete(id);
  state.items = items;
  renderSide();
  renderList();
});
window.api.onProgress((list) => {
  for (const p of list) {
    state.progress.set(p.id, p);
    const it = state.items.find((x) => x.id === p.id);
    if (it) { it.received = p.received; if (p.size) it.size = p.size; }
    patchRow(p.id);
  }
  updateSpeed();
  if (state.selected.size === 1 && list.some((p) => state.selected.has(p.id))) renderDetails();
});
window.api.onQueues((qs) => { state.queues = qs; renderSide(); renderList(); });
window.api.onSettings((s) => { state.settings = { ...state.settings, ...s }; updateToolState(); });
window.api.onScan(({ id, state: st }) => { state.scans.set(id, st); patchRow(id); if (st === 'clean') toast(t('scan.clean'), { type: 'ok' }); });
window.api.onWarning(({ code }) => toast(t(`warn.${code}`), { type: 'err', timeout: 7000 }));
window.api.onAddDialog((req) => openAddDialog(req));
window.api.onBatchDialog((req) => openBatchDialog(req));
window.api.onAccount((st) => { state.account = { ...state.account, ...st }; renderAccount(); });

// Kuyruk bitince eylem geri sayımı
window.api.onAfter(({ action, seconds }) => {
  const bar = $('#afterBar');
  let left = seconds;
  const draw = () => {
    bar.innerHTML = `${icon('clock')}<span>${esc(t(`after.countdown.${action}`, { n: left }))}</span>`;
    const b = h(`<button class="btn sm">${esc(t('common.cancel'))}</button>`);
    b.onclick = () => { clearInterval(iv); window.api.cancelAfter(); bar.classList.add('hidden'); };
    bar.appendChild(b);
  };
  bar.classList.remove('hidden');
  draw();
  const iv = setInterval(() => { left--; if (left <= 0) { clearInterval(iv); bar.classList.add('hidden'); return; } draw(); }, 1000);
});

// Güncelleme
window.api.onUpdateAvailable((u) => {
  const bar = $('#updateBar');
  bar.innerHTML = `${icon('up')}<span>${esc(t('update.available', { version: u.version }))}</span>`;
  const b = h(`<button class="btn sm primary">${icon('download')}${esc(t('update.install'))}</button>`);
  b.onclick = async () => { b.disabled = true; const r = await window.api.selfUpdate(); if (!r.ok) { b.disabled = false; toast(t('update.failed', { msg: r.code || '' }), { type: 'err' }); } };
  const x = h(`<button class="icon-btn" title="${esc(t('common.close'))}">${icon('x')}</button>`);
  x.onclick = () => bar.classList.add('hidden');
  bar.append(b, x);
  bar.classList.remove('hidden');
});
window.api.onUpdateProgress((p) => {
  const span = $('#updateBar span');
  if (!span) return;
  span.textContent = p.phase === 'install' ? t('update.installing') : t('update.downloading', { pct: p.total ? Math.floor((p.received / p.total) * 100) : 0 });
});

// --- Hesap rozeti -------------------------------------------------------------------
function renderAccount() {
  const acct = state.account || {};
  const b = $('#btnAccount');
  const name = (acct.user && acct.user.name) || acct.email || '?';
  b.querySelector('.ac-avatar').textContent = name.trim().slice(0, 1).toLocaleUpperCase(LANG);
  b.querySelector('.ac-name').textContent = (acct.user && acct.user.name) || acct.email || '';
  b.title = acct.email || '';
}
$('#btnAccount').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  contextMenu(r.left, r.bottom + 4, [
    { label: t('acct.myAccount'), icon: 'open', action: () => window.api.openWeb('account') },
    { label: t('set.account'), icon: 'user', action: () => openSettings('account') },
    '-',
    { label: t('acct.logoutAll'), icon: 'logout', danger: true, action: logout },
  ]);
};
async function logout() {
  const ok = await confirmBox(t('acct.logoutTitle'), esc(t('acct.logoutConfirm')), { okText: t('acct.logoutAll'), iconName: 'logout' });
  if (ok) window.api.logout();
}

// --- Klavye ve sürükle-bırak ----------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-backdrop')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Delete' && state.selected.size) deleteSelected();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); state.selected = new Set(visibleItems().map((x) => x.id)); renderList(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openAddDialog({}); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    window.api.clipboardLinks().then((links) => { if (links.length === 1) openAddDialog({ url: links[0] }); else if (links.length) openBatchDialog({ items: links.map((url) => ({ url })) }); });
  } else if (e.key === 'Enter' && state.selected.size === 1) {
    const it = state.items.find((x) => x.id === [...state.selected][0]);
    if (it && it.status === 'completed') window.api.open(it.id);
  }
});

// Pencereye bağlantı, metin ya da .ef2/.txt dosyası bırakma
let dragDepth = 0;
const isExternal = (e) => !e.dataTransfer.types.includes('application/x-md-ids');
window.addEventListener('dragenter', (e) => { if (!isExternal(e)) return; dragDepth++; $('#dropOverlay').classList.remove('hidden'); });
window.addEventListener('dragleave', (e) => { if (!isExternal(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.add('hidden'); } });
window.addEventListener('dragover', (e) => { if (isExternal(e)) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (!isExternal(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').classList.add('hidden');
  const files = [...e.dataTransfer.files].filter((f) => /\.(ef2|txt)$/i.test(f.name));
  if (files.length) { for (const f of files) window.api.importFile(window.api.filePath(f)); return; }
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (text) window.api.dropText(text);
});

// --- Başlangıç -------------------------------------------------------------------------
$('#btnSettings').innerHTML = icon('gear');
$('#btnSettings').title = t('set.title');
$('#btnSettings').onclick = () => openSettings();
$('#portal').appendChild(portalLink());
$('#searchIcon').innerHTML = icon('search');
$('#search').placeholder = t('list.search');
$('#search').oninput = (e) => { state.search = e.target.value; renderList(); };
$('#dropOverlay').innerHTML = `<div>${icon('download')}<span>${esc(t('drop.hint'))}</span></div>`;
renderTools();
refreshAll();
