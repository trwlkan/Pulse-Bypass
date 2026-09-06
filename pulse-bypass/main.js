'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Store = require('electron-store');

const GoodbyeDPImanager = require('./engine/goodbyedpi-manager');

const PACKAGE = require('./package.json');
const APP_TITLE = 'Pulse Bypass';

let mainWindow = null;
let tray = null;
let gd = null;
let isQuitting = false;

const DEFAULT_CONFIG = {
  domains: {
    youtube: true,
    discord: true,
    general: false,
    custom: []
  },
  apps: [],
  lastStrategyId: null,
  autoStartBypass: false,
  launchOnBoot: false,
  minimizeToTrayOnClose: true
};

const store = new Store({
  name: 'pulse-bypass-config',
  defaults: DEFAULT_CONFIG
});

const resourcesPath = app.isPackaged
  ? path.join(process.resourcesPath, 'zapret')
  : path.join(__dirname, 'engine', 'vendor', 'goodbyedpi');

const listsPath = app.isPackaged
  ? path.join(process.resourcesPath, 'hostlists')
  : path.join(__dirname, 'engine', 'hostlists');

gd = new GoodbyeDPImanager({ resourcesPath, listsPath, getStore: () => store.store });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 600,
    minWidth: 720,
    minHeight: 500,
    title: APP_TITLE,
    frame: false,
    resizable: true,
    maximizable: true,
    backgroundColor: '#0B0F14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    if (gd && gd.isRunning() && store.get('minimizeToTrayOnClose', true)) {
      e.preventDefault();
      mainWindow.hide();
    } else if (gd && gd.isRunning()) {
      e.preventDefault();
      gd.stop().then(() => { if (mainWindow) mainWindow.close(); });
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, 'src', 'icons', 'tray.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();

  tray = new Tray(img);
  tray.setToolTip(APP_TITLE);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else mainWindow.show();
    }
  });

  tray.setContextMenu([
    {
      label: 'Показать',
      click: () => { if (mainWindow) mainWindow.show(); }
    },
    {
      label: gd && gd.isRunning() ? 'Остановить обход' : 'Запустить обход',
      click: () => {
        if (gd && gd.isRunning()) {
          gd.stop();
        } else {
          const id = store.get('lastStrategyId') || 'gd_mode9';
          gd.start(id).catch(err => {
            if (mainWindow) mainWindow.webContents.send('engine:error', err.message);
          });
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => { isQuitting = true; app.quit(); }
    }
  ]);
}

// ===== IPC Handlers =====

ipcMain.handle('config:load', () => store.store);

ipcMain.handle('config:update', async (_e, patch) => {
  store.set(patch);
  if (Object.prototype.hasOwnProperty.call(patch, 'launchOnBoot')) {
    try { app.setLoginItemSettings({ openAtLogin: !!patch.launchOnBoot }); } catch (e) {}
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'domains')) {
    await applyDomainsChange();
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'apps')) {
    await applyDomainsChange();
  }
  return store.store;
});

ipcMain.handle('config:addDomain', async (_e, host) => {
  const list = store.get('domains.custom', []);
  const id = 'd_' + Date.now().toString(36);
  list.push({ id, host: String(host).trim().toLowerCase(), enabled: true });
  store.set('domains.custom', list);
  await applyDomainsChange();
  return list;
});

ipcMain.handle('config:removeDomain', async (_e, id) => {
  const list = store.get('domains.custom', []).filter((d) => d.id !== id);
  store.set('domains.custom', list);
  await applyDomainsChange();
  return list;
});

ipcMain.handle('config:addApp', async (_e, appData) => {
  let exePath, name;
  
  if (appData && appData.exePath) {
    exePath = appData.exePath;
    name = appData.name;
  } else {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите .exe',
      filters: [{ name: 'Приложения', extensions: ['exe'] }],
      properties: ['openFile']
    });
    
    if (res.canceled || !res.filePaths[0]) return store.get('apps', []);
    exePath = res.filePaths[0];
    name = path.basename(exePath, '.exe');
  }
  
  const list = store.get('apps', []);
  if (list.some(a => a.exePath.toLowerCase() === exePath.toLowerCase())) return list;
  
  list.push({ id: 'a_' + Date.now().toString(36), name, exePath, enabled: true, domains: [] });
  store.set('apps', list);
  await applyDomainsChange();
  return list;
});

