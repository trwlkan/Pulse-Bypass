/* Переключение темы (зелёная / чёрная / белая) — атрибут data-theme на <html>,
   сами цвета уже описаны в pulsebypass-base.css через html[data-theme="..."]. */
(function () {
  'use strict';

  const KEY = 'pulsebypass-theme';
  const root = document.documentElement;

  function apply(theme) {
    if (theme === 'green') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);

    document.querySelectorAll('.theme-swatch').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  }

  function current() {
    try { return localStorage.getItem(KEY) || 'green'; } catch (e) { return 'green'; }
  }

  function set(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    apply(theme);
    if (window.pulse) window.pulse.updateConfig({ theme });
    window.dispatchEvent(new CustomEvent('pulsebypass:theme', { detail: theme }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    apply(current());
    document.querySelectorAll('.theme-swatch').forEach((btn) => {
      btn.addEventListener('click', () => set(btn.dataset.theme));
    });
  });

  window.PulseTheme = { set, get: current };
})();
