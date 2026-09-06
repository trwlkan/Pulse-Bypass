'use strict';

/**
 * Загрузчик GoodbyeDPI с GitHub Releases.
 * Скачивает и распаковывает goodbyedpi-0.2.2.zip.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const os = require('os');

const GOODBYEDPI_VERSION = '0.2.2';
const DOWNLOAD_URL = `https://github.com/ValdikSS/GoodbyeDPI/releases/download/${GOODBYEDPI_VERSION}/goodbyedpi-${GOODBYEDPI_VERSION}.zip`;
const FILE_SIZE_HINT = 700000; // ~700KB

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let downloaded = 0;

    const handleRedirect = (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, dest, onProgress).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const total = parseInt(response.headers['content-length'] || '0', 10);
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress && total > 0) {
          onProgress(Math.round((downloaded / total) * 100));
        }
      });
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    };

    https.get(url, handleRedirect).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      // Используем PowerShell для распаковки
      const psScript = `
        Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force
      `;
      execFile('powershell', ['-Command', psScript], { windowsHide: true, timeout: 30000 }, (err) => {
        if (err) {
          reject(new Error('Не удалось распаковать: ' + err.message));
        } else {
          resolve();
        }
      });
    } else {
      execFile('unzip', ['-o', zipPath, '-d', destDir], (err) => {
        if (err) {
          reject(new Error('Не удалось распаковать: ' + err.message));
        } else {
          resolve();
        }
      });
    }
  });
}

async function fetchGoodbyeDPIBundle(binDir, onLog) {
  const tmpDir = path.join(os.tmpdir(), 'pulse-bypass-gd');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
  
  const zipPath = path.join(tmpDir, `goodbyedpi-${GOODBYEDPI_VERSION}.zip`);
  
  onLog(`Скачиваю GoodbyeDPI v${GOODBYEDPI_VERSION}...`);
  onLog(`URL: ${DOWNLOAD_URL}`);
  
  await downloadFile(DOWNLOAD_URL, zipPath, (pct) => {
    if (pct % 10 === 0) onLog(`Загрузка: ${pct}%`);
  });
  
  onLog('Загрузка завершена. Распаковываю...');
  
  const extractDir = path.join(tmpDir, 'gd-extracted');
  try { fs.mkdirSync(extractDir, { recursive: true }); } catch (e) {}
  
  await extractZip(zipPath, extractDir);
  
  // GoodbyeDPI структура:
  // goodbyedpi-0.2.2/
  //   goodbyedpi.exe
  //   x86_64/
  //     goodbyedpi.exe
  //     WinDivert.dll
  //     WinDivert64.sys
  //   x86/
  //     goodbyedpi.exe
  //     WinDivert.dll
  //     WinDivert32.sys
  //   russia-blacklist.txt
  //   russia-youtube.txt
  //   1_russia_blacklist.cmd
  //   ...
  
  // Копируем x86_64 бинарник и DLL в binDir
  fs.mkdirSync(binDir, { recursive: true });
  
  const arch = process.arch === 'x64' ? 'x86_64' : 'x86';
  const srcArchDir = path.join(extractDir, `goodbyedpi-${GOODBYEDPI_VERSION}`, arch);
  
  if (fs.existsSync(srcArchDir)) {
    const files = fs.readdirSync(srcArchDir);
    for (const file of files) {
      const src = path.join(srcArchDir, file);
      const dst = path.join(binDir, file);
      fs.copyFileSync(src, dst);
      onLog(`Установлен: ${file}`);
    }
  } else {
    // Может быть в корне архива
    const rootDir = path.join(extractDir, `goodbyedpi-${GOODBYEDPI_VERSION}`);
    if (fs.existsSync(path.join(rootDir, 'goodbyedpi.exe'))) {
      fs.copyFileSync(path.join(rootDir, 'goodbyedpi.exe'), path.join(binDir, 'goodbyedpi.exe'));
      onLog('Установлен: goodbyedpi.exe');
    }
  }
  
  // Копируем blacklists в listsDir
  const listsDir = path.join(path.dirname(binDir), 'lists');
  fs.mkdirSync(listsDir, { recursive: true });
  
  const rootDir = path.join(extractDir, `goodbyedpi-${GOODBYEDPI_VERSION}`);
  const blacklistFiles = ['russia-blacklist.txt', 'russia-youtube.txt'];
  for (const file of blacklistFiles) {
    const src = path.join(rootDir, file);
    const dst = path.join(listsDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      onLog(`Список: ${file}`);
    }
  }
  
  // Очистка
  try {
    fs.unlinkSync(zipPath);
    fs.rmSync(extractDir, { recursive: true, force: true });
  } catch (e) {}
  
  onLog('GoodbyeDPI установлен успешно');
  
  return true;
}

module.exports = { fetchGoodbyeDPIBundle, GOODBYEDPI_VERSION };