ipcMain.handle('config:addAppFromRunning', async () => {
  // TODO: implement running process picker
  return store.get('apps', []);
});

ipcMain.handle('config:removeApp', async (_e, id) => {
  const list = store.get('apps', []).filter((a) => a.id !== id);
  store.set('apps', list);
  await applyDomainsChange();
  return list;
});

ipcMain.handle('config:addAppDomain', async (_e, appId, domain) => {
  const list = store.get('apps', []);
  const appItem = list.find(a => a.id === appId);
  if (appItem) {
    if (!Array.isArray(appItem.domains)) appItem.domains = [];
    const d = String(domain).trim().toLowerCase();
    if (d && !appItem.domains.includes(d)) {
      appItem.domains.push(d);
      store.set('apps', list);
      await applyDomainsChange();
    }
  }
  return list;
});

ipcMain.handle('strategies:list', () => gd.listStrategies());

ipcMain.handle('engine:start', async (_e, strategyId) => {
  try {
    await gd.start(strategyId);
    store.set('lastStrategyId', strategyId);
    return { success: true };
  } catch (e) {
    if (mainWindow) mainWindow.webContents.send('engine:error', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('engine:stop', async () => {
  await gd.stop();
  return { success: true };
});

ipcMain.handle('engine:autoDetect', async () => {
  try {
    const result = await gd.autoDetect();
    if (result.success && result.strategyId) {
      store.set('lastStrategyId', result.strategyId);
    }
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('engine:checkHealth', async () => {
  const targets = [
    { name: 'YouTube', host: 'www.youtube.com', port: 443 },
    { name: 'Discord', host: 'discord.com', port: 443 }
  ];
  
  const results = [];
  for (const t of targets) {
    const r = await gd.checkServiceHealth(t.name, t.host, t.port, 5);
    results.push(r);
  }
  return results;
});

ipcMain.handle('engine:reinstall', async () => {
  try {
    const { fetchGoodbyeDPIBundle } = require('./engine/vendor-fetch-gd');
    await fetchGoodbyeDPIBundle(resourcesPath, (msg) => {
      if (mainWindow) mainWindow.webContents.send('engine:installProgress', msg);
    });
    if (mainWindow) mainWindow.webContents.send('engine:installed');
    return { success: true };
  } catch (e) {
    if (mainWindow) mainWindow.webContents.send('engine:error', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('engine:openLogs', () => {
  const logsDir = path.join(os.homedir(), 'AppData', 'Roaming', 'pulse-bypass', 'logs');
  try { fs.mkdirSync(logsDir, { recursive: true }); } catch (e) {}
  shell.openPath(logsDir);
});

// Window controls
ipcMain.on('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.on('window:close', () => { if (mainWindow) mainWindow.close(); });

// Status & log forwarding
gd.on('status', (status) => {
  if (mainWindow) mainWindow.webContents.send('engine:status', status);
});

gd.on('log', (line) => {
  if (mainWindow) mainWindow.webContents.send('engine:log', line);
});

async function applyDomainsChange() {
  gd.rebuildBlacklist(store.store);
  if (gd.isRunning()) {
    const id = store.get('lastStrategyId') || gd.currentStrategyId;
    if (id) {
      try { await gd.start(id); } catch (e) {}
    }
  }
}

// ===== App lifecycle =====
app.whenReady().then(() => {
  createWindow();
  createTray();

  // Set version
  if (mainWindow) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('config:loaded', store.store);
      mainWindow.webContents.send('strategies:list', gd.listStrategies());
      mainWindow.webContents.send('engine:status', gd.getStatus());
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !(gd && gd.isRunning())) {
    app.quit();
  }
});

app.on('before-quit', async (e) => {
  if (e.defaultPrevented) return;
  e.preventDefault();
  isQuitting = true;
  if (gd) {
    try { await gd.stop(); } catch (err) {}
  }
  app.exit(0);
});
