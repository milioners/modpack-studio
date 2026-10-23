// Главный процесс ModPack Studio: окно, проекты, файлы, сборка. Интерфейс общается через IPC (preload.js).
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const project = require('../core/project');
const importer = require('../core/importer');
const inno = require('../core/inno');
const { createDemo } = require('../core/demo');
const { writeBmp } = require('../core/bmp');
const online = require('../core/online');
const builds = require('../core/builds');
const updater = require('./updater');
const pkg = require('../../package.json');

const APP_ROOT = path.join(__dirname, '..', '..');
const DEMO_CATALOG = path.join(APP_ROOT, 'catalog');
const APP_ICON = path.join(APP_ROOT, 'build', 'icon.ico');
const OPENABLE_RE = /\.(mtmod|wotmod|zip)$/i;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp' };

let win;
const SETTINGS_DEFAULTS = { recent: [], autoUpdate: true, catalogUrl: '' };
let settings = { ...SETTINGS_DEFAULTS };
let current = null; // { dir, data }
let pendingFile = null;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...SETTINGS_DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch { /* первый запуск */ }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
}

function remember(dir, data) {
  settings.recent = [{ dir, name: data.info.name, version: data.info.version, opened: new Date().toISOString() },
    ...settings.recent.filter((r) => r.dir.toLowerCase() !== dir.toLowerCase())].slice(0, 12);
  saveSettings();
}

function projectState() {
  if (!current) return null;
  const { dir, data } = current;
  const outputDir = data.options.outputDir || path.join(dir, 'output');
  return { dir, data, stats: project.stats(dir, data), check: project.validate(dir, data), outputDir, builds: builds.list(outputDir) };
}

function state() {
  const recent = settings.recent.map((r) => ({ ...r, exists: fs.existsSync(path.join(r.dir, project.PROJECT_FILE)) }));
  return {
    appVersion: app.getVersion(), recent, project: projectState(), iscc: inno.findIscc(), packaged: app.isPackaged,
    app: { autoUpdate: settings.autoUpdate, catalogUrl: settings.catalogUrl, defaultCatalogUrl: defaultCatalogUrl(), updateRepo: updater.repo() },
  };
}

function openProject(dir) {
  const data = project.open(dir);
  current = { dir, data };
  project.collectGarbage(dir, data);
  remember(dir, data);
  return state();
}

function uniqueDir(parent, name) {
  let dir = path.join(parent, inno.safeName(name));
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(parent, `${inno.safeName(name)}_${i}`);
  return dir;
}

function requireProject() {
  if (!current) throw new Error('Проект не открыт');
  return current;
}

// Интерфейс присылает проект целиком; главный процесс сохраняет его и отвечает актуальным состоянием
function accept(data) {
  const cur = requireProject();
  cur.data = project.normalize(data);
  project.save(cur.dir, cur.data);
  return cur;
}

// Создаёт узел мода из файла/архива/папки
function modFromSource(dir, src) {
  const a = importer.analyze(src);
  try {
    if (!a.files.length) throw new Error(`В «${path.basename(src)}» нет файлов для игры (.mtmod, .wotmod, mods/, res_mods/)`);
    const node = {
      id: project.newId('m'), type: 'mod', name: a.suggested.name, version: a.suggested.version || '1.0', author: '',
      description: a.suggested.description, preview: null, checked: true, files: [], skipped: a.skipped,
    };
    node.files = project.storeModFiles(dir, node.id, a);
    if (a.images[0]) node.preview = project.storeImage(dir, a.images[0]);
    return node;
  } finally {
    importer.cleanup(a);
  }
}

function findNode(nodes, id) {
  for (const { node } of project.walk(nodes)) if (node.id === id) return node;
  return null;
}

// ---------- онлайн-каталог ----------

const defaultCatalogUrl = () => (!app.isPackaged && process.env.MPS_CATALOG_URL) || pkg.catalogUrl || '';
const catalogUrl = () => settings.catalogUrl || defaultCatalogUrl();
const catalogCacheFile = () => path.join(app.getPath('userData'), 'catalog-cache.json');
let catalogCache = null;
const imageCache = new Map();

