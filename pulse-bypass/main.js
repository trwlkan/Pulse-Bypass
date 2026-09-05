'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');

const ZapretManager = require('./engine/zapret-manager');

const store = new Store({
  name: 'pulse-bypass-config',
  defaults: {
    autostartEngine: false,
    launchOnBoot: false,
    minimizeToTrayOnClose: true,
    lastStrategyId: null,
    theme: 'green',
    domains: {
      youtube: true,
      discord: true,
      custom: [] // { id, host, enabled }
    },
    apps: [] // { id, name, exePath, enabled } — для WF-фильтрации по .exe (winws --wf-l3 / per-process через service)
  }
});

let mainWindow = null;
let tray = null;
let zapret = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    frame: false,
    backgroundColor: '#0A1210',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', 'normal'));

  mainWindow.on('close', (e) => {
    if (zapret && zapret.isRunning() && store.get('minimizeToTrayOnClose', true)) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  // Плейсхолдер-иконка 16x16 (реальную иконку кладите в src/icons/tray.png при сборке)
  const iconPath = path.join(__dirname, 'src', 'icons', 'tray.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();

  tray = new Tray(img);
  tray.setToolTip('Pulse Bypass');

  const rebuildMenu = () => {
    const running = zapret && zapret.isRunning();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: running ? 'Активен ✓' : 'Остановлен', enabled: false },
      { type: 'separator' },
      {
        label: running ? 'Остановить обход' : 'Запустить обход',
        click: async () => {
          if (running) await zapret.stop();
          else await zapret.start(store.get('lastStrategyId'));
          rebuildMenu();
        }
      },
      {
        label: 'Открыть Pulse Bypass',
        click: () => { if (mainWindow) { mainWindow.show(); } else { createWindow(); } }
      },
      { type: 'separator' },
      { label: 'Выход', click: () => { app.exit(0); } }
    ]));
  };

  rebuildMenu();
  tray.on('click', () => { if (mainWindow) mainWindow.show(); });
  zapret.on('status', rebuildMenu);
}

app.whenReady().then(async () => {
  zapret = new ZapretManager({
    resourcesPath: app.isPackaged
      ? path.join(process.resourcesPath, 'zapret')
      : path.join(__dirname, 'engine', 'vendor', 'zapret'),
    listsPath: path.join(__dirname, 'engine', 'hostlists'),
    getStore: () => store.store
  });

  createWindow();
  createTray();

  zapret.on('log', (line) => { if (mainWindow) mainWindow.webContents.send('engine-log', line); });
  zapret.on('status', (s) => { if (mainWindow) mainWindow.webContents.send('engine-status', s); });

  if (store.get('autostartEngine')) {
    const id = store.get('lastStrategyId');
    if (id) zapret.start(id).catch(() => {});
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  store.set('minimizeToTrayOnClose', false);
  if (zapret) await zapret.stop();
});

/* =========================================================
   IPC — титлбар (совместимо с window.desktop из pulsehub.js)
   ========================================================= */
ipcMain.handle('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow && mainWindow.close());
ipcMain.handle('window:isMaximized', () => (mainWindow ? mainWindow.isMaximized() : false));

/* =========================================================
   IPC — движок обхода
   ========================================================= */
ipcMain.handle('engine:getState', () => ({
  status: zapret.getStatus(),
  strategies: zapret.listStrategies(),
  config: store.store,
  engineReady: zapret.isEngineInstalled()
}));

ipcMain.handle('engine:start', async (_e, strategyId) => {
  store.set('lastStrategyId', strategyId);
  return zapret.start(strategyId);
});

ipcMain.handle('engine:stop', async () => zapret.stop());

ipcMain.handle('engine:autoDetect', async (_e, targets) => {
  const result = await zapret.autoDetect(targets);
  if (result && result.strategyId) store.set('lastStrategyId', result.strategyId);
  return result;
});

ipcMain.handle('config:update', (_e, patch) => {
  store.set(patch);
  if (Object.prototype.hasOwnProperty.call(patch, 'launchOnBoot')) {
    try { app.setLoginItemSettings({ openAtLogin: !!patch.launchOnBoot }); } catch (e) {}
  }
  return store.store;
});

ipcMain.handle('config:addDomain', (_e, host) => {
  const list = store.get('domains.custom', []);
  const id = 'd_' + Date.now().toString(36);
  list.push({ id, host: String(host).trim().toLowerCase(), enabled: true });
  store.set('domains.custom', list);
  zapret.rebuildHostlist(store.store);
  return list;
});

ipcMain.handle('config:removeDomain', (_e, id) => {
  const list = store.get('domains.custom', []).filter((d) => d.id !== id);
  store.set('domains.custom', list);
  zapret.rebuildHostlist(store.store);
  return list;
});

ipcMain.handle('config:addApp', async (_e) => {
  const { dialog } = require('electron');
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите исполняемый файл приложения',
    filters: [{ name: 'Приложения', extensions: ['exe'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths[0]) return store.get('apps', []);
  const exePath = res.filePaths[0];
  const name = path.basename(exePath, '.exe');
  const list = store.get('apps', []);
  list.push({ id: 'a_' + Date.now().toString(36), name, exePath, enabled: true });
  store.set('apps', list);
  return list;
});

ipcMain.handle('config:removeApp', (_e, id) => {
  const list = store.get('apps', []).filter((a) => a.id !== id);
  store.set('apps', list);
  return list;
});

ipcMain.handle('engine:openLogsFolder', () => shell.openPath(zapret.logsDir));
ipcMain.handle('engine:installEngine', () => zapret.ensureEngine());
