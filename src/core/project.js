// Проект модпака — папка:
//   project.json        описание: сведения, оформление, дерево групп и модов
//   mods/<id>/files/    файлы модов (копии, проект не зависит от исходников)
//   images/             превью, баннер, картинка приветствия, иконка
//   output/             готовые установщики (по умолчанию)
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJsonAtomic, sizeOf } = require('./fsutil');
const { normalizeLayout, layoutImages, template } = require('./layout');

const FORMAT = 'modpack-studio-project';
const PROJECT_FILE = 'project.json';

const newId = (prefix = 'n') => `${prefix}${crypto.randomBytes(5).toString('hex')}`;

function defaults(info = {}) {
  return {
    format: FORMAT,
    formatVersion: 1,
    appId: crypto.randomUUID().toUpperCase(),
    info: {
      name: info.name || 'Мой модпак',
      version: info.version || '1.0',
      author: info.author || '',
      website: info.website || '',
      gameVersion: info.gameVersion || '',
      description: info.description || 'Сборка полезных модов для «Мира танков».',
    },
    design: {
      accent: '#f0a53a',
      bannerImage: null,
      bannerTitle: '',
      bannerSubtitle: '',
      sidebarImage: null,
      icon: null,
      welcomeText: '',
      finishText: '',
      theme: 'dark', // light | dark | auto (как в Windows)
    },
    options: {
      cleanDefault: true,
      compression: 'max',
      outputDir: '',
      showChangelog: true,
      launchGame: true,
      installerType: 'mps', // mps — свой установщик, inno — классический Inno Setup
    },
    // История версий: [{ version, date, text }], новые сверху. «Что нового» в установщике берётся отсюда
    changelog: [],
    // Оформление собственного установщика (ModPack Installer)
    installer: defaultInstallerTheme(),
    // Откуда установщик игрока берёт обновления модпака: none | github (repo) | url (адрес update.json)
    publish: { type: 'none', repo: '', url: '' },
    tree: [],
  };
}

function defaultInstallerTheme() {
  return {
    preset: 'tactic',
    colors: {
      bg: '#0F1115', surface: '#181B21', card: '#1F232B', border: '#2C313B', text: '#EEE9DF', muted: '#8F8A80',
      accent: '#F0A53A', accentText: '#1D1305', danger: '#EF5D55', success: '#5CC98A',
    },
    backgroundImage: null, // картинка проекта (images/…), в установщик попадает перекодированной
    bgDim: 0.6,
    bgBlur: 6,
    surfaceOpacity: 0.9,
    font: 'Segoe UI',
    titleFont: 'Bahnschrift',
    fontSize: 13,
    radius: 12,
    layout: 'grid', // grid | list
    cardSize: 'm', // s | m | l
    nav: 'tabs', // tabs | sidebar
    width: 1100,
    height: 700,
    animations: true,
    welcomeScreen: true,
    texts: { welcomeTitle: '', welcomeText: '', installButton: 'Установить', finishTitle: 'Готово!', finishText: '' },
    layout: template('classic'),
  };
}

