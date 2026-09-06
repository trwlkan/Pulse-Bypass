'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { execFile, spawn } = require('child_process');

const ZapretManager = require('./engine/zapret-manager');

/**
 * ДОБАВЛЕНО: проверка прав администратора при старте приложения.
 *
 * winws.exe (движок zapret) не может установить/открыть драйвер WinDivert
 * без прав администратора — без них ЛЮБАЯ стратегия падает почти мгновенно
 * после старта с "ошибка движка"/"ошибка запуска", и это касается вообще
 * всех стратегий без исключения (не зависит от провайдера или конкретной
 * стратегии). Раньше приложение просто пыталось запускать движок и честно
 * отражало эту ошибку, из-за чего казалось, что "ничего не работает" и
 * автоподбор "постоянно пытается переподключиться", хотя причина была одна
 * и очень простая — отсутствие прав администратора.
 *
 * Что делает эта проверка:
 *  - если приложение уже запущено с правами администратора — ничего не
 *    происходит, всё как раньше;
 *  - если прав нет — показываем понятный диалог и предлагаем перезапустить
 *    приложение с правами администратора через UAC (Start-Process -Verb
 *    RunAs), не пытаясь молча стартовать движок, который всё равно упадёт.
 *
 * Электрон не даёт поднять права уже запущенного процесса "на лету" — это
 * ограничение Windows, а не наше; единственный штатный способ — перезапуск
 * с UAC-подтверждением, поэтому мы закрываем текущий (неэлевированный)
 * процесс и стартуем новый через PowerShell Start-Process -Verb RunAs.
 */
function isElevatedWin() {
  if (process.platform !== 'win32') return Promise.resolve(true);
  return new Promise((resolve) => {
    execFile('net', ['session'], (err) => resolve(!err));
  });
}

function relaunchElevated() {
  const exe = process.execPath;
  // В dev-режиме process.execPath указывает на electron.exe, и нужно
  // передать путь к приложению первым аргументом (как при `electron .`).
  const args = app.isPackaged ? [] : [path.join(__dirname)];
  const argString = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
  const psCommand = argString
    ? `Start-Process -FilePath '${exe}' -ArgumentList ${argString} -Verb RunAs`
    : `Start-Process -FilePath '${exe}' -Verb RunAs`;

  try {
    spawn('powershell.exe', ['-NoProfile', '-Command', psCommand], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
  } catch (e) {
    // Если перезапуск через UAC не удался (например, пользователь отменил
    // системный диалог позже) — просто выходим, ничего страшного не
    // произойдёт, пользователь может перезапустить вручную.
  }
  app.exit(0);
}

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
      custom: []
    },
    apps: [], // { id, name, exePath, enabled, domains: [] }
    serviceHealthCache: {} // Кэш состояния сервисов
  }
});

let mainWindow = null;
let tray = null;
let zapret = null;
let isQuitting = false;

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
    // ИСПРАВЛЕНО: используем isQuitting флаг вместо store.set
    if (isQuitting) return;
    if (zapret && zapret.isRunning() && store.get('minimizeToTrayOnClose', true)) {
      e.preventDefault();
      mainWindow.hide();
    } else if (zapret && zapret.isRunning()) {
      e.preventDefault();
      zapret.stop().then(() => { if (mainWindow) mainWindow.close(); });
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
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
      { label: 'Выход', click: () => { isQuitting = true; app.quit(); } }
    ]));
  };

  rebuildMenu();
  tray.on('click', () => { if (mainWindow) mainWindow.show(); });
  zapret.on('status', rebuildMenu);
}

