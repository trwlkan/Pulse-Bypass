'use strict';

/**
 * Скачивает официальный бинарный бандл zapret (bol-van/zapret-win-bundle,
 * репозиторий с готовыми winws.exe + драйвером WinDivert для Windows) с
 * GitHub Releases и раскладывает нужные файлы в resourcesPath.
 *
 * Мы намеренно НЕ храним сами бинарники в этом репозитории — они тянутся
 * с официального источника на этапе сборки (см. .github/workflows/build.yml)
 * либо при первом запуске приложения, если движок ещё не установлен.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = 'bol-van/zapret-win-bundle';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const NEEDED_FILES = ['winws.exe', 'WinDivert.dll', 'WinDivert64.sys', 'WinDivert32.sys', 'WinDivert.sys', 'cygwin1.dll'];

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'pulse-bypass' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpsGetJson(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error('GitHub API вернул код ' + res.statusCode));
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      https.get(u, { headers: { 'User-Agent': 'pulse-bypass' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doGet(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error('Не удалось скачать файл, код ' + res.statusCode));
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    };
    doGet(url);
  });
}

function findFilesRecursive(dir, names) {
  const found = {};
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (names.includes(entry.name)) found[entry.name] = full;
    }
  };
  walk(dir);
  return found;
}

async function fetchZapretBundle(resourcesPath, log = () => {}) {
  const AdmZip = require('adm-zip');

  log('Ищу последний релиз ' + REPO + '…');
  const release = await httpsGetJson(API_URL);
  const asset = (release.assets || []).find((a) => /\.zip$/i.test(a.name));
  if (!asset) throw new Error('В последнем релизе не найден zip-архив');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-bypass-'));
  const zipPath = path.join(tmpDir, asset.name);

  log(`Скачиваю ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} МБ)…`);
  await downloadFile(asset.browser_download_url, zipPath);

  log('Распаковываю…');
  const extractDir = path.join(tmpDir, 'extracted');
  new AdmZip(zipPath).extractAllTo(extractDir, true);

  const found = findFilesRecursive(extractDir, NEEDED_FILES);
  if (!found['winws.exe']) throw new Error('winws.exe не найден в архиве — структура релиза изменилась');

  fs.mkdirSync(resourcesPath, { recursive: true });
  for (const [name, srcPath] of Object.entries(found)) {
    fs.copyFileSync(srcPath, path.join(resourcesPath, name));
    log('  ✓ ' + name);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  log('Движок zapret установлен: ' + resourcesPath);
  return true;
}

module.exports = { fetchZapretBundle };
