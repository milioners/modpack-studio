// Автообновление ModPack Studio через GitHub Releases.
// В релизе лежат ModPack-Studio-Setup-<версия>.exe и файл .sha256 с его контрольной суммой.
// Обновление скачивается, проверяется и запускается тихо; установщик сам перезапускает программу.
'use strict';

// В тестах (обычный Node) electron недоступен — нужен только parseRelease
const { app, net } = process.versions.electron ? require('electron') : {};
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const online = require('../core/online');

const SETUP_RE = /^ModPack-Studio-Setup-.+\.exe$/i;

function repo() {
  return require('../../package.json').updateRepo || '';
}

// { available, version, current, notes, publishedAt, size, url, shaUrl, pageUrl }
async function check() {
  const r = repo();
  if (!r) throw new Error('Не указан репозиторий обновлений');
  const res = await net.fetch(`https://api.github.com/repos/${r}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ModPack-Studio' },
  });
  if (res.status === 404) return { available: false, current: app.getVersion(), noReleases: true };
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
  return parseRelease(await res.json(), app.getVersion());
}

// Обновление доступно, только если в релизе есть и установщик, и его контрольная сумма
function parseRelease(rel, current) {
  const version = String(rel.tag_name || '').replace(/^v/i, '');
  const exe = (rel.assets || []).find((a) => SETUP_RE.test(a.name));
  const sha = exe && (rel.assets || []).find((a) => a.name === `${exe.name}.sha256`);
  return {
    available: Boolean(!rel.draft && !rel.prerelease && exe && sha && online.compareVersions(version, current) > 0),
    version,
    current,
    notes: rel.body || '',
    publishedAt: rel.published_at,
    size: exe?.size || 0,
    url: exe?.browser_download_url || null,
    shaUrl: sha?.browser_download_url || null,
    pageUrl: rel.html_url,
  };
}

async function download(info, onProgress) {
  if (!info?.url || !info.shaUrl) throw new Error('В релизе нет установщика или его контрольной суммы');
  const shaText = (await online.readBytes(net.fetch, info.shaUrl, { maxBytes: 4096 })).toString('utf8');
  const hash = (shaText.match(/[a-f0-9]{64}/i) || [])[0];
  if (!hash) throw new Error('Файл контрольной суммы повреждён');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-update-'));
  return online.download(net.fetch, info.url, dir, { hash, onProgress, maxBytes: 600 * 1024 * 1024 });
}

// Запускает установщик обновления и закрывает программу
function install(setupPath) {
  if (!app.isPackaged) throw new Error('Обновление ставится только в установленной программе (сейчас режим разработки)');
  spawn(setupPath, ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS'], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 300);
}

module.exports = { check, download, install, repo, parseRelease };