// Достраивает недостающие поля (проекты старых версий, ручное редактирование)
function normalize(p) {
  const d = defaults();
  const di = d.installer;
  const pi = p.installer || {};
  const out = {
    ...d, ...p, info: { ...d.info, ...p.info }, design: { ...d.design, ...p.design }, options: { ...d.options, ...p.options },
    installer: { ...di, ...pi, colors: { ...di.colors, ...pi.colors }, texts: { ...di.texts, ...pi.texts }, layout: normalizeLayout(pi.layout) },
    publish: { ...d.publish, ...p.publish },
  };
  const fix = (nodes) => nodes.map((n) => (n.type === 'group'
    ? { id: n.id || newId('g'), type: 'group', name: n.name || 'Группа', description: n.description || '', preview: n.preview || null,
      mode: n.mode === 'single' ? 'single' : 'multi', checked: n.checked !== false, expanded: n.expanded !== false, children: fix(n.children || []) }
    : { id: n.id || newId('m'), type: 'mod', name: n.name || 'Мод', version: n.version || '', author: n.author || '', description: n.description || '',
      preview: n.preview || null, checked: n.checked !== false, files: n.files || [], skipped: n.skipped || [],
      catalogId: n.catalogId || null, catalogVersion: n.catalogVersion || null }));
  out.tree = fix(out.tree || []);
  out.changelog = (Array.isArray(p.changelog) ? p.changelog : [])
    .filter((e) => e && e.version)
    .map((e) => ({ version: String(e.version), date: e.date || null, text: e.text || '' }));
  for (const { node } of walk(out.tree)) {
    if (node.type !== 'group' || node.mode !== 'single') continue;
    const mods = node.children.filter((c) => c.type === 'mod');
    const first = mods.find((c) => c.checked) || mods[0];
    mods.forEach((c) => { c.checked = c === first; });
  }
  return out;
}

function create(dir, info) {
  if (fs.existsSync(path.join(dir, PROJECT_FILE))) throw new Error('В этой папке уже есть проект модпака');
  for (const d of ['mods', 'images', 'output']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const p = defaults(info);
  writeJsonAtomic(path.join(dir, PROJECT_FILE), p);
  return p;
}

function open(dir) {
  const file = path.join(dir, PROJECT_FILE);
  if (!fs.existsSync(file)) throw new Error(`В папке ${dir} нет проекта модпака (project.json)`);
  const p = readJson(file);
  if (p.format !== FORMAT) throw new Error('Это не проект ModPack Studio');
  return normalize(p);
}

function save(dir, p) {
  writeJsonAtomic(path.join(dir, PROJECT_FILE), normalize(p));
}

// ---------- обход дерева ----------

function* walk(nodes, parent = null, depth = 0) {
  for (const n of nodes) {
    yield { node: n, parent, depth };
    if (n.type === 'group') yield* walk(n.children, n, depth + 1);
  }
}

const allMods = (p) => [...walk(p.tree)].filter((x) => x.node.type === 'mod').map((x) => x.node);

// ---------- файлы ----------

// Копирует файлы из разобранного мода (importer.analyze) в проект
function storeModFiles(dir, modId, analysis) {
  const modDir = path.join(dir, 'mods', modId);
  fs.rmSync(modDir, { recursive: true, force: true });
  for (const f of analysis.files) {
    const dst = path.join(modDir, 'files', ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(analysis.root, ...f.rel.split('/')), dst);
  }
  return analysis.files.map((f) => ({ src: `mods/${modId}/files/${f.rel}`, dst: f.dst, size: f.size }));
}

function removeModFiles(dir, modId) {
  if (!/^[\w-]+$/.test(modId)) return;
  fs.rmSync(path.join(dir, 'mods', modId), { recursive: true, force: true });
}

// Копирует картинку в images/ проекта; одинаковые файлы не дублируются
function storeImage(dir, srcPath) {
  const data = fs.readFileSync(srcPath);
  const hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 12);
  const rel = `images/${hash}${path.extname(srcPath).toLowerCase()}`;
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  if (!fs.existsSync(path.join(dir, rel))) fs.writeFileSync(path.join(dir, rel), data);
  return rel;
}

// Удаляет картинки и файлы модов, на которые больше ничего не ссылается
function collectGarbage(dir, p) {
  const used = new Set([p.design.bannerImage, p.design.sidebarImage, p.design.icon, p.installer?.backgroundImage, ...layoutImages(p.installer?.layout)]);
  const modIds = new Set();
  for (const { node } of walk(p.tree)) {
    used.add(node.preview);
    if (node.type !== 'mod') continue;
    modIds.add(node.id);
    for (const f of node.files) {
      const m = /^mods\/([^/]+)\//.exec(f.src);
      if (m) modIds.add(m[1]);
    }
  }
  const imgDir = path.join(dir, 'images');
  if (fs.existsSync(imgDir)) {
    for (const f of fs.readdirSync(imgDir)) if (!used.has(`images/${f}`)) fs.rmSync(path.join(imgDir, f), { force: true });
  }
  const modsDir = path.join(dir, 'mods');
  if (fs.existsSync(modsDir)) {
    for (const d of fs.readdirSync(modsDir)) if (!modIds.has(d)) fs.rmSync(path.join(modsDir, d), { recursive: true, force: true });
  }
}

