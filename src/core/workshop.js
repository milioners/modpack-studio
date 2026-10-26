// Мастерская: свои моды автора. Каждый мод — папка с workshop.json, исходниками (src/, flash/)
// и собранными файлами (dist/). Здесь же — поиск игры, её состояние, установка мода и лог.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { listFiles, readJson, writeJsonAtomic } = require('./fsutil');
const templates = require('./modtemplates');

const MOD_FILE = 'workshop.json';
const GAME_EXES = ['Tanki.exe', 'WorldOfTanks.exe'];
const GAME_SUBDIRS = ['Games\\Tanki', 'Games\\World_of_Tanks_RU', 'Games\\Mir_Tankov', 'Tanki', 'Lesta\\Tanki', 'Games\\World_of_Tanks'];
// какие файлы мода можно открыть в редакторе студии
const TEXT_RE = /\.(py|html?|css|js|json|xml|hx|txt|md|cfg|ini)$/i;

// ---------- игра ----------

// «v.1.46.0 #123» → «1.46.0.0» (так называется папка mods/<версия>)
function gameVersion(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, 'version.xml'), 'utf8');
  } catch {
    return null;
  }
  const m = text.match(/v\.\s*([\d.]+)/);
  if (!m) return null;
  const parts = m[1].split('.').filter(Boolean);
  while (parts.length < 4) parts.push('0');
  return parts.slice(0, 4).join('.');
}

function gameInfo(dir) {
  const version = dir ? gameVersion(dir) : null;
  if (!version) return null;
  return {
    dir, version, modsDir: path.join(dir, 'mods', version), resModsDir: path.join(dir, 'res_mods', version),
    log: path.join(dir, 'python.log'), screenshots: path.join(dir, 'screenshots'),
    exe: GAME_EXES.map((e) => path.join(dir, e)).find((p) => fs.existsSync(p)) || null,
  };
}

// Папка игры: сначала указанная автором, потом обычные места на всех дисках
function findGame(hint) {
  const tried = new Set();
  const cands = [hint];
  for (const d of 'CDEFGH') for (const s of GAME_SUBDIRS) cands.push(`${d}:\\${s}`);
  for (const c of cands) {
    if (!c || tried.has(c.toLowerCase())) continue;
    tried.add(c.toLowerCase());
    const info = gameInfo(c);
    if (info) return info;
  }
  return null;
}

function tasklist() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      resolve(err ? '' : String(out));
    });
  });
}

async function gameRunning() {
  const out = (await tasklist()).toLowerCase();
  return GAME_EXES.some((e) => out.includes(`"${e.toLowerCase()}"`));
}

function killGame() {
  return Promise.all(GAME_EXES.map((e) => new Promise((resolve) => {
    execFile('taskkill', ['/IM', e, '/F'], { windowsHide: true }, () => resolve());
  })));
}

// Ждёт, пока игра закроется (после taskkill файлы модов освобождаются не сразу)
async function waitClosed(timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!(await gameRunning())) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ---------- моды ----------

function modDirs(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, MOD_FILE)))
    .map((e) => path.join(root, e.name));
}

function readMod(dir) {
  return readJson(path.join(dir, MOD_FILE));
}

function writeMod(dir, data) {
  writeJsonAtomic(path.join(dir, MOD_FILE), data);
}

// Самое позднее изменение исходников — чтобы показать «изменён · не собран»
function sourcesChangedAt(dir) {
  let t = 0;
  for (const sub of ['src', 'flash/src']) {
    const p = path.join(dir, sub);
    if (!fs.existsSync(p)) continue;
    for (const f of listFiles(p)) t = Math.max(t, fs.statSync(f).mtimeMs);
  }
  return t;
}

// Какая версия мода стоит в игре (по имени файла <id>_<версия>.mtmod)
function installedVersion(game, id) {
  if (!game || !fs.existsSync(game.modsDir)) return null;
  const prefix = `${id}_`.toLowerCase();
  const f = fs.readdirSync(game.modsDir).find((x) => x.toLowerCase().startsWith(prefix) && x.toLowerCase().endsWith('.mtmod'));
  return f ? f.slice(prefix.length, -'.mtmod'.length) : null;
}

function modSummary(dir, game) {
  const m = readMod(dir);
  const last = (m.builds || [])[0] || null;
  const changed = sourcesChangedAt(dir);
  return {
    dir, ...m, lastBuild: last,
    dirty: !last || changed > Date.parse(last.builtAt) + 1000,
    installed: installedVersion(game, m.id),
    preview: fs.existsSync(path.join(dir, 'preview.png')) ? path.join(dir, 'preview.png') : null,
  };
}

