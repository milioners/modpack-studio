// Работа с сетью: онлайн-каталог модов и загрузка файлов.
// Всё, что приходит из сети, — данные: файлы модов только копируются в проект и никогда не запускаются,
// у каждого файла проверяется размер и контрольная сумма SHA-256.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');

const CATALOG_FORMAT = 'modpack-studio-catalog';
const MAX_DOWNLOAD = 1024 * 1024 * 1024; // 1 ГБ
const MAX_IMAGE = 4 * 1024 * 1024;

// Каталог может лежать в интернете (https) или локально (путь / file:) — удобно авторам каталога
function toUrl(src) {
  if (/^https?:\/\//i.test(src) || /^file:/i.test(src)) return src;
  return pathToFileURL(path.resolve(src)).href;
}

function resolveUrl(base, rel) {
  if (!rel) return null;
  const u = new URL(rel, base);
  if (!['https:', 'http:', 'file:'].includes(u.protocol)) throw new Error(`Недопустимый адрес: ${rel}`);
  return u.href;
}

async function readBytes(fetchFn, url, { maxBytes = MAX_DOWNLOAD, onProgress } = {}) {
  if (url.startsWith('file:')) {
    const p = fileURLToPath(url);
    const size = fs.statSync(p).size;
    if (size > maxBytes) throw new Error(`Файл слишком большой: ${path.basename(p)}`);
    onProgress?.(size, size);
    return fs.readFileSync(p);
  }
  const res = await fetchFn(url, { headers: { 'User-Agent': 'TankAir-Studio' } });
  if (!res.ok) throw new Error(`Сервер ответил ${res.status} для ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > maxBytes) throw new Error('Файл слишком большой');
  const chunks = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (got > maxBytes) throw new Error('Файл слишком большой');
    chunks.push(Buffer.from(value));
    onProgress?.(got, total);
  }
  return Buffer.concat(chunks);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Скачивает файл в папку dir; если указан hash — проверяет его
async function download(fetchFn, url, dir, { name, hash, onProgress, maxBytes } = {}) {
  const buf = await readBytes(fetchFn, url, { onProgress, maxBytes });
  if (hash && sha256(buf) !== hash.toLowerCase()) {
    throw new Error('Контрольная сумма файла не совпала — файл повреждён или подменён. Загрузка отменена.');
  }
  const fileName = (name || decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'download.bin').replace(/[\\/:*?"<>|]/g, '_');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, fileName);
  fs.writeFileSync(p, buf);
  return p;
}

async function imageDataUrl(fetchFn, url) {
  const buf = await readBytes(fetchFn, url, { maxBytes: MAX_IMAGE });
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }[ext];
  if (!mime) throw new Error('Неподдерживаемый формат картинки');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Проверяет и нормализует index.json каталога; адреса превращаются в абсолютные
function parseCatalog(data, baseUrl) {
  if (!data || data.format !== CATALOG_FORMAT) throw new Error('По этому адресу не каталог TankAir Studio');
  const seen = new Set();
  const mods = [];
  for (const m of data.mods || []) {
    if (!m.id || !/^[\w.-]+$/.test(m.id) || seen.has(m.id) || !m.download) continue;
    seen.add(m.id);
    mods.push({
      id: m.id,
      name: String(m.name || m.id),
      version: String(m.version || '1.0'),
      author: String(m.author || ''),
      category: String(m.category || 'other'),
      gameVersion: String(m.gameVersion || ''),
      description: String(m.description || ''),
      tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
      homepage: m.homepage && /^https:\/\//.test(m.homepage) ? m.homepage : '',
      license: String(m.license || ''),
      updated: m.updated || null,
      size: Number(m.size) || 0,
      sha256: m.sha256 ? String(m.sha256).toLowerCase() : null,
      preview: m.preview ? resolveUrl(baseUrl, m.preview) : null,
      download: resolveUrl(baseUrl, m.download),
    });
  }
  return { title: String(data.title || 'Каталог модов'), updated: data.updated || null, categories: data.categories || {}, mods };
}

async function loadCatalog(fetchFn, src) {
  const url = toUrl(src);
  const buf = await readBytes(fetchFn, url, { maxBytes: 20 * 1024 * 1024 });
  let data;
  try {
    data = JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
  } catch {
    throw new Error('Каталог повреждён: это не JSON');
  }
  return { url, ...parseCatalog(data, url) };
}

// Сравнение версий вида 1.2.10: -1, 0, 1
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

module.exports = { CATALOG_FORMAT, toUrl, resolveUrl, readBytes, download, imageDataUrl, parseCatalog, loadCatalog, compareVersions, sha256 };