app.whenReady().then(async () => {
  if (process.platform === 'win32' && !(await isElevatedWin())) {
    const choice = await dialog.showMessageBox({
      type: 'warning',
      title: 'Нужны права администратора',
      message: 'Pulse Bypass нужно запустить от имени администратора',
      detail:
        'Движок обхода (winws.exe) устанавливает системный драйвер WinDivert, ' +
        'а это требует прав администратора. Без них ни одна стратегия обхода ' +
        'не запустится и будет постоянно показывать ошибку.\n\n' +
        'Перезапустить приложение с правами администратора сейчас?',
      buttons: ['Перезапустить с правами администратора', 'Продолжить без прав (не будет работать)'],
      defaultId: 0,
      cancelId: 1
    });

    if (choice.response === 0) {
      relaunchElevated();
      return; // app.exit() уже вызван внутри relaunchElevated()
    }
  }

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
    // ИСПРАВЛЕНО: раньше при автозапуске всегда бралась последняя выбранная
    // стратегия, даже если на этом устройстве/у этого провайдера она ни разу
    // не была проверена (или не проверялась вовсе) — именно из-за этого
    // одному человеку YouTube открывался, а другому с тем же билдом нет.
    // Теперь при отсутствии подтверждённо рабочей стратегии сразу
    // запускается автоподбор.
    const id = store.get('lastStrategyId');
    const cached = id ? zapret.strategyTestResults[id] : null;
    if (cached && cached.success) {
      zapret.start(id).catch(() => {});
    } else {
      zapret.autoDetect().then((result) => {
        if (result && result.strategyId) store.set('lastStrategyId', result.strategyId);
      }).catch(() => {});
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  // ИСПРАВЛЕНО: isQuitting флаг + preventDefault + await stop + exit.
  if (e.defaultPrevented) return;
  e.preventDefault();
  isQuitting = true;
  if (zapret) {
    try { await zapret.stop(); } catch (err) {}
  }
  app.exit(0);
});

/* =========================================================
   IPC — титлбар
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
ipcMain.handle('engine:getState', async () => ({
  status: zapret.getStatus(),
  strategies: zapret.listStrategies(),
  config: store.store,
  engineReady: zapret.isEngineInstalled(),
  serviceHealth: store.get('serviceHealthCache', {}),
  // ДОБАВЛЕНО: чтобы UI мог показать постоянное предупреждение, если
  // пользователь нажал "Продолжить без прав" в диалоге при запуске —
  // иначе он увидит ошибку только после клика "запустить обход".
  isElevated: await isElevatedWin()
}));

// ИСПРАВЛЕНО: renderer (src/assets/app.js) вызывает window.pulse.getConfig()
// отдельно от getState() после каждого добавления домена/приложения, но
// соответствующего IPC-канала не было — вызов падал молча.
ipcMain.handle('config:get', () => store.store);

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

/**
 * НОВОЕ: проверка работоспособности сервисов
 */
ipcMain.handle('engine:checkServiceHealth', async (_e, services) => {
  const results = {};
  
  for (const service of services) {
    const result = await zapret.checkServiceHealth(
      service.name, 
      service.host, 
      service.port || 443,
      5 // 5 попыток
    );
    results[service.name] = result;
  }
  
  // Сохраняем в кэш
  store.set('serviceHealthCache', results);
  
  return results;
});

/**
 * Получение списка запущенных процессов.
 * ИСПРАВЛЕНО: "wmic" удалён в свежих сборках Windows 11 (начиная с 24H2),
 * из-за чего на части устройств этот список всегда возвращался пустым и
 * кнопка "добавить из запущенных" не работала. Переключились на
 * PowerShell + Get-Process, которая доступна на всех поддерживаемых
 * версиях Windows.
 */
ipcMain.handle('system:getRunningProcesses', async () => {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }

    const psCommand =
      'Get-Process | Where-Object { $_.Path } | ' +
      'Select-Object -Property Name, Path -Unique | ConvertTo-Json -Compress';

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psCommand],
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        try {
          let parsed = JSON.parse(stdout.trim() || '[]');
          if (!Array.isArray(parsed)) parsed = [parsed];

          const seen = new Set();
          const processes = [];
          for (const p of parsed) {
            const exePath = p && p.Path ? String(p.Path).trim() : '';
            const name = p && p.Name ? String(p.Name).trim() : '';
            const key = exePath.toLowerCase();
            if (exePath && name && !seen.has(key)) {
              seen.add(key);
              processes.push({ name, exePath });
            }
          }

          processes.sort((a, b) => a.name.localeCompare(b.name));
          resolve(processes);
        } catch (e) {
          resolve([]);
        }
      }
    );
  });
});