async function getCatalog(force = false) {
  if (catalogCache && !force) return catalogCache;
  const url = catalogUrl();
  if (!url) throw new Error('Не указан адрес каталога');
  try {
    catalogCache = { ...(await online.loadCatalog(net.fetch, url)), loadedAt: new Date().toISOString(), offline: false };
    fs.writeFileSync(catalogCacheFile(), JSON.stringify(catalogCache), 'utf8');
  } catch (e) {
    // нет сети — показываем последнюю загруженную версию каталога
    let cached = null;
    try {
      cached = JSON.parse(fs.readFileSync(catalogCacheFile(), 'utf8'));
    } catch { /* кэша нет */ }
    if (!cached || cached.url !== online.toUrl(url)) throw new Error(`Не удалось загрузить каталог: ${e.message}`);
    catalogCache = { ...cached, offline: true, error: e.message };
  }
  return catalogCache;
}

async function catalogMod(id) {
  const cat = await getCatalog();
  const m = cat.mods.find((x) => x.id === id);
  if (!m) throw new Error('Мод не найден в каталоге');
  return m;
}

// Скачивает мод из каталога во временную папку и превращает в узел проекта
async function nodeFromCatalog(dir, m) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-dl-'));
  try {
    const send = (got, total) => win?.webContents.send('catalog:progress', { id: m.id, got, total: total || m.size });
    if (!m.sha256) throw new Error('У мода в каталоге нет контрольной суммы — скачивание небезопасно');
    const file = await online.download(net.fetch, m.download, tmp, { hash: m.sha256, onProgress: send });
    const node = modFromSource(dir, file);
    Object.assign(node, {
      name: m.name, version: m.version, author: m.author, description: m.description || node.description,
      catalogId: m.id, catalogVersion: m.version,
    });
    if (m.preview) {
      try {
        const img = await online.download(net.fetch, m.preview, path.join(tmp, 'img'), { maxBytes: 4 * 1024 * 1024 });
        node.preview = project.storeImage(dir, img);
      } catch { /* без превью тоже можно */ }
    }
    return node;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- IPC ----------

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
}