// Проверка перед сборкой: ошибки блокируют сборку, предупреждения — нет
function validate(dir, p) {
  const errors = [];
  const warnings = [];
  const mods = allMods(p);
  if (!p.info.name.trim()) errors.push('Не указано название модпака');
  if (!mods.length) errors.push('В модпаке нет ни одного мода');
  for (const { node, parent } of walk(p.tree)) {
    if (node.type === 'group') {
      if (!node.children.length) warnings.push(`Группа «${node.name}» пустая — в установщике её не будет`);
      if (node.mode === 'single' && node.children.some((c) => c.type === 'group')) {
        errors.push(`В группе «${node.name}» с выбором одного варианта не может быть вложенных групп`);
      }
      continue;
    }
    if (!node.files.length) errors.push(`У мода «${node.name}» нет файлов`);
    const missing = node.files.filter((f) => !fs.existsSync(path.join(dir, f.src)));
    if (missing.length) errors.push(`У мода «${node.name}» пропали файлы (${missing.length}) — добавьте мод заново`);
    if (!node.preview) warnings.push(`У мода «${node.name}» нет превью — будет нарисована заглушка`);
    if (!node.description.trim()) warnings.push(`У мода «${node.name}» нет описания`);
    if (parent?.mode === 'single' && parent.children.length < 2) warnings.push(`В группе «${parent.name}» всего один вариант — лучше сделать её обычной`);
  }
  // Один и тот же файл в двух модах, которые можно выбрать одновременно, перезапишет друг друга
  const byDst = new Map();
  for (const { node, parent } of walk(p.tree)) {
    if (node.type !== 'mod') continue;
    for (const f of node.files) {
      const key = f.dst.toLowerCase();
      const prev = byDst.get(key);
      if (prev && !(prev.parent && prev.parent === parent && parent.mode === 'single')) {
        warnings.push(`Моды «${prev.node.name}» и «${node.name}» пишут один файл ${f.dst} — победит тот, что ниже в списке`);
      }
      byDst.set(key, { node, parent });
    }
  }
  return { errors, warnings: [...new Set(warnings)] };
}

function stats(dir, p) {
  const mods = allMods(p);
  return {
    mods: mods.length,
    groups: [...walk(p.tree)].filter((x) => x.node.type === 'group').length,
    files: mods.reduce((s, m) => s + m.files.length, 0),
    size: sizeOf(path.join(dir, 'mods')),
  };
}

// ---------- версии ----------

// «1.0» → «1.1» (minor) или «2.0» (major); нечисловые хвосты отбрасываются
function bumpVersion(v, kind = 'minor') {
  const parts = String(v || '1.0').split('.').map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x));
  while (parts.length < 2) parts.push(0);
  if (kind === 'major') return `${parts[0] + 1}.0`;
  parts[parts.length - 1] += 1;
  return parts.join('.');
}

// Записи «Что нового» для установщика: текущая версия и две предыдущие
function changelogText(p, limit = 3) {
  const entries = p.changelog.filter((e) => e.text.trim()).slice(0, limit);
  return entries.map((e) => {
    const date = e.date ? ` — ${new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}` : '';
    return `Версия ${e.version}${date}\n${e.text.trim()}`;
  }).join('\n\n');
}

module.exports = {
  defaultInstallerTheme, bumpVersion, changelogText,
  FORMAT, PROJECT_FILE, newId, defaults, normalize, create, open, save, walk, allMods,
  storeModFiles, removeModFiles, storeImage, collectGarbage, validate, stats,
};
