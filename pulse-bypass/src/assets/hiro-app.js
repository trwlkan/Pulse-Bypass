'use strict';

const pulse = window.pulse;

let config = {};
let strategies = [];
let engineStatus = { status: 'stopped', strategyId: null, error: null };

const STATUS_LABELS = {
  stopped: 'Защита отключена',
  starting: 'Запуск...',
  running: 'Защита активна',
  testing: 'Подбор стратегии...',
  error: 'Ошибка'
};

const STATUS_SUBTITLES = {
  stopped: 'Нажмите кнопку, чтобы включить обход DPI',
  starting: 'Запускаю GoodbyeDPI...',
  running: 'Обход DPI активен',
  testing: 'Тестирую стратегии по очереди...',
  error: 'Произошла ошибка'
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function init() {
  // Navigation
  $$('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.view').forEach(v => v.classList.remove('active'));
      const viewName = btn.dataset.view.charAt(0).toUpperCase() + btn.dataset.view.slice(1);
      const view = $('#view' + viewName);
      if (view) view.classList.add('active');
    });
  });

  $('#navLogs').addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.remove('active'));
    $('#navLogs').classList.add('active');
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#viewLogs').classList.add('active');
  });

  // Titlebar
  $('#tbMinimize').addEventListener('click', () => pulse.minimize());
  $('#tbMaximize').addEventListener('click', () => pulse.maximize());
  $('#tbClose').addEventListener('click', () => pulse.close());

  // Connect button
  $('#toggleBtn').addEventListener('click', toggleBypass);
  $('#autoDetectBtn').addEventListener('click', autoDetect);
  $('#checkHealthBtn').addEventListener('click', checkHealth);

  // Strategy
  $('#strategySelect').addEventListener('change', (e) => {
    const s = strategies.find(s => s.id === e.target.value);
    if (s) {
      $('#strategyDesc').textContent = s.description;
      if (engineStatus.status === 'running') {
        pulse.updateConfig({ lastStrategyId: s.id });
      }
    }
  });

  // Domain toggles
  $('#chkYoutube').addEventListener('change', (e) => {
    pulse.updateConfig({ domains: { ...config.domains, youtube: e.target.checked } });
  });
  $('#chkDiscord').addEventListener('change', (e) => {
    pulse.updateConfig({ domains: { ...config.domains, discord: e.target.checked } });
  });
  $('#chkGeneral').addEventListener('change', (e) => {
    pulse.updateConfig({ domains: { ...config.domains, general: e.target.checked } });
  });

  // Custom domains
  $('#addDomainBtn').addEventListener('click', addDomain);
  $('#newDomainInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addDomain();
  });

  // Apps
  $('#addAppBtn').addEventListener('click', () => pulse.addApp());
  $('#addRunningAppBtn').addEventListener('click', () => pulse.addAppFromRunning());

  // Settings
  $('#chkAutostart').addEventListener('change', (e) => {
    pulse.updateConfig({ autoStartBypass: e.target.checked });
  });
  $('#chkLaunchBoot').addEventListener('change', (e) => {
    pulse.updateConfig({ launchOnBoot: e.target.checked });
  });
  $('#chkTray').addEventListener('change', (e) => {
    pulse.updateConfig({ minimizeToTrayOnClose: e.target.checked });
  });

  // Menu actions
  $('#menuInstallBtn').addEventListener('click', () => pulse.reinstall());
  $('#menuLogsBtn').addEventListener('click', () => pulse.openLogs());
  $('#logClearBtn').addEventListener('click', () => {
    $('#logBox').innerHTML = '<div class="log-empty">Журнал очищен</div>';
  });

  // IPC listeners
  pulse.on('config:loaded', (cfg) => { config = cfg; renderAll(); });
  pulse.on('config:updated', (cfg) => { config = cfg; renderAll(); });
  pulse.on('strategies:list', (list) => { strategies = list; renderStrategies(); });
  pulse.on('engine:status', (status) => { engineStatus = status; renderStatus(); });
  pulse.on('engine:log', (line) => { appendLog(line); });
  pulse.on('engine:error', (msg) => { appendLog('ОШИБКА: ' + msg, 'error'); showToast(msg); });
  pulse.on('engine:installProgress', (msg) => { appendLog(msg); });
  pulse.on('engine:installed', () => { appendLog('Движок установлен', 'success'); showToast('GoodbyeDPI установлен'); });
  pulse.on('toast', (msg) => { showToast(msg); });

  // Load initial data
  config = await pulse.loadConfig();
  strategies = await pulse.listStrategies();
  
  renderAll();
  
  // Auto-start if configured
  if (config.autoStartBypass) {
    setTimeout(() => toggleBypass(), 1000);
  }
}

