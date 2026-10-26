// Справочник игры: индекс скриптов клиента (Python 2.7) и классов Flash текущей версии игры.
// Скрипты разбирает py/gameindex.py тем же Python 2.7, что у игры; Flash — разбор байткода ABC здесь.
// Индекс кэшируется в папке программы и пересобирается после патча игры.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');

const INDEX_SCRIPT = path.join(__dirname, 'py', 'gameindex.py');
// Flash-файлы, в которых живут классы интерфейса (страницы, базовые классы, общие компоненты)
const FLASH_FILES = ['battle.swf', 'lobby.swf', 'guiControlsLobbyBattle.swf', 'guiControlsLobby.swf'];

const cache = new Map(); // файл индекса -> данные

// ---------- разбор Flash (ABC) ----------

function abcClasses(b) {
  let p = 0;
  const u8 = () => b[p++];
  const u16 = () => { const v = b.readUInt16LE(p); p += 2; return v; };
  const u30 = () => {
    let r = 0;
    for (let i = 0; i < 5; i++) {
      const c = b[p++];
      r += (c & 0x7f) * 2 ** (7 * i);
      if (!(c & 0x80)) break;
    }
    return r;
  };
  u16(); u16();
  for (let n = u30(), i = 1; i < n; i++) u30();
  for (let n = u30(), i = 1; i < n; i++) u30();
  for (let n = u30(), i = 1; i < n; i++) p += 8;
  const strings = [''];
  for (let n = u30(), i = 1; i < n; i++) {
    const len = u30();
    strings.push(b.toString('utf8', p, p + len));
    p += len;
  }
  const nss = [[0, '']];
  for (let n = u30(), i = 1; i < n; i++) { const k = u8(); nss.push([k, strings[u30()]]); }
  for (let n = u30(), i = 1; i < n; i++) { const c = u30(); for (let j = 0; j < c; j++) u30(); }
  const names = [null];
  for (let n = u30(), i = 1; i < n; i++) {
    const k = u8();
    if (k === 0x07 || k === 0x0d) { const ns = u30(); const nm = u30(); names.push([nss[ns][1], strings[nm], nss[ns][0]]); }
    else if (k === 0x0f || k === 0x10) names.push(['', strings[u30()], 0]);
    else if (k === 0x11 || k === 0x12) names.push(['', '*', 0]);
    else if (k === 0x09 || k === 0x0e) { const nm = u30(); u30(); names.push(['', strings[nm], 0]); }
    else if (k === 0x1b || k === 0x1c) { u30(); names.push(['', '*', 0]); }
    else if (k === 0x1d) { u30(); for (let c = u30(), j = 0; j < c; j++) u30(); names.push(['', 'Vector', 0]); }
    else throw new Error(`multiname ${k}`);
  }
  const qn = (i) => (!i || !names[i] ? '*' : names[i][0] ? `${names[i][0]}.${names[i][1]}` : names[i][1]);
  const methods = [];
  for (let n = u30(), i = 0; i < n; i++) {
    const pc = u30();
    const ret = u30();
    const params = [];
    for (let j = 0; j < pc; j++) params.push(u30());
    u30();
    const flags = u8();
    if (flags & 0x08) for (let c = u30(), j = 0; j < c; j++) { u30(); u8(); }
    if (flags & 0x80) for (let j = 0; j < pc; j++) u30();
    methods.push([params, ret]);
  }
  for (let n = u30(), i = 0; i < n; i++) { u30(); for (let c = u30(), j = 0; j < c; j++) { u30(); u30(); } }
  const traits = () => {
    const out = [];
    for (let n = u30(), i = 0; i < n; i++) {
      const nm = u30();
      const kind = u8();
      const t = kind & 0x0f;
      const vis = names[nm] ? { 0x05: 'private', 0x17: 'internal', 0x18: 'protected', 0x1a: 'protected' }[names[nm][2]] || 'public' : 'public';
      const name = names[nm] ? names[nm][1] : '?';
      if (t === 0 || t === 6) { u30(); const tn = u30(); if (u30()) u8(); out.push({ k: 'var', n: name, t: qn(tn), v: vis }); }
      else if (t >= 1 && t <= 3) { u30(); const [ps, ret] = methods[u30()]; out.push({ k: ['', 'function', 'get', 'set'][t], n: name, a: ps.map(qn), t: qn(ret), v: vis }); }
      else { u30(); u30(); }
      if ((kind >> 4) & 0x04) for (let c = u30(), j = 0; j < c; j++) u30();
    }
    return out;
  };
  const inst = [];
  const count = u30();
  for (let i = 0; i < count; i++) {
    const name = u30();
    const sup = u30();
    const flags = u8();
    if (flags & 0x08) u30();
    const ifaces = [];
    for (let c = u30(), j = 0; j < c; j++) ifaces.push(qn(u30()));
    u30();
    inst.push({ n: qn(name), s: qn(sup), i: ifaces, iface: !!(flags & 0x04), t: traits() });
  }
  for (let i = 0; i < count; i++) { u30(); traits(); }
  return inst;
}

