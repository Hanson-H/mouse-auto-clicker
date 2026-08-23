// preload：向渲染进程暴露安全 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  saveConfig: (patch) => ipcRenderer.invoke('cfg:save', patch),
  setHotkey: (which, accelerator) => ipcRenderer.invoke('hotkey:set', { which, accelerator }),
  startClick: () => ipcRenderer.invoke('click:start'),
  stopClick: () => ipcRenderer.invoke('click:stop'),
  getCursorPos: () => ipcRenderer.invoke('cursor:pos'),
  onStatus: (cb) => {
    ipcRenderer.on('status', (_e, s) => cb(s));
  },
});
