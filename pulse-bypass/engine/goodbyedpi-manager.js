'use strict';

const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const tls = require('tls');
const https = require('https');

const { STRATEGIES, getStrategy } = require('./goodbyedpi-strategies');

const DEFAULT_TEST_TARGETS = [
  { host: 'www.youtube.com', port: 443 },
  { host: 'discord.com', port: 443 }
];

/**
 * GoodbyeDPI Manager — управляет движком GoodbyeDPI для обхода DPI.
 * Заменяет zapret-manager.js.
 * 
 * Особенности:
 * - Простое управление процессом goodbyedpi.exe
 * - Полное завершение процессов при остановке
 * - Санитизация доменов для --blacklist
 * - Автоподбор стратегии с HTTPS-тестированием
 * - Сохранение результатов тестирования
 */
class GoodbyeDPImanager extends EventEmitter {
  constructor({ resourcesPath, listsPath, getStore }) {
    super();
    this.resourcesPath = resourcesPath;
    this.listsPath = listsPath;
    this.getStore = getStore;

    this.userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'pulse-bypass');
    this.logsDir = path.join(this.userDataDir, 'logs');
    for (const dir of [this.userDataDir, this.logsDir]) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }

    this.proc = null;
    this.currentStrategyId = null;
    this.status = 'stopped';
    this.lastError = null;
    
    this.strategyTestResults = this._loadStrategyResults();
  }

  get binDir() {
    return path.join(this.resourcesPath, 'bin');
  }

  get binPath() {
    return path.join(this.binDir, process.platform === 'win32' ? 'goodbyedpi.exe' : 'goodbyedpi');
  }

  get blacklistDir() {
    return path.join(this.resourcesPath, 'lists');
  }

  get blacklistPath() {
    return path.join(this.blacklistDir, 'pulse-blacklist.txt');
  }

  get youtubeBlacklistPath() {
    return path.join(this.blacklistDir, 'russia-youtube.txt');
  }

  isEngineInstalled() {
    try { return fs.existsSync(this.binPath); } catch (e) { return false; }
  }

  isElevated() {
    if (process.platform !== 'win32') return Promise.resolve(true);
    return new Promise((resolve) => {
      execFile('net', ['session'], (err) => resolve(!err));
    });
  }

  _loadStrategyResults() {
    const filePath = path.join(this.userDataDir, 'gd-strategy-test-results.json');
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (e) {}
    return {};
  }

  _saveStrategyResults() {
    const filePath = path.join(this.userDataDir, 'gd-strategy-test-results.json');
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.strategyTestResults, null, 2));
    } catch (e) {}
  }

  _sanitizeDomain(host) {
    let h = String(host).trim().toLowerCase();
    h = h.replace(/^https?:\/\//, '');
    h = h.split('/')[0].split('?')[0].split('#')[0];
    h = h.split(':')[0];
    h = h.replace(/\.$/, '');
    return h;
  }

  /**
   * Собирает blacklist для GoodbyeDPI из пользовательских доменов.
   * Формат: один домен на строку, комментарии начинаются с #.
   */
  rebuildBlacklist(config) {
    const lines = [];
    const seen = new Set();

    const add = (host) => {
      const h = this._sanitizeDomain(host);
      if (h && !h.startsWith('#') && !seen.has(h) && h.includes('.')) {
        seen.add(h);
        lines.push(h);
      }
    };

    // YouTube домены
    if (config.domains && config.domains.youtube !== false) {
      const ytPath = path.join(this.listsPath, 'youtube.txt');
      if (fs.existsSync(ytPath)) {
        fs.readFileSync(ytPath, 'utf8').split(/\r?\n/).forEach(add);
      }
    }

    // Discord домены
    if (config.domains && config.domains.discord !== false) {
      const dcPath = path.join(this.listsPath, 'discord.txt');
      if (fs.existsSync(dcPath)) {
        fs.readFileSync(dcPath, 'utf8').split(/\r?\n/).forEach(add);
      }
    }

    // Общий список
    if (config.domains && config.domains.general) {
      const genPath = path.join(this.listsPath, 'general.txt');
      if (fs.existsSync(genPath)) {
        fs.readFileSync(genPath, 'utf8').split(/\r?\n/).forEach(add);
      }
    }

    // Пользовательские домены
    if (config.domains && Array.isArray(config.domains.custom)) {
      config.domains.custom.forEach((entry) => {
        if (entry.enabled !== false && entry.host) {
          add(entry.host);
        }
      });
    }

    // Домены приложений
    if (Array.isArray(config.apps)) {
      config.apps.forEach((app) => {
        if (app.enabled !== false && Array.isArray(app.domains)) {
          app.domains.forEach(add);
        }
      });
    }

    const content = lines.length
      ? lines.join('\n')
      : '# Pulse Bypass: добавьте сайты для обхода';

    try {
      fs.mkdirSync(this.blacklistDir, { recursive: true });
      fs.writeFileSync(this.blacklistPath, content, 'utf8');
      this._log(`Blacklist обновлён: ${lines.length} доменов`);
    } catch (err) {
      this._log('Ошибка записи blacklist: ' + err.message);
    }
  }

  /**
   * Полное завершение всех процессов goodbyedpi.exe и драйвера WinDivert.
   */
  killAllInstances() {
    if (process.platform !== 'win32') return Promise.resolve();
    const run = (cmd, args) => new Promise((resolve) => {
      execFile(cmd, args, { windowsHide: true }, () => resolve());
    });

    const killByPid = this.proc && this.proc.pid
      ? run('taskkill', ['/F', '/T', '/PID', String(this.proc.pid)])
      : Promise.resolve();

    return killByPid
      .then(() => run('taskkill', ['/F', '/IM', 'goodbyedpi.exe', '/T']))
      .then(() => run('net', ['stop', 'WinDivert']))
      .then(() => run('sc', ['delete', 'WinDivert']))
      .then(() => run('net', ['stop', 'WinDivert14']))
      .then(() => run('sc', ['delete', 'WinDivert14']))
      .catch(() => {});
  }

  async ensureEngine() {
    if (this.isEngineInstalled()) return true;
    const { fetchGoodbyeDPIBundle } = require('./vendor-fetch-gd');
    this._log('Движок GoodbyeDPI не найден — загружаю...');
    try {
      await fetchGoodbyeDPIBundle(this.binDir, (msg) => this._log(msg));
      return this.isEngineInstalled();
    } catch (err) {
      this._log('Не удалось загрузить движок: ' + err.message);
      return false;
    }
  }

  listStrategies() {
    return STRATEGIES.map(({ id, name, description, recommended }) => {
      const result = this.strategyTestResults[id];
      return { 
        id, name, description, recommended,
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
    return { status: this.status, strategyId: this.currentStrategyId, error: this.lastError }; 
  }

  async start(strategyId) {
    const elevated = await this.isElevated();
    if (!elevated) {
      this._setStatus('error');
      this.lastError = 'Нужны права администратора';
      throw new Error(
        'Нужны права администратора: закройте приложение и запустите его ' +
        'через "Запуск от имени администратора" (ПКМ по ярлыку).'
      );
    }

    if (this.isRunning()) await this.stop();

    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error('Неизвестная стратегия: ' + strategyId);

    if (!this.isEngineInstalled()) {
      const ok = await this.ensureEngine();
      if (!ok) throw new Error('Движок GoodbyeDPI не установлен');
    }

    this.rebuildBlacklist(this.getStore());

    if (!fs.existsSync(this.blacklistPath)) {
      throw new Error('Список доменов пуст — добавьте сайты для обхода');
    }

    await this.killAllInstances();

    // Собираем аргументы: режим стратегии + blacklist
    const args = [...strategy.args, '--blacklist', this.blacklistPath];
    
    // Добавляем YouTube blacklist если существует
    if (fs.existsSync(this.youtubeBlacklistPath)) {
      args.push('--blacklist', this.youtubeBlacklistPath);
    }

    this._setStatus('starting');
    this._log(`Запуск стратегии "${strategy.name}"...`);
    this._log('Команда: goodbyedpi.exe ' + args.join(' '));

    return new Promise((resolve, reject) => {
      try {
        const child = spawn(this.binPath, args, {
          cwd: this.binDir,
          windowsHide: true,
          detached: false
        });

        this.proc = child;

        child.stdout.on('data', (d) => this._log('[gd] ' + d.toString().trim()));
        child.stderr.on('data', (d) => this._log('[gd] ' + d.toString().trim()));

        child.on('error', (err) => {
          this._log('Ошибка запуска: ' + err.message);
          this.lastError = err.message;
          this._setStatus('error');
          if (this.proc === child) this.proc = null;
          reject(err);
        });

        child.on('exit', (code, signal) => {
          this._log(`goodbyedpi.exe завершён (код ${code}, сигнал ${signal})`);
          if (this.proc === child) {
            if (this.status === 'running' || this.status === 'starting') {
              this._setStatus('stopped');
            }
            this.proc = null;
          }
        });

        setTimeout(() => {
          if (this.proc === child && child.exitCode === null) {
            this.currentStrategyId = strategyId;
            this._setStatus('running');
            this._log('Обход активен');
            resolve();
          } else {
            this._setStatus('error');
            if (this.proc === child) this.proc = null;
            reject(new Error('Процесс завершился сразу после старта'));
          }
        }, 700);

      } catch (err) {
        this._setStatus('error');
        this.lastError = err.message;
        reject(err);
      }
    });
  }

  async stop() {
    const wasActive = this.isRunning() || !!this.proc;
    if (wasActive) this._log('Остановка обхода...');
    this._setStatus('stopped');

    if (this.proc && this.proc.pid) {
      if (process.platform === 'win32') {
        await new Promise((resolve) => {
          execFile('taskkill', ['/F', '/T', '/PID', String(this.proc.pid)],
            { windowsHide: true }, () => resolve());
        });
      } else {
        this.proc.kill('SIGTERM');
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    await this.killAllInstances();
    this.proc = null;
    this.currentStrategyId = null;
    if (wasActive) this._log('Обход остановлен, все процессы завершены');
  }

  /**
   * Автоподбор стратегии с HTTPS-тестированием.
   * Перебирает режимы от -9 до -1, тестирует каждый.
   */
  async autoDetect(targets = DEFAULT_TEST_TARGETS) {
    const elevated = await this.isElevated();
    if (!elevated) {
      this._setStatus('error');
      this.lastError = 'Нужны права администратора';
      throw new Error('Нужны права администратора.');
    }

    // Добавляем пользовательские домены к тестовым целям
    const config = this.getStore();
    const userTargets = [...targets];
    const seenHosts = new Set(targets.map(t => t.host));
    
    if (config.domains && Array.isArray(config.domains.custom)) {
      config.domains.custom.forEach((entry) => {
        if (entry.enabled !== false && entry.host) {
          const h = this._sanitizeDomain(entry.host);
          if (h && h.includes('.') && !seenHosts.has(h)) {
            seenHosts.add(h);
            userTargets.push({ host: h, port: 443 });
          }
        }
      });
    }

    if (Array.isArray(config.apps)) {
      config.apps.forEach((app) => {
        if (app.enabled !== false && Array.isArray(app.domains)) {
          app.domains.forEach((domain) => {
            const h = this._sanitizeDomain(domain);
            if (h && h.includes('.') && !seenHosts.has(h)) {
              seenHosts.add(h);
              userTargets.push({ host: h, port: 443 });
            }
          });
        }
      });
    }

    const testTargets = userTargets.slice(0, 6);
    this._log(`Тестовые цели: ${testTargets.map(t => t.host).join(', ')}`);

    this._setStatus('testing');
    this._log('Автоподбор стратегии GoodbyeDPI...');

    // Сортируем: сначала рекомендуемые, потом ранее работавшие
    const strategiesToTest = STRATEGIES.slice();
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
      this._log(`Тестирую ${i + 1}/${testOrder.length}: ${strategy.name}...`);

      try {
        await this.start(strategy.id);
        await new Promise((r) => setTimeout(r, 1000));

        const success = await this._testConnection(testTargets, 5000);

        if (success) {
          this._log(`✓ Стратегия "${strategy.name}" работает!`);
          this.strategyTestResults[strategy.id] = { success: true, timestamp: Date.now() };
          this._saveStrategyResults();
          this._setStatus('running');
          return { strategyId: strategy.id, success: true };
        } else {
          this._log(`✗ Стратегия "${strategy.name}" не работает`);
          this.strategyTestResults[strategy.id] = { success: false, timestamp: Date.now() };
          await this.stop();
        }
      } catch (err) {
        this._log(`Ошибка при тесте "${strategy.name}": ${err.message}`);
        this.strategyTestResults[strategy.id] = { success: false, timestamp: Date.now() };
        await this.stop();
      }
    }

    this._saveStrategyResults();
    this._setStatus('stopped');
    this._log('Не удалось найти рабочую стратегию');
    return { success: false, strategyId: null };
  }

  async checkServiceHealth(serviceName, host, port = 443, attempts = 5) {
    this._log(`Проверяю ${serviceName} (${host}:${port}) — ${attempts} попыток...`);
    
    let successCount = 0;
    for (let i = 0; i < attempts; i++) {
      try {
        const success = await this._testConnection([{ host, port }], 5000);
        if (success) successCount++;
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {}
    }
    
    const healthPercent = (successCount / attempts) * 100;
    const isHealthy = successCount >= Math.ceil(attempts * 0.6);
    
    this._log(`${serviceName}: ${successCount}/${attempts} (${healthPercent.toFixed(0)}%) - ${isHealthy ? '✓' : '✗'}`);
    
    return {
      service: serviceName, host, port,
      successCount, totalAttempts: attempts,
      healthPercent, isHealthy
    };
  }

  /**
   * HTTPS GET тест с fallback на TLS handshake.
   * Любой HTTP-ответ = соединение прошло через DPI.
   */
  async _testConnection(targets, timeout = 5000) {
    const tests = targets.map((t) => this._tryConnect(t.host, t.port, timeout));
    const results = await Promise.allSettled(tests);
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    return ok > 0;
  }

  _tryConnect(host, port, timeout) {
    return new Promise((resolve) => {
      let settled = false;
      let req;
      
      const done = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const timer = setTimeout(() => {
        if (req) req.destroy();
        this._tryTLS(host, port, 3000).then(done);
      }, timeout);

      req = https.request({
        hostname: host,
        port: port,
        path: '/',
        method: 'GET',
        rejectUnauthorized: false,
        timeout: timeout,
        headers: { 'User-Agent': 'Mozilla/5.0 PulseBypass/3.0' }
      }, (res) => {
        clearTimeout(timer);
        res.destroy();
        done(true);
      });

      req.on('error', () => {
        clearTimeout(timer);
        this._tryTLS(host, port, 3000).then(done);
      });

      req.on('timeout', () => {
        req.destroy();
        clearTimeout(timer);
        this._tryTLS(host, port, 3000).then(done);
      });

      req.end();
    });
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

module.exports = GoodbyeDPImanager;