function flashClasses(swf) {
  let data = swf;
  const sig = data.slice(0, 3).toString('latin1');
  if (sig === 'CWS') data = Buffer.concat([data.slice(0, 8), zlib.inflateSync(data.slice(8))]);
  else if (sig !== 'FWS') return [];
  let pos = 8 + Math.ceil((5 + (data[8] >> 3) * 4) / 8) + 4;
  const out = [];
  while (pos < data.length) {
    const cl = data.readUInt16LE(pos);
    pos += 2;
    const code = cl >> 6;
    let len = cl & 0x3f;
    if (len === 0x3f) { len = data.readUInt32LE(pos); pos += 4; }
    const body = data.slice(pos, pos + len);
    pos += len;
    try {
      if (code === 82) { let z = 4; while (body[z] !== 0) z++; out.push(...abcClasses(body.slice(z + 1))); }
      else if (code === 72) out.push(...abcClasses(body));
    } catch { /* повреждённый блок — пропускаем */ }
    if (code === 0) break;
  }
  return out;
}

// ---------- сборка индекса ----------

function indexFile(cacheDir, version) {
  return path.join(cacheDir, `gameref-${version}.json`);
}

function load(cacheDir, version) {
  const file = indexFile(cacheDir, version);
  if (cache.has(file)) return cache.get(file);
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  cache.set(file, data);
  return data;
}

function status(cacheDir, game) {
  if (!game) return { ready: false, reason: 'no-game' };
  const d = load(cacheDir, game.version);
  if (!d) return { ready: false, reason: 'not-built', version: game.version };
  return { ready: true, version: d.version, builtAt: d.builtAt, modules: d.modules.length, classes: d.stats.classes, flash: d.flash.length };
}

function runPy(python, args) {
  return new Promise((resolve, reject) => {
    execFile(python, ['-E', '-S', ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 }, (err, out, errOut) => {
      if (err) reject(new Error(String(errOut || err.message).trim()));
      else resolve(String(out));
    });
  });
}

