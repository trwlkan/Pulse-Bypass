'use strict';

/**
 * Запускается перед electron-builder (см. "predist" в package.json) и
 * вручную через `npm run fetch-engine`. Кладёт официальные бинарники
 * zapret в engine/vendor/zapret/bin, откуда electron-builder упаковывает их
 * как extraResources — так собранный установщик уже содержит движок и
 * ничего не нужно докачивать при первом запуске.
 *
 * В обычном случае этот скрипт вообще ничего не скачивает: winws.exe,
 * WinDivert*, cygwin1.dll, *.bin и lists/ уже лежат в engine/vendor/zapret
 * (встроены из официальной сборки zapret-discord-youtube). Загрузка —
 * это резервный путь на случай, если папка bin/ была случайно удалена.
 */

const path = require('path');
const fs = require('fs');
const { fetchZapretBundle } = require('../engine/vendor-fetch');

const target = path.join(__dirname, '..', 'engine', 'vendor', 'zapret', 'bin');

(async () => {
  if (fs.existsSync(path.join(target, 'winws.exe'))) {
    console.log('[fetch-engine] winws.exe уже на месте, пропускаю загрузку.');
    return;
  }
  try {
    await fetchZapretBundle(target, (msg) => console.log('[fetch-engine]', msg));
  } catch (err) {
    console.error('[fetch-engine] Не удалось скачать движок автоматически:', err.message);
    console.error('[fetch-engine] Сборка продолжится без движка — приложение скачает его при первом запуске.');
    fs.mkdirSync(target, { recursive: true });
  }
})();
