'use strict';

// Mastertool hesabı ve cihazdaki ortak oturum (sözleşme v1.1, mastertool.download docs/mastertool-api.md).
// Convert Master'daki account.js'in Master Download uyarlaması: uçlar /api/md/*, senkron kütüphanesi yok.
//
//   giriş       → prelogin → PBKDF2 → POST /api/md/auth/login {sso:true} → uygulama token'ı + sso_token
//                 → ortak kimliği yaz (Windows Kimlik Bilgisi Yöneticisi) → durum {gen+1,"in"}
//   şifresiz    → ortak kimlik varsa POST /api/md/auth/sso {sso_token}
//   çıkış       → ortak kimliği sil, durum "out" (tüm aile kapanır), POST /api/md/auth/logout
//   401         → oturum düştü: ortak kimlik de geçersiz, silinir
//   403 app_disabled / wrong_app → yalnız bu uygulamada kapanır

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const APP = 'md';
const API_BASE = (process.env.MD_API || 'https://mastertool.download').replace(/\/+$/, '');

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const pbkdf2 = (pass, salt, iter, len) =>
  new Promise((resolve, reject) => crypto.pbkdf2(pass, salt, iter, len, 'sha256', (e, k) => (e ? reject(e) : resolve(k))));

// master = PBKDF2-SHA256(şifre, tuz, iter, 32); authHash = base64(PBKDF2-SHA256(master, şifre, 1, 32))
async function deriveKeys(password, kdf) {
  if (!kdf || kdf.alg !== 'PBKDF2-SHA256' || !kdf.salt || !kdf.iter) throw new ApiError(0, 'unsupported_kdf');
  const pw = Buffer.from(String(password), 'utf8');
  const master = await pbkdf2(pw, Buffer.from(kdf.salt, 'base64'), Number(kdf.iter), 32);
  const authHash = (await pbkdf2(master, pw, 1, 32)).toString('base64');
  // master yalnız ortak kimliğe yazılır (diğer uygulamalar kendi anahtarlarını türetebilsin); dosyaya/günlüğe yazılmaz
  return { master, authHash };
}

