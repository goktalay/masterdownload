'use strict';

// Ayarlar (Mastertool ortak iskeleti): Genel · Hesap · Bağlantı · İndirmeler · Kategoriler · Tarayıcı bütünleşmesi ·
// Hız sınırı · Kuyruklar ve zamanlayıcı · Hakkında. Kaydet'e basılınca uygulanır; tema anında önizlenir.

const OSS = [['Master Download', 'MIT'], ['Electron', 'MIT'], ['Chromium', 'BSD-3-Clause +'], ['Node.js', 'MIT'], ['@napi-rs/keyring', 'MIT']];

async function openSettings(startTab = 'general') {
  const [s, about] = await Promise.all([window.api.getSettings(), window.api.about()]);
  let appTheme = s.appTheme || 'system';
  const acct = state.account || {};
  let cats = JSON.parse(JSON.stringify(s.categories || []));
  const langOptions = Object.entries(I18N.LANGUAGES).map(([code, l]) => `<option value="${code}" ${code === LANG ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const tabs = [
    ['general', 'gear', t('set.general')],
    ['account', 'user', t('set.account')],
    ['connection', 'wifi', t('set.connection')],
    ['downloads', 'download', t('set.downloads')],
    ['categories', 'tag', t('set.categories')],
    ['browser', 'puzzle', t('set.browser')],
    ['limit', 'gauge', t('set.limit')],
    ['queues', 'clock', t('set.queues')],
    ['about', 'bolt', t('set.about')],
  ];
  const c = s.connection, d = s.downloads, b = s.browser, px = c.proxy || {};
  const chk = (id, on, label, hint = '') => `<label class="check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`;

  const body = h(`<div class="set-wrap">
    <nav class="set-nav">${tabs.map(([k, ic, label]) => `<button type="button" data-tab="${k}">${icon(ic)}<span>${esc(label)}</span></button>`).join('')}</nav>
    <div class="set-pages">
      <section data-page="general">
        <div class="field"><label>${esc(t('set.language'))}</label><select class="input" id="s-lang">${langOptions}</select>
          <small class="set-hint">${esc(t('set.languageHint'))}</small></div>
        <div class="field"><label>${esc(t('set.theme'))}</label>
          <div class="seg" id="s-theme">
            <button type="button" data-v="dark">${icon('moon')}${esc(t('set.themeDark'))}</button>
            <button type="button" data-v="light">${icon('sun')}${esc(t('set.themeLight'))}</button>
            <button type="button" data-v="system">${icon('monitor')}${esc(t('set.themeSystem'))}</button>
          </div></div>
        <div class="section-title">${esc(t('set.startup'))}</div>
        ${chk('s-login', about.openAtLogin, t('set.openAtLogin'), t('set.openAtLoginHint'))}
        ${chk('s-min', s.minimizeToTray, t('set.minTray'))}
        ${chk('s-close', s.closeToTray, t('set.closeTray'), t('set.closeTrayHint'))}
        <div class="section-title">${esc(t('set.updates'))}</div>
        ${chk('s-upd', s.checkUpdates, t('set.autoUpdate'))}
        <div><button class="btn sm" type="button" id="s-quit">${icon('power')}${esc(t('set.quit'))}</button></div>
      </section>

      <section data-page="account">
        <div class="acct-box">
          <div class="acct-who">${icon('user')}<span class="ltr">${esc(t('acct.signedInAs', { email: acct.email || '' }))}</span></div>
          <div class="set-hint">${esc(t('acct.ssoInfo'))}</div>
          <div class="acct-actions">
            <button class="btn sm" type="button" id="s-web">${icon('open')}${esc(t('acct.myAccount'))}</button>
            <span style="flex:1"></span>
            <button class="btn sm danger" type="button" id="s-logout">${icon('logout')}${esc(t('acct.logoutAll'))}</button>
          </div>
        </div>
      </section>

      <section data-page="connection">
        <div class="row c-1-1">
          <div class="field"><label>${esc(t('set.maxConn'))}</label><select class="input" id="s-conn">${[1, 2, 4, 6, 8, 12, 16, 24, 32].map((n) => `<option ${n === c.maxConnections ? 'selected' : ''}>${n}</option>`).join('')}</select>
            <small class="set-hint">${esc(t('set.maxConnHint'))}</small></div>
          <div class="field"><label>${esc(t('set.retries'))}</label><input class="input" id="s-retries" type="number" min="0" max="100" value="${c.retries}"></div>
        </div>
        <div class="field"><label>${esc(t('set.timeout'))}</label><input class="input" id="s-timeout" type="number" min="5" max="300" value="${c.timeoutSec}"></div>
        <div class="field"><label>${esc(t('set.ua'))}</label><input class="input ltr" id="s-ua" spellcheck="false" value="${esc(c.userAgent || '')}" placeholder="${esc(t('set.uaDefault'))}"></div>
        <div class="section-title">${esc(t('set.proxy'))}</div>
        <div class="seg" id="s-pmode">${['system', 'none', 'http', 'socks5'].map((m) => `<button type="button" data-v="${m}">${esc(t(`set.proxy.${m}`))}</button>`).join('')}</div>
        <div class="row c-3-1" id="s-pbox">
          <div class="field"><label>${esc(t('set.proxyHost'))}</label><input class="input ltr" id="s-phost" spellcheck="false" value="${esc(px.host || '')}"></div>
          <div class="field"><label>${esc(t('set.proxyPort'))}</label><input class="input" id="s-pport" type="number" value="${esc(px.port || '')}"></div>
          <div class="field"><label>${esc(t('add.user'))}</label><input class="input" id="s-puser" autocomplete="off" value="${esc(px.user || '')}"></div>
          <div class="field"><label>${esc(t('add.pass'))}</label><input class="input" id="s-ppass" type="password" autocomplete="off" value="${esc(px.pass || '')}"></div>
        </div>
      </section>

      <section data-page="downloads">
        <div class="field"><label>${esc(t('set.dir'))}</label>
          <div class="path-row"><input class="input ltr" id="s-dir" value="${esc(d.dir)}"><button class="btn sm" type="button" id="s-dirPick">${icon('folder')}</button></div>
          <small class="set-hint">${esc(t('set.dirHint'))}</small></div>
        <div class="field"><label>${esc(t('set.temp'))}</label>
          <div class="path-row"><input class="input ltr" id="s-temp" value="${esc(d.tempDir || '')}" placeholder="${esc(t('set.tempDefault'))}"><button class="btn sm" type="button" id="s-tempPick">${icon('folder')}</button></div></div>
        <div class="field"><label>${esc(t('set.duplicate'))}</label><select class="input" id="s-dup">${['rename', 'overwrite'].map((v) => `<option value="${v}" ${d.duplicate === v ? 'selected' : ''}>${esc(t(`set.dup.${v}`))}</option>`).join('')}</select></div>
        <div class="section-title">${esc(t('set.dialogs'))}</div>
        ${chk('s-startDlg', d.showStartDialog, t('set.startDialog'), t('set.startDialogHint'))}
        ${chk('s-progress', d.showProgress, t('set.progressWin'))}
        ${chk('s-complete', d.showComplete, t('set.completeWin'))}
        ${chk('s-notify', d.notify, t('set.notify'))}
        ${chk('s-sound', d.sound, t('set.sound'))}
        ${chk('s-resume', d.resumeOnStart, t('set.resumeOnStart'))}
        ${chk('s-clip', s.clipboard.watch, t('set.clipboard'), t('set.clipboardHint'))}
        <div class="section-title">${esc(t('set.security'))}</div>
        ${chk('s-motw', d.motw, t('set.motw'), t('set.motwHint'))}
        ${chk('s-scan', d.virusScan, t('set.scan'), t('set.scanHint'))}
        <div class="row c-1-1">
          <div class="field"><label>${esc(t('set.scanner'))}</label><select class="input" id="s-scanner"><option value="defender" ${d.scanner !== 'custom' ? 'selected' : ''}>Microsoft Defender</option><option value="custom" ${d.scanner === 'custom' ? 'selected' : ''}>${esc(t('set.scannerCustom'))}</option></select></div>
          <div class="field"><label>${esc(t('set.scannerArgs'))}</label><input class="input ltr" id="s-scanArgs" value="${esc(d.scannerArgs || '"[File]"')}"></div>
        </div>
        <div class="path-row" id="s-scanPathRow"><input class="input ltr" id="s-scanPath" value="${esc(d.scannerPath || '')}" placeholder="C:\\Program Files\\…\\scanner.exe"><button class="btn sm" type="button" id="s-scanPick">${icon('folder')}</button></div>
      </section>

      <section data-page="categories">
        <div class="set-hint">${esc(t('set.catHint'))}</div>
        <div class="cat-list" id="s-cats"></div>
        <div><button class="btn sm" type="button" id="s-catAdd">${icon('plus')}${esc(t('set.catAdd'))}</button></div>
      </section>

      <section data-page="browser">
        ${chk('s-bOn', b.enabled, t('set.bEnabled'), t('set.bEnabledHint'))}
        <div class="field"><label>${esc(t('set.bExts'))}</label><textarea class="input ltr" id="s-bExts" rows="3">${esc((b.exts || []).join(' '))}</textarea>
          <small class="set-hint">${esc(t('set.bExtsHint'))}</small></div>
        <div class="row c-1-1">
          <div class="field"><label>${esc(t('set.bMin'))}</label><input class="input" id="s-bMin" type="number" min="0" value="${b.minSizeKB || 0}"></div>
          <div class="field"><label>${esc(t('set.bSkip'))}</label><input class="input ltr" id="s-bSkip" value="${esc((b.skipSites || []).join(' '))}" placeholder="example.com"></div>
        </div>
        ${chk('s-bVideo', b.videoButton, t('set.bVideo'), t('set.bVideoHint'))}
        <div class="section-title">${esc(t('set.bInstall'))}</div>
        <div class="set-hint">${esc(t('set.bInstallHint'))}</div>
        <div class="acct-actions">
          <button class="btn sm" type="button" data-store="chrome">Chrome</button>
          <button class="btn sm" type="button" data-store="edge">Edge</button>
          <button class="btn sm" type="button" data-store="firefox">Firefox</button>
          <button class="btn sm" type="button" data-store="folder">${icon('folder')}${esc(t('set.bFolder'))}</button>
          <button class="btn sm" type="button" id="s-bReg">${icon('refresh')}${esc(t('set.bRegister'))}</button>
        </div>
        <small class="set-hint">${esc(t('set.bAlt'))}</small>
      </section>

      <section data-page="limit">
        ${chk('s-lOn', s.speedLimit.enabled, t('set.lEnabled'), t('set.lHint'))}
        <div class="field"><label>${esc(t('set.lValue'))}</label><input class="input" id="s-lVal" type="number" min="1" value="${s.speedLimit.kbps}"></div>
        <small class="set-hint">${esc(t('set.lPerFile'))}</small>
      </section>

      <section data-page="queues">
        <div class="set-hint">${esc(t('set.queuesHint'))}</div>
        <div><button class="btn sm" type="button" id="s-queues">${icon('clock')}${esc(t('q.title'))}</button></div>
      </section>

      <section data-page="about">
        <div class="about-head">
          <img src="../../build/icon.png" alt="">
          <div><div class="about-name">Master Download</div>
            <div class="about-ver">${esc(t('about.version', { version: about.version }))}</div></div>
        </div>
        <div class="set-hint">${esc(t('about.family'))}</div>
        <div class="acct-actions">
          <button class="btn sm" type="button" id="s-update">${icon('refresh')}${esc(t('about.checkUpdate'))}</button>
          <span class="about-update" id="s-update-result"></span>
        </div>
        <div class="section-title">${esc(t('about.licenses'))}</div>
        <div class="set-hint">${esc(t('about.licensesIntro'))}</div>
        <ul class="oss">${OSS.map(([n, l]) => `<li><span>${esc(n)}</span><span>${esc(l)}</span></li>`).join('')}</ul>
        <div class="acct-actions">
          <button class="btn sm" type="button" id="s-licenses">${icon('file')}${esc(t('about.chromium'))}</button>
          <span class="set-hint">Electron ${esc(about.electron)} · Chromium ${esc(about.chrome)}</span>
        </div>
      </section>
    </div>
  </div>`);

  const q = (sel) => body.querySelector(sel);
  const showTab = (k) => {
    body.querySelectorAll('.set-nav button').forEach((x) => x.classList.toggle('on', x.dataset.tab === k));
    body.querySelectorAll('.set-pages section').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== k));
  };
  body.querySelectorAll('.set-nav button').forEach((x) => (x.onclick = () => showTab(x.dataset.tab)));
  showTab(startTab);

  // Tema anında önizlenir; İptal'de eski temaya döner
  const originalTheme = appTheme;
  const setTheme = (v) => {
    appTheme = v;
    body.querySelectorAll('#s-theme button').forEach((x) => x.classList.toggle('on', x.dataset.v === v));
    window.api.setSettings({ appTheme: v });
  };
  body.querySelectorAll('#s-theme button').forEach((x) => (x.onclick = () => setTheme(x.dataset.v)));
  body.querySelectorAll('#s-theme button').forEach((x) => x.classList.toggle('on', x.dataset.v === appTheme));

  // Proxy kipi
  let pmode = px.mode || 'system';
  const setPmode = (m) => {
    pmode = m;
    body.querySelectorAll('#s-pmode button').forEach((x) => x.classList.toggle('on', x.dataset.v === m));
    q('#s-pbox').classList.toggle('disabled', m === 'system' || m === 'none');
    q('#s-pbox').querySelectorAll('input').forEach((i) => (i.disabled = m === 'system' || m === 'none'));
  };
  body.querySelectorAll('#s-pmode button').forEach((x) => (x.onclick = () => setPmode(x.dataset.v)));
  setPmode(pmode);

  // Klasörler ve tarayıcı programı
  bindDir(body, '#s-dir', '#s-dirPick');
  bindDir(body, '#s-temp', '#s-tempPick');
  q('#s-scanPick').onclick = async () => { const f = await window.api.pickFile(); if (f) q('#s-scanPath').value = f; };
  const scanRow = () => { q('#s-scanPathRow').classList.toggle('hidden', q('#s-scanner').value !== 'custom'); };
  q('#s-scanner').onchange = scanRow;
  scanRow();

  // Kategoriler
  const drawCats = () => {
    q('#s-cats').innerHTML = cats.map((cat, i) => `<div class="cat-row" data-i="${i}">
      <div class="cat-head">${icon(CAT_ICONS[cat.id] || 'tag')}<input class="input sm" data-k="name" value="${esc(cat.name || '')}" placeholder="${esc(t(`cat.${cat.id}`) !== `cat.${cat.id}` ? t(`cat.${cat.id}`) : t('set.catName'))}">
        ${['compressed', 'documents', 'music', 'programs', 'video'].includes(cat.id) ? '' : `<button class="icon-btn" data-del="${i}" title="${esc(t('menu.delete'))}">${icon('trash')}</button>`}</div>
      <input class="input sm ltr" data-k="exts" value="${esc((cat.exts || []).join(' '))}" placeholder="${esc(t('set.catExts'))}">
      <input class="input sm ltr" data-k="dir" value="${esc(cat.dir || '')}" placeholder="${esc(t('set.catDir'))}">
    </div>`).join('');
    q('#s-cats').querySelectorAll('[data-del]').forEach((x) => (x.onclick = () => { readCats(); cats.splice(Number(x.dataset.del), 1); drawCats(); }));
  };
  const readCats = () => {
    q('#s-cats').querySelectorAll('.cat-row').forEach((row) => {
      const cat = cats[Number(row.dataset.i)];
      cat.name = row.querySelector('[data-k="name"]').value.trim();
      cat.exts = [...new Set(row.querySelector('[data-k="exts"]').value.toLowerCase().split(/[\s,;]+/).map((x) => x.replace(/^\*?\./, '')).filter(Boolean))];
      cat.dir = row.querySelector('[data-k="dir"]').value.trim();
    });
  };
  q('#s-catAdd').onclick = () => { readCats(); cats.push({ id: `c${Date.now().toString(36)}`, name: '', exts: [], dir: '', sites: [] }); drawCats(); };
  drawCats();

  // Tarayıcı
  body.querySelectorAll('[data-store]').forEach((x) => (x.onclick = async () => {
    const r = await window.api.browserStore(x.dataset.store);
    if (r) toast(t('set.bCopied', { url: r }), { type: 'ok', timeout: 6000 });
  }));
  q('#s-bReg').onclick = async () => {
    const r = await window.api.registerBrowser();
    toast(r.ok ? t('set.bRegistered') : t('set.bRegisterDev'), { type: r.ok ? 'ok' : 'err' });
  };

  q('#s-quit').onclick = () => window.api.quit();
  q('#s-web').onclick = () => window.api.openWeb('account');
  q('#s-logout').onclick = logout;
  q('#s-queues').onclick = () => openQueuesDialog();
  q('#s-update').onclick = async () => {
    const out = q('#s-update-result');
    out.className = 'about-update';
    out.textContent = t('about.checking');
    const r = await window.api.checkUpdate();
    if (!r.ok) { out.classList.add('err'); out.textContent = t('about.checkFailed', { msg: r.message || r.code }); return; }
    if (r.newer) { out.classList.add('new'); out.textContent = t('update.available', { version: r.latest }); } else { out.classList.add('ok'); out.textContent = t('about.upToDate'); }
  };
  q('#s-licenses').onclick = () => window.api.openLicenses();

  const words = (v) => v.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const res = await openModal({
    title: t('set.title'), iconName: 'gear', width: 820, body,
    buttons: [
      { label: t('common.cancel'), value: null },
      {
        label: t('common.save'), cls: 'primary',
        onClick: () => {
          readCats();
          return {
            appTheme, language: q('#s-lang').value, openAtLogin: q('#s-login').checked, minimizeToTray: q('#s-min').checked,
            closeToTray: q('#s-close').checked, checkUpdates: q('#s-upd').checked,
            connection: {
              maxConnections: Number(q('#s-conn').value), retries: Math.max(0, Number(q('#s-retries').value) || 0),
              timeoutSec: Math.max(5, Number(q('#s-timeout').value) || 30), userAgent: q('#s-ua').value.trim(),
              proxy: { mode: pmode, host: q('#s-phost').value.trim(), port: q('#s-pport').value.trim(), user: q('#s-puser').value.trim(), pass: q('#s-ppass').value },
            },
            downloads: {
              dir: q('#s-dir').value.trim() || s.defaults.downloadsDir, tempDir: q('#s-temp').value.trim(), duplicate: q('#s-dup').value,
              showStartDialog: q('#s-startDlg').checked, showProgress: q('#s-progress').checked, showComplete: q('#s-complete').checked,
              notify: q('#s-notify').checked, sound: q('#s-sound').checked, resumeOnStart: q('#s-resume').checked,
              motw: q('#s-motw').checked, virusScan: q('#s-scan').checked, scanner: q('#s-scanner').value,
              scannerPath: q('#s-scanPath').value.trim(), scannerArgs: q('#s-scanArgs').value.trim() || '"[File]"',
            },
            clipboard: { watch: q('#s-clip').checked },
            categories: cats,
            browser: {
              enabled: q('#s-bOn').checked, exts: [...new Set(words(q('#s-bExts').value).map((x) => x.replace(/^\*?\./, '')))],
              minSizeKB: Math.max(0, Number(q('#s-bMin').value) || 0), skipSites: words(q('#s-bSkip').value), videoButton: q('#s-bVideo').checked,
            },
            speedLimit: { enabled: q('#s-lOn').checked, kbps: Math.max(1, Number(q('#s-lVal').value) || 1024) },
          };
        },
      },
    ],
  });
  if (!res) {
    if (appTheme !== originalTheme) window.api.setSettings({ appTheme: originalTheme });
    return;
  }
  const langChanged = res.language !== LANG;
  state.settings = await window.api.setSettings(res);
  if (!langChanged) {
    toast(t('set.saved'), { type: 'ok' });
    renderSide();
    renderList();
    updateToolState();
  }
}
