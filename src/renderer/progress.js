'use strict';

// İndirme ilerleme penceresi (IDM'deki gibi): yüzde, hız, kalan süre, sürdürme desteği, bölüm haritası,
// bağlantı tablosu, indirme başına hız sınırı; bitince Aç / Klasörü aç / Kapat.

const $ = (s) => document.querySelector(s);
const ID = new URLSearchParams(location.search).get('id');
let item = null;
let last = null;
let closeWhenDone = false;

const speed = (bps) => (bps ? ltr(bps >= 1048576 ? `${(bps / 1048576).toLocaleString(LANG, { maximumFractionDigits: 2 })} MB/s` : `${Math.round(bps / 1024)} KB/s`) : '—');
function eta(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  if (sec < 60) return ltr(t('time.sec', { n: Math.max(1, Math.round(sec)) }));
  if (sec < 3600) return ltr(t('time.min', { m: Math.floor(sec / 60), s: Math.round(sec % 60) }));
  return ltr(t('time.hour', { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60) }));
}
const errText = (code) => (t(`err.${code}`) !== `err.${code}` ? t(`err.${code}`) : t('err.generic', { code }));

function render() {
  if (!item) return;
  const p = last || item.progress || {};
  const size = p.size || item.size;
  const rec = p.received != null ? p.received : item.received;
  document.title = `${item.status === 'completed' ? '100%' : size ? `${Math.floor((rec / size) * 100)}%` : ''} ${item.fileName || ''} — Master Download`;
  $('#name').textContent = item.fileName || item.url;
  $('#url').textContent = item.url;
  $('#ic').innerHTML = icon(item.kind === 'hls' || item.kind === 'dash' ? 'video' : 'download');
  let pct = size ? Math.min(100, Math.floor((rec / size) * 100)) : p.segmentsTotal ? Math.floor((p.segmentsDone / p.segmentsTotal) * 100) : null;
  if (item.status === 'completed') pct = 100;
  $('#pct').textContent = pct == null ? '' : `${pct}%`;
  $('#bar').style.width = `${pct || 0}%`;
  const st = $('#status');
  st.className = `pw-status ${item.status === 'error' ? 'err' : item.status === 'completed' ? 'ok' : ''}`;
  st.textContent = item.status === 'error' ? errText(item.error) : t(`st.${item.status}`);
  const res = item.resumable === true ? t('det.yes') : item.resumable === false ? t('det.no') : t('det.unknown');
  $('#grid').innerHTML = `
    <span>${esc(t('pw.size'))}</span><span>${size ? formatSize(size) : '—'}</span>
    <span>${esc(t('pw.downloaded'))}</span><span>${formatProgress(rec || 0, size)}</span>
    <span>${esc(t('pw.speed'))}</span><span>${item.status === 'downloading' ? speed(p.speed) : '—'}</span>
    <span>${esc(t('pw.eta'))}</span><span>${item.status === 'downloading' ? eta(p.eta) : '—'}</span>
    <span>${esc(t('det.resumable'))}</span><span class="${item.resumable === false ? 'warn' : ''}">${esc(res)}</span>
    <span>${esc(t('det.connections'))}</span><span>${p.segments ? ltr(`${p.segments.filter((s) => s.active).length}`) : p.connections != null ? ltr(String(p.connections)) : '—'}</span>`;
  // Bölüm haritası ve bağlantı tablosu
  $('#mapTitle').textContent = p.segmentsTotal ? t('det.segments', { done: p.segmentsDone, total: p.segmentsTotal }) : t('pw.map');
  if (p.segments && size) {
    $('#map').innerHTML = p.segments.map((s, i) => {
      const end = s.end == null ? size - 1 : s.end;
      const done = Math.min(100, ((s.pos - s.start) / Math.max(1, end - s.start + 1)) * 100);
      return `<div class="seg" style="inset-inline-start:${(s.start / size) * 100}%;width:${((end - s.start + 1) / size) * 100}%"><div class="seg-fill c${i % 8}" style="width:${done}%"></div></div>`;
    }).join('');
    $('#conns').innerHTML = `<table><thead><tr><th>#</th><th>${esc(t('pw.range'))}</th><th>${esc(t('pw.downloaded'))}</th><th>${esc(t('col.status'))}</th></tr></thead><tbody>${p.segments.map((s, i) => {
      const end = s.end == null ? size - 1 : s.end;
      return `<tr><td><span class="dot c${i % 8}"></span>${i + 1}</td><td>${formatSize(s.start)} – ${formatSize(end + 1)}</td><td>${formatSize(s.pos - s.start)}</td><td>${esc(s.pos > end ? t('pw.segDone') : s.active ? t('pw.segActive') : t('pw.segWait'))}</td></tr>`;
    }).join('')}</tbody></table>`;
  } else {
    $('#map').innerHTML = `<div class="seg" style="inset-inline-start:0;width:100%"><div class="seg-fill c0" style="width:${pct || 0}%"></div></div>`;
    $('#conns').innerHTML = p.segmentsTotal ? `<div class="empty-note">${esc(t('det.segments', { done: p.segmentsDone, total: p.segmentsTotal }))}</div>` : '';
  }
  renderFoot();
}

