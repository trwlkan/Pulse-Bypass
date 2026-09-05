/* window.desktop и window.pulse обычно приходят из preload.js (contextBridge).
   Этот файл — просто безопасный фолбэк на случай, если index.html открыли
   напрямую в браузере (например, чтобы посмотреть вёрстку), чтобы titlebar
   и остальной интерфейс не падали с ошибкой "undefined". */
(function () {
  'use strict';
  if (!window.desktop) {
    window.desktop = {
      isDesktop: false,
      minimizeSelf: () => {},
      toggleMaximizeSelf: () => {},
      closeSelf: () => {},
      isMaximizedSelf: () => Promise.resolve(false),
      onWindowState: () => {}
    };
  }
})();
