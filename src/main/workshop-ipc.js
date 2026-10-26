// IPC Мастерской: свои моды, сборка и установка в игру, справочник игры, лог и превью страниц.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { BrowserWindow, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const AdmZip = require('adm-zip');
const workshop = require('../core/workshop');
const modbuild = require('../core/modbuild');
const gameref = require('../core/gameref');

const PREVIEW_STUB = fs.readFileSync(path.join(__dirname, 'gameface-stub.html'), 'utf8');

// Картинки игры для превью страниц Gameface: gameimg://pkg/gui/maps/... читается из gui-part*.pkg
protocol.registerSchemesAsPrivileged([{ scheme: 'gameimg', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function register({ handle, app, dialog, shell, getWin, settings, saveSettings, addModToProject }) {
  const cfg = () => (settings().workshop ||= {});
  const root = () => cfg().root || path.join(app.getPath('documents'), 'TankAir Studio', 'Workshop');
  const refDir = () => path.join(app.getPath('userData'), 'gameref');
  const tools = () => modbuild.findTools();
  let gameCache = null;
  const game = () => {
    const hint = cfg().gamePath;
    if (!gameCache || gameCache.hint !== hint) gameCache = { hint, info: workshop.findGame(hint) };
    return gameCache.info;
  };
  const send = (ch, payload) => getWin()?.webContents.send(ch, payload);
  const modDir = (dir) => {
    const p = path.resolve(dir);
    if (!p.startsWith(path.resolve(root()) + path.sep) || !fs.existsSync(path.join(p, workshop.MOD_FILE))) throw new Error('Мод не найден в Мастерской');
    return p;
  };

  // ---------- картинки игры для превью ----------
  let pkgs = null;
  const pkgZips = () => {
    const g = game();
    if (!g) return [];
    if (!pkgs || pkgs.dir !== g.dir) {
      const dir = path.join(g.dir, 'res', 'packages');
      pkgs = { dir: g.dir, zips: fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^gui(-part\d+)?\.pkg$/i.test(f)).map((f) => path.join(dir, f)) : [], open: new Map() };
    }
    return pkgs.zips.map((f) => {
      if (!pkgs.open.has(f)) pkgs.open.set(f, new AdmZip(f));
      return pkgs.open.get(f);
    });
  };
  app.whenReady().then(() => {
    protocol.handle('gameimg', (req) => {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
      for (const z of pkgZips()) {
        const e = z.getEntry(rel);
        if (e) return new Response(e.getData(), { headers: { 'content-type': rel.endsWith('.png') ? 'image/png' : 'application/octet-stream' } });
      }
      return new Response('', { status: 404 });
    });
  });

  const wsState = async () => {
    const g = game();
    const t = tools();
    return {
      root: root(), game: g ? { ...g, running: await workshop.gameRunning() } : null, gamePath: cfg().gamePath || '',
      tools: { python: !!t.python, haxe: !!t.haxe }, mods: workshop.list(root(), g), ref: gameref.status(refDir(), g), steps: modbuild.STEPS,
    };
  };

  handle('ws:state', wsState);
  handle('ws:running', () => workshop.gameRunning());
  handle('ws:pickGame', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Папка «Мира танков»', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    if (!workshop.gameInfo(r.filePaths[0])) throw new Error('В этой папке нет игры (не найден version.xml)');
    cfg().gamePath = r.filePaths[0];
    saveSettings();
    return wsState();
  });
  handle('ws:pickRoot', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Папка для своих модов', defaultPath: root(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    cfg().root = r.filePaths[0];
    saveSettings();
    return wsState();
  });
  handle('ws:templates', () => require('../core/modtemplates').TEMPLATES);
  handle('ws:create', (opts) => {
    fs.mkdirSync(root(), { recursive: true });
    const dir = workshop.create(root(), { ...opts, game: game()?.version || '' });
    return workshop.modSummary(dir, game());
  });
  handle('ws:mod', (dir) => workshop.modSummary(modDir(dir), game()));
  handle('ws:update', (dir, patch) => {
    workshop.update(modDir(dir), patch);
    return workshop.modSummary(modDir(dir), game());
  });
  handle('ws:delete', async (dir) => {
    const p = modDir(dir);
    await shell.trashItem(p); // в корзину, а не насовсем
    return wsState();
  });
  handle('ws:tree', (dir) => workshop.tree(modDir(dir)));
  handle('ws:read', (dir, rel) => workshop.readFile(modDir(dir), rel));
  handle('ws:write', async (dir, rel, text) => {
    const p = modDir(dir);
    workshop.writeFile(p, rel, text);
    const check = rel.endsWith('.py') && tools().python ? await modbuild.checkFile(tools().python, p, rel) : { errors: [] };
    return check;
  });
  handle('ws:build', async (dir) => {
    const p = modDir(dir);
    const entry = await modbuild.build(p, tools(), (i, state, detail, ms) => send('ws:step', { dir: p, i, state, detail, ms }));
    return { entry, mod: workshop.modSummary(p, game()) };
  });
  // Установка последней сборки; если игра запущена — ошибка GAME_RUNNING или закрытие игры по kill
  handle('ws:install', async (dir, { kill = false } = {}) => {
    const p = modDir(dir);
    const m = workshop.readMod(p);
    const b = (m.builds || [])[0];
    if (!b || !fs.existsSync(b.file)) throw new Error('Сначала соберите мод');
    if (await workshop.gameRunning()) {
      if (!kill) throw new Error('GAME_RUNNING');
      await workshop.killGame();
      if (!(await workshop.waitClosed())) throw new Error('Игра не закрылась — закройте её вручную');
    }
    const dst = workshop.install(b.file, game(), m.id);
    return { file: dst, mod: workshop.modSummary(p, game()) };
  });
  handle('ws:launch', () => {
    const g = game();
    if (!g?.exe) throw new Error('Не найден файл запуска игры');
    spawn(g.exe, [], { cwd: g.dir, detached: true, stdio: 'ignore' }).unref();
  });
  handle('ws:kill', async () => {
    await workshop.killGame();
    return workshop.waitClosed();
  });
  handle('ws:log', (opts) => workshop.logTail(game(), opts || {}));
  handle('ws:shots', () => workshop.screenshots(game()).map((s) => ({ ...s, url: pathToFileURL(s.path).href })));
  handle('ws:addToModpack', (data, dir) => {
    const p = modDir(dir);
    const m = workshop.readMod(p);
    const b = (m.builds || [])[0];
    if (!b || !fs.existsSync(b.file)) throw new Error('Сначала соберите мод');
    return addModToProject(data, b.file, { name: m.name, version: m.version, author: m.author, description: m.description || '' });
  });

  // ---------- превью страницы Gameface ----------
  // 1280×720: панели мода в rem выглядят как на экране игры при масштабе 100%, но крупнее в карточке
  handle('ws:preview', async (dir, rel, size = { width: 1280, height: 720 }) => {
    const p = modDir(dir);
    const page = fs.readFileSync(path.join(p, rel), 'utf8');
    let sample = {};
    try {
      sample = JSON.parse(fs.readFileSync(path.join(p, 'preview.json'), 'utf8')).data || {};
    } catch { /* без образца данных */ }
    const stub = PREVIEW_STUB.replace('__DATA__', JSON.stringify(JSON.stringify(sample)));
    const html = page.replace(/img:\/\//g, 'gameimg://pkg/').replace('<script>', `${stub}<script>`);
    const tmp = path.join(os.tmpdir(), 'tas-preview', `${Date.now()}.html`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, html, 'utf8');
    const w = new BrowserWindow({ width: size.width, height: size.height, show: false, useContentSize: true, webPreferences: { offscreen: true } });
    try {
      await w.loadFile(tmp);
      await new Promise((r) => setTimeout(r, 700));
      const logs = await w.webContents.executeJavaScript('window.__logs || []');
      const img = await w.webContents.capturePage();
      return { image: img.toDataURL(), logs };
    } finally {
      w.destroy();
      fs.rmSync(tmp, { force: true });
    }
  });

  // ---------- справочник игры ----------
  handle('ref:status', () => gameref.status(refDir(), game()));
  handle('ref:build', () => gameref.build(refDir(), game(), tools().python, (m) => send('ref:progress', m)));
  handle('ref:search', (q, kind) => gameref.search(refDir(), game(), q, kind));
  handle('ref:detail', (hit) => gameref.detail(refDir(), game(), hit));
  handle('ref:snippet', (mod, cls, method, args) => gameref.interceptSnippet(mod, cls, method, args));
}

module.exports = { register };
