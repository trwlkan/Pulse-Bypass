'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/* window.desktop — управление окном, имена методов совпадают с оригинальным
   assets/desktop-api.js (Pulse-hub), чтобы переиспользовать титлбар as-is. */
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  minimizeSelf: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeSelf: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeSelf: () => ipcRenderer.invoke('window:close'),
  isMaximizedSelf: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_e, s) => cb(s))
});

/* window.pulse — управление движком обхода блокировок */
contextBridge.exposeInMainWorld('pulse', {
  getState: () => ipcRenderer.invoke('engine:getState'),
  start: (strategyId) => ipcRenderer.invoke('engine:start', strategyId),
  stop: () => ipcRenderer.invoke('engine:stop'),
  autoDetect: (targets) => ipcRenderer.invoke('engine:autoDetect', targets),
  installEngine: () => ipcRenderer.invoke('engine:installEngine'),
  openLogsFolder: () => ipcRenderer.invoke('engine:openLogsFolder'),

  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  addDomain: (host) => ipcRenderer.invoke('config:addDomain', host),
  removeDomain: (id) => ipcRenderer.invoke('config:removeDomain', id),
  addApp: () => ipcRenderer.invoke('config:addApp'),
  removeApp: (id) => ipcRenderer.invoke('config:removeApp', id),

  onLog: (cb) => ipcRenderer.on('engine-log', (_e, line) => cb(line)),
  onStatus: (cb) => ipcRenderer.on('engine-status', (_e, s) => cb(s))
});
