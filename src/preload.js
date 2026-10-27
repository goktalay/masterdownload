'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const inv = (channel) => (...a) => ipcRenderer.invoke(channel, ...a);

contextBridge.exposeInMainWorld('api', {
  // arayüz dili (açılışta senkron alınır ki ilk çizim doğru dilde olsun)
  lang: ipcRenderer.sendSync('app:lang'),

  // ortak oturum (mastertool.download)
  accountState: inv('account:state'),
  login: (email, password) => ipcRenderer.invoke('account:login', { email, password }),
  logout: inv('account:logout'),
  openWeb: inv('account:openWeb'), // 'forgot' | 'register' | 'account'
  openPortal: inv('app:openPortal'),
  onAccount: on('account:state'),

  // indirmeler
  list: inv('dl:list'),
  get: inv('dl:get'),
  add: inv('dl:add'),
  addMany: inv('dl:addMany'),
  start: inv('dl:start'),
  pause: inv('dl:pause'),
  pauseAll: inv('dl:pauseAll'),
  remove: (ids, deleteFile) => ipcRenderer.invoke('dl:remove', { ids, deleteFile }),
  redownload: inv('dl:redownload'),
  refreshUrl: (id, url) => ipcRenderer.invoke('dl:refresh', { id, url }),
  update: (id, patch) => ipcRenderer.invoke('dl:update', { id, patch }),
  open: inv('dl:open'),
  openWith: inv('dl:openWith'),
  reveal: inv('dl:reveal'),
  progressWindow: inv('dl:progressWindow'),
  moveToQueue: (ids, queue) => ipcRenderer.invoke('dl:moveToQueue', { ids, queue }),
  reorder: (queue, ids) => ipcRenderer.invoke('dl:reorder', { queue, ids }),
  copyUrl: inv('dl:copyUrl'),
  scan: inv('dl:scan'),
  startDrag: (id) => ipcRenderer.invoke('dl:startOnDrag', id),
  onList: on('dl:list'),
  onProgress: on('dl:progress'),
  onWarning: on('dl:warning'),
  onScan: on('dl:scan'),
  onAddDialog: on('dl:addDialog'),
  onBatchDialog: on('dl:batchDialog'),
  onAfter: on('dl:after'),

  // kuyruklar
  queues: inv('q:list'),
  startQueue: inv('q:start'),
  stopQueue: inv('q:stop'),
  saveQueues: inv('q:save'),
  cancelAfter: inv('q:cancelAfter'),
  onQueues: on('dl:queues'),

  // toplu indirme, içe/dışa aktarma, site yakalayıcı
  expand: inv('batch:expand'),
  clipboardLinks: inv('batch:clipboard'),
  importList: inv('io:import'),
  importFile: inv('io:importFile'),
  exportList: (ids, format) => ipcRenderer.invoke('io:export', { ids, format }),
  grab: inv('grab:start'),
  grabStop: inv('grab:stop'),
  onGrab: on('grab:progress'),

  // pencere yardımcıları
  pickDir: inv('ui:pickDir'),
  pickFile: inv('ui:pickFile'),
  dropText: inv('ui:dropText'),
  filePath: (file) => (webUtils ? webUtils.getPathForFile(file) : file.path),
  closeWindow: inv('ui:closeWindow'),
  showMain: inv('ui:showMain'),

  // ilerleme penceresi
  onPwProgress: on('pw:progress'),
  onPwState: on('pw:state'),

  // ayarlar ve Hakkında
  getSettings: inv('settings:get'),
  setSettings: inv('settings:set'),
  onSettings: on('settings:changed'),
  registerBrowser: inv('browser:register'),
  browserStore: inv('browser:openStore'),
  dropTarget: inv('app:dropTarget'),
  about: inv('app:about'),
  checkUpdate: inv('app:checkUpdate'),
  selfUpdate: inv('app:selfUpdate'),
  openLicenses: inv('app:openLicenses'),
  quit: inv('app:quit'),
  onUpdateAvailable: on('app:update'),
  onUpdateProgress: on('app:updateProgress'),
});