function renderAll() {
  renderStatus();
  renderStrategies();
  renderDomains();
  renderApps();
  renderSettings();
}

function renderStatus() {
  const st = engineStatus.status || 'stopped';
  const ring = $('#statusRing');
  const icon = $('#statusIcon');
  const title = $('#heroTitle');
  const subtitle = $('#heroSubtitle');
  const btn = $('#toggleBtn');
  const btnText = btn.querySelector('.connect-btn-text');
  const autoBtn = $('#autoDetectBtn');
  const healthBtn = $('#checkHealthBtn');

  ring.className = 'status-ring';

  if (st === 'running') {
    ring.classList.add('connected');
    title.textContent = STATUS_LABELS.running;
    subtitle.textContent = STATUS_SUBTITLES.running;
    btn.classList.add('connected');
    btnText.textContent = 'Отключить';
    icon.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>';
  } else if (st === 'starting') {
    ring.classList.add('connecting');
    title.textContent = STATUS_LABELS.starting;
    subtitle.textContent = STATUS_SUBTITLES.starting;
    btn.classList.remove('connected');
    btnText.textContent = 'Запуск...';
    btn.disabled = true;
    icon.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>';
  } else if (st === 'testing') {
    ring.classList.add('connecting');
    title.textContent = STATUS_LABELS.testing;
    subtitle.textContent = STATUS_SUBTITLES.testing;
    btn.classList.remove('connected');
    btnText.textContent = 'Подбор...';
    btn.disabled = true;
    autoBtn.disabled = true;
    healthBtn.disabled = true;
  } else if (st === 'error') {
    ring.classList.add('error');
    title.textContent = STATUS_LABELS.error;
    subtitle.textContent = engineStatus.error || STATUS_SUBTITLES.error;
    btn.classList.remove('connected');
    btnText.textContent = 'Повторить';
    btn.disabled = false;
    icon.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';
  } else {
    title.textContent = STATUS_LABELS.stopped;
    subtitle.textContent = STATUS_SUBTITLES.stopped;
    btn.classList.remove('connected');
    btnText.textContent = 'Включить';
    btn.disabled = false;
    autoBtn.disabled = false;
    healthBtn.disabled = false;
    icon.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L3 7v6c0 5 3.5 9 9 11 5.5-2 9-6 9-11V7l-9-5z"/></svg>';
  }

  if (engineStatus.strategyId) {
    const s = strategies.find(s => s.id === engineStatus.strategyId);
    if (s) {
      $('#strategyBadge').textContent = s.name;
      $('#strategyBadge').className = 'badge success';
    }
  } else {
    $('#strategyBadge').textContent = '—';
    $('#strategyBadge').className = 'badge';
  }
}

function renderStrategies() {
  const select = $('#strategySelect');
  if (!strategies.length) return;

  select.innerHTML = strategies.map(s => {
    let badge = '';
    if (s.tested) badge = s.working ? ' ✓' : ' ✗';
    const label = s.recommended ? '★ ' + s.name + badge : s.name + badge;
    return `<option value="${s.id}" title="${s.description}">${label}</option>`;
  }).join('');

  const selectValue = engineStatus.strategyId
    || (config.lastStrategyId && strategies.find(s => s.id === config.lastStrategyId) ? config.lastStrategyId : null)
    || (strategies.find(s => s.working === true) ? strategies.find(s => s.working === true).id : null)
    || (strategies.find(s => s.recommended) ? strategies.find(s => s.recommended).id : null)
    || strategies[0].id;
  
  if (selectValue) select.value = selectValue;
  
  const selected = strategies.find(s => s.id === select.value);
  if (selected) $('#strategyDesc').textContent = selected.description;
}

function renderDomains() {
  const list = $('#customDomainList');
  const custom = (config.domains && config.domains.custom) || [];
  
  if (!custom.length) {
    list.innerHTML = '<span style="color:var(--text-faint);font-size:13px;">Нет добавленных сайтов</span>';
    return;
  }

  list.innerHTML = custom.map(d => 
    `<div class="chip">${d.host} <span class="chip-remove" data-id="${d.id}">×</span></div>`
  ).join('');

  list.querySelectorAll('.chip-remove').forEach(el => {
    el.addEventListener('click', () => {
      pulse.removeDomain(el.dataset.id);
    });
  });

  if (config.domains) {
    $('#chkYoutube').checked = config.domains.youtube !== false;
    $('#chkDiscord').checked = config.domains.discord !== false;
    $('#chkGeneral').checked = config.domains.general === true;
  }
}