let footState = '';
function renderFoot() {
  const key = item.status === 'completed' ? 'done' : ['paused', 'error'].includes(item.status) ? 'stopped' : 'running';
  if (key === footState) return;
  footState = key;
  const f = $('#foot');
  f.innerHTML = '';
  const btn = (label, ic, fn, cls = '') => { const b = h(`<button class="btn sm ${cls}">${icon(ic)}${esc(label)}</button>`); b.onclick = fn; f.appendChild(b); return b; };
  if (key === 'done') {
    if (closeWhenDone) return window.api.closeWindow();
    btn(t('pw.open'), 'open', () => { window.api.open(ID); window.api.closeWindow(); }, 'primary');
    btn(t('menu.openWith'), 'app', () => window.api.openWith(ID));
    btn(t('pw.openFolder'), 'folder', () => { window.api.reveal(ID); window.api.closeWindow(); });
    f.appendChild(h('<span class="spacer"></span>'));
    btn(t('common.close'), 'x', () => window.api.closeWindow());
    return;
  }
  const lim = h(`<label class="check"><input type="checkbox" id="limOn" ${item.speedLimit ? 'checked' : ''}><span>${esc(t('pw.limit'))}</span></label>`);
  const val = h(`<input class="input" id="limVal" type="number" min="1" value="${item.speedLimit ? Math.round(item.speedLimit / 1024) : 512}" title="KB/s">`);
  const apply = () => window.api.update(ID, { speedLimit: lim.querySelector('input').checked ? Math.max(1, Number(val.value) || 512) * 1024 : 0 });
  lim.querySelector('input').onchange = apply;
  val.onchange = apply;
  f.append(lim, val, h('<span class="set-hint">KB/s</span>'));
  const cw = h(`<label class="check"><input type="checkbox" ${closeWhenDone ? 'checked' : ''}><span>${esc(t('pw.closeWhenDone'))}</span></label>`);
  cw.querySelector('input').onchange = (e) => { closeWhenDone = e.target.checked; };
  f.append(cw, h('<span class="spacer"></span>'));
  if (key === 'running') btn(t('menu.pause'), 'pause', () => window.api.pause([ID]));
  else btn(t('menu.resume'), 'play', () => window.api.start([ID]), 'primary');
  btn(t('pw.hide'), 'x', () => window.api.closeWindow());
}

window.api.onPwProgress((p) => { last = p; if (item && p.size) item.size = p.size; render(); });
window.api.onPwState((it) => { item = { ...item, ...it }; render(); });
window.api.onList((list) => {
  const it = list.find((x) => x.id === ID);
  if (!it) return window.api.closeWindow();
  item = it;
  render();
});
window.api.get(ID).then((it) => { item = it; if (item) render(); });
