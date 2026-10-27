'use strict';

// İletişim kutuları: Yeni indirme, Toplu indirme, Site yakalayıcı, Kuyruklar ve zamanlayıcı, Bağlantı yenileme, Özellikler.
// app.js'deki state, queueName, catLabel ve biçimlendiricileri kullanır.

function queueOptions(selected) {
  return `<option value="">${esc(t('add.noQueue'))}</option>` + state.queues.map((q) => `<option value="${esc(q.id)}" ${q.id === selected ? 'selected' : ''}>${esc(queueName(q))}</option>`).join('');
}

function categoryOptions(selected) {
  const cats = state.settings.categories || [];
  return `<option value="">${esc(t('add.autoCategory'))}</option>` + cats.map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('');
}

function bindDir(root, inputSel, btnSel) {
  root.querySelector(btnSel).onclick = async () => {
    const d = await window.api.pickDir(root.querySelector(inputSel).value);
    if (d) root.querySelector(inputSel).value = d;
  };
}

const isUrl = (s) => /^(https?|ftp):\/\/\S+$/i.test(String(s || '').trim());
const guessName = (url) => { try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); } catch { return ''; } };

// --- Yeni indirme ------------------------------------------------------------------
async function openAddDialog(req = {}) {
  const s = state.settings;
  const kindBadge = req.kind === 'hls' || req.kind === 'dash' ? `<span class="pill">${req.kind.toUpperCase()}</span>` : '';
  const body = h(`<div class="stack">
    <div class="field"><label>${esc(t('add.url'))} ${kindBadge}</label>
      <input class="input ltr" id="a-url" spellcheck="false" value="${esc(req.url || '')}" placeholder="https://"></div>
    <div class="row c-1-1">
      <div class="field"><label>${esc(t('add.fileName'))}</label><input class="input" id="a-name" spellcheck="false" value="${esc(req.filename || req.fileName || '')}" placeholder="${esc(t('add.autoName'))}"></div>
      <div class="field"><label>${esc(t('add.category'))}</label><select class="input" id="a-cat">${categoryOptions(req.category)}</select></div>
    </div>
    <div class="field"><label>${esc(t('add.saveTo'))}</label>
      <div class="path-row"><input class="input ltr" id="a-dir" spellcheck="false" value="${esc(req.dir || '')}" placeholder="${esc(t('add.autoDir'))}"><button class="btn sm" type="button" id="a-pick">${icon('folder')}${esc(t('common.browse'))}</button></div></div>
    <div class="row c-1-1">
      <div class="field"><label>${esc(t('add.queue'))}</label><select class="input" id="a-queue">${queueOptions(req.queue || '')}</select></div>
      <div class="field"><label>${esc(t('add.connections'))}</label><select class="input" id="a-conn">${[1, 2, 4, 8, 16, 24, 32].map((n) => `<option ${n === (s.connection.maxConnections || 8) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    <details class="more"><summary>${esc(t('add.advanced'))}</summary>
      <div class="stack" style="margin-top:10px">
        <div class="row c-1-1">
          <div class="field"><label>${esc(t('add.user'))}</label><input class="input" id="a-user" autocomplete="off" spellcheck="false"></div>
          <div class="field"><label>${esc(t('add.pass'))}</label><input class="input" id="a-pass" type="password" autocomplete="off"></div>
        </div>
        <div class="field"><label>${esc(t('add.referrer'))}</label><input class="input ltr" id="a-ref" spellcheck="false" value="${esc(req.referrer || '')}"></div>
        <div class="field"><label>${esc(t('add.desc'))}</label><input class="input" id="a-desc" value="${esc(req.title || '')}"></div>
      </div>
    </details>
    <div class="info-line" id="a-info">${req.size ? `${icon('info')}${esc(t('add.size', { size: '' }))}${formatSize(req.size)}` : ''}${req.cookies ? ` · ${esc(t('add.cookies'))}` : ''}</div>
  </div>`);
  const q = (x) => body.querySelector(x);
  bindDir(body, '#a-dir', '#a-pick');
  q('#a-url').addEventListener('input', () => {
    q('#a-url').classList.remove('invalid');
    if (!q('#a-name').dataset.touched) q('#a-name').placeholder = guessName(q('#a-url').value) || t('add.autoName');
  });
  q('#a-name').addEventListener('input', () => { q('#a-name').dataset.touched = '1'; });
  if (req.url) q('#a-name').placeholder = guessName(req.url) || t('add.autoName');

  const collect = (m, start, later) => {
    const url = q('#a-url').value.trim();
    if (!isUrl(url)) { q('#a-url').classList.add('invalid'); q('#a-url').focus(); return false; }
    const user = q('#a-user').value.trim();
    return {
      url, fileName: q('#a-name').value.trim(), dir: q('#a-dir').value.trim(), category: q('#a-cat').value || null,
      queue: later ? (q('#a-queue').value || 'main') : (q('#a-queue').value || null),
      connections: Number(q('#a-conn').value), referrer: q('#a-ref').value.trim(), description: q('#a-desc').value.trim(),
      auth: user ? { user, pass: q('#a-pass').value } : null,
      cookies: req.cookies || '', ua: req.ua || '', kind: req.kind, pageUrl: req.pageUrl || '', title: req.title || '', size: req.size || null,
      start,
    };
  };
  const res = await openModal({
    title: t('add.title'), iconName: 'download', width: 620, body,
    onMount: () => setTimeout(() => (req.url ? q('#a-name') : q('#a-url')).focus(), 30),
    buttons: [
      { label: t('common.cancel'), value: null, left: true },
      { label: t('add.later'), icon: 'layers', onClick: (m) => collect(m, false, true) },
      { label: t('add.start'), icon: 'download', cls: 'primary', onClick: (m) => collect(m, true, false) },
    ],
  });
  if (!res) return;
  const r = await window.api.add(res);
  if (!r.ok) return toast(errText(r.code), { type: 'err' });
  if (r.item.duplicate) {
    toast(t('add.duplicate'), { type: 'err' });
    state.selected = new Set([r.item.id]);
    renderList();
  } else if (!res.start) toast(t('add.queued', { queue: queueName(state.queues.find((x) => x.id === res.queue) || { id: res.queue }) }), { type: 'ok' });
}

// --- Toplu indirme (kalıp, pano, liste) -------------------------------------------
async function openBatchDialog({ items } = {}) {
  let list = (items || []).map((x) => ({ ...x, on: true }));
  const fromList = list.length > 0;
  const body = h(`<div class="stack">
    <div class="seg" id="b-mode">
      <button type="button" data-v="pattern">${icon('list')}${esc(t('batch.pattern'))}</button>
      <button type="button" data-v="paste">${icon('clipboard')}${esc(t('batch.paste'))}</button>
    </div>
    <div id="b-pattern" class="stack">
      <div class="field"><label>${esc(t('batch.patternUrl'))}</label><input class="input ltr" id="b-url" spellcheck="false" placeholder="https://example.com/dosya*.zip"></div>
      <div class="row c-4">
        <div class="field"><label>${esc(t('batch.from'))}</label><input class="input" id="b-from" value="1"></div>
        <div class="field"><label>${esc(t('batch.to'))}</label><input class="input" id="b-to" value="10"></div>
        <div class="field"><label>${esc(t('batch.width'))}</label><input class="input" id="b-width" type="number" min="0" max="10" value="0"></div>
        <div class="field"><label>${esc(t('batch.step'))}</label><input class="input" id="b-step" type="number" min="1" value="1"></div>
      </div>
      <small class="set-hint">${esc(t('batch.patternHint'))}</small>
    </div>
    <div id="b-paste" class="stack hidden">
      <textarea class="input ltr" id="b-text" rows="5" spellcheck="false" placeholder="${esc(t('batch.pasteHint'))}"></textarea>
    </div>
    <div class="b-list-head"><label class="check"><input type="checkbox" id="b-all" checked><span id="b-count"></span></label></div>
    <div class="b-list" id="b-list"></div>
    <div class="row c-1-1">
      <div class="field"><label>${esc(t('add.saveTo'))}</label>
        <div class="path-row"><input class="input ltr" id="b-dir" spellcheck="false" placeholder="${esc(t('add.autoDir'))}"><button class="btn sm" type="button" id="b-pick">${icon('folder')}</button></div></div>
      <div class="field"><label>${esc(t('add.queue'))}</label><select class="input" id="b-queue">${state.queues.map((qq) => `<option value="${esc(qq.id)}">${esc(queueName(qq))}</option>`).join('')}</select></div>
    </div>
  </div>`);
  const q = (x) => body.querySelector(x);
  bindDir(body, '#b-dir', '#b-pick');
  const draw = () => {
    q('#b-list').innerHTML = list.slice(0, 2000).map((x, i) => `<label class="b-row"><input type="checkbox" data-i="${i}" ${x.on ? 'checked' : ''}><span class="ltr">${esc(x.url)}</span></label>`).join('') || `<div class="empty-note">${esc(t('batch.none'))}</div>`;
    const n = list.filter((x) => x.on).length;
    q('#b-count').textContent = t('batch.count', { n, total: list.length });
    q('#b-all').checked = n === list.length && n > 0;
  };
  q('#b-list').addEventListener('change', (e) => { const i = Number(e.target.dataset.i); if (list[i]) list[i].on = e.target.checked; draw(); });
  q('#b-all').onchange = (e) => { list.forEach((x) => (x.on = e.target.checked)); draw(); };
  let mode = 'pattern';
  const setMode = (m) => {
    mode = m;
    body.querySelectorAll('#b-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
    q('#b-pattern').classList.toggle('hidden', m !== 'pattern');
    q('#b-paste').classList.toggle('hidden', m !== 'paste');
  };
  body.querySelectorAll('#b-mode button').forEach((b) => (b.onclick = () => { setMode(b.dataset.v); refresh(); }));
  const refresh = async () => {
    if (mode === 'pattern') {
      const pattern = q('#b-url').value.trim();
      if (!pattern) { list = []; return draw(); }
      const r = await window.api.expand({ pattern, from: q('#b-from').value.trim(), to: q('#b-to').value.trim(), width: q('#b-width').value, step: q('#b-step').value });
      list = r.ok ? r.urls.map((url) => ({ url, on: true })) : [];
      q('#b-url').classList.toggle('invalid', !r.ok);
    } else {
      const links = [...new Set((q('#b-text').value.match(/\b(?:https?|ftp):\/\/[^\s"'<>]+/gi) || []))];
      list = links.map((url) => ({ url, on: true }));
    }
    draw();
  };
  ['#b-url', '#b-from', '#b-to', '#b-width', '#b-step', '#b-text'].forEach((s) => q(s).addEventListener('input', refresh));
  if (fromList) {
    q('#b-mode').classList.add('hidden');
    q('#b-pattern').classList.add('hidden');
  } else setMode('pattern');
  draw();

  const go = (start) => () => {
    const chosen = list.filter((x) => x.on);
    if (!chosen.length) return false;
    return { items: chosen.map(({ on, ...x }) => x), queue: q('#b-queue').value, dir: q('#b-dir').value.trim(), start };
  };
  const res = await openModal({
    title: fromList ? t('batch.titleList') : t('batch.title'), iconName: 'list', width: 680, body,
    buttons: [
      { label: t('common.cancel'), value: null, left: true },
      { label: t('batch.addOnly'), icon: 'layers', onClick: go(false) },
      { label: t('batch.addStart'), icon: 'download', cls: 'primary', onClick: go(true) },
    ],
  });
  if (!res) return;
  const r = await window.api.addMany(res);
  toast(t('batch.added', { n: r.added }), { type: 'ok' });
}

// --- Site yakalayıcı -----------------------------------------------------------------
async function openGrabberDialog() {
  const body = h(`<div class="stack">
    <div class="field"><label>${esc(t('grab.url'))}</label><input class="input ltr" id="g-url" spellcheck="false" placeholder="https://example.com/dosyalar/"></div>
    <div class="row c-3">
      <div class="field"><label>${esc(t('grab.types'))}</label><input class="input ltr" id="g-exts" value="zip rar 7z pdf"></div>
      <div class="field"><label>${esc(t('grab.depth'))}</label><select class="input" id="g-depth">${[0, 1, 2, 3, 4, 5].map((n) => `<option ${n === 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field"><label>${esc(t('grab.scope'))}</label><select class="input" id="g-scope">
        <option value="host">${esc(t('grab.scopeHost'))}</option><option value="path">${esc(t('grab.scopePath'))}</option><option value="any">${esc(t('grab.scopeAny'))}</option></select></div>
    </div>
    <small class="set-hint">${esc(t('grab.hint'))}</small>
    <div class="g-status" id="g-status"></div>
    <div class="b-list-head"><label class="check"><input type="checkbox" id="g-all" checked><span id="g-count"></span></label></div>
    <div class="b-list" id="g-list"><div class="empty-note">${esc(t('grab.empty'))}</div></div>
  </div>`);
  const q = (x) => body.querySelector(x);
  let files = [];
  let running = false;
  const draw = () => {
    q('#g-list').innerHTML = files.map((f, i) => `<label class="b-row"><input type="checkbox" data-i="${i}" ${f.on ? 'checked' : ''}><span class="pill">${esc(f.ext)}</span><span class="ltr">${esc(f.url)}</span></label>`).join('') || `<div class="empty-note">${esc(t('grab.empty'))}</div>`;
    q('#g-count').textContent = t('batch.count', { n: files.filter((f) => f.on).length, total: files.length });
  };
  q('#g-list').addEventListener('change', (e) => { const i = Number(e.target.dataset.i); if (files[i]) files[i].on = e.target.checked; draw(); });
  q('#g-all').onchange = (e) => { files.forEach((f) => (f.on = e.target.checked)); draw(); };
  const off = window.api.onGrab((p) => { q('#g-status').innerHTML = `<span class="spin"></span>${esc(t('grab.progress', { pages: p.pages, files: p.files }))}`; });
  draw();

  const res = await openModal({
    title: t('grab.title'), iconName: 'spider', width: 700, body,
    buttons: [
      { label: t('common.cancel'), value: null, left: true, onClick: () => { window.api.grabStop(); return null; } },
      {
        label: t('grab.scan'), icon: 'search',
        onClick: async (m, btn) => {
          if (running) { window.api.grabStop(); return false; }
          const url = q('#g-url').value.trim();
          if (!isUrl(url)) { q('#g-url').classList.add('invalid'); return false; }
          running = true;
          btn.innerHTML = `${icon('stop')}${esc(t('grab.stop'))}`;
          const r = await window.api.grab({ url, exts: q('#g-exts').value, depth: q('#g-depth').value, scope: q('#g-scope').value });
          running = false;
          btn.innerHTML = `${icon('search')}${esc(t('grab.scan'))}`;
          if (!r.ok) { q('#g-status').textContent = errText(r.code); return false; }
          files = r.files.map((f) => ({ ...f, on: true }));
          q('#g-status').textContent = t('grab.done', { pages: r.pages, files: files.length }) + (r.skipped.length ? ` · ${t('grab.robots', { n: r.skipped.length })}` : '');
          draw();
          return false;
        },
      },
      {
        label: t('grab.download'), icon: 'download', cls: 'primary',
        onClick: () => { const chosen = files.filter((f) => f.on); if (!chosen.length) return false; return chosen; },
      },
    ],
  });
  off();
  if (!res || !res.length) return;
  openBatchDialog({ items: res.map((f) => ({ url: f.url, referrer: f.page })) });
}

// --- Kuyruklar ve zamanlayıcı ------------------------------------------------------------
async function openQueuesDialog(focusId) {
  let queues = JSON.parse(JSON.stringify(await window.api.queues()));
  let cur = focusId && queues.some((x) => x.id === focusId) ? focusId : queues[0].id;
  const dayNames = [1, 2, 3, 4, 5, 6, 0].map((d) => [d, new Date(2026, 9, 25 + d).toLocaleDateString(LANG, { weekday: 'short' })]);
  const body = h('<div class="set-wrap q-wrap"><nav class="set-nav" id="q-nav"></nav><div class="set-pages" id="q-page"></div></div>');
  const q = (x) => body.querySelector(x);
  const curQ = () => queues.find((x) => x.id === cur);

  function readForm() {
    const p = q('#q-page');
    const qq = curQ();
    if (!qq || !p.querySelector('#q-name')) return;
    if (qq.id !== 'main' || p.querySelector('#q-name').value.trim()) qq.name = p.querySelector('#q-name').value.trim();
    qq.maxParallel = Number(p.querySelector('#q-par').value) || 1;
    qq.after = p.querySelector('#q-after').value;
    qq.schedule = {
      enabled: p.querySelector('#q-sch').checked, start: p.querySelector('#q-start').value, stop: p.querySelector('#q-stopOn').checked ? p.querySelector('#q-stop').value : '',
      days: [...p.querySelectorAll('.days input:checked')].map((i) => Number(i.value)), once: p.querySelector('#q-once').checked,
    };
  }

  function draw() {
    q('#q-nav').innerHTML = queues.map((x) => `<button type="button" data-id="${esc(x.id)}" class="${x.id === cur ? 'on' : ''}">${icon('layers')}<span>${esc(queueName(x))}</span>${x.running ? '<span class="run-dot"></span>' : ''}</button>`).join('')
      + `<button type="button" id="q-new">${icon('plus')}<span>${esc(t('q.new'))}</span></button>`;
    q('#q-nav').querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => { readForm(); cur = b.dataset.id; draw(); }));
    q('#q-new').onclick = () => { readForm(); const id = `q${Date.now().toString(36)}`; queues.push({ id, name: t('q.newName', { n: queues.length }), maxParallel: 1, schedule: { enabled: false, start: '02:00', stop: '', days: [], once: false }, after: 'none' }); cur = id; draw(); };
    const x = curQ();
    const sch = x.schedule || {};
    const items = state.items.filter((it) => it.queue === x.id).sort((a, b) => (a.order || 0) - (b.order || 0));
    q('#q-page').innerHTML = `<section>
      <div class="row c-3-1">
        <div class="field"><label>${esc(t('q.name'))}</label><input class="input" id="q-name" value="${esc(x.name || '')}" placeholder="${esc(queueName(x))}"></div>
        <div class="field"><label>${esc(t('q.parallel'))}</label><input class="input" id="q-par" type="number" min="1" max="32" value="${x.maxParallel || 1}"></div>
      </div>
      <div class="section-title">${esc(t('q.schedule'))}</div>
      <label class="check"><input type="checkbox" id="q-sch" ${sch.enabled ? 'checked' : ''}><span>${esc(t('q.scheduleOn'))}</span></label>
      <div class="row c-1-1">
        <div class="field"><label>${esc(t('q.startAt'))}</label><input class="input" id="q-start" type="time" value="${esc(sch.start || '02:00')}"></div>
        <div class="field"><label class="check"><input type="checkbox" id="q-stopOn" ${sch.stop ? 'checked' : ''}><span>${esc(t('q.stopAt'))}</span></label><input class="input" id="q-stop" type="time" value="${esc(sch.stop || '07:00')}"></div>
      </div>
      <div class="days">${dayNames.map(([d, n]) => `<label class="day"><input type="checkbox" value="${d}" ${(sch.days || []).includes(d) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
      <small class="set-hint">${esc(t('q.daysHint'))}</small>
      <label class="check"><input type="checkbox" id="q-once" ${sch.once ? 'checked' : ''}><span>${esc(t('q.once'))}</span></label>
      <div class="field"><label>${esc(t('q.after'))}</label><select class="input" id="q-after">${['none', 'exit', 'sleep', 'hibernate', 'shutdown'].map((a) => `<option value="${a}" ${x.after === a ? 'selected' : ''}>${esc(t(`after.${a}`))}</option>`).join('')}</select></div>
      ${x.next ? `<div class="set-hint">${icon('clock')} ${esc(t('q.next', { when: new Date(x.next).toLocaleString(LANG, { weekday: 'long', hour: '2-digit', minute: '2-digit' }) }))}</div>` : ''}
      <div class="section-title">${esc(t('q.files', { n: items.length }))}</div>
      <div class="b-list q-files" id="q-files">${items.map((it) => `<div class="b-row" draggable="true" data-id="${it.id}"><span class="grip">⋮⋮</span><span>${esc(it.fileName || it.url)}</span><span class="muted">${esc(t(`st.${it.status}`))}</span></div>`).join('') || `<div class="empty-note">${esc(t('q.empty'))}</div>`}</div>
      <div class="acct-actions">
        <button class="btn sm" type="button" id="q-run">${icon(x.running ? 'stop' : 'play')}${esc(x.running ? t('q.stop') : t('q.start'))}</button>
        <span style="flex:1"></span>
        ${x.id !== 'main' ? `<button class="btn sm danger" type="button" id="q-del">${icon('trash')}${esc(t('q.delete'))}</button>` : ''}
      </div></section>`;
    q('#q-run').onclick = async () => { readForm(); await window.api.saveQueues(queues); if (x.running) await window.api.stopQueue(x.id); else await window.api.startQueue(x.id); queues = JSON.parse(JSON.stringify(await window.api.queues())); draw(); };
    const del = q('#q-del');
    if (del) del.onclick = () => { queues = queues.filter((y) => y.id !== x.id); cur = 'main'; draw(); };
    // Sürükleyerek kuyruk sırası
    let dragId = null;
    q('#q-files').querySelectorAll('.b-row').forEach((row) => {
      row.ondragstart = () => { dragId = row.dataset.id; };
      row.ondragover = (e) => e.preventDefault();
      row.ondrop = (e) => {
        e.preventDefault();
        const ids = [...q('#q-files').querySelectorAll('.b-row')].map((r) => r.dataset.id).filter((id) => id !== dragId);
        ids.splice(ids.indexOf(row.dataset.id), 0, dragId);
        window.api.reorder(x.id, ids).then(() => setTimeout(draw, 150));
      };
    });
  }
  draw();
  const res = await openModal({
    title: t('q.title'), iconName: 'clock', width: 760, body,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), cls: 'primary', onClick: () => { readForm(); return queues; } }],
  });
  if (!res) return;
  state.queues = await window.api.saveQueues(res);
  renderSide();
  toast(t('set.saved'), { type: 'ok' });
}

// --- Bağlantı yenileme ----------------------------------------------------------------
async function openRefreshDialog(it) {
  const body = h(`<div class="stack">
    <div class="set-hint">${esc(t('refresh.hint'))}</div>
    <div class="field"><label>${esc(t('refresh.old'))}</label><div class="path ltr">${esc(it.url)}</div></div>
    <div class="field"><label>${esc(t('refresh.new'))}</label><input class="input ltr" id="r-url" spellcheck="false" placeholder="https://"></div>
  </div>`);
  const res = await openModal({
    title: t('refresh.title'), iconName: 'link', width: 600, body,
    onMount: (m) => setTimeout(() => m.querySelector('#r-url').focus(), 30),
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('refresh.apply'), cls: 'primary', onClick: (m) => { const u = m.querySelector('#r-url').value.trim(); if (!isUrl(u)) { m.querySelector('#r-url').classList.add('invalid'); return false; } return u; } }],
  });
  if (!res) return;
  await window.api.refreshUrl(it.id, res);
  window.api.start([it.id]);
  toast(t('refresh.done'), { type: 'ok' });
}

// --- Özellikler ----------------------------------------------------------------------------
async function openPropertiesDialog(it) {
  const body = h(`<div class="stack">
    <div class="det-grid">
      <span>${esc(t('det.url'))}</span><span class="path ltr">${esc(it.url)}</span>
      ${it.finalUrl && it.finalUrl !== it.url ? `<span>${esc(t('prop.finalUrl'))}</span><span class="path ltr">${esc(it.finalUrl)}</span>` : ''}
      ${it.referrer ? `<span>${esc(t('add.referrer'))}</span><span class="path ltr">${esc(it.referrer)}</span>` : ''}
      <span>${esc(t('det.saveTo'))}</span><span class="path ltr">${esc(it.dest || it.dir || '—')}</span>
      <span>${esc(t('col.size'))}</span><span>${it.size ? formatSize(it.size) : '—'}</span>
      <span>${esc(t('col.status'))}</span><span>${esc(it.status === 'error' ? errText(it.error) : t(`st.${it.status}`))}</span>
      <span>${esc(t('col.added'))}</span><span>${esc(formatDate(it.addedAt))}</span>
      ${it.finishedAt ? `<span>${esc(t('prop.finished'))}</span><span>${esc(formatDate(it.finishedAt))}</span>` : ''}
      <span>${esc(t('det.resumable'))}</span><span>${esc(it.resumable === true ? t('det.yes') : it.resumable === false ? t('det.no') : t('det.unknown'))}</span>
    </div>
    <div class="row c-1-1">
      <div class="field"><label>${esc(t('add.category'))}</label><select class="input" id="p-cat">${categoryOptions(it.category)}</select></div>
      <div class="field"><label>${esc(t('prop.limit'))}</label><input class="input" id="p-limit" type="number" min="0" value="${it.speedLimit ? Math.round(it.speedLimit / 1024) : 0}"></div>
    </div>
    <div class="field"><label>${esc(t('add.desc'))}</label><input class="input" id="p-desc" value="${esc(it.description || '')}"></div>
  </div>`);
  const res = await openModal({
    title: t('prop.title'), iconName: 'info', width: 640, body,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), cls: 'primary', onClick: (m) => ({ category: m.querySelector('#p-cat').value || it.category, description: m.querySelector('#p-desc').value, speedLimit: Math.max(0, Number(m.querySelector('#p-limit').value) || 0) * 1024 }) }],
  });
  if (res) await window.api.update(it.id, res);
}
