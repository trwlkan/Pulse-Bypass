'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulse', {
  // Config
  loadConfig: () => ipcRenderer.invoke('config:load'),
  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  addDomain: (host) => ipcRenderer.invoke('config:addDomain', host),
  removeDomain: (id) => ipcRenderer.invoke('config:removeDomain', id),
  addApp: (data) => ipcRenderer.invoke('config:addApp', data),
  addAppFromRunning: () => ipcRenderer.invoke('config:addAppFromRunning'),
  removeApp: (id) => ipcRenderer.invoke('config:removeApp', id),
  addAppDomain: (appId, domain) => ipcRenderer.invoke('config:addAppDomain', appId, domain),
  
  // Strategies
  listStrategies: () => ipcRenderer.invoke('strategies:list'),
  
  // Engine
  start: (strategyId) => ipcRenderer.invoke('engine:start', strategyId),
  stop: () => ipcRenderer.invoke('engine:stop'),
  autoDetect: () => ipcRenderer.invoke('engine:autoDetect'),
  checkHealth: () => ipcRenderer.invoke('engine:checkHealth'),
  reinstall: () => ipcRenderer.invoke('engine:reinstall'),
  openLogs: () => ipcRenderer.invoke('engine:openLogs'),
  
  // Window
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  
  // Listeners
  on: (channel, callback) => {
    const validChannels = [
      'config:loaded', 'config:updated',
      'strategies:list',
      'engine:status', 'engine:log', 'engine:error',
      'engine:installProgress', 'engine:installed',
      'toast'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  }
});