function registerIpc() {
  handle('state:get', () => state());

  handle('project:new', async (info) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Где создать папку проекта', defaultPath: settings.lastParent || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.lastParent = r.filePaths[0];
    const dir = uniqueDir(r.filePaths[0], info.name || 'Мой модпак');
    project.create(dir, info);
    return openProject(dir);
  });
  handle('project:open', async (dir) => {
    if (!dir) {
      const r = await dialog.showOpenDialog(win, {
        title: 'Открыть проект модпака', properties: ['openFile'],
        filters: [{ name: 'Проект ModPack Studio', extensions: ['json'] }],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      dir = path.dirname(r.filePaths[0]);
    }
    return openProject(dir);
  });
  handle('project:demo', () => {
    const docs = !app.isPackaged && process.env.MPS_DOCS ? process.env.MPS_DOCS : app.getPath('documents');
    const parent = path.join(docs, 'ModPack Studio');
    fs.mkdirSync(parent, { recursive: true });
    const dir = uniqueDir(parent, 'Демо-модпак');
    createDemo(dir, DEMO_CATALOG);
    return openProject(dir);
  });
  handle('project:close', () => {
    if (current) project.collectGarbage(current.dir, current.data);
    current = null;
    return state();
  });
  handle('project:forget', (dir) => {
    settings.recent = settings.recent.filter((r) => r.dir.toLowerCase() !== dir.toLowerCase());
    saveSettings();
    return state();
  });
  handle('project:save', (data) => {
    const cur = accept(data);
    remember(cur.dir, cur.data);
    return projectState();
  });

  handle('mods:pick', async (kind) => {
    const r = await dialog.showOpenDialog(win, kind === 'folder'
      ? { title: 'Папка с модом', properties: ['openDirectory', 'multiSelections'] }
      : { title: 'Файлы модов', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Моды', extensions: ['mtmod', 'wotmod', 'zip'] }] });
    return r.canceled ? [] : r.filePaths;
  });
  // Добавляет моды из файлов в группу parentId (или в корень); ошибки по отдельным файлам не прерывают остальные
  handle('mods:add', (data, sources, parentId) => {
    const cur = accept(data);
    const added = [];
    const failed = [];
    const target = parentId ? findNode(cur.data.tree, parentId) : null;
    const list = target?.type === 'group' ? target.children : cur.data.tree;
    for (const src of sources) {
      try {
        const node = modFromSource(cur.dir, src);
        list.push(node);
        added.push(node);
      } catch (e) {
        failed.push(`${path.basename(src)}: ${e.message}`);
      }
    }
    project.save(cur.dir, cur.data);
    return { project: projectState(), added: added.map((n) => n.id), failed };
  });
  handle('mods:replaceFiles', async (data, modId) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Новые файлы мода', properties: ['openFile'], filters: [{ name: 'Моды', extensions: ['mtmod', 'wotmod', 'zip'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const cur = accept(data);
    const node = findNode(cur.data.tree, modId);
    const fresh = modFromSource(cur.dir, r.filePaths[0]);
    // файлы уже лежат в mods/<новый id>/ — переносим их в папку старого мода
    project.removeModFiles(cur.dir, node.id);
    fs.renameSync(path.join(cur.dir, 'mods', fresh.id), path.join(cur.dir, 'mods', node.id));
    node.files = fresh.files.map((f) => ({ ...f, src: f.src.replace(`mods/${fresh.id}/`, `mods/${node.id}/`) }));
    node.skipped = fresh.skipped;
    if (!node.preview && fresh.preview) node.preview = fresh.preview;
    if (fresh.version && fresh.version !== '1.0') node.version = fresh.version;
    project.save(cur.dir, cur.data);
    return projectState();
  });

  handle('image:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Выберите картинку', properties: ['openFile'],
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return project.storeImage(requireProject().dir, r.filePaths[0]);
  });
  handle('image:store', (p) => project.storeImage(requireProject().dir, p));
  // Картинки отдаются как data: URL — их можно рисовать на canvas без ограничений file://
  handle('image:data', (rel) => {
    const { dir } = requireProject();
    const p = path.resolve(dir, rel);
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('Картинка вне проекта');
    const mime = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
  });

  handle('output:pick', async (current) => {
    const r = await dialog.showOpenDialog(win, { title: 'Куда сохранять установщики', defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // assets: { banner, sidebar, packImage, previews: {id: img}, icon: [png] }, img = { w, h, rgba }
  handle('build:run', async (data, assets) => {
    const cur = accept(data);
    const send = (line) => win?.webContents.send('build:log', line);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-assets-'));
    try {
      const bmp = (name, img) => {
        if (!img) return null;
        const p = path.join(tmp, `${name}.bmp`);
        writeBmp(p, img.w, img.h, img.rgba);
        return p;
      };
      send('Готовлю картинки…');
      const files = {
        banner: bmp('banner', assets.banner),
        sidebar: bmp('sidebar', assets.sidebar),
        packImage: bmp('pack', assets.packImage),
        previews: Object.fromEntries(Object.entries(assets.previews || {}).map(([id, img]) => [id, bmp(`p_${id}`, img)])),
        icon: APP_ICON,
      };
      if (assets.icon?.length) {
        files.icon = path.join(tmp, 'icon.ico');
        fs.writeFileSync(files.icon, Buffer.from(assets.icon));
      }
      send('Генерирую скрипт Inno Setup…');
      const { issPath, exePath, files: count } = inno.buildIss(cur.dir, cur.data, files);
      send(`Скрипт: ${issPath} (файлов модов: ${count})`);
      send('Компилирую установщик…');
      await inno.compileIss(issPath, (l) => { if (!/^\s*(Compressing|Reading|Parsing)/.test(l)) send(l); });
      const result = { exePath, size: fs.statSync(exePath).size, builtAt: new Date().toISOString() };
      builds.record(path.dirname(exePath), {
        file: path.basename(exePath), version: cur.data.info.version, builtAt: result.builtAt, size: result.size,
        mods: project.allMods(cur.data).length,
      });
      return { ...result, project: projectState() };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  handle('catalog:load', (force) => getCatalog(force));
  handle('catalog:image', async (url) => {
    if (!imageCache.has(url)) imageCache.set(url, online.imageDataUrl(net.fetch, url).catch(() => null));
    return imageCache.get(url);
  });
  handle('catalog:add', async (data, modId, parentId) => {
    const m = await catalogMod(modId);
    const cur = accept(data);
    const node = await nodeFromCatalog(cur.dir, m);
    const target = parentId ? findNode(cur.data.tree, parentId) : null;
    (target?.type === 'group' ? target.children : cur.data.tree).push(node);
    project.save(cur.dir, cur.data);
    return { project: projectState(), added: node.id };
  });
  // Ставит в проект свежую версию мода из каталога, сохраняя место в дереве и тексты автора
  handle('catalog:updateNode', async (data, nodeId) => {
    const cur = accept(data);
    const node = findNode(cur.data.tree, nodeId);
    if (!node?.catalogId) throw new Error('Этот мод не из каталога');
    const m = await catalogMod(node.catalogId);
    const fresh = await nodeFromCatalog(cur.dir, m);
    project.removeModFiles(cur.dir, node.id);
    fs.renameSync(path.join(cur.dir, 'mods', fresh.id), path.join(cur.dir, 'mods', node.id));
    node.files = fresh.files.map((f) => ({ ...f, src: f.src.replace(`mods/${fresh.id}/`, `mods/${node.id}/`) }));
    node.version = fresh.version;
    node.catalogVersion = fresh.catalogVersion;
    if (!node.preview) node.preview = fresh.preview;
    project.save(cur.dir, cur.data);
    return projectState();
  });

  handle('app:settings', (patch) => {
    for (const k of ['autoUpdate', 'catalogUrl']) if (patch[k] !== undefined) settings[k] = patch[k];
    if (patch.catalogUrl !== undefined) catalogCache = null;
    saveSettings();
    return state();
  });
  handle('update:check', async () => {
    settings.lastUpdateCheck = new Date().toISOString();
    saveSettings();
    return updater.check();
  });
  handle('update:download', (info) => updater.download(info, (got, total) => win?.webContents.send('update:progress', { got, total })));
  handle('update:install', (setupPath) => updater.install(setupPath));

  handle('builds:delete', (file) => {
    requireProject();
    builds.remove(projectState().outputDir, file);
    return projectState();
  });

  handle('shell:open', (p) => shell.openPath(p));
  handle('shell:show', (p) => shell.showItemInFolder(p));
  handle('shell:external', (url) => {
    if (!/^https:\/\//.test(url)) throw new Error('Разрешены только https-ссылки');
    return shell.openExternal(url);
  });
  handle('fs:kind', (p) => {
    if (fs.existsSync(path.join(p, project.PROJECT_FILE))) return 'project';
    if (/project\.json$/i.test(p)) return 'project-file';
    return fs.existsSync(p) ? 'mod' : 'missing';
  });

  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.on('win:close', () => win?.close());
}

// ---------- окно ----------

const fileFromArgv = (argv) => argv.slice(1).find((a) => (OPENABLE_RE.test(a) || /project\.json$/i.test(a)) && fs.existsSync(a)) || null;
const openFile = (p) => p && win?.webContents.send('open-file', p);

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0f1013',
    icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.once('did-finish-load', () => setTimeout(() => openFile(pendingFile), 600));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Только для разработки: скрипт автотестов интерфейса и снимков экрана
  if (!app.isPackaged && process.env.MPS_DEV_SCRIPT) {
    win.webContents.once('did-finish-load', () => require(process.env.MPS_DEV_SCRIPT)(win, app));
  }
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    openFile(fileFromArgv(argv));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    if (!app.isPackaged && process.env.MPS_USER_DATA) app.setPath('userData', process.env.MPS_USER_DATA);
    loadSettings();
    pendingFile = fileFromArgv(process.argv);
    registerIpc();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
