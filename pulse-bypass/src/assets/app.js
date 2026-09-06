(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const isDesktop = typeof window.desktop !== 'undefined' && window.desktop.isDesktop;

  /* ==================================================================== */
  /* 1. Титлбар */
  /* ==================================================================== */
  if (isDesktop) {
    $('tbMinimize').addEventListener('click', () => window.desktop.minimizeSelf());
    $('tbClose').addEventListener('click', () => window.desktop.closeSelf());
    $('tbMaximize').addEventListener('click', () => window.desktop.toggleMaximizeSelf());

    const iconMax = $('tbMaximizeIconMax'), iconRestore = $('tbMaximizeIconRestore');
    const setMaxIcon = (max) => {
      iconMax.style.display = max ? 'none' : '';
      iconRestore.style.display = max ? '' : 'none';
    };
    window.desktop.onWindowState((s) => setMaxIcon(s === 'maximized'));
    window.desktop.isMaximizedSelf().then(setMaxIcon);
    document.querySelector('.titlebar-left').addEventListener('dblclick', () => window.desktop.toggleMaximizeSelf());
  } else {
    document.body.style.paddingTop = '0';
  }

  /* ==================================================================== */
  /* 2. Тост */
  /* ==================================================================== */
  const toastEl = $('toast');
  let toastTimer = null;
  function toast(html) {
    toastEl.innerHTML = html;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  /* ==================================================================== */
  /* 3. Бургер-меню */
  /* ==================================================================== */
  const burgerBtn = $('burgerBtn');
  const burgerMenu = $('burgerMenu');
  function closeBurger() {
    burgerMenu.classList.remove('open');
    burgerBtn.classList.remove('open');
    burgerBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleBurger() {
    const willOpen = !burgerMenu.classList.contains('open');
    burgerMenu.classList.toggle('open', willOpen);
    burgerBtn.classList.toggle('open', willOpen);
    burgerBtn.setAttribute('aria-expanded', String(willOpen));
  }
  burgerBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleBurger(); });
  document.addEventListener('click', (e) => { if (!burgerMenu.contains(e.target)) closeBurger(); });

  /* ==================================================================== */
  /* 4. Состояние приложения */
  /* ==================================================================== */
  const hasEngine = typeof window.pulse !== 'undefined';
  let config = { domains: { youtube: true, discord: true, general: false, custom: [] }, apps: [] };
  let strategies = [];
  let engineStatus = { status: 'stopped', strategyId: null };
  let serviceHealth = {};

  const strategySelect = $('strategySelect');
  const toggleBtn = $('toggleBtn');
  const autoDetectBtn = $('autoDetectBtn');
  const checkHealthBtn = $('checkHealthBtn');
  const statusDot = $('statusDot');
  const statusText = $('statusText');
  const engineStateLabel = $('engineStateLabel');
  const tbDot = $('tbDot');
  const engineWarning = $('engineWarning');
  const logBox = $('logBox');

  const STATUS_LABELS = {
    stopped: 'обход выключен',
    starting: 'запуск…',
    running: 'обход активен',
    testing: 'подбираю стратегию…',
    error: 'ошибка движка'
  };

  function renderStrategies() {
    // УЛУЧШЕНО: показываем только рабочие стратегии, если есть протестированные
    const working = strategies.filter(s => s.working === true);
    const toShow = working.length > 0 ? working : strategies;
    
    strategySelect.innerHTML = toShow.map((s) => {
      let badge = '';
      if (s.tested) {
        badge = s.working ? ' ✓' : ' ✗';
      }
      return `<option value="${s.id}" title="${escapeHtml(s.description)}">${escapeHtml(s.name)}${badge}</option>`;
    }).join('');
    
    if (engineStatus.strategyId) strategySelect.value = engineStatus.strategyId;
  }

  function renderStatus() {
    const st = engineStatus.status || 'stopped';
    statusText.textContent = STATUS_LABELS[st] || st;
    engineStateLabel.textContent = STATUS_LABELS[st] || st;

    statusDot.style.background = '';
    tbDot.className = 'titlebar-dot ' + ({
      running: 'pb-on', testing: 'pb-testing', starting: 'pb-testing', error: 'pb-error'
    }[st] || 'pb-off');

    const busy = st === 'starting' || st === 'testing';
    toggleBtn.disabled = busy;
    autoDetectBtn.disabled = busy;

    if (st === 'running') {
      toggleBtn.textContent = 'остановить обход';
      toggleBtn.classList.add('pb-active');
    } else if (busy) {
      toggleBtn.textContent = st === 'testing' ? 'подбор стратегии…' : 'запуск…';
      toggleBtn.classList.remove('pb-active');
    } else {
      toggleBtn.textContent = 'запустить обход';
      toggleBtn.classList.remove('pb-active');
    }

    if (engineStatus.strategyId) strategySelect.value = engineStatus.strategyId;
  }

  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
  }

  /* ==================================================================== */
  /* НОВОЕ: Отображение индикаторов работоспособности сервисов */
  /* ==================================================================== */
  function renderServiceHealth() {
    const youtubeHealth = serviceHealth['YouTube'];
    const discordHealth = serviceHealth['Discord'];
    
    const youtubeLabel = $('chkYoutube').nextSibling;
    const discordLabel = $('chkDiscord').nextSibling;
    
    if (youtubeHealth) {
      const indicator = youtubeHealth.isHealthy ? ' <span style="color: #4ade80;">✓</span>' : ' <span style="color: #f87171;">✗</span>';
      if (youtubeLabel.nodeType === Node.TEXT_NODE) {
        const text = youtubeLabel.textContent.replace(/ [✓✗]$/, '');
        youtubeLabel.textContent = text;
        const span = document.createElement('span');
        span.innerHTML = indicator;
        youtubeLabel.parentNode.appendChild(span);
      }
    }
    
    if (discordHealth) {
      const indicator = discordHealth.isHealthy ? ' <span style="color: #4ade80;">✓</span>' : ' <span style="color: #f87171;">✗</span>';
      if (discordLabel.nodeType === Node.TEXT_NODE) {
        const text = discordLabel.textContent.replace(/ [✓✗]$/, '');
        discordLabel.textContent = text;
        const span = document.createElement('span');
        span.innerHTML = indicator;
        discordLabel.parentNode.appendChild(span);
      }
    }
  }

  function renderDomainChips() {
    const list = (config.domains && config.domains.custom) || [];
    const box = $('customDomainList');
    if (!list.length) { box.innerHTML = '<div class="pb-chip-empty">свои сайты пока не добавлены</div>'; return; }
    box.innerHTML = list.map((d) =>
      `<span class="pb-chip" data-id="${d.id}">${escapeHtml(d.host)}<button data-remove-domain="${d.id}" title="удалить">✕</button></span>`
    ).join('');
  }

  function renderApps() {
    const list = config.apps || [];
    const box = $('appList');
    if (!list.length) { box.innerHTML = '<div class="pb-chip-empty">приложения пока не добавлены</div>'; return; }
    // ИСПРАВЛЕНО: раньше у добавленного приложения не было способа указать
    // его домены — поле domains оставалось пустым навсегда, поэтому обход
    // никогда не подхватывал трафик этого приложения. Теперь у каждого
    // приложения есть своя строка добавления домена (использует тот же
    // config:addAppDomain, что уже был в main.js, но не был подключён к UI).
    box.innerHTML = list.map((a) => `
      <div class="pb-app-item" data-id="${a.id}">
        <div class="pb-app-item-top">
          <div>
            <div class="pb-app-name">${escapeHtml(a.name)}</div>
            <div class="pb-app-path">${escapeHtml(a.exePath)}</div>
            ${Array.isArray(a.domains) && a.domains.length > 0 ? `<div class="pb-app-domains">домены: ${a.domains.map(escapeHtml).join(', ')}</div>` : '<div class="pb-app-domains pb-app-domains-empty">домены не заданы — трафик приложения не будет обходиться, пока вы не добавите хотя бы один домен ниже</div>'}
          </div>
          <button data-remove-app="${a.id}" title="удалить приложение">✕</button>
        </div>
        <div class="pb-add-row pb-app-add-row">
          <input type="text" data-app-domain-input="${a.id}" placeholder="домен приложения — например: api.example.com" spellcheck="false" autocomplete="off">
          <button class="ghost-btn" data-add-app-domain="${a.id}">добавить</button>
        </div>
      </div>`).join('');
  }

  function renderSettings() {
    $('chkYoutube').checked = config.domains.youtube !== false;
    $('chkDiscord').checked = config.domains.discord !== false;
    $('chkGeneral').checked = !!config.domains.general;
    $('chkAutostart').checked = !!config.autostartEngine;
    $('chkLaunchBoot').checked = !!config.launchOnBoot;
    $('chkTray').checked = config.minimizeToTrayOnClose !== false;
  }

  function appendLog(line) {
    if (logBox.querySelector('.pb-log-empty')) logBox.innerHTML = '';
    const atBottom = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 6;
    const row = document.createElement('div');
    row.textContent = line;
    logBox.appendChild(row);
    while (logBox.childNodes.length > 300) logBox.removeChild(logBox.firstChild);
    if (atBottom) logBox.scrollTop = logBox.scrollHeight;
  }

  /* ==================================================================== */
  /* 5. Загрузка начального состояния */
  /* ==================================================================== */
  async function init() {
    if (!hasEngine) {
      engineWarning.style.display = '';
      engineWarning.textContent = 'window.pulse недоступен — вы открыли интерфейс не через Electron-приложение, часть функций работать не будет.';
      logBox.innerHTML = '<div class="pb-log-empty">журнал появится при запуске в приложении</div>';
      return;
    }

    const state = await window.pulse.getState();
    strategies = state.strategies || [];
    config = state.config || config;
    engineStatus = state.status || engineStatus;
    serviceHealth = state.serviceHealth || {};

    // ДОБАВЛЕНО: постоянное предупреждение, если приложение запущено без
    // прав администратора — иначе пользователь узнаёт об этом только после
    // клика "запустить обход", когда ВСЕ стратегии подряд падают с неясной
    // "ошибка движка"/"ошибка запуска" (winws.exe не может открыть
    // WinDivert без прав администратора).
    if (state.isElevated === false) {
      engineWarning.style.display = '';
      engineWarning.className = 'pb-note err';
      engineWarning.innerHTML =
        'Запущено без прав администратора — обход не сможет запуститься ни на одной ' +
        'стратегии. Закройте приложение и запустите его через «Запуск от имени администратора».';
    } else if (!state.engineReady) {
      engineWarning.style.display = '';
      engineWarning.className = 'pb-note err';
      engineWarning.innerHTML = 'Движок zapret (winws.exe) не установлен. Нажмите «переустановить движок» в меню.';
    }

    renderStrategies();
    renderStatus();
    renderDomainChips();
    renderApps();
    renderSettings();
    renderServiceHealth();
  }

  /* ==================================================================== */
  /* 6. Обработчики событий */
  /* ==================================================================== */
  
  // Переключатель обхода.
  // ИСПРАВЛЕНО: если на этом устройстве/у этого провайдера ещё ни одна
  // стратегия не подтверждена рабочей, кнопка теперь сама запускает
  // автоподбор вместо того, чтобы слепо стартовать то, что выбрано в
  // списке (обычно первую по умолчанию — "General") — она вполне может не
  // проходить именно через DPI конкретного провайдера. Так же ведёт себя
  // Happ Proxy и подобные: одна кнопка, которая сама находит рабочий вариант.
  toggleBtn.addEventListener('click', async () => {
    if (!hasEngine) return;
    if (engineStatus.status === 'running') {
      await window.pulse.stop();
      return;
    }

    const hasConfirmedWorking = strategies.some((s) => s.working === true);
    if (!hasConfirmedWorking) {
      await runAutoDetect('Ни одна стратегия ещё не проверена на этом устройстве — подбираю рабочую…');
      return;
    }

    const id = strategySelect.value;
    if (!id) { toast('Выберите стратегию'); return; }
    try {
      await window.pulse.start(id);
      toast('Обход запущен');
    } catch (err) {
      toast('Ошибка: ' + err.message);
    }
  });

  async function runAutoDetect(startToast) {
    if (startToast) toast(startToast);
    try {
      const result = await window.pulse.autoDetect();
      const state = await window.pulse.getState();
      strategies = state.strategies || [];
      engineStatus = state.status || engineStatus;
      renderStrategies();
      renderStatus();
      toast(result.success ? '✓ Найдена рабочая стратегия, обход запущен' : '✗ Не удалось найти рабочую стратегию');
      return result;
    } catch (err) {
      toast('Ошибка автоподбора: ' + err.message);
      return { success: false };
    }
  }

  // Автоподбор
  autoDetectBtn.addEventListener('click', () => runAutoDetect('Начинаю автоподбор стратегии...'));

  // НОВОЕ: Проверка работоспособности сервисов
  if (checkHealthBtn) {
    checkHealthBtn.addEventListener('click', async () => {
      if (!hasEngine) return;
      try {
        toast('Проверяю работоспособность сервисов (5 попыток для каждого)...');
        checkHealthBtn.disabled = true;
        checkHealthBtn.textContent = 'проверяю...';
        
        const services = [
          { name: 'YouTube', host: 'www.youtube.com', port: 443 },
          { name: 'Discord', host: 'discord.com', port: 443 }
        ];
        
        const results = await window.pulse.checkServiceHealth(services);
        serviceHealth = results;
        
        renderServiceHealth();
        
        const youtubeOk = results.YouTube && results.YouTube.isHealthy;
        const discordOk = results.Discord && results.Discord.isHealthy;
        
        if (youtubeOk && discordOk) {
          toast('✓ Все сервисы работают');
        } else if (youtubeOk || discordOk) {
          toast('⚠ Некоторые сервисы не работают');
        } else {
          toast('✗ Сервисы не работают');
        }
      } catch (err) {
        toast('Ошибка проверки: ' + err.message);
      } finally {
        checkHealthBtn.disabled = false;
        checkHealthBtn.textContent = 'проверить работоспособность';
      }
    });
  }

  // Изменение стратегии
  strategySelect.addEventListener('change', async () => {
    if (!hasEngine) return;
    if (engineStatus.status === 'running') {
      const id = strategySelect.value;
      try {
        await window.pulse.start(id);
        toast('Стратегия изменена');
      } catch (err) {
        toast('Ошибка: ' + err.message);
      }
    }
  });

  // Добавление домена
  $('addDomainBtn').addEventListener('click', async () => {
    if (!hasEngine) return;
    const inp = $('newDomainInput');
    const host = inp.value.trim();
    if (!host) return;
    try {
      await window.pulse.addDomain(host);
      inp.value = '';
      config.domains.custom = await window.pulse.getConfig().then(c => c.domains.custom);
      renderDomainChips();
      toast('Домен добавлен');
    } catch (err) {
      toast('Ошибка: ' + err.message);
    }
  });

  // УЛУЧШЕНО: Добавление приложения - два способа
  $('addAppBtn').addEventListener('click', async () => {
    if (!hasEngine) return;
    try {
      await window.pulse.addApp();
      config.apps = await window.pulse.getConfig().then(c => c.apps);
      renderApps();
      toast('Приложение добавлено');
    } catch (err) {
      toast('Ошибка: ' + err.message);
    }
  });

  // НОВОЕ: Добавление приложения из запущенных процессов
  if ($('addRunningAppBtn')) {
    $('addRunningAppBtn').addEventListener('click', async () => {
      if (!hasEngine) return;
      try {
        toast('Получаю список запущенных процессов...');
        const processes = await window.pulse.getRunningProcesses();
        
        if (!processes || processes.length === 0) {
          toast('Не удалось получить список процессов');
          return;
        }

        // Создаём модальное окно со списком процессов
        const modal = createProcessSelectorModal(processes);
        document.body.appendChild(modal);
        
      } catch (err) {
        toast('Ошибка: ' + err.message);
      }
    });
  }

  function createProcessSelectorModal(processes) {
    const modal = document.createElement('div');
    modal.className = 'pb-modal';
    modal.innerHTML = `
      <div class="pb-modal-content">
        <div class="pb-modal-header">
          <h3>Выберите приложение</h3>
          <button class="pb-modal-close">✕</button>
        </div>
        <div class="pb-modal-body">
          <input type="text" class="pb-search-input" placeholder="Поиск..." id="processSearch">
          <div class="pb-process-list" id="processList">
            ${processes.map(p => `
              <div class="pb-process-item" data-path="${escapeHtml(p.exePath)}" data-name="${escapeHtml(p.name)}">
                <div class="pb-process-name">${escapeHtml(p.name)}</div>
                <div class="pb-process-path">${escapeHtml(p.exePath)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // Закрытие модального окна
    modal.querySelector('.pb-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // Поиск по процессам
    modal.querySelector('#processSearch').addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      modal.querySelectorAll('.pb-process-item').forEach(item => {
        const name = item.dataset.name.toLowerCase();
        const path = item.dataset.path.toLowerCase();
        item.style.display = (name.includes(query) || path.includes(query)) ? '' : 'none';
      });
    });

    // Выбор процесса
    modal.querySelectorAll('.pb-process-item').forEach(item => {
      item.addEventListener('click', async () => {
        const exePath = item.dataset.path;
        const name = item.dataset.name;
        try {
          await window.pulse.addApp({ exePath, name });
          config.apps = await window.pulse.getConfig().then(c => c.apps);
          renderApps();
          toast(`Приложение "${name}" добавлено`);
          modal.remove();
        } catch (err) {
          toast('Ошибка: ' + err.message);
        }
      });
    });

    return modal;
  }

  // НОВОЕ: добавление домена конкретному приложению
  async function addAppDomainFromInput(appId) {
    if (!hasEngine) return;
    const input = document.querySelector(`[data-app-domain-input="${appId}"]`);
    if (!input) return;
    const domain = input.value.trim();
    if (!domain) return;
    try {
      await window.pulse.addAppDomain(appId, domain);
      config.apps = await window.pulse.getConfig().then((c) => c.apps);
      renderApps();
      toast('Домен приложения добавлен');
    } catch (err) {
      toast('Ошибка: ' + err.message);
    }
  }

  document.addEventListener('click', async (e) => {
    const addAppDomainBtn = e.target.closest('[data-add-app-domain]');
    if (addAppDomainBtn && hasEngine) {
      e.stopPropagation();
      await addAppDomainFromInput(addAppDomainBtn.dataset.addAppDomain);
    }
  });

  document.addEventListener('keydown', async (e) => {
    const input = e.target.closest('[data-app-domain-input]');
    if (input && e.key === 'Enter') {
      e.preventDefault();
      await addAppDomainFromInput(input.dataset.appDomainInput);
    }
  });

  // Удаление домена/приложения
  document.addEventListener('click', async (e) => {
    const removeD = e.target.closest('[data-remove-domain]');
    const removeA = e.target.closest('[data-remove-app]');

    if (removeD && hasEngine) {
      e.stopPropagation();
      const id = removeD.dataset.removeDomain;
      try {
        await window.pulse.removeDomain(id);
        config.domains.custom = await window.pulse.getConfig().then(c => c.domains.custom);
        renderDomainChips();
        toast('Домен удалён');
      } catch (err) {
        toast('Ошибка: ' + err.message);
      }
    }

    if (removeA && hasEngine) {
      e.stopPropagation();
      const id = removeA.dataset.removeApp;
      try {
        await window.pulse.removeApp(id);
        config.apps = await window.pulse.getConfig().then(c => c.apps);
        renderApps();
        toast('Приложение удалено');
      } catch (err) {
        toast('Ошибка: ' + err.message);
      }
    }
  });

  // Настройки
  ['chkYoutube', 'chkDiscord', 'chkGeneral', 'chkAutostart', 'chkLaunchBoot', 'chkTray'].forEach((id) => {
    $(id).addEventListener('change', async () => {
      if (!hasEngine) return;
      const key = {
        chkYoutube: 'domains.youtube',
        chkDiscord: 'domains.discord',
        chkGeneral: 'domains.general',
        chkAutostart: 'autostartEngine',
        chkLaunchBoot: 'launchOnBoot',
        chkTray: 'minimizeToTrayOnClose'
      }[id];
      const val = $(id).checked;
      try {
        await window.pulse.updateConfig({ [key]: val });
        config = await window.pulse.getConfig();
      } catch (err) {
        toast('Ошибка: ' + err.message);
      }
    });
  });

  // Меню
  $('menuLogsBtn').addEventListener('click', () => {
    if (hasEngine) window.pulse.openLogsFolder();
    closeBurger();
  });

  $('menuInstallBtn').addEventListener('click', async () => {
    if (!hasEngine) return;
    closeBurger();
    toast('Переустанавливаю движок...');
    try {
      await window.pulse.reinstallEngine();
      toast('Движок переустановлен');
      location.reload();
    } catch (err) {
      toast('Ошибка: ' + err.message);
    }
  });

  // Обработчики IPC
  if (hasEngine) {
    window.pulse.onEngineLog((line) => appendLog(line));
    window.pulse.onEngineStatus((st) => {
      engineStatus = st;
      renderStatus();
    });
  }

  // Темы: переключение уже полностью обрабатывает assets/theme.js
  // (атрибут data-theme на <html> + сохранение через updateConfig). Здесь
  // достаточно только закрыть бургер-меню после выбора.
  document.querySelectorAll('[data-theme]').forEach((btn) => {
    btn.addEventListener('click', () => closeBurger());
  });

  // Журнал
  $('logClearBtn').addEventListener('click', () => {
    logBox.innerHTML = '<div class="pb-log-empty">журнал очищен</div>';
  });

  // Инициализация
  init();
})();