async function applyDomainsChange() {
  zapret.rebuildHostlist(store.store);
  if (zapret.isRunning()) {
    const id = store.get('lastStrategyId') || zapret.currentStrategyId;
    if (id) {
      try { await zapret.start(id); } catch (e) { }
    }
  }
}

ipcMain.handle('config:update', async (_e, patch) => {
  store.set(patch);
  if (Object.prototype.hasOwnProperty.call(patch, 'launchOnBoot')) {
    try { app.setLoginItemSettings({ openAtLogin: !!patch.launchOnBoot }); } catch (e) {}
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'domains')) {
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

/**
 * УЛУЧШЕНО: добавление приложения теперь поддерживает как file dialog, так и выбор из запущенных
 */
ipcMain.handle('config:addApp', async (_e, appData) => {
  let exePath, name;
  
  if (appData && appData.exePath) {
    // Добавляем из списка запущенных процессов
    exePath = appData.exePath;
    name = appData.name;
  } else {
    // Открываем диалог выбора файла
    const { dialog } = require('electron');
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите исполняемый файл приложения',
      filters: [{ name: 'Приложения', extensions: ['exe'] }],
      properties: ['openFile']
    });
    
    if (res.canceled || !res.filePaths[0]) return store.get('apps', []);
    
    exePath = res.filePaths[0];
    name = path.basename(exePath, '.exe');
  }
  
  const list = store.get('apps', []);
  
  // Проверяем, не добавлено ли уже
  if (list.some(a => a.exePath.toLowerCase() === exePath.toLowerCase())) {
    return list;
  }
  
  list.push({ 
    id: 'a_' + Date.now().toString(36), 
    name, 
    exePath, 
    enabled: true,
    domains: [] // Пользователь может добавить домены позже
  });
  
  store.set('apps', list);
  // ИСПРАВЛЕНО: вызываем applyDomainsChange() чтобы синхронизировать hostlist
  // (даже если доменов пока нет — это гарантирует консистентность)
  await applyDomainsChange();
  return list;
});

ipcMain.handle('config:removeApp', async (_e, id) => {
  const list = store.get('apps', []).filter((a) => a.id !== id);
  store.set('apps', list);
  await applyDomainsChange();
  return list;
});

/**
 * НОВОЕ: добавление домена к приложению
 */
ipcMain.handle('config:addAppDomain', async (_e, appId, domain) => {
  const list = store.get('apps', []);
  const app = list.find(a => a.id === appId);
  
  if (app) {
    if (!Array.isArray(app.domains)) app.domains = [];
    const d = String(domain).trim().toLowerCase();
    if (d && !app.domains.includes(d)) {
      app.domains.push(d);
      store.set('apps', list);
      await applyDomainsChange();
    }
  }
  
  return list;
});

ipcMain.handle('engine:openLogsFolder', () => {
  const logsPath = path.join(zapret.logsDir);
  shell.openPath(logsPath);
});

ipcMain.handle('engine:reinstall', async () => {
  const { fetchZapretBundle } = require('./engine/vendor-fetch');
  await fetchZapretBundle(
    app.isPackaged ? path.join(process.resourcesPath, 'zapret') : path.join(__dirname, 'engine', 'vendor', 'zapret'),
    (msg) => { if (mainWindow) mainWindow.webContents.send('engine-log', msg); }
  );
  return zapret.isEngineInstalled();
});

ipcMain.handle('theme:set', (_e, theme) => {
  store.set('theme', theme);
  return theme;
});