function renderApps() {
  const list = $('#appList');
  const apps = config.apps || [];
  
  if (!apps.length) {
    list.innerHTML = '<span style="color:var(--text-faint);font-size:13px;">Нет добавленных приложений</span>';
    return;
  }

  list.innerHTML = apps.map(app => `
    <div class="app-item">
      <div class="app-item-info">
        <div class="app-item-name">${app.name}</div>
        <div class="app-item-domains">${(app.domains || []).join(', ') || 'нет доменов'}</div>
      </div>
      <div class="app-item-actions">
        <button class="app-item-btn" data-app-id="${app.id}" data-action="domains">домены</button>
        <button class="app-item-btn danger" data-app-id="${app.id}" data-action="remove">удалить</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.app-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const appId = btn.dataset.appId;
      const action = btn.dataset.action;
      if (action === 'remove') {
        pulse.removeApp(appId);
      } else if (action === 'domains') {
        showAppDomainsModal(appId);
      }
    });
  });
}

function renderSettings() {
  $('#chkAutostart').checked = config.autoStartBypass === true;
  $('#chkLaunchBoot').checked = config.launchOnBoot === true;
  $('#chkTray').checked = config.minimizeToTrayOnClose !== false;
}

async function toggleBypass() {
  const btn = $('#toggleBtn');
  if (btn.disabled) return;

  if (engineStatus.status === 'running') {
    btn.disabled = true;
    await pulse.stop();
    btn.disabled = false;
  } else {
    const strategyId = $('#strategySelect').value;
    btn.disabled = true;
    try {
      await pulse.start(strategyId);
    } catch (e) {
      showToast('Ошибка: ' + e.message);
    }
    btn.disabled = false;
  }
}

async function autoDetect() {
  const btn = $('#autoDetectBtn');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const result = await pulse.autoDetect();
    if (result && result.success) {
      showToast('Найдена рабочая стратегия!');
    } else {
      showToast('Не удалось найти рабочую стратегию');
    }
  } catch (e) {
    showToast('Ошибка: ' + e.message);
  }
  btn.disabled = false;
}

async function checkHealth() {
  const btn = $('#checkHealthBtn');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const result = await pulse.checkHealth();
    if (result && result.length > 0) {
      const summary = result.map(r => `${r.service}: ${r.successCount}/${r.totalAttempts}`).join(', ');
      showToast(summary);
    }
  } catch (e) {
    showToast('Ошибка проверки');
  }
  btn.disabled = false;
}

async function addDomain() {
  const input = $('#newDomainInput');
  const host = input.value.trim();
  if (!host) return;
  input.value = '';
  await pulse.addDomain(host);
}

function appendLog(line, type) {
  const box = $('#logBox');
  const empty = box.querySelector('.log-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = 'log-line' + (type ? ' ' + type : '');
  div.textContent = line;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;

  while (box.children.length > 500) {
    box.removeChild(box.firstChild);
  }
}

function showToast(msg) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function showAppDomainsModal(appId) {
  const app = (config.apps || []).find(a => a.id === appId);
  if (!app) return;

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Домены — ${app.name}</h3>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <div class="app-domains-input">
          <input type="text" placeholder="example.com" id="appDomainInput">
          <button class="btn-primary btn-sm" id="appDomainAddBtn">+</button>
        </div>
        <div class="app-domain-list" id="appDomainList"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const input = modal.querySelector('#appDomainInput');
  const addBtn = modal.querySelector('#appDomainAddBtn');
  const list = modal.querySelector('#appDomainList');

  function renderDomains() {
    const domains = app.domains || [];
    list.innerHTML = domains.map(d => 
      `<div class="app-domain-chip">${d} <span class="app-domain-chip-remove" data-domain="${d}">×</span></div>`
    ).join('');

    list.querySelectorAll('.app-domain-chip-remove').forEach(el => {
      el.addEventListener('click', async () => {
        const domain = el.dataset.domain;
        const newDomains = (app.domains || []).filter(d => d !== domain);
        app.domains = newDomains;
        await pulse.updateConfig({ apps: config.apps });
        renderDomains();
      });
    });
  }

  async function addDomain() {
    const domain = input.value.trim().toLowerCase();
    if (!domain) return;
    if (!app.domains) app.domains = [];
    if (!app.domains.includes(domain)) {
      app.domains.push(domain);
      await pulse.updateConfig({ apps: config.apps });
    }
    input.value = '';
    renderDomains();
  }

  addBtn.addEventListener('click', addDomain);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addDomain();
  });

  modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  renderDomains();
  input.focus();
}
