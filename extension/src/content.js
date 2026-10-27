/* Master Download eklentisi — içerik betiği (tüm çerçevelerde, document_start).
 * - Alt/Ctrl durumunu arka plana bildirir (Alt: yakalamayı atla, Ctrl: zorla yakala).
 * - Ctrl ile tıklanan dosya bağlantısını doğrudan Master Download'a verir.
 * - Sağ tık "Tüm bağlantıları indir" için a[href] listesini toplar.
 * - Videonun sağ üst köşesinde "⬇ İndir" rozeti ve algılanan akışlar listesi.
 *   Bilinen DRM'li/indirmeyi yasaklayan sitelerde ve sayfada EME (şifreli medya) kullanılıyorsa gösterilmez. */
(function () {
  'use strict';
  if (window.__mdContentLoaded) return;
  window.__mdContentLoaded = true;

  const B = globalThis.browser || globalThis.chrome;
  const R = globalThis.MDRules;
  if (!B || !B.runtime || !R) return;

  const t = (k, s) => (B.i18n && B.i18n.getMessage(k, s)) || k;
  const send = (msg) => {
    try { return Promise.resolve(B.runtime.sendMessage(msg)).catch(() => null); } catch (e) { return Promise.resolve(null); }
  };

  let settings = R.normalizeSettings({});
  try {
    Promise.resolve(B.storage.local.get('settings')).then((o) => { settings = R.normalizeSettings(o && o.settings); refresh(); }).catch(() => {});
    B.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.settings) { settings = R.normalizeSettings(ch.settings.newValue); refresh(); }
    });
  } catch (e) { /* depolama yoksa varsayılanlar */ }

  const host = location.hostname;
  const siteBlocked = R.isBlockedSite(host);
  let eme = false;

  // ------------------------------------------------------------ değiştirici tuşlar
  const modState = { alt: false, ctrl: false };
  function pushMods(alt, ctrl) {
    if (alt === modState.alt && ctrl === modState.ctrl) return;
    modState.alt = alt; modState.ctrl = ctrl;
    send({ type: 'mod', alt, ctrl });
  }
  const onKey = (e) => {
    // Alt'ın keyup olayında e.altKey zaten false'tur; doğrudan olay bayrakları kullanılır
    if (e.key === 'Alt' || e.key === 'Control' || e.key === 'AltGraph') pushMods(e.altKey, e.ctrlKey);
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', () => pushMods(false, false), true);

  // Sayfa adresi gibi görünen (indirilebilir dosya olmayan) uzantılar
  const PAGE_EXTS = ['html', 'htm', 'xhtml', 'shtml', 'php', 'asp', 'aspx', 'jsp', 'jspx', 'cfm', 'cgi', 'pl', 'do', 'action'];
  function looksLikeFile(a) {
    if (a.hasAttribute('download')) return true;
    const e = R.extOf(a.href);
    return !!e && PAGE_EXTS.indexOf(e) < 0;
  }

  document.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const p = R.parseUrl(a.href);
    if (!p || R.CAPTURE_PROTOCOLS.indexOf(p.protocol) < 0) return;
    send({ type: 'click', alt: e.altKey, ctrl: e.ctrlKey, url: a.href, pageUrl: location.href });
    if (e.ctrlKey && !e.altKey && !e.shiftKey && looksLikeFile(a) && !R.isSkippedSite(p.hostname, settings)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      send({ type: 'forceAdd', url: a.href, filename: a.getAttribute('download') || '' });
    }
  }, true);

  // ------------------------------------------------------------ bağlantı toplama
  function collectLinks(selectionOnly) {
    const sel = window.getSelection();
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      if (selectionOnly && !(sel && sel.rangeCount && sel.containsNode(a, true))) continue;
      out.push({ url: a.href, filename: a.getAttribute('download') || '' });
      if (out.length >= 5000) break;
    }
    return out;
  }

  // ------------------------------------------------------------ EME (şifreli medya) algılama
  function markEme() {
    if (eme) return;
    eme = true;
    hideBadge();
    send({ type: 'eme' });
  }
  document.addEventListener('encrypted', markEme, true);

  // ------------------------------------------------------------ video rozeti
  let ui = null;           // { host, root, badge, panel }
  let current = null;      // rozetin bağlı olduğu medya öğesi
  let hideTimer = null;
  let lastCtxMedia = null; // son sağ tıklanan video/ses

  const allowedHere = () => settings.videoButton && !siteBlocked && !eme && !R.isSkippedSite(host, settings);

  function buildUi() {
    if (ui) return ui;
    const h = document.createElement('md-download-ui');
    h.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
    const root = h.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host { all: initial; }
      .wrap { position: fixed; font: 12px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 999px; cursor: pointer;
        background: rgba(255,255,255,.92); color: #1e1b4b; border: 1px solid rgba(99,102,241,.45);
        box-shadow: 0 2px 10px rgba(0,0,0,.25); user-select: none; white-space: nowrap; }
      .badge:hover { background: #fff; border-color: #6366f1; }
      .badge b { background: linear-gradient(180deg,#22d3ee,#6366f1); -webkit-background-clip: text; background-clip: text; color: transparent; font-size: 13px; }
      .panel { position: absolute; right: 0; top: 30px; min-width: 260px; max-width: 420px; max-height: 300px; overflow: auto;
        background: #fff; color: #0f172a; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.3); padding: 4px; }
      .panel[hidden] { display: none; }
      .item { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 6px 8px; border-radius: 7px; cursor: pointer; }
      .item:hover { background: #eef2ff; }
      .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
      .meta { color: #64748b; font-size: 11px; grid-column: 1 / span 2; }
      .kind { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 6px; background: #e0f2fe; color: #0369a1; align-self: center; }
      .msg { padding: 8px 10px; color: #475569; }
      .ok { color: #047857; } .err { color: #b91c1c; }
      @media (prefers-color-scheme: dark) {
        .badge { background: rgba(15,23,42,.9); color: #e2e8f0; border-color: rgba(34,211,238,.45); }
        .badge:hover { background: #0f172a; border-color: #22d3ee; }
        .panel { background: #0f172a; color: #e2e8f0; border-color: #334155; }
        .item:hover { background: #1e293b; }
        .meta, .msg { color: #94a3b8; }
        .kind { background: #164e63; color: #a5f3fc; }
        .ok { color: #34d399; } .err { color: #f87171; }
      }
    </style>
    <div class="wrap"><span class="badge" role="button" tabindex="0"><b>⬇</b><span class="lbl"></span></span><div class="panel" hidden></div></div>`;
    const wrap = root.querySelector('.wrap');
    const badge = root.querySelector('.badge');
    const panel = root.querySelector('.panel');
    root.querySelector('.lbl').textContent = t('btnDownload');
    badge.title = t('btnDownloadTitle');
    const stop = (e) => { e.stopPropagation(); };
    for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu']) wrap.addEventListener(ev, stop);
    badge.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); togglePanel(); });
    badge.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); } });
    wrap.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    wrap.addEventListener('mouseleave', () => scheduleHide());
    (document.documentElement || document).appendChild(h);
    ui = { host: h, root, wrap, badge, panel };
    return ui;
  }

  function position() {
    if (!ui || !current) return;
    const r = current.getBoundingClientRect();
    if (!current.isConnected || r.width < 2 || r.height < 2) { hideBadge(); return; }
    const top = Math.max(4, r.top + 8);
    ui.wrap.style.top = `${top}px`;
    ui.wrap.style.left = '';
    ui.wrap.style.right = `${Math.max(4, document.documentElement.clientWidth - r.right + 8)}px`;
  }

  function showBadge(media) {
    if (!allowedHere()) return;
    buildUi();
    if (current !== media) { ui.panel.hidden = true; current = media; }
    ui.host.style.display = '';
    position();
    clearTimeout(hideTimer);
  }

  function hideBadge() {
    clearTimeout(hideTimer);
    if (ui) { ui.panel.hidden = true; ui.host.style.display = 'none'; }
    current = null;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (ui && ui.panel.hidden) hideBadge(); }, 2500);
  }

  function mediaList() {
    return Array.from(document.querySelectorAll('video'));
  }

  // Oynatıcı üstünde katmanlar olabileceğinden hedef öğeye değil, imleç konumuna bakılır
  function videoAt(x, y) {
    for (const v of mediaList()) {
      const r = v.getBoundingClientRect();
      if (r.width >= 160 && r.height >= 90 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
    }
    return null;
  }

  function checkEme() {
    for (const v of mediaList()) if (v.mediaKeys) { markEme(); return true; }
    return false;
  }

  let moveQueued = false;
  document.addEventListener('mousemove', (e) => {
    if (moveQueued || !allowedHere()) return;
    moveQueued = true;
    const x = e.clientX; const y = e.clientY;
    requestAnimationFrame(() => {
      moveQueued = false;
      if (checkEme()) return;
      const v = videoAt(x, y);
      if (v) showBadge(v);
      else if (current) scheduleHide();
    });
  }, { capture: true, passive: true });
  window.addEventListener('scroll', () => position(), { capture: true, passive: true });
  window.addEventListener('resize', () => position(), { passive: true });
  document.addEventListener('fullscreenchange', () => hideBadge());

  document.addEventListener('contextmenu', (e) => {
    const el = e.target;
    lastCtxMedia = el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') ? el : videoAt(e.clientX, e.clientY);
  }, true);

  function refresh() {
    if (!allowedHere()) hideBadge();
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function kindLabel(k) {
    return k === 'hls' ? 'HLS' : k === 'dash' ? 'DASH' : t('kindFile');
  }

  function showMessage(text, cls) {
    ui.panel.textContent = '';
    ui.panel.appendChild(el('div', `msg ${cls || ''}`, text));
    ui.panel.hidden = false;
  }

  async function openPanel() {
    buildUi();
    showMessage(t('loading'));
    const m = await send({ type: 'getMedia' });
    if (!m || m.blocked || m.eme) { showMessage(t('errBlocked'), 'err'); return; }
    const items = (m.items || []).slice();
    // Oynatıcının doğrudan dosya kaynağı (blob: değilse) listede yoksa eklenir
    const src = current && (current.currentSrc || current.src);
    const p = src && R.parseUrl(src);
    if (p && (p.protocol === 'http:' || p.protocol === 'https:') && !R.isBlockedSite(p.hostname) && !items.some((x) => x.url === src)) {
      items.unshift({ url: src, kind: R.detectKind(src, '') || 'file', mime: '', size: 0, filename: R.fileNameOf(src) });
    }
    if (!items.length) { showMessage(t('noMedia')); return; }
    ui.panel.textContent = '';
    for (const it of items) {
      const row = el('div', 'item');
      row.title = it.url;
      row.appendChild(el('span', 'name', it.filename || R.fileNameOf(it.url) || R.hostOf(it.url)));
      row.appendChild(el('span', 'kind', kindLabel(it.kind)));
      const meta = [it.mime, R.formatSize(it.size), R.hostOf(it.url)].filter(Boolean).join(' · ');
      row.appendChild(el('span', 'meta', meta));
      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        showMessage(t('sending'));
        const res = await send({ type: 'sendMedia', item: it });
        if (res && res.ok) showMessage(t('sentOk'), 'ok');
        else showMessage(res && res.code === 'blocked' ? t('errBlocked') : t('errAppUnavailable'), 'err');
        setTimeout(() => { if (ui) { ui.panel.hidden = true; scheduleHide(); } }, 2200);
      });
      ui.panel.appendChild(row);
    }
    ui.panel.hidden = false;
  }

  function togglePanel() {
    if (!ui) return;
    if (!ui.panel.hidden) { ui.panel.hidden = true; return; }
    openPanel();
  }

  // Panelin dışına tıklanınca kapat
  document.addEventListener('mousedown', (e) => {
    if (ui && !ui.panel.hidden && e.composedPath().indexOf(ui.host) < 0) ui.panel.hidden = true;
  }, true);

  // ------------------------------------------------------------ arka plandan gelen istekler
  B.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'collectLinks') { sendResponse(collectLinks(!!msg.selection)); return false; }
    if (msg.type === 'showChooser') {
      checkEme();
      const target = lastCtxMedia || mediaList()[0];
      const r = target && target.getBoundingClientRect();
      if (!target || !allowedHere() || r.width < 60 || r.height < 20) { sendResponse(false); return false; }
      showBadge(target);
      openPanel();
      sendResponse(true);
      return false;
    }
    return false;
  });
}());
