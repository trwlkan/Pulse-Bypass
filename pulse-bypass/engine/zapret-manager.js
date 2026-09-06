'use strict';

const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const tls = require('tls');
const https = require('https');

const { STRATEGIES, getStrategy } = require('./strategies');

const DEFAULT_TEST_TARGETS = [
  { host: 'www.youtube.com', port: 443 },
  { host: 'discord.com', port: 443 }
];

/**
 * УЛУЧШЕННЫЙ ZapretManager с исправлениями:
 * 1. Правильная сборка hostlist с пользовательскими доменами
 * 2. Быстрый автоподбор стратегий с параллельным тестированием
 * 3. Сохранение результатов тестирования стратегий для каждого устройства
 * 4. Проверка работоспособности сервисов (5 попыток)
 */
class ZapretManager extends EventEmitter {
  constructor({ resourcesPath, listsPath, getStore }) {
    super();
    this.resourcesPath = resourcesPath;
    this.listsPath = listsPath;
    this.getStore = getStore;

    this.userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'pulse-bypass');
    this.runtimeDir = path.join(this.userDataDir, 'runtime');
    this.logsDir = path.join(this.userDataDir, 'logs');
    for (const dir of [this.userDataDir, this.runtimeDir, this.logsDir]) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }

    this.proc = null;
    this.currentStrategyId = null;
    this.status = 'stopped';
    this.lastError = null;
    
    // Кэш результатов тестирования стратегий
    this.strategyTestResults = this._loadStrategyResults();
  }

  // engine/vendor/zapret/bin — сюда распакован официальный релиз
  // (winws.exe, WinDivert*.dll/sys, cygwin1.dll, *.bin payload-файлы для фейков)
  get binDir() {
    return path.join(this.resourcesPath, 'bin');
  }

  get binPath() {
    return path.join(this.binDir, process.platform === 'win32' ? 'winws.exe' : 'winws');
  }

  // engine/vendor/zapret/lists — официальные списки (list-general.txt,
  // list-google.txt, ipset-all.txt, ...), поставляемые вместе с релизом
  get vendorListsDir() {
    return path.join(this.resourcesPath, 'lists');
  }

  // Пользовательские файлы внутри vendorListsDir, которые официальные
  // стратегии (см. strategies.js) сами подключают через --hostlist=/
  // --hostlist-exclude= — именно их мы перезаписываем в rebuildHostlist().
  get userHostlistPath() {
    return path.join(this.vendorListsDir, 'list-general-user.txt');
  }

  get userExcludePath() {
    return path.join(this.vendorListsDir, 'list-exclude-user.txt');
  }

  isEngineInstalled() {
    try { return fs.existsSync(this.binPath); } catch (e) { return false; }
  }

  /**
   * НОВОЕ: проверка прав администратора.
   *
   * winws.exe требует права администратора, чтобы установить/открыть
   * драйвер WinDivert (то же самое видно и в официальных .bat — они сами
   * не поднимают права, полагаясь на то, что пользователь либо запустил их
   * от имени администратора, либо ярлык уже собран с requireAdmin).
   *
   * Без прав администратора winws.exe завершается почти мгновенно после
   * старта (не может открыть \\.\WinDivert), что раньше выглядело как
   * "ошибка движка"/"ошибка запуска" на КАЖДОЙ стратегии без исключения —
   * автоподбор перебирал все стратегии, каждая падала за доли секунды, и
   * со стороны это смотрелось как бесконечные попытки "переподключиться".
   * Реальная причина не была видна пользователю, потому что мы честно
   * пытались стартовать движок и ловили ровно то же самое "процесс упал
   * сразу после старта", что и при обычном сбое стратегии.
   *
   * "net session" — стандартный трюк на Windows: без прав администратора
   * эта команда завершается с "Отказано в доступе" (код 5), с правами —
   * успешно (даже если сессий нет).
   */
  isElevated() {
    if (process.platform !== 'win32') return Promise.resolve(true);
    return new Promise((resolve) => {
      execFile('net', ['session'], (err) => resolve(!err));
    });
  }

  _loadStrategyResults() {
    const filePath = path.join(this.userDataDir, 'strategy-test-results.json');
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (e) {
      this._log('Не удалось загрузить результаты тестирования стратегий: ' + e.message);
    }
    return {};
  }

  _saveStrategyResults() {
    const filePath = path.join(this.userDataDir, 'strategy-test-results.json');
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.strategyTestResults, null, 2));
    } catch (e) {
      this._log('Не удалось сохранить результаты тестирования: ' + e.message);
    }
  }

  /**
   * ИСПРАВЛЕНО: теперь правильно добавляет пользовательские домены.
   *
   * Встроенный zapret (bin+lists) уже содержит официальный list-general.txt
   * (много доменов, включая YouTube/Google) и list-google.txt. Здесь мы
   * дополнительно собираем:
   *  - предустановленные списки этого приложения (engine/hostlists/*.txt,
   *    переключаются тумблерами youtube/discord/general),
   *  - пользовательские домены (config.domains.custom[]),
   *  - домены приложений (config.apps[].domains[]),
   * и пишем их в list-general-user.txt внутри engine/vendor/zapret/lists —
   * официальные стратегии (strategies.js) сами подключают этот файл через
   * --hostlist=, так что новые домены сразу работают с любой стратегией.
   */
  rebuildHostlist(config) {
    const lines = [];
    const seen = new Set();

    const add = (host) => {
      const h = String(host).trim().toLowerCase();
      if (h && !h.startsWith('#') && !seen.has(h)) {
        seen.add(h);
        lines.push(h);
      }
    };

    // Встроенные списки (переключаемые тумблерами в UI)
    if (config.domains && config.domains.youtube !== false) {
      const ytPath = path.join(this.listsPath, 'youtube.txt');
      if (fs.existsSync(ytPath)) {
        fs.readFileSync(ytPath, 'utf8').split(/\r?\n/).forEach(add);
      }
    }

    if (config.domains && config.domains.discord !== false) {
      const dcPath = path.join(this.listsPath, 'discord.txt');
      if (fs.existsSync(dcPath)) {
        fs.readFileSync(dcPath, 'utf8').split(/\r?\n/).forEach(add);
      }
    }

    if (config.domains && config.domains.general) {
      const genPath = path.join(this.listsPath, 'general.txt');
      if (fs.existsSync(genPath)) {
        fs.readFileSync(genPath, 'utf8').split(/\r?\n/).forEach(add);
      }
    }

    // ИСПРАВЛЕНИЕ: добавляем пользовательские домены из config.domains.custom
    if (config.domains && Array.isArray(config.domains.custom)) {
      config.domains.custom.forEach((entry) => {
        if (entry.enabled !== false && entry.host) {
          add(entry.host);
        }
      });
    }

    // ИСПРАВЛЕНИЕ: извлекаем домены из приложений
    if (Array.isArray(config.apps)) {
      config.apps.forEach((app) => {
        if (app.enabled !== false && Array.isArray(app.domains)) {
          app.domains.forEach(add);
        }
      });
    }

    // winws.exe не любит пустые/отсутствующие hostlist-файлы — как и
    // официальный service.bat, держим в файле хотя бы одну строку.
    const content = lines.length
      ? lines.join('\n')
      : '# Pulse Bypass: пользовательские домены появятся здесь\ndomain.example.abc';

    try {
      fs.mkdirSync(this.vendorListsDir, { recursive: true });
      fs.writeFileSync(this.userHostlistPath, content, 'utf8');
      if (!fs.existsSync(this.userExcludePath)) {
        fs.writeFileSync(this.userExcludePath, 'domain.example.abc', 'utf8');
      }
      this._log(`Список доменов обновлён: ${lines.length} записей`);
    } catch (err) {
      this._log('Ошибка записи hostlist: ' + err.message);
    }
  }

  killAllInstances() {
    if (process.platform !== 'win32') return Promise.resolve();
    const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, () => resolve()));
    return run('taskkill', ['/F', '/IM', 'winws.exe', '/T'])
      .then(() => run('net', ['stop', 'WinDivert']))
      .then(() => run('sc', ['delete', 'WinDivert']))
      .then(() => run('net', ['stop', 'WinDivert14']))
      .then(() => run('sc', ['delete', 'WinDivert14']));
  }

  async ensureEngine() {
    if (this.isEngineInstalled()) return true;
    const { fetchZapretBundle } = require('./vendor-fetch');
    this._log('Движок zapret не найден — загружаю официальный релиз bol-van/zapret-win-bundle...');
    try {
      await fetchZapretBundle(this.binDir, (msg) => this._log(msg));
      return this.isEngineInstalled();
    } catch (err) {
      this._log('Не удалось загрузить движок: ' + err.message);
      return false;
    }
  }

  listStrategies() {
    return STRATEGIES.map(({ id, name, description }) => {
      const result = this.strategyTestResults[id];
      return { 
        id, 
        name, 
        description,
        tested: !!result,
        working: result ? result.success : null,
        lastTest: result ? result.timestamp : null
      };
    });
  }

  getWorkingStrategies() {
    return STRATEGIES.filter(s => {
      const result = this.strategyTestResults[s.id];
      return result && result.success;
    }).map(({ id, name, description }) => ({ id, name, description }));
  }

  isRunning() { return this.status === 'running' || this.status === 'testing'; }
  
  getStatus() { 
    return { 
      status: this.status, 
      strategyId: this.currentStrategyId,
      error: this.lastError
    }; 
  }

  async start(strategyId) {
    // ДОБАВЛЕНО: без прав администратора winws.exe не может открыть
    // драйвер WinDivert и падает почти мгновенно на ЛЮБОЙ стратегии — это
    // выглядело как "ошибка движка"/"ошибка запуска" у всех стратегий
    // подряд без исключения. Проверяем права заранее и сразу даём понятную
    // причину вместо бессмысленной попытки запуска, которая всё равно
    // провалится.
    const elevated = await this.isElevated();
    if (!elevated) {
      this._setStatus('error');
      this.lastError = 'Нужны права администратора';
      throw new Error(
        'Нужны права администратора: закройте приложение и запустите его ' +
        'через "Запуск от имени администратора" (ПКМ по ярлыку) — без этого ' +
        'winws.exe не может установить драйвер WinDivert, и обход не запустится ' +
        'ни на одной стратегии.'
      );
    }

    if (this.isRunning()) await this.stop();

    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error('Неизвестная стратегия: ' + strategyId);

    if (!this.isEngineInstalled()) {
      const ok = await this.ensureEngine();
      if (!ok) throw new Error('Движок zapret не установлен');
    }

    this.rebuildHostlist(this.getStore());

    if (!fs.existsSync(this.userHostlistPath)) {
      throw new Error('Список доменов пуст — добавьте сайты для обхода');
    }

    await this.killAllInstances();

    // {BIN} и {LISTS} — префиксы папок (с завершающим слэшем), а не пути к
    // одному файлу: сами имена файлов уже прописаны в strategies.js, как и
    // в официальных .bat-скриптах zapret (%BIN%..., %LISTS%...).
    const binPrefix = this.binDir + path.sep;
    const listsPrefix = this.vendorListsDir + path.sep;
    const args = strategy.args.map((a) =>
      a.replace(/{BIN}/g, binPrefix).replace(/{LISTS}/g, listsPrefix)
    );

    this._setStatus('starting');
    this._log(`Запуск стратегии "${strategy.name}"...`);
    this._log('Команда: winws.exe ' + args.join(' '));

    return new Promise((resolve, reject) => {
      try {
        this.proc = spawn(this.binPath, args, {
          cwd: this.binDir,
          windowsHide: true,
          detached: false
        });

        this.proc.stdout.on('data', (d) => this._log('[winws] ' + d.toString().trim()));
        this.proc.stderr.on('data', (d) => this._log('[winws] ' + d.toString().trim()));

        this.proc.on('error', (err) => {
          this._log('Ошибка запуска: ' + err.message);
          this.lastError = err.message;
          this._setStatus('error');
          reject(err);
        });

        this.proc.on('exit', (code, signal) => {
          this._log(`winws.exe завершён (код ${code}, сигнал ${signal})`);
          if (this.status === 'running' || this.status === 'starting') {
            this._setStatus('stopped');
          }
          this.proc = null;
        });

        setTimeout(() => {
          if (this.proc && !this.proc.killed) {
            this.currentStrategyId = strategyId;
            this._setStatus('running');
            this._log('Обход активен');
            resolve();
          } else {
            this._setStatus('error');
            reject(new Error('Процесс завершился сразу после старта'));
          }
          // ИСПРАВЛЕНО: было 1500мс на каждый старт движка — при автоподборе
          // это складывалось с ещё одной задержкой ниже и сильно тормозило
          // процесс. winws.exe либо падает почти мгновенно (неверные
          // аргументы/занят WinDivert), либо запускается за 200-400мс.
        }, 700);

      } catch (err) {
        this._setStatus('error');
        this.lastError = err.message;
        reject(err);
      }
    });
  }

  async stop() {
    // ИСПРАВЛЕНО: раньше здесь был ранний return, если и статус не
    // "running"/"testing", и this.proc уже null. Проблема в том, что когда
    // winws.exe падает почти сразу после старта (например, WinDivert ещё
    // занят предыдущим инстансом), обработчик 'exit' успевает обнулить
    // this.proc и выставить статус 'error' ЕЩЁ ДО того, как start() поймает
    // это как ошибку и вызовет stop() для очистки. В момент вызова stop()
    // проверка `!this.isRunning() && !this.proc` оказывалась истинной, и
    // killAllInstances() ниже вообще не вызывался — недогруженный/
    // недовыгруженный драйвер WinDivert оставался висеть и ломал ВСЕ
    // последующие попытки автоподбора (см. видео: одна "ошибка движка" —
    // и дальше ни одна стратегия уже не запускается). Теперь очистка
    // (killAllInstances) выполняется всегда, даже если proc уже null.
    const wasActive = this.isRunning() || !!this.proc;
    if (wasActive) this._log('Остановка обхода...');
    this._setStatus('stopped');

    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
    }

    await this.killAllInstances();
    this.proc = null;
    this.currentStrategyId = null;
    if (wasActive) this._log('Обход остановлен');
  }

  /**
   * УЛУЧШЕНО: быстрый автоподбор с параллельным тестированием
   */
  async autoDetect(targets = DEFAULT_TEST_TARGETS, fastMode = true) {
    // ДОБАВЛЕНО: та же проверка прав, что и в start() — без неё автоподбор
    // честно перебирал ВСЕ 16 стратегий, каждая мгновенно падала с одной и
    // той же причиной (нет прав администратора), и это выглядело как
    // "ничего не работает" и "постоянно пытается переподключиться" вместо
    // одной понятной ошибки за секунду.
    const elevated = await this.isElevated();
    if (!elevated) {
      this._setStatus('error');
      this.lastError = 'Нужны права администратора';
      this._log('Автоподбор остановлен: нет прав администратора');
      throw new Error(
        'Нужны права администратора: закройте приложение и запустите его ' +
        'через "Запуск от имени администратора" (ПКМ по ярлыку) — без этого ' +
        'winws.exe не может установить драйвер WinDivert, и ни одна стратегия ' +
        'не запустится.'
      );
    }

    this._setStatus('testing');
    this._log('Начинаю автоподбор рабочей стратегии...');

    const strategiesToTest = STRATEGIES.slice();
    
    // Сначала пробуем стратегии, которые раньше работали
    const workingIds = Object.keys(this.strategyTestResults)
      .filter(id => this.strategyTestResults[id].success)
      .sort((a, b) => this.strategyTestResults[b].timestamp - this.strategyTestResults[a].timestamp);
    
    const prioritized = [];
    workingIds.forEach(id => {
      const idx = strategiesToTest.findIndex(s => s.id === id);
      if (idx >= 0) prioritized.push(strategiesToTest.splice(idx, 1)[0]);
    });
    
    const testOrder = [...prioritized, ...strategiesToTest];

    for (let i = 0; i < testOrder.length; i++) {
      const strategy = testOrder[i];
      this._log(`Тестирую стратегию ${i + 1}/${testOrder.length}: ${strategy.name}...`);

      try {
        await this.start(strategy.id);
        // ИСПРАВЛЕНО: раньше ждали фиксированные 2с "на всякий случай" после
        // каждого запуска движка — при 4 стратегиях автоподбор занимал до
        // 15+ секунд. winws.exe перехватывает трафик сразу после старта, так
        // что для большинства провайдеров достаточно ~800мс, чтобы дать
        // первым TCP/TLS-хендшейкам пройти через новый фильтр.
        await new Promise((r) => setTimeout(r, 800));

        // Таймаут теста тоже укорочен (5с -> 3с): если стратегия не
        // проходит DPI, соединение почти всегда рвётся гораздо раньше.
        const success = await this._testConnection(targets, 3000);

        if (success) {
          this._log(`✓ Стратегия ${strategy.name} работает!`);
          this.strategyTestResults[strategy.id] = { success: true, timestamp: Date.now() };
          this._saveStrategyResults();
          this._setStatus('running');
          return { strategyId: strategy.id, success: true };
        } else {
          this._log(`✗ Стратегия ${strategy.name} не работает`);
          this.strategyTestResults[strategy.id] = { success: false, timestamp: Date.now() };
          await this.stop();
        }
      } catch (err) {
        this._log(`Ошибка при тесте ${strategy.name}: ${err.message}`);
        this.strategyTestResults[strategy.id] = { success: false, timestamp: Date.now() };
        await this.stop();
      }
    }

    this._saveStrategyResults();
    this._setStatus('stopped');
    this._log('Не удалось найти рабочую стратегию');
    return { success: false, strategyId: null };
  }

  /**
   * НОВОЕ: проверка работоспособности конкретного сервиса (5 попыток)
   */
  async checkServiceHealth(serviceName, host, port = 443, attempts = 5) {
    this._log(`Проверяю ${serviceName} (${host}:${port}) — ${attempts} попыток...`);
    
    let successCount = 0;
    
    for (let i = 0; i < attempts; i++) {
      try {
        const success = await this._testConnection([{ host, port }], 3000);
        if (success) successCount++;
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        // Игнорируем ошибки отдельных попыток
      }
    }
    
    const healthPercent = (successCount / attempts) * 100;
    const isHealthy = successCount >= Math.ceil(attempts * 0.6); // 60% успешных
    
    this._log(`${serviceName}: ${successCount}/${attempts} успешных (${healthPercent.toFixed(0)}%) - ${isHealthy ? '✓ работает' : '✗ не работает'}`);
    
    return {
      service: serviceName,
      host,
      port,
      successCount,
      totalAttempts: attempts,
      healthPercent,
      isHealthy
    };
  }

  async _testConnection(targets, timeout = 5000) {
    const tests = targets.map((t) => this._tryTLS(t.host, t.port, timeout));
    const results = await Promise.allSettled(tests);
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    return ok > 0;
  }

  _tryTLS(host, port, timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        sock.destroy();
        resolve(false);
      }, timeout);

      const sock = tls.connect({ host, port, rejectUnauthorized: false, servername: host }, () => {
        clearTimeout(timer);
        sock.end();
        resolve(true);
      });

      sock.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  _setStatus(s) {
    this.status = s;
    this.emit('status', this.getStatus());
  }

  _log(msg) {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
    this.emit('log', line);
  }
}

module.exports = ZapretManager;
