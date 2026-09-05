(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const isDesktop = typeof window.desktop !== 'undefined' && window.desktop.isDesktop;

  /* ====================================================================
     1. Титлбар
     ==================================================================== */
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

  /* ====================================================================
     2. Тост
     ==================================================================== */
  const toastEl = $('toast');
  let toastTimer = null;
  function toast(html) {
    toastEl.innerHTML = html;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  /* ====================================================================
     3. Бургер-меню
     ==================================================================== */
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

  /* ====================================================================
     4. Состояние приложения
     ==================================================================== */
  const hasEngine = typeof window.pulse !== 'undefined';
  let config = { domains: { youtube: true, discord: true, general: false, custom: [] }, apps: [] };
  let strategies = [];
  let engineStatus = { status: 'stopped', strategyId: null };

  const strategySelect = $('strategySelect');
  const toggleBtn = $('toggleBtn');
  const autoDetectBtn = $('autoDetectBtn');
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
    strategySelect.innerHTML = strategies.map((s) =>
      `<option value="${s.id}" title="${escapeHtml(s.description)}">${escapeHtml(s.name)}</option>`
    ).join('');
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

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
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
    box.innerHTML = list.map((a) => `
      <div class="pb-app-item" data-id="${a.id}">
        <div>
          <div class="pb-app-name">${escapeHtml(a.name)}</div>
          <div class="pb-app-path">${escapeHtml(a.exePath)}</div>
        </div>
        <button data-remove-app="${a.id}" title="удалить">✕</button>
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

  /* ====================================================================
     5. Загрузка начального состояния
     ==================================================================== */
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

    if (!state.engineReady) {
      engineWarning.style.display = '';
      engineWarning.className = 'pb-note err';
      engineWarning.innerHTML = 'Движок zapret (winws.exe) не установлен. Нажмите «переустановить движок» в меню (☰), либо просто нажмите «запустить обход» — приложение попробует скачать его автоматически с официального релиза bol-van/zapret-win-bundle.';
    }

    renderStrategies();
    renderStatus();
    renderDomainChips();
    renderApps();
    renderSettings();
    logBox.innerHTML = '<div class="pb-log-empty">журнал пуст — здесь будет вывод winws.exe</div>';

    window.pulse.onLog(appendLog);
    window.pulse.onStatus((s) => { engineStatus = s; renderStatus(); });
  }

  /* ====================================================================
     6. Обработчики
     ==================================================================== */
  toggleBtn.addEventListener('click', async () => {
    if (!hasEngine) return;
    try {
      if (engineStatus.status === 'running') {
        await window.pulse.stop();
      } else {
        await window.pulse.start(strategySelect.value || (strategies[0] && strategies[0].id));
      }
    } catch (err) {
      toast('ошибка: ' + escapeHtml(err.message || String(err)));
    }
  });

  autoDetectBtn.addEventListener('click', async () => {
    if (!hasEngine) return;
    const targets = [];
    if (config.domains.youtube !== false) targets.push({ host: 'www.youtube.com', port: 443 });
    if (config.domains.discord !== false) targets.push({ host: 'discord.com', port: 443 });
    toast('подбираю рабочую стратегию — это может занять минуту…');
    const res = await window.pulse.autoDetect(targets);
    if (res && res.success) toast(`подобрано: <b>${escapeHtml(res.strategyName)}</b>`);
    else toast('не удалось подобрать стратегию автоматически — попробуйте выбрать вручную');
  });

  strategySelect.addEventListener('change', () => {
    if (hasEngine) window.pulse.updateConfig({ lastStrategyId: strategySelect.value });
  });

  ['chkYoutube', 'chkDiscord', 'chkGeneral'].forEach((id) => {
    $(id).addEventListener('change', () => {
      config.domains.youtube = $('chkYoutube').checked;
      config.domains.discord = $('chkDiscord').checked;
      config.domains.general = $('chkGeneral').checked;
      if (hasEngine) window.pulse.updateConfig({ domains: config.domains });
    });
  });

  ['chkAutostart', 'chkLaunchBoot', 'chkTray'].forEach((id) => {
    $(id).addEventListener('change', () => {
      const patch = {
        autostartEngine: $('chkAutostart').checked,
        launchOnBoot: $('chkLaunchBoot').checked,
        minimizeToTrayOnClose: $('chkTray').checked
      };
      Object.assign(config, patch);
      if (hasEngine) window.pulse.updateConfig(patch);
      $('settingsMsg').textContent = 'сохранено';
      $('settingsMsg').className = 'hub-msg ok';
      setTimeout(() => { $('settingsMsg').textContent = ''; }, 1800);
    });
  });

  async function addDomain() {
    const input = $('newDomainInput');
    const val = input.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!val) return;
    if (!hasEngine) { input.value = ''; return; }
    config.domains.custom = await window.pulse.addDomain(val);
    input.value = '';
    renderDomainChips();
    toast('сайт добавлен');
  }
  $('addDomainBtn').addEventListener('click', addDomain);
  $('newDomainInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addDomain(); });

  $('customDomainList').addEventListener('click', async (e) => {
    const id = e.target.getAttribute && e.target.getAttribute('data-remove-domain');
    if (!id || !hasEngine) return;
    config.domains.custom = await window.pulse.removeDomain(id);
    renderDomainChips();
  });

  $('addAppBtn').addEventListener('click', async () => {
    if (!hasEngine) return;
    config.apps = await window.pulse.addApp();
    renderApps();
  });

  $('appList').addEventListener('click', async (e) => {
    const id = e.target.getAttribute && e.target.getAttribute('data-remove-app');
    if (!id || !hasEngine) return;
    config.apps = await window.pulse.removeApp(id);
    renderApps();
  });

  $('menuLogsBtn').addEventListener('click', () => { if (hasEngine) window.pulse.openLogsFolder(); closeBurger(); });
  $('menuInstallBtn').addEventListener('click', async () => {
    closeBurger();
    if (!hasEngine) return;
    toast('устанавливаю движок…');
    const ok = await window.pulse.installEngine();
    toast(ok ? 'движок установлен' : 'не удалось установить движок — проверьте подключение к интернету');
  });

  let inited = false;
  function initOnce() { if (inited) return; inited = true; init(); }
  document.addEventListener('DOMContentLoaded', initOnce);
  if (document.readyState !== 'loading') initOnce();
})();