async function build(cacheDir, game, python, onProgress = () => {}) {
  if (!game) throw new Error('Не найдена папка игры');
  if (!python) throw new Error('Не найден Python 2.7 для разбора скриптов игры');
  fs.mkdirSync(cacheDir, { recursive: true });
  const pkg = path.join(game.dir, 'res', 'packages', 'scripts.pkg');
  if (!fs.existsSync(pkg)) throw new Error('Не найден res/packages/scripts.pkg');
  onProgress('Разбираю скрипты игры…');
  const tmp = path.join(cacheDir, `py-${Date.now()}.json`);
  let py;
  try {
    await runPy(python, [INDEX_SCRIPT, pkg, tmp]);
    py = JSON.parse(fs.readFileSync(tmp, 'utf8')).modules;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  onProgress('Разбираю классы Flash…');
  const flash = [];
  const pkgDir = path.join(game.dir, 'res', 'packages');
  for (const name of fs.readdirSync(pkgDir).filter((f) => /^gui-part\d+\.pkg$/i.test(f))) {
    const zip = new AdmZip(path.join(pkgDir, name));
    for (const swf of FLASH_FILES) {
      const e = zip.getEntry(`gui/flash/${swf}`);
      if (!e) continue;
      for (const c of flashClasses(e.getData())) flash.push({ ...c, file: swf });
    }
  }
  const classes = py.reduce((s, m) => s + m.c.length, 0);
  const data = { version: game.version, builtAt: new Date().toISOString(), stats: { classes }, modules: py, flash };
  const file = indexFile(cacheDir, game.version);
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
  cache.set(file, data);
  return status(cacheDir, game);
}

// ---------- поиск ----------

// Совпадения по классам, методам, функциям и модулям; точное и «начинается с» — выше
function search(cacheDir, game, query, kind = 'all', limit = 60) {
  const d = game && load(cacheDir, game.version);
  if (!d) return [];
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = [];
  const score = (name) => {
    const n = name.toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return -1;
  };
  if (kind === 'all' || kind === 'python') {
    for (const m of d.modules) {
      for (const c of m.c) {
        const s = score(c.n);
        if (s >= 0) hits.push({ kind: 'class', lang: 'python', name: c.n, mod: m.mod, score: s, count: c.m.length });
        for (const [mn, args] of c.m) {
          const ms = score(mn);
          if (ms >= 0) hits.push({ kind: 'method', lang: 'python', name: `${c.n}.${mn}`, cls: c.n, method: mn, args, mod: m.mod, score: ms + 0.5 });
        }
      }
      for (const [fn, args] of m.f) {
        const s = score(fn);
        if (s >= 0) hits.push({ kind: 'function', lang: 'python', name: fn, args, mod: m.mod, score: s + 0.6 });
      }
      const ms = score(m.mod.split('.').pop());
      if (ms >= 0) hits.push({ kind: 'module', lang: 'python', name: m.mod, mod: m.mod, score: ms + 0.3, count: m.c.length });
    }
  }
  if (kind === 'all' || kind === 'flash') {
    for (const c of d.flash) {
      const short = c.n.split('.').pop();
      const s = score(short);
      if (s >= 0) hits.push({ kind: c.iface ? 'interface' : 'class', lang: 'flash', name: c.n, file: c.file, score: s + 0.2, count: c.t.length });
    }
  }
  hits.sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  // один и тот же класс может встретиться в двух Flash-файлах
  const seen = new Set();
  return hits.filter((h) => {
    const k = `${h.lang}|${h.kind}|${h.name}|${h.mod || ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, limit);
}

// Карточка класса Python или Flash
function detail(cacheDir, game, hit) {
  const d = game && load(cacheDir, game.version);
  if (!d) return null;
  if (hit.lang === 'flash') {
    const c = d.flash.find((x) => x.n === hit.name);
    return c && { lang: 'flash', name: c.n, file: c.file, super: c.s, ifaces: c.i, members: c.t.filter((t) => t.v !== 'private') };
  }
  const m = d.modules.find((x) => x.mod === hit.mod);
  if (!m) return null;
  if (hit.kind === 'module' || hit.kind === 'function') {
    return { lang: 'python', kind: 'module', mod: m.mod, file: m.file, classes: m.c.map((c) => c.n), functions: m.f };
  }
  const c = m.c.find((x) => x.n === (hit.cls || hit.name));
  return c && { lang: 'python', kind: 'class', name: c.n, mod: m.mod, file: m.file, methods: c.m, focus: hit.method || null };
}

// Готовый перехват метода для мода (обёртка через _patch из шаблонов Мастерской)
function interceptSnippet(mod, cls, method, args) {
  const params = (args || []).filter((a) => a !== 'self');
  const sig = ['original', 'self', ...params.map((a) => (a.startsWith('*') ? a : a)), ...(params.some((a) => a.startsWith('**')) ? [] : ['**kwargs'])];
  const call = ['self', ...params.map((a) => (a.startsWith('*') ? a : a)), ...(params.some((a) => a.startsWith('**')) ? [] : ['**kwargs'])];
  const fn = `_on_${method.replace(/^_+/, '').replace(/[^\w]/g, '_')}`;
  return {
    func: `
def ${fn}(${sig.join(', ')}):
    result = original(${call.join(', ')})
    # ${cls}.${method} уже выполнился — здесь ваш код
    LOGGER.info('${cls}.${method}')
    return result
`,
    init: `    from ${mod} import ${cls}
    _patch(${cls}, '${method}', ${fn})`,
  };
}

module.exports = { status, build, search, detail, interceptSnippet, flashClasses };
