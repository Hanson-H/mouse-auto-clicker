// statusbar-preload：向状态栏窗口暴露最小安全 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('statusbarApi', {
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onVisibility: (cb) => ipcRenderer.on('bar-visibility', (_e, v) => cb(v)),
});
