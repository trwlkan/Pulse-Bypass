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

/* window.pulse — управление движком обхода блокировок.
   ИСПРАВЛЕНО: раньше половина методов, которые реально вызывает src/assets/app.js
   (getConfig, getRunningProcesses, checkServiceHealth, addAppDomain, reinstallEngine,
   onEngineLog/onEngineStatus), тут не были объявлены — вызовы падали с
   "window.pulse.X is not a function", и это тихо ломало добавление доменов/
   приложений и проверку работоспособности. addApp() также не передавал
   аргумент дальше в main-процесс, поэтому «добавить из запущенных» всегда
   на деле открывал диалог выбора файла. */
contextBridge.exposeInMainWorld('pulse', {
  getState: () => ipcRenderer.invoke('engine:getState'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  start: (strategyId) => ipcRenderer.invoke('engine:start', strategyId),
  stop: () => ipcRenderer.invoke('engine:stop'),
  autoDetect: (targets) => ipcRenderer.invoke('engine:autoDetect', targets),
  reinstallEngine: () => ipcRenderer.invoke('engine:reinstall'),
  openLogsFolder: () => ipcRenderer.invoke('engine:openLogsFolder'),
  checkServiceHealth: (services) => ipcRenderer.invoke('engine:checkServiceHealth', services),

  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),

  addDomain: (host) => ipcRenderer.invoke('config:addDomain', host),
  removeDomain: (id) => ipcRenderer.invoke('config:removeDomain', id),

  addApp: (appData) => ipcRenderer.invoke('config:addApp', appData),
  removeApp: (id) => ipcRenderer.invoke('config:removeApp', id),
  addAppDomain: (appId, domain) => ipcRenderer.invoke('config:addAppDomain', appId, domain),

  getRunningProcesses: () => ipcRenderer.invoke('system:getRunningProcesses'),

  onEngineLog: (cb) => ipcRenderer.on('engine-log', (_e, line) => cb(line)),
  onEngineStatus: (cb) => ipcRenderer.on('engine-status', (_e, s) => cb(s))
});