function list(root, game) {
  return modDirs(root).map((d) => {
    try {
      return modSummary(d, game);
    } catch (e) {
      return { dir: d, name: path.basename(d), broken: e.message };
    }
  }).sort((a, b) => String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')));
}

function create(root, opts) {
  const { names, files, flashClass, flashSwf } = templates.render(opts.template, opts);
  if (!/^[a-z0-9_.-]+$/i.test(names.id)) throw new Error('Идентификатор: только латиница, цифры, точка, дефис и подчёркивание');
  if (list(root).some((m) => m.id === names.id)) throw new Error(`Мод с идентификатором ${names.id} уже есть в Мастерской`);
  let dir = path.join(root, names.py);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, `${names.py}_${i}`);
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  }
  const now = new Date().toISOString();
  writeMod(dir, {
    format: 'tankair-mod', id: names.id, name: names.name, version: names.version, author: names.author, template: opts.template,
    game: opts.game || '', py: names.py, tag: names.tag, flashClass, flashSwf, created: now, updated: now, builds: [],
  });
  return dir;
}

function update(dir, patch) {
  const m = readMod(dir);
  for (const k of ['name', 'version', 'author', 'description']) if (patch[k] !== undefined) m[k] = String(patch[k]);
  m.updated = new Date().toISOString();
  writeMod(dir, m);
  if (patch.version !== undefined || patch.name !== undefined) syncMeta(dir, m);
  return m;
}

// meta.xml повторяет имя и версию из карточки мода
function syncMeta(dir, m) {
  const p = path.join(dir, 'src', 'meta.xml');
  if (!fs.existsSync(p)) return;
  let xml = fs.readFileSync(p, 'utf8');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  xml = xml.replace(/<version>[^<]*<\/version>/, `<version>${esc(m.version)}</version>`).replace(/<name>[^<]*<\/name>/, `<name>${esc(m.name)}</name>`);
  fs.writeFileSync(p, xml, 'utf8');
}

// ---------- файлы мода для редактора ----------

function inside(dir, rel) {
  const p = path.resolve(dir, rel);
  if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('Файл вне папки мода');
  return p;
}

function tree(dir) {
  const out = [];
  for (const sub of ['src', 'flash/src']) {
    const root = path.join(dir, sub);
    if (!fs.existsSync(root)) continue;
    for (const f of listFiles(root)) {
      const rel = path.relative(dir, f).replace(/\\/g, '/');
      out.push({ rel, size: fs.statSync(f).size, text: TEXT_RE.test(f) });
    }
  }
  return out;
}

function readFile(dir, rel) {
  const p = inside(dir, rel);
  if (!TEXT_RE.test(p)) throw new Error('Этот файл не текстовый');
  return fs.readFileSync(p, 'utf8');
}

function writeFile(dir, rel, text) {
  const p = inside(dir, rel);
  if (!TEXT_RE.test(p)) throw new Error('Этот файл не текстовый');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

// ---------- установка ----------

// Кладёт .mtmod в mods/<версия игры>, убирая прошлые версии этого мода
function install(file, game, id) {
  if (!game) throw new Error('Не найдена папка игры — укажите её в Мастерской');
  fs.mkdirSync(game.modsDir, { recursive: true });
  const prefix = `${id}_`.toLowerCase();
  for (const f of fs.readdirSync(game.modsDir)) {
    if (f.toLowerCase().startsWith(prefix) && f.toLowerCase().endsWith('.mtmod')) fs.rmSync(path.join(game.modsDir, f));
  }
  const dst = path.join(game.modsDir, path.basename(file));
  fs.copyFileSync(file, dst);
  return dst;
}

// ---------- лог и скриншоты ----------

// Последние строки python.log; строки Traceback склеиваются с ошибкой над ними
function logTail(game, { lines = 400, filter = '' } = {}) {
  if (!game || !fs.existsSync(game.log)) return { lines: [], size: 0 };
  const st = fs.statSync(game.log);
  const len = Math.min(st.size, 768 * 1024);
  const fd = fs.openSync(game.log, 'r');
  const buf = Buffer.alloc(len);
  try {
    fs.readSync(fd, buf, 0, len, st.size - len);
  } finally {
    fs.closeSync(fd);
  }
  let rows = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim());
  if (len < st.size) rows = rows.slice(1);
  const f = filter.toLowerCase();
  const out = [];
  for (const l of rows) {
    const kind = /\bERROR\b|\[EXCEPTION\]|Traceback|Error:/.test(l) ? 'error' : /WARNING/.test(l) ? 'warn' : 'info';
    const m = l.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\.\d+: (\w+): (?:\[([^\]]+)\] )?(.*)$/);
    out.push(m ? { time: m[1].slice(11), level: m[2], tag: m[3] || '', text: m[4], kind } : { time: '', level: '', tag: '', text: l, kind });
  }
  const filtered = f ? out.filter((r) => `${r.tag} ${r.text}`.toLowerCase().includes(f)) : out;
  return { lines: filtered.slice(-lines), size: st.size };
}

function screenshots(game, limit = 12) {
  if (!game || !fs.existsSync(game.screenshots)) return [];
  return fs.readdirSync(game.screenshots).filter((f) => /\.(jpe?g|png|bmp)$/i.test(f))
    .map((f) => {
      const p = path.join(game.screenshots, f);
      return { path: p, name: f, time: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.time - a.time).slice(0, limit);
}

module.exports = {
  MOD_FILE, gameVersion, gameInfo, findGame, gameRunning, killGame, waitClosed,
  list, create, update, readMod, writeMod, modSummary, tree, readFile, writeFile, install, installedVersion, logTail, screenshots,
};
