'use strict';

const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const tls = require('tls');

const { STRATEGIES, getStrategy } = require('./strategies');

const DEFAULT_TEST_TARGETS = [
  { host: 'www.youtube.com', port: 443 },
  { host: 'discord.com', port: 443 }
];

/**
 * ZapretManager отвечает за:
 *  - сборку общего hostlist-файла из встроенных списков + доменов пользователя,
 *  - запуск/остановку winws.exe с аргументами выбранной стратегии,
 *  - автоподбор рабочей стратегии перебором с проверкой TLS-соединения.
 *
 * Важно: winws.exe перехватывает трафик по домену/порту глобально (через
 * WinDivert), а не по конкретному exe-процессу. Список «приложений» в
 * интерфейсе — это удобная привязка «приложение → его домены», а не
 * пер-процессная фильтрация трафика (такое штатно не поддерживается ни
 * WinDivert, ни zapret).
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
    this.status = 'stopped'; // stopped | starting | running | testing | error
    this.lastError = null;
  }

  get binPath() {
    return path.join(this.resourcesPath, process.platform === 'win32' ? 'winws.exe' : 'winws');
  }

  isEngineInstalled() {
    try { return fs.existsSync(this.binPath); } catch (e) { return false; }
  }

  /** Принудительно убивает ВСЕ процессы winws.exe в системе, а не только тот,
   *  что запустила текущая сессия приложения. Это нужно на случай, если
   *  предыдущий запуск приложения был закрыт аварийно (сбой, "Завершить
   *  процесс" в диспетчере задач) — Windows не убивает дочерние процессы
   *  автоматически при падении родителя, и осиротевший winws.exe продолжает
   *  перехватывать трафик через WinDivert в фоне, никак не будучи виден
   *  текущей сессии приложения. Вызывается перед стартом и при остановке.
   *
   *  WinDivert — это драйвер уровня ядра, который регистрируется как
   *  ОТДЕЛЬНАЯ служба Windows ("WinDivert"/"WinDivert14"), а не просто
   *  хендл внутри процесса winws.exe. Убийство самого процесса останавливает
   *  активный перехват (без открытого хендла драйвер ничего не изменяет),
   *  но сама служба может остаться загруженной в системе. Поэтому вдобавок
   *  явно останавливаем и удаляем её — как это делает штатный service.bat
   *  из официальной сборки zapret.
   */
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
      await fetchZapretBundle(this.resourcesPath, (msg) => this._log(msg));
      return this.isEngineInstalled();
    } catch (err) {
      this._log('Не удалось загрузить движок: ' + err.message);
      return false;
    }
  }

  listStrategies() {
    return STRATEGIES.map(({ id, name, description }) => ({ id, name, description }));
  }

  isRunning() { return this.status === 'running' || this.status === 'testing'; }
  getStatus() { return { status: this.status, strategyId: this.currentStrategyId, error: this.lastError }; }

  _setStatus(status, extra) {
    this.status = status;
    this.emit('status', { status, strategyId: this.currentStrategyId, ...extra });
  }

  _log(line) {
    const stamped = `[${new Date().toLocaleTimeString('ru-RU')}] ${line}`;
    this.emit('log', stamped);
    try {
      fs.appendFileSync(path.join(this.logsDir, 'pulse-bypass.log'), stamped + '\n');
    } catch (e) {}
  }

  /** Собирает общий hostlist из встроенных списков + пользовательских доменов. */
  rebuildHostlist(config) {
    const lines = new Set();
    const cfg = config || (this.getStore ? this.getStore() : {});
    const domains = (cfg && cfg.domains) || {};

    const readBuiltin = (file) => {
      try {
        return fs.readFileSync(path.join(this.listsPath, file), 'utf8')
          .split('\n').map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'));
      } catch (e) { return []; }
    };

    if (domains.youtube !== false) readBuiltin('youtube.txt').forEach((h) => lines.add(h));
    if (domains.discord !== false) readBuiltin('discord.txt').forEach((h) => lines.add(h));
    if (domains.general) readBuiltin('general.txt').forEach((h) => lines.add(h));

    (domains.custom || []).forEach((d) => {
      if (d && d.enabled !== false && d.host) lines.add(String(d.host).trim().toLowerCase());
    });

    const outPath = path.join(this.runtimeDir, 'hostlist.txt');
    fs.writeFileSync(outPath, Array.from(lines).join('\n') + '\n', 'utf8');
    return outPath;
  }

  _buildArgs(strategyId, hostlistPath) {
    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error('Неизвестная стратегия: ' + strategyId);
    return strategy.args.map((a) => a.replace('{LISTS}', hostlistPath));
  }

  /** Запускает winws.exe с указанной стратегией. */
  async start(strategyId) {
    if (this.proc) await this.stop();
    await this.killAllInstances();

    const installed = await this.ensureEngine();
    if (!installed) {
      this.lastError = 'engine_missing';
      this._setStatus('error');
      throw new Error('Движок zapret не установлен. Нажмите «Установить движок» и повторите.');
    }

    const hostlistPath = this.rebuildHostlist(this.getStore ? this.getStore() : {});
    const args = this._buildArgs(strategyId, hostlistPath);
    this.currentStrategyId = strategyId;
    this._setStatus('starting');
    this._log(`Запуск winws.exe со стратегией "${getStrategy(strategyId).name}"`);

    return new Promise((resolve, reject) => {
      try {
        this.proc = spawn(this.binPath, args, {
          cwd: this.resourcesPath,
          windowsHide: true
        });
      } catch (err) {
        this.lastError = err.message;
        this._setStatus('error');
        return reject(err);
      }

      let resolved = false;
      const onData = (buf) => {
        const text = buf.toString('utf8');
        text.split('\n').filter(Boolean).forEach((l) => this._log(l.trim()));
        if (!resolved) {
          resolved = true;
          this._setStatus('running');
          resolve(true);
        }
      };

      this.proc.stdout.on('data', onData);
      this.proc.stderr.on('data', onData);

      this.proc.on('exit', (code, signal) => {
        this._log(`winws.exe завершился (code=${code}, signal=${signal})`);
        this.proc = null;
        this._setStatus('stopped');
      });

      this.proc.on('error', (err) => {
        this.lastError = err.message;
        this._log('Ошибка запуска winws.exe: ' + err.message);
        this._setStatus('error');
        if (!resolved) { resolved = true; reject(err); }
      });

      // Если процесс за 1.5с не выдал вывод и не упал — считаем, что стартовал успешно (тихий режим).
      setTimeout(() => {
        if (!resolved && this.proc) {
          resolved = true;
          this._setStatus('running');
          resolve(true);
        }
      }, 1500);
    });
  }

  async stop() {
    if (!this.proc) {
      // Даже если у текущей сессии нет своего процесса — на всякий случай
      // убиваем любой осиротевший winws.exe от предыдущего запуска, иначе
      // он молча продолжит перехватывать трафик в фоне.
      await this.killAllInstances();
      this._setStatus('stopped');
      return true;
    }
    await new Promise((resolve) => {
      const p = this.proc;
      const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 2000);
      p.once('exit', () => { clearTimeout(timer); resolve(); });
      try { p.kill(); } catch (e) { resolve(); }
      this.proc = null;
      this.currentStrategyId = null;
    });
    // Подчищаем и системно — WinDivert-хук иногда переживает завершение
    // основного процесса на долю секунды, а также ловим любые другие копии.
    await this.killAllInstances();
    this._setStatus('stopped');
    return true;
  }

  /** Проверяет, что TLS-хендшейк с host:port проходит (косвенный признак, что домен не режется DPI). */
  _testTls(host, port, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const socket = tls.connect(
        { host, port, servername: host, timeout: timeoutMs, rejectUnauthorized: false },
        () => { socket.end(); resolve(true); }
      );
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });
  }

  /**
   * Перебирает стратегии по очереди: запускает, ждёт, проверяет доступность
   * целевых доменов, останавливает при неудаче и пробует следующую.
   * Останавливается на первой стратегии, где все проверки прошли успешно.
   */
  async autoDetect(targets) {
    const testTargets = (targets && targets.length ? targets : DEFAULT_TEST_TARGETS);
    this._setStatus('testing');
    this._log('Автоподбор стратегии запущен — проверяю ' + STRATEGIES.length + ' вариантов…');

    for (const strategy of STRATEGIES) {
      this._log(`→ пробую "${strategy.name}"`);
      try {
        await this.start(strategy.id);
      } catch (err) {
        this._log(`  не удалось запустить: ${err.message}`);
        continue;
      }

      // Дать WinDivert время перехватить сокеты и прогреться.
      await new Promise((r) => setTimeout(r, 1200));

      let allOk = true;
      for (const t of testTargets) {
        const ok = await this._testTls(t.host, t.port);
        this._log(`  ${t.host}:${t.port} → ${ok ? 'OK' : 'не отвечает'}`);
        if (!ok) { allOk = false; break; }
      }

      if (allOk) {
        this._log(`✓ Стратегия "${strategy.name}" подходит, оставляю включённой.`);
        this._setStatus('running');
        return { success: true, strategyId: strategy.id, strategyName: strategy.name };
      }

      await this.stop();
    }

    this._log('✗ Ни одна стратегия не сработала. Попробуйте позже или добавьте свою в engine/strategies.js.');
    this._setStatus('stopped');
    return { success: false, strategyId: null };
  }
}

module.exports = ZapretManager;