async function api(method, route, { token, body, timeout = 20000, fetchImpl = fetch } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetchImpl(API_BASE_DYN() + route, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch {
    throw new ApiError(0, 'offline', 'offline');
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = await res.json(); } catch { /* boş gövde */ }
  if (!res.ok) {
    const code = (json && (json.code || json.detail)) || `http_${res.status}`;
    const err = new ApiError(res.status, typeof code === 'string' ? code : `http_${res.status}`, json && json.message);
    err.body = json;
    throw err;
  }
  return json || {};
}
// Testler MD_API'yi modül yüklendikten sonra da değiştirebilsin
const API_BASE_DYN = () => (process.env.MD_API || API_BASE).replace(/\/+$/, '');

function createAccount(deps) {
  // deps: { userDataDir, appVersion, encrypt, decrypt, sso, onStatus(state), onSessionExpired(code), onSharedLogin(), onSharedLogout() }
  const sso = deps.sso || null;
  const ssoRef = (t) => (t ? crypto.createHash('sha256').update(String(t)).digest('base64') : null);
  const file = path.join(deps.userDataDir, 'account.json');

  // Kalıcı alanlar (token yalnız "Beni hatırla" seçiliyse ve DPAPI ile şifreli yazılır)
  let saved = { email: '', remember: true };
  try { saved = { ...saved, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* ilk açılış */ }

  let session = null; // { token, user, ssoRef }
  if (saved.token) {
    try { session = { token: deps.decrypt(saved.token), user: saved.user, ssoRef: saved.ssoRef || null }; } catch { session = null; }
  }

  function persist() {
    const out = { email: saved.email, remember: saved.remember };
    if (session && saved.remember) {
      out.token = deps.encrypt(session.token);
      out.user = session.user;
      out.ssoRef = session.ssoRef || null; // ortak oturumun özeti (sso_token'ın kendisi değil)
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  }

  const publicState = () => ({ loggedIn: !!session, user: session ? session.user : null, email: saved.email });
  const status = () => deps.onStatus && deps.onStatus(publicState());
  const deviceName = () => `${os.hostname()} (Windows)`.slice(0, 120);
  const appVersion = () => String(deps.appVersion).slice(0, 30);

  function beginSession(res, { email, remember, ssoToken }) {
    session = { token: res.token, user: res.user, ssoRef: ssoRef(ssoToken) };
    saved.email = email || (res.user && res.user.email) || saved.email;
    saved.remember = remember;
    persist();
    status();
  }

  async function login(email, password, remember = true) {
    email = String(email || '').trim().toLowerCase();
    const pre = await api('POST', `/api/${APP}/auth/prelogin`, { body: { email } });
    let keys = await deriveKeys(password, pre.kdf);
    const res = await api('POST', `/api/${APP}/auth/login`, {
      body: { email, auth_hash: keys.authHash, device: deviceName(), app_version: appVersion(), sso: true },
    });
    // Sunucu güncel kdf'yi döner; tuz farklıysa (şifre başka yerde değişmiş) master yeniden türetilir
    const kdf = res.kdf || pre.kdf;
    if (res.kdf && (res.kdf.salt !== pre.kdf.salt || Number(res.kdf.iter) !== Number(pre.kdf.iter))) { keys.master.fill(0); keys = await deriveKeys(password, res.kdf); }
    beginSession(res, { email, remember: !!remember, ssoToken: res.sso_token });
    if (sso && res.sso_token) {
      try {
        sso.writeCredential({ email, user: res.user, sso_token: res.sso_token, master: keys.master, kdf });
        markShared('in');
      } catch { /* kimlik deposu kullanılamıyorsa yalnız bu uygulamada oturum açık kalır */ }
    }
    keys.master.fill(0);
    return publicState();
  }

  // Ortak kimlikle şifresiz giriş. Dönen: { ok, code }
  async function loginWithShared() {
    if (!sso) return { ok: false, code: 'no_sso' };
    const cred = sso.readCredential();
    if (!cred) return { ok: false, code: 'no_credential' };
    let res;
    try {
      res = await api('POST', `/api/${APP}/auth/sso`, { body: { sso_token: cred.sso_token, device: deviceName(), app_version: appVersion() }, timeout: 8000 });
    } catch (e) {
      // Ortak oturum sunucuda düşmüş: kimliği sil, ailenin geri kalanına da bildir
      if (e.status === 401) { sso.deleteCredential(); markShared('out'); }
      return { ok: false, code: e.code || 'error', message: e.message };
    }
    beginSession(res, { email: cred.email, remember: true, ssoToken: cred.sso_token });
    return { ok: true };
  }

  let watcher = null;
  function markShared(state) {
    if (!sso) return;
    try { const s = sso.bumpState(state); if (watcher) watcher.seen(s.gen); } catch { /* işaret yazılamadı */ }
  }

  async function logout() {
    const token = session && session.token;
    session = null;
    persist();
    status();
    // Ortak oturum ailede kapanır: kimliği sil, durumu "out" yap (sunucu da sso_ended ile tüm aileyi kapatır)
    if (sso) { sso.deleteCredential(); markShared('out'); }
    if (token) await api('POST', `/api/${APP}/auth/logout`, { token, timeout: 8000 }).catch(() => {});
  }

  // Başka bir Mastertool uygulamasında giriş/çıkış: ortak kimliği okuyup karar ver (çağrılar sırayla)
  let syncing = Promise.resolve();
  function syncShared(state) {
    syncing = syncing.then(() => doSyncShared(state)).catch(() => {});
    return syncing;
  }
  async function doSyncShared(state) {
    if (!sso) return;
    const st = state || sso.readState().state;
    const cred = sso.readCredential();
    if (cred) {
      if (session && session.ssoRef === ssoRef(cred.sso_token)) return; // aynı ortak oturum
      const r = await loginWithShared();
      if (r.ok && deps.onSharedLogin) deps.onSharedLogin(r);
      return;
    }
    // Ortak kimlik silinmiş ve işaret "out": ailede çıkış yapıldı ("in" iken kimlik okunamıyorsa dokunma)
    if (st === 'out' && session && deps.onSharedLogout) deps.onSharedLogout();
  }

  // Açılışta: oturum ortak oturumdan geldiyse ve uygulama kapalıyken ailede çıkış yapıldıysa yerelde kapat
  function sharedEndedWhileClosed() {
    if (!sso || !session || !session.ssoRef) return false;
    if (sso.readCredential()) return false;
    if (sso.readState().state !== 'out') return false;
    endLocal();
    return true;
  }

  // Ortak çıkışı yerelde uygula (sunucuya çıkış gönderilmez); süren indirmeler ana süreçte duraklatılır
  function endLocal() {
    session = null;
    persist();
    status();
  }

  function watchShared() {
    if (!sso || watcher) return;
    watcher = sso.watch((st) => { syncShared(st.state); });
  }
  function stopShared() { if (watcher) { watcher.stop(); watcher = null; } }

  // Oturum sunucuda geçersiz: 401 session_expired; 403 app_disabled (yönetici bu hesapta Master Download'ı kapattı) / wrong_app
  function expire(code = 'session_expired') {
    if (code === 'session_expired' && sso) { sso.deleteCredential(); markShared('out'); }
    session = null;
    persist();
    status();
    if (deps.onSessionExpired) deps.onSessionExpired(code);
  }

  async function authed(method, route, body) {
    if (!session) throw new ApiError(401, 'session_expired');
    try {
      return await api(method, route, { token: session.token, body });
    } catch (e) {
      if (e.status === 401) expire('session_expired');
      else if (e.status === 403 && ['app_disabled', 'wrong_app', 'suspended'].includes(e.code)) expire(e.code);
      throw e;
    }
  }

  // Açılışta oturumu doğrula (çevrimdışıysa saklı oturumla devam)
  async function start() {
    if (!session) return;
    try {
      const me = await authed('GET', `/api/${APP}/me`);
      if (me.user) { session.user = me.user; persist(); status(); }
    } catch { /* çevrimdışı ya da expire() zaten çağrıldı */ }
  }

  async function latestRelease() {
    return authed('GET', `/api/${APP}/releases/latest`);
  }

  return {
    isLoggedIn: () => !!session,
    token: () => (session ? session.token : null),
    state: publicState,
    login, logout, start, loginWithShared, syncShared, sharedEndedWhileClosed, watchShared, stopShared, endLocal, expire, authed, latestRelease,
  };
}

function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/, '').split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

module.exports = { APP, API_BASE, ApiError, createAccount, deriveKeys, compareVersions, api, apiBase: API_BASE_DYN };
