// Визуальный редактор окна установщика: холст со свободным размещением элементов (как в Figma).
// Холст рисует элементы приближённо в HTML; кнопка «Проверить в настоящем окне» показывает точный снимок установщика.
'use strict';

const CE = {
  meta: null,
  screen: 'welcome',
  sel: [],            // id выбранных элементов
  hist: [],           // снимки раскладки для отмены
  fut: [],
  clip: null,
  grid: true,
  tab: 'canvas',      // canvas | theme
  scale: 1,
  drag: null,
};

const lay = () => S.proj.installer.layout;
const scr = () => lay().screens[CE.screen];
const els = () => scr().elements;
const byId = (id) => els().find((e) => e.id === id);
const selected1 = () => (CE.sel.length === 1 ? byId(CE.sel[0]) : null);
const GRID = 8;

async function ceInit() {
  if (!CE.meta) CE.meta = await call(api.layoutMeta);
}

// ---------- история ----------

function ceSnap() {
  CE.hist.push(JSON.stringify(lay()));
  if (CE.hist.length > 100) CE.hist.shift();
  CE.fut = [];
}
function ceCommit() {
  changed({ tree: false });
  ceRender();
}
function ceUndo(redo = false) {
  const from = redo ? CE.fut : CE.hist;
  const to = redo ? CE.hist : CE.fut;
  if (!from.length) return;
  to.push(JSON.stringify(lay()));
  S.proj.installer.layout = JSON.parse(from.pop());
  CE.sel = CE.sel.filter((id) => byId(id));
  ceCommit();
}

// ---------- цвета и подстановки ----------

const TOKENS = ['bg', 'surface', 'card', 'border', 'text', 'muted', 'accent', 'accentText', 'danger', 'success'];
const TOKEN_NAMES = { bg: 'Фон', surface: 'Панели', card: 'Карточки', border: 'Рамки', text: 'Текст', muted: 'Второстеп.', accent: 'Акцент', accentText: 'На акценте', danger: 'Опасность', success: 'Успех' };

function col(v, def = '@text') {
  const s = v || def;
  if (s.startsWith('@')) return S.proj.installer.colors[s.slice(1)] || '#ff00ff';
  // #aarrggbb → rgba
  if (/^#[0-9a-f]{8}$/i.test(s)) {
    const n = parseInt(s.slice(1), 16);
    return `rgba(${(n >>> 16) & 255},${(n >>> 8) & 255},${n & 255},${((n >>> 24) & 255) / 255})`;
  }
  return s;
}
const fontOf = (f) => (!f || f === '@font' ? S.proj.installer.font : f === '@titleFont' ? S.proj.installer.titleFont : f);

function sampleFill(s) {
  const p = S.proj;
  const mods = allMods();
  const map = {
    name: p.info.name, version: p.info.version, author: p.info.author, gameVersion: p.info.gameVersion || '1.30.0.0',
    description: p.installer.texts.welcomeText || p.info.description, welcomeTitle: p.installer.texts.welcomeTitle || p.info.name,
    finishTitle: p.installer.texts.finishTitle || 'Готово!', finishText: p.installer.texts.finishText || `Модпак «${p.info.name}» установлен. Можно запускать игру!`,
    modsCount: mods.length, size: fmtSize(mods.reduce((s, m) => s + modSize(m), 0)), selected: mods.filter((m) => m.checked).length,
    selectedSize: fmtSize(mods.filter((m) => m.checked).reduce((s, m) => s + modSize(m), 0)), game: 'Игра: C:\\Games\\Tanki  ·  1.30.0.0',
    gamePath: 'C:\\Games\\Tanki', installedVersion: '1.0', updateVersion: bump(p.info.version, 'minor'),
  };
  return String(s || '').replace(/\{(\w+)\}/g, (m, k) => (map[k] !== undefined ? map[k] : m)).replace(/\s+•\s*$/, '');
}

// ---------- отрисовка элементов (приближённо) ----------

const imgUrlCache = new Map();
function imgSrc(src) {
  if (!src) return null;
  const rel = src === '@logo' ? S.proj.design.icon : src === '@banner' ? S.proj.design.bannerImage : src;
  if (!rel) return src === '@logo' ? 'logo-default' : null;
  return rel;
}

function elHtml(e) {
  const p = e.props;
  const r = (v) => `${Math.max(0, v || 0)}px`;
  switch (e.type) {
    case 'text': {
      const jc = p.valign === 'center' ? 'center' : p.valign === 'bottom' ? 'flex-end' : 'flex-start';
      return `<div class="ce-text" style="justify-content:${jc};text-align:${p.align};color:${col(p.color)};font:${p.italic ? 'italic ' : ''}${p.weight === 'bold' ? 700 : p.weight === 'semibold' ? 600 : p.weight === 'light' ? 300 : 400} ${p.size}px '${fontOf(p.font)}', 'Segoe UI';${p.lineHeight ? `line-height:${p.lineHeight}px;` : ''}${p.shadow ? 'text-shadow:0 1px 8px rgba(0,0,0,.85);' : ''}"><span>${esc(sampleFill(p.text))}</span></div>`;
    }
    case 'image': {
      const rel = imgSrc(p.src);
      const fit = p.fit === 'contain' ? 'contain' : p.fit === 'fill' ? '100% 100%' : 'cover';
      if (rel === 'logo-default') return `<div class="ce-img" style="border-radius:${r(p.radius)}">${LOGO.replace('width="26" height="26"', 'width="100%" height="100%"')}</div>`;
      if (!rel) return `<div class="ce-img empty" style="border-radius:${r(p.radius)}">${icon('image', 22)}<span>${p.src === '@banner' ? 'Баннер не выбран' : 'Картинка'}</span></div>`;
      return `<div class="ce-img" data-ce-img="${esc(rel)}" style="border-radius:${r(p.radius)};background-size:${fit};border:${p.borderWidth || 0}px solid ${col(p.border, '@border')}"></div>`;
    }
    case 'shape': {
      const bg = p.fill2 ? `linear-gradient(${(p.angle || 90) + 90}deg, ${col(p.fill)}, ${col(p.fill2)})` : col(p.fill, '@surface');
      return `<div class="ce-box" style="background:${bg};border-radius:${r(p.radius)};border:${p.borderWidth || 0}px solid ${col(p.border, '@border')};${p.shadow ? 'box-shadow:0 6px 24px rgba(0,0,0,.5);' : ''}"></div>`;
    }
    case 'button': {
      const fill = col(p.fill, '@accent');
      return `<div class="ce-btn" style="background:${fill};color:${col(p.color, '@accentText')};border-radius:${r(p.radius)};border:${p.borderWidth || 0}px solid ${col(p.border, '@accent')};font:${p.weight === 'bold' ? 700 : p.weight === 'semibold' ? 600 : 400} ${p.size}px '${fontOf(p.font)}', 'Segoe UI';${p.glow && !/rgba\(.*,0\)$/.test(fill) ? `box-shadow:0 0 18px ${fill}59;` : ''}">${esc(sampleFill(p.label))}</div>`;
    }
    case 'modlist': return modListHtml(p);
    case 'moddetail': {
      const m = allMods()[0];
      return `<div class="ce-panel ce-detail">${m ? `<div class="ce-detail-img">${thumb(m)}</div><div class="ce-pad"><small style="color:${col('@accent')}">ГРУППА</small><b>${esc(m.name)}</b><small>Версия ${esc(m.version || '1.0')} · ${fmtSize(modSize(m))}</small><p>${esc((m.description || '').slice(0, 180))}</p></div>
        <div class="ce-mini-btn" style="background:${col('@accent')};color:${col('@accentText')}">Добавить в набор</div>` : ''}</div>`;
    }
    case 'gamecard':
      return `<div class="ce-panel ce-pad"><b><i class="dot" style="background:${col('@success')}"></i>Игра найдена · 1.30.0.0</b><small>C:\\Games\\Tanki</small><span class="ce-chip-btn">Изменить папку</span></div>`;
    case 'options':
      return `<div class="ce-opts">${p.game ? `<div><i class="dot" style="background:${col('@success')}"></i><b>C:\\Games\\Tanki · 1.30.0.0</b> <span style="color:${col('@accent')}">Изменить</span></div>` : ''}
        <div class="ce-toggles">${p.clean ? `<span><i class="tg" style="background:${col('@accent')}"></i>Убрать старые моды (в бэкап)</span>` : ''}${p.shortcut ? `<span><i class="tg" style="background:${col('@accent')}"></i>Ярлык на рабочем столе</span>` : ''}</div></div>`;
    case 'progress':
      return `<div class="ce-progress"><small>Лампа «Шестое чувство»</small><div class="bar" style="background:${col('@card')};border-color:${col('@border')}"><i style="background:${col('@accent')};box-shadow:0 0 12px ${col('@accent')}"></i></div><b style="color:${col('@accent')}">62%</b></div>`;
    case 'changelog': {
      const cl = S.proj.changelog.find((c) => c.text.trim());
      return `<div class="ce-panel ce-pad"><b>Что нового в версии ${esc(cl?.version || S.proj.info.version)}</b><p>${esc(cl?.text || 'Список изменений из раздела «Сборка»')}</p></div>`;
    }
    case 'wincontrols':
      return `<div class="ce-win"><span>—</span><span>✕</span></div>`;
  }
  return '';
}

function modListHtml(p) {
  const mods = allMods().slice(0, 8);
  const cats = ['Все моды', ...S.proj.tree.filter((n) => n.type === 'group').map((g) => g.name), 'Выбранные'];
  const tabs = p.categories === 'tabs' ? `<div class="ce-tabs">${cats.map((c, i) => `<span class="${i === 0 ? 'on' : ''}" style="${i === 0 ? `background:${col('@accent')};color:${col('@accentText')}` : ''}">${esc(c)}</span>`).join('')}</div>` : '';
  const side = p.categories === 'sidebar' ? `<div class="ce-side">${cats.map((c, i) => `<span style="${i === 0 ? `background:${col('@accent')};color:${col('@accentText')}` : ''}">${esc(c)}</span>`).join('')}</div>` : '';
  const w = p.cardSize === 's' ? 168 : p.cardSize === 'l' ? 262 : 210;
  const items = p.layout === 'list'
    ? mods.map((m) => `<div class="ce-row" style="border-color:${m.checked ? col('@accent') : col('@border')}"><i class="ind ${m.checked ? 'on' : ''}" style="${m.checked ? `background:${col('@accent')}` : ''}"></i><div class="th">${thumb(m)}</div><div><b>${esc(m.name)}</b><small>${esc((m.description || '').split('\n')[0])}</small></div></div>`).join('')
    : mods.map((m) => `<div class="ce-card" style="width:${w}px;border-color:${m.checked ? col('@accent') : col('@border')}"><div class="th" style="height:${w * 9 / 16}px">${thumb(m)}<i class="ind ${m.checked ? 'on' : ''}" style="${m.checked ? `background:${col('@accent')}` : ''}"></i></div><b>${esc(m.name)}</b><small>v${esc(m.version || '1.0')} · ${fmtSize(modSize(m))}</small></div>`).join('');
  return `<div class="ce-modlist ${p.categories === 'sidebar' ? 'with-side' : ''}">${side}<div class="ce-ml-main">
    <div class="ce-ml-top">${tabs}${p.search ? '<span class="ce-search">Поиск модов…</span>' : ''}</div>
    <div class="ce-ml-items ${p.layout === 'list' ? 'list' : ''}">${items || '<em>Добавьте моды в «Составе модпака»</em>'}</div></div></div>`;
}

// ---------- страница ----------

function pageCanvasEditor() {
  const L = lay();
  const tabs = `<div class="seg-tabs ce-tabsbar"><button class="${CE.tab === 'canvas' ? 'on' : ''}" data-act="ce-tab" data-tab="canvas">${icon('edit', 14)}Холст</button><button class="${CE.tab === 'theme' ? 'on' : ''}" data-act="ce-tab" data-tab="theme">${icon('image', 14)}Палитра, шрифты, фон</button></div>`;
  if (CE.tab === 'theme') return tabs + pageInstallerDesign();
  if (!CE.meta) return `${tabs}<div class="empty"><span class="spinner big-spin"></span><p>Загружаю редактор…</p></div>`;
  return `${tabs}
    <div class="ce" id="ce">
      <aside class="ce-left">
        <div class="ce-sect">Экраны</div>
        ${CE.meta.screens.map((k) => `<button class="ce-scr ${CE.screen === k ? 'on' : ''}" data-act="ce-screen" data-screen="${k}">${esc(CE.meta.screenNames[k])}
          ${L.screens[k].enabled === false ? '<span class="badge">выкл</span>' : ''}<span class="n">${L.screens[k].elements.length}</span></button>`).join('')}
        <button class="btn sm" style="margin-top:8px" data-act="ce-templates">${icon('catalog', 13)}Шаблоны</button>
        <div class="ce-sect">Добавить</div>
        <div class="ce-add">${Object.entries(CE.meta.types).map(([k, t]) => `<button data-act="ce-add" data-type="${k}" title="${esc(t.name)}">${icon(ADD_ICONS[k] || 'plus', 14)}<span>${esc(t.name)}</span></button>`).join('')}</div>
        <div class="ce-sect">Слои <small>сверху — выше</small></div>
        <div class="ce-layers">${[...els()].reverse().map((e) => `<div class="ce-layer ${CE.sel.includes(e.id) ? 'on' : ''} ${e.hidden ? 'hid' : ''}" data-act="ce-pick" data-id="${e.id}">
          ${icon(ADD_ICONS[e.type] || 'other', 13)}<span>${esc(e.name)}</span>${e.showIf !== 'always' ? `<i title="${esc(CE.meta.showIf[e.showIf])}">?</i>` : ''}
          <button data-act="ce-eye" data-id="${e.id}" title="${e.hidden ? 'Показать' : 'Скрыть'}">${e.hidden ? '◌' : '●'}</button>
          <button data-act="ce-lock" data-id="${e.id}" title="${e.locked ? 'Разблокировать' : 'Заблокировать'}">${e.locked ? '🔒' : '·'}</button></div>`).join('')}</div>
      </aside>
      <section class="ce-center">
        <div class="ce-toolbar">
          <button class="btn sm icon-only" data-act="ce-undo" title="Отменить (Ctrl+Z)" ${CE.hist.length ? '' : 'disabled'}>↶</button>
          <button class="btn sm icon-only" data-act="ce-redo" title="Повторить (Ctrl+Y)" ${CE.fut.length ? '' : 'disabled'}>↷</button>
          <span class="sep"></span>
          <button class="btn sm ${CE.grid ? 'on' : ''}" data-act="ce-grid">${icon('catalog', 13)}Сетка</button>
          ${CE.sel.length ? `<button class="btn sm" data-act="ce-dup" title="Ctrl+D">${icon('squares', 13)}Копия</button>
            <button class="btn sm" data-act="ce-z" data-dir="up" title="Выше">${icon('arrow', 13, 'up')}</button>
            <button class="btn sm" data-act="ce-z" data-dir="down" title="Ниже">${icon('arrow', 13, 'down')}</button>
            <button class="btn sm danger" data-act="ce-del" title="Delete">${icon('trash', 13)}</button>` : ''}
          <span class="grow"></span>
          <span class="hint-text">${L.window.width}×${L.window.height}</span>
          <button class="btn sm" data-act="ce-real">${icon('play', 13)}Проверить в настоящем окне</button>
          <button class="btn sm primary" data-act="ip-open">${icon('external', 13)}Открыть установщик</button>
        </div>
        <div class="ce-stage-wrap" id="ce-wrap"><div class="ce-stage" id="ce-stage"></div></div>
        <div class="hint-text ce-hint">Перетаскивайте элементы мышью, тяните за маркеры, чтобы изменить размер. Shift — несколько элементов, стрелки — сдвиг на 1 px (с Shift — на 10), Alt — без привязки.</div>
      </section>
      <aside class="ce-right" id="ce-props"></aside>
    </div>`;
}

const ADD_ICONS = { text: 'edit', image: 'image', shape: 'square', button: 'play', modlist: 'catalog', moddetail: 'file', gamecard: 'target', options: 'settings', progress: 'refresh', changelog: 'info', wincontrols: 'x' };

function ceRender() {
  if (S.page !== 'design' || !isMps() || CE.tab !== 'canvas') {
    if (S.page === 'design') renderPage();
    return;
  }
  const page = $('#page');
  const st = page.scrollTop;
  page.innerHTML = pageCanvasEditor();
  page.scrollTop = st;
  ceStage();
  ceProps();
}

function ceStage() {
  const stage = $('#ce-stage');
  const wrap = $('#ce-wrap');
  if (!stage) return;
  const L = lay();
  const sc = scr();
  const avail = wrap.clientWidth - 24;
  CE.scale = Math.min(1, avail / L.window.width);
  stage.style.width = `${L.window.width}px`;
  stage.style.height = `${L.window.height}px`;
  stage.style.transform = `scale(${CE.scale})`;
  wrap.style.height = `${L.window.height * CE.scale + 24}px`;
  stage.style.borderRadius = `${L.window.radius}px`;
  stage.style.background = col(sc.background.color, '@bg');
  stage.style.fontFamily = `'${S.proj.installer.font}', 'Segoe UI'`;
  stage.style.color = col('@text');
  const pi = S.proj.installer;
  const so = pi.surfaceOpacity ?? 0.9;
  const alpha = (hex, k) => { const n = parseInt(String(hex).slice(1, 7), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${k})`; };
  stage.style.setProperty('--ce-surface', alpha(col('@surface'), so));
  stage.style.setProperty('--ce-card', alpha(col('@card'), so));
  stage.style.setProperty('--ce-border', col('@border'));
  stage.style.setProperty('--ce-muted', col('@muted'));
  stage.style.setProperty('--ce-radius', `${pi.radius}px`);
  const bgRel = sc.background.image || S.proj.installer.backgroundImage;
  stage.innerHTML = `${bgRel ? `<div class="ce-bg" data-ce-img="${esc(bgRel)}" style="filter:blur(${sc.background.blur}px)"></div><div class="ce-dim" style="background:${col(sc.background.color, '@bg')};opacity:${sc.background.dim}"></div>` : ''}
    ${CE.grid ? '<div class="ce-gridbg"></div>' : ''}
    ${els().map((e) => `<div class="ce-el ${CE.sel.includes(e.id) ? 'sel' : ''} ${e.hidden ? 'hid' : ''} ${e.locked ? 'locked' : ''}" data-ce-el="${e.id}"
        style="left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;opacity:${e.hidden ? 0.15 : e.opacity}">${elHtml(e)}
        ${e.showIf !== 'always' ? `<span class="ce-cond">${esc(CE.meta.showIf[e.showIf])}</span>` : ''}</div>`).join('')}
    <div class="ce-guides" id="ce-guides"></div>
    ${ceHandles()}`;
  stage.querySelectorAll('[data-ce-img]').forEach(async (d) => {
    const u = await getImg(d.dataset.ceImg);
    if (u) d.style.backgroundImage = `url("${u}")`;
  });
  hydrate(stage);
  // если окно установщика по-прежнему не помещается — масштаб пересчитывается при изменении размера окна
}

function ceBounds(ids = CE.sel) {
  const list = ids.map(byId).filter(Boolean);
  if (!list.length) return null;
  const x = Math.min(...list.map((e) => e.x));
  const y = Math.min(...list.map((e) => e.y));
  return { x, y, w: Math.max(...list.map((e) => e.x + e.w)) - x, h: Math.max(...list.map((e) => e.y + e.h)) - y };
}

function ceHandles() {
  const b = ceBounds();
  if (!b) return '';
  const k = 1 / CE.scale;
  const hs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  return `<div class="ce-selbox" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border-width:${1.5 * k}px">
    ${CE.sel.length === 1 ? hs.map((h) => `<i class="ce-h ${h}" data-handle="${h}" style="width:${10 * k}px;height:${10 * k}px;margin:${-5 * k}px"></i>`).join('') : ''}
    <span class="ce-size" style="transform:scale(${k});transform-origin:left bottom">${Math.round(b.x)}, ${Math.round(b.y)} · ${Math.round(b.w)}×${Math.round(b.h)}</span></div>`;
}

// ---------- мышь: выбор, перемещение, изменение размера ----------

function stagePoint(ev) {
  const r = $('#ce-stage').getBoundingClientRect();
  return { x: (ev.clientX - r.left) / CE.scale, y: (ev.clientY - r.top) / CE.scale };
}

// Привязка к сетке, краям и центрам других элементов и окна. Возвращает поправку и линии-направляющие
function snapRect(r, ignore, noSnap) {
  if (noSnap) return { dx: 0, dy: 0, lines: [] };
  const L = lay();
  const xs = [0, L.window.width / 2, L.window.width];
  const ys = [0, L.window.height / 2, L.window.height];
  for (const e of els()) {
    if (ignore.includes(e.id) || e.hidden) continue;
    xs.push(e.x, e.x + e.w / 2, e.x + e.w);
    ys.push(e.y, e.y + e.h / 2, e.y + e.h);
  }
  const pick = (vals, cands) => {
    let best = null;
    for (const v of vals) for (const c of cands) {
      const d = c - v;
      if (Math.abs(d) <= 6 / CE.scale && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c };
    }
    return best;
  };
  const bx = pick([r.x, r.x + r.w / 2, r.x + r.w], xs);
  const by = pick([r.y, r.y + r.h / 2, r.y + r.h], ys);
  let dx = bx ? bx.d : 0;
  let dy = by ? by.d : 0;
  if (!bx && CE.grid) dx = Math.round(r.x / GRID) * GRID - r.x;
  if (!by && CE.grid) dy = Math.round(r.y / GRID) * GRID - r.y;
  const lines = [];
  if (bx) lines.push({ x: bx.at });
  if (by) lines.push({ y: by.at });
  return { dx, dy, lines };
}

function drawGuides(lines) {
  const g = $('#ce-guides');
  if (!g) return;
  const k = 1 / CE.scale;
  g.innerHTML = lines.map((l) => (l.x !== undefined ? `<i style="left:${l.x}px;top:0;bottom:0;width:${k}px"></i>` : `<i style="top:${l.y}px;left:0;right:0;height:${k}px"></i>`)).join('');
}

function moveDom() {
  for (const id of CE.sel) {
    const e = byId(id);
    const d = document.querySelector(`[data-ce-el="${id}"]`);
    if (d) Object.assign(d.style, { left: `${e.x}px`, top: `${e.y}px`, width: `${e.w}px`, height: `${e.h}px` });
  }
  const box = document.querySelector('.ce-selbox');
  const b = ceBounds();
  if (box && b) {
    Object.assign(box.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    const sz = box.querySelector('.ce-size');
    if (sz) sz.textContent = `${Math.round(b.x)}, ${Math.round(b.y)} · ${Math.round(b.w)}×${Math.round(b.h)}`;
  }
}

document.addEventListener('mousedown', (ev) => {
  const stage = ev.target.closest?.('#ce-stage');
  if (!stage || ev.button !== 0) return;
  ev.preventDefault();
  const p = stagePoint(ev);
  const handle = ev.target.closest('[data-handle]')?.dataset.handle;
  const elDiv = ev.target.closest('[data-ce-el]');
  if (!handle) {
    const id = elDiv?.dataset.ceEl;
    if (!id) {
      CE.sel = [];
      ceStage();
      ceProps();
      ceLayersRefresh();
      return;
    }
    if (ev.shiftKey) CE.sel = CE.sel.includes(id) ? CE.sel.filter((x) => x !== id) : [...CE.sel, id];
    else if (!CE.sel.includes(id)) CE.sel = [id];
    ceStage();
    ceProps();
    ceLayersRefresh();
    if (!CE.sel.includes(id) || byId(id).locked) return;
  }
  const start = Object.fromEntries(CE.sel.map((id) => [id, { ...byId(id) }]));
  CE.drag = { handle, p0: p, start, moved: false };
});

document.addEventListener('mousemove', (ev) => {
  const d = CE.drag;
  if (!d) return;
  const p = stagePoint(ev);
  let dx = p.x - d.p0.x;
  let dy = p.y - d.p0.y;
  if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3 / CE.scale) return;
  if (!d.moved) {
    ceSnap();
    d.moved = true;
  }
  if (!d.handle) {
    const b0 = ceBounds();
    const s0 = Object.values(d.start);
    const rx = Math.min(...s0.map((e) => e.x)) + dx;
    const ry = Math.min(...s0.map((e) => e.y)) + dy;
    const sn = snapRect({ x: rx, y: ry, w: b0.w, h: b0.h }, CE.sel, ev.altKey);
    dx += sn.dx;
    dy += sn.dy;
    for (const id of CE.sel) {
      const e = byId(id);
      e.x = Math.round(d.start[id].x + dx);
      e.y = Math.round(d.start[id].y + dy);
    }
    drawGuides(sn.lines);
  } else {
    const id = CE.sel[0];
    const e = byId(id);
    const s0 = d.start[id];
    let { x, y, w, h } = s0;
    const hd = d.handle;
    if (hd.includes('e')) w = s0.w + dx;
    if (hd.includes('s')) h = s0.h + dy;
    if (hd.includes('w')) { x = s0.x + dx; w = s0.w - dx; }
    if (hd.includes('n')) { y = s0.y + dy; h = s0.h - dy; }
    if (ev.shiftKey && (hd.length === 2)) { const k = s0.w / s0.h; if (w / h > k) w = h * k; else h = w / k; if (hd.includes('w')) x = s0.x + s0.w - w; if (hd.includes('n')) y = s0.y + s0.h - h; }
    if (!ev.altKey && CE.grid) {
      const sn = (v) => Math.round(v / GRID) * GRID;
      if (hd.includes('e')) w = sn(x + w) - x;
      if (hd.includes('s')) h = sn(y + h) - y;
      if (hd.includes('w')) { const nx = sn(x); w += x - nx; x = nx; }
      if (hd.includes('n')) { const ny = sn(y); h += y - ny; y = ny; }
    }
    Object.assign(e, { x: Math.round(x), y: Math.round(y), w: Math.max(8, Math.round(w)), h: Math.max(8, Math.round(h)) });
  }
  moveDom();
  cePropsGeom();
});

document.addEventListener('mouseup', () => {
  const d = CE.drag;
  CE.drag = null;
  if (!d || !d.moved) return;
  drawGuides([]);
  changed({ tree: false });
  ceStage();
});

document.addEventListener('keydown', (ev) => {
  if (S.page !== 'design' || !isMps() || CE.tab !== 'canvas' || !S.proj) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || $('#modal').innerHTML) return;
  const k = ev.key;
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl && k.toLowerCase() === 'z') { ev.preventDefault(); ceUndo(ev.shiftKey); return; }
  if (ctrl && k.toLowerCase() === 'y') { ev.preventDefault(); ceUndo(true); return; }
  if (ctrl && k.toLowerCase() === 'a') { ev.preventDefault(); CE.sel = els().map((e) => e.id); ceRender(); return; }
  if (!CE.sel.length) return;
  if (ctrl && k.toLowerCase() === 'c') { CE.clip = JSON.stringify(CE.sel.map(byId)); toast('info', 'Скопировано', `${CE.sel.length} эл.`); return; }
  if (ctrl && k.toLowerCase() === 'd') { ev.preventDefault(); ACTIONS['ce-dup'](); return; }
  if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); ev.stopPropagation(); ACTIONS['ce-del'](); return; }
  if (k === 'Escape') { CE.sel = []; ceRender(); return; }
  const step = ev.shiftKey ? 10 : 1;
  const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k];
  if (mv) {
    ev.preventDefault();
    ceSnap();
    for (const id of CE.sel) { const e = byId(id); if (!e.locked) { e.x += mv[0]; e.y += mv[1]; } }
    moveDom();
    cePropsGeom();
    clearTimeout(CE.nudge);
    CE.nudge = setTimeout(() => changed({ tree: false }), 300);
  }
}, true);

document.addEventListener('keydown', (ev) => {
  if (S.page !== 'design' || CE.tab !== 'canvas' || !CE.clip || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'v') {
    ev.preventDefault();
    ceSnap();
    const items = JSON.parse(CE.clip).filter(Boolean).map((e) => ({ ...e, id: ceNewId(), x: e.x + 16, y: e.y + 16 }));
    els().push(...items);
    CE.sel = items.map((e) => e.id);
    ceCommit();
  }
});

window.addEventListener('resize', () => { if (S.page === 'design' && CE.tab === 'canvas') ceStage(); });

function ceLayersRefresh() {
  document.querySelectorAll('.ce-layer').forEach((d) => d.classList.toggle('on', CE.sel.includes(d.dataset.id)));
  const tb = document.querySelector('.ce-toolbar');
  if (tb) {
    const fresh = document.createElement('div');
    fresh.innerHTML = pageCanvasEditor();
    const nt = fresh.querySelector('.ce-toolbar');
    if (nt) tb.replaceWith(nt);
  }
}

const ceNewId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------- панель свойств ----------

function colorField(path, label, value, allowNone = false) {
  return `<div class="field"><span>${label}</span><div class="ce-color">
    ${TOKENS.map((t) => `<button class="sw ${value === `@${t}` ? 'on' : ''}" style="background:${col(`@${t}`)}" title="${TOKEN_NAMES[t]} (из палитры)" data-act="ce-col" data-path="${path}" data-val="@${t}"></button>`).join('')}
    ${allowNone ? `<button class="sw none ${value === '#00000000' ? 'on' : ''}" title="Прозрачный" data-act="ce-col" data-path="${path}" data-val="#00000000"></button>` : ''}
    <label class="sw custom ${value && !value.startsWith('@') && value !== '#00000000' ? 'on' : ''}" title="Свой цвет" style="${value && !value.startsWith('@') && value !== '#00000000' ? `background:${col(value)}` : ''}">
      <input type="color" data-ceprop="${path}" value="${value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}">+</label></div></div>`;
}

const num = (path, label, value, step = 1) => `<label class="field ce-num"><span>${label}</span><input class="input" type="number" step="${step}" data-ceprop="${path}" data-num="1" value="${value}"></label>`;
const sel = (path, label, value, opts) => `<label class="field"><span>${label}</span><select class="select" data-ceprop="${path}">${Object.entries(opts).map(([k, v]) => `<option value="${esc(k)}" ${String(value) === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
const chk = (path, label, value) => `<label class="toggle"><input type="checkbox" data-ceprop="${path}" data-bool="1" ${value ? 'checked' : ''}><span class="track"></span><span>${label}</span></label>`;
const txt = (path, label, value, area = false, ph = '') => `<label class="field"><span>${label}</span>${area ? `<textarea class="textarea" data-ceprop="${path}" placeholder="${esc(ph)}">${esc(value)}</textarea>` : `<input class="input" data-ceprop="${path}" value="${esc(value)}" placeholder="${esc(ph)}">`}</label>`;
const FONT_OPTS = () => Object.fromEntries([['@font', `Основной (${S.proj.installer.font})`], ['@titleFont', `Заголовков (${S.proj.installer.titleFont})`], ...FONTS.map((f) => [f, f])]);
const WEIGHTS = { light: 'Тонкий', normal: 'Обычный', semibold: 'Полужирный', bold: 'Жирный' };

function imageSrcField(e) {
  const v = e.props.src;
  return `<div class="field"><span>Картинка</span><div class="segmented ce-src">
      <button class="${v === '@logo' ? 'on' : ''}" data-act="ce-src" data-val="@logo">Логотип</button>
      <button class="${v === '@banner' ? 'on' : ''}" data-act="ce-src" data-val="@banner">Баннер</button>
      <button class="${v && !v.startsWith('@') ? 'on' : ''}" data-act="ce-src-pick">${icon('image', 12)}Своя…</button></div>
    ${v && !v.startsWith('@') ? `<div class="imgbox" style="aspect-ratio:16/9;margin-top:8px"><img data-rel="${esc(v)}" alt=""></div>` : ''}</div>`;
}

function ceProps() {
  const box = $('#ce-props');
  if (!box) return;
  const L = lay();
  const sc = scr();
  if (CE.sel.length > 1) {
    box.innerHTML = `<div class="ce-ptitle">Выбрано элементов: ${CE.sel.length}</div>
      <div class="ce-align">${[['left', '⇤ Левые'], ['hcenter', '↔ Центры'], ['right', 'Правые ⇥'], ['top', '⤒ Верх'], ['vcenter', '↕ Середины'], ['bottom', 'Низ ⤓']].map(([k, l]) => `<button class="btn sm" data-act="ce-align" data-how="${k}">${l}</button>`).join('')}</div>
      <div class="note">Перетаскивайте вместе, удаляйте Delete, копируйте Ctrl+D.</div>`;
    return;
  }
  const e = selected1();
  if (!e) {
    box.innerHTML = `<div class="ce-ptitle">Экран «${esc(CE.meta.screenNames[CE.screen])}»</div>
      ${CE.screen === 'welcome' ? chk('screen.enabled', 'Показывать этот экран', sc.enabled !== false) : ''}
      ${colorField('screen.background.color', 'Цвет фона', sc.background.color)}
      <div class="field"><span>Картинка фона</span><div class="picker">${imageBox(sc.background.image, 'ce:bg', '', '16 / 9')}
        <div class="picker-side"><small class="hint-text">Если не выбрана — общий фон из вкладки «Палитра, шрифты, фон».</small>
        <div class="row-btns"><button class="btn sm" data-act="ce-bg-pick">${icon('image', 13)}Выбрать</button>${sc.background.image ? '<button class="btn sm ghost" data-act="ce-bg-clear">Убрать</button>' : ''}</div></div></div></div>
      ${ceRange('screen.background.dim', 'Затемнение фона', sc.background.dim, 0, 0.95, 0.05)}
      ${ceRange('screen.background.blur', 'Размытие фона', sc.background.blur, 0, 30, 1)}
      <div class="ce-ptitle" style="margin-top:18px">Окно установщика</div>
      <div class="ce-grid2">${num('window.width', 'Ширина', L.window.width, 10)}${num('window.height', 'Высота', L.window.height, 10)}</div>
      ${ceRange('window.radius', 'Скругление углов окна', L.window.radius, 0, 30, 1)}
      <div class="note">Выберите элемент на холсте или в «Слоях», чтобы изменить его. Новые элементы — в «Добавить» слева.</div>`;
    return;
  }
  const p = e.props;
  const t = CE.meta.types[e.type];
  let specific = '';
  if (e.type === 'text') {
    specific = `${txt('props.text', 'Текст', p.text, true, 'Можно вставлять {name}, {version}, {author}, {selected}…')}
      <div class="hint-text ce-ph">Подстановки: {name} {version} {author} {description} {modsCount} {size} {selected} {selectedSize} {game} {installedVersion} {updateVersion} {welcomeTitle} {finishTitle} {finishText}</div>
      ${sel('props.font', 'Шрифт', p.font, FONT_OPTS())}
      <div class="ce-grid2">${num('props.size', 'Размер', p.size, 1)}${sel('props.weight', 'Насыщенность', p.weight, WEIGHTS)}</div>
      ${colorField('props.color', 'Цвет текста', p.color)}
      <div class="field"><span>Выравнивание</span><div class="segmented">${[['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']].map(([k, l]) => `<button class="${p.align === k ? 'on' : ''}" data-act="ce-set" data-path="props.align" data-val="${k}">${l}</button>`).join('')}</div></div>
      <div class="field"><span>По вертикали</span><div class="segmented">${[['top', 'Сверху'], ['center', 'Центр'], ['bottom', 'Снизу']].map(([k, l]) => `<button class="${p.valign === k ? 'on' : ''}" data-act="ce-set" data-path="props.valign" data-val="${k}">${l}</button>`).join('')}</div></div>
      ${num('props.lineHeight', 'Межстрочный интервал (0 — авто)', p.lineHeight, 1)}
      <div class="ce-checks">${chk('props.italic', 'Курсив', p.italic)}${chk('props.shadow', 'Тень под текстом', p.shadow)}</div>`;
  } else if (e.type === 'image') {
    specific = `${imageSrcField(e)}
      ${sel('props.fit', 'Вписать', p.fit, { cover: 'Заполнить (обрезать края)', contain: 'Целиком', fill: 'Растянуть' })}
      ${ceRange('props.radius', 'Скругление', p.radius, 0, 200, 1)}
      ${num('props.borderWidth', 'Толщина рамки', p.borderWidth, 1)}${p.borderWidth ? colorField('props.border', 'Цвет рамки', p.border) : ''}`;
  } else if (e.type === 'shape') {
    specific = `${colorField('props.fill', 'Заливка', p.fill, true)}
      ${chk('props.grad', 'Градиент', !!p.fill2)}
      ${p.fill2 ? `${colorField('props.fill2', 'Второй цвет градиента', p.fill2, true)}${ceRange('props.angle', 'Угол градиента', p.angle, 0, 360, 15)}` : ''}
      ${ceRange('props.radius', 'Скругление', p.radius, 0, 300, 1)}
      ${num('props.borderWidth', 'Толщина рамки', p.borderWidth, 1)}${p.borderWidth ? colorField('props.border', 'Цвет рамки', p.border) : ''}
      ${chk('props.shadow', 'Тень', p.shadow)}`;
  } else if (e.type === 'button') {
    specific = `${txt('props.label', 'Надпись', p.label)}
      ${sel('props.action', 'Что делает', p.action, CE.meta.actions)}
      ${p.action === 'url' ? txt('props.url', 'Ссылка', p.url, false, 'https://…') : ''}
      ${colorField('props.fill', 'Цвет кнопки', p.fill, true)}${colorField('props.color', 'Цвет надписи', p.color)}
      <div class="ce-grid2">${num('props.size', 'Размер текста', p.size, 1)}${sel('props.weight', 'Насыщенность', p.weight, WEIGHTS)}</div>
      ${sel('props.font', 'Шрифт', p.font || '@font', FONT_OPTS())}
      ${ceRange('props.radius', 'Скругление', p.radius, 0, 40, 1)}
      ${num('props.borderWidth', 'Толщина рамки', p.borderWidth, 1)}${p.borderWidth ? colorField('props.border', 'Цвет рамки', p.border) : ''}
      ${chk('props.glow', 'Свечение', p.glow)}`;
  } else if (e.type === 'modlist') {
    specific = `<div class="field"><span>Моды показываются</span><div class="segmented">${[['grid', 'Карточками'], ['list', 'Списком']].map(([k, l]) => `<button class="${p.layout === k ? 'on' : ''}" data-act="ce-set" data-path="props.layout" data-val="${k}">${l}</button>`).join('')}</div></div>
      ${p.layout === 'grid' ? `<div class="field"><span>Размер карточек</span><div class="segmented">${[['s', 'Мелкие'], ['m', 'Средние'], ['l', 'Крупные']].map(([k, l]) => `<button class="${p.cardSize === k ? 'on' : ''}" data-act="ce-set" data-path="props.cardSize" data-val="${k}">${l}</button>`).join('')}</div></div>` : ''}
      ${sel('props.categories', 'Категории (группы)', p.categories, { tabs: 'Вкладками сверху', sidebar: 'Меню слева', none: 'Не показывать' })}
      ${chk('props.search', 'Поиск модов', p.search)}
      <div class="note">Цвета карточек — из палитры темы («Карточки», «Рамки», «Акцент»).</div>`;
  } else if (e.type === 'options') {
    specific = `<div class="ce-checks">${chk('props.game', 'Папка игры и «Изменить»', p.game)}${chk('props.clean', 'Переключатель «Убрать старые моды»', p.clean)}${chk('props.shortcut', 'Переключатель «Ярлык»', p.shortcut)}</div>`;
  } else {
    specific = `<div class="note">${esc(t.name)} — готовый блок установщика. Его вид задаётся палитрой темы, а размер и место — здесь, на холсте.</div>`;
  }
  box.innerHTML = `<div class="ce-ptitle">${icon(ADD_ICONS[e.type] || 'other', 15)}${esc(t.name)}</div>
    ${txt('name', 'Название слоя', e.name)}
    <div class="ce-grid4" id="ce-geom">${num('x', 'X', e.x)}${num('y', 'Y', e.y)}${num('w', 'Ш', e.w)}${num('h', 'В', e.h)}</div>
    ${ceRange('opacity', 'Непрозрачность', e.opacity, 0.05, 1, 0.05)}
    ${sel('showIf', 'Когда показывать', e.showIf, CE.meta.showIf)}
    <div class="ce-sep"></div>
    ${specific}
    <div class="ce-sep"></div>
    <div class="row-btns"><button class="btn sm" data-act="ce-center" data-axis="h">↔ По центру окна</button><button class="btn sm" data-act="ce-center" data-axis="v">↕ По середине</button></div>`;
  hydrate(box);
}

function ceRange(path, label, value, min, max, step) {
  return `<label class="field"><span>${label} <b class="slider-val" data-cefor="${path}">${value}</b></span><input type="range" class="range" data-ceprop="${path}" data-num="1" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function cePropsGeom() {
  const e = selected1();
  const g = $('#ce-geom');
  if (!e || !g) return;
  for (const k of ['x', 'y', 'w', 'h']) {
    const inp = g.querySelector(`[data-ceprop="${k}"]`);
    if (inp && document.activeElement !== inp) inp.value = e[k];
  }
}

// Путь свойства: screen.* — экран, window.* — окно, остальное — выбранный элемент
function ceSetPath(path, value) {
  const L = lay();
  let obj;
  let keys;
  if (path.startsWith('screen.')) { obj = scr(); keys = path.slice(7).split('.'); }
  else if (path.startsWith('window.')) { obj = L.window; keys = path.slice(7).split('.'); }
  else { obj = selected1(); keys = path.split('.'); }
  if (!obj) return;
  for (const k of keys.slice(0, -1)) obj = obj[k];
  obj[keys[keys.length - 1]] = value;
}

let ceTyping = null;
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (!t.dataset.ceprop) return;
  if (!ceTyping) ceSnap();
  clearTimeout(ceTyping);
  ceTyping = setTimeout(() => { ceTyping = null; }, 700);
  let v = t.dataset.num ? Number(t.value) : t.dataset.bool ? t.checked : t.value;
  const path = t.dataset.ceprop;
  if (path === 'props.grad') {
    const e = selected1();
    e.props.fill2 = t.checked ? '@bg' : '';
    changed({ tree: false });
    ceRender();
    return;
  }
  if (['x', 'y', 'w', 'h'].includes(path)) v = Math.round(v);
  ceSetPath(path, v);
  const lbl = document.querySelector(`[data-cefor="${path}"]`);
  if (lbl) lbl.textContent = v;
  if (path.startsWith('window.')) S.proj.installer.layout.template = 'custom';
  changed({ tree: false });
  if (path === 'name') { const l = document.querySelector(`.ce-layer[data-id="${selected1()?.id}"] span`); if (l) l.textContent = v; return; }
  ceStage();
  if (t.type === 'color' || t.tagName === 'SELECT' || t.dataset.bool) ceProps();
});

// ---------- действия ----------

Object.assign(ACTIONS, {
  'ce-tab': (el) => { CE.tab = el.dataset.tab; renderPage(); },
  'ce-screen': (el) => { CE.screen = el.dataset.screen; CE.sel = []; ceRender(); },
  'ce-pick': (el) => { CE.sel = [el.dataset.id]; ceStage(); ceProps(); ceLayersRefresh(); },
  'ce-eye': (el) => { ceSnap(); const e = byId(el.dataset.id); e.hidden = !e.hidden; ceCommit(); },
  'ce-lock': (el) => { ceSnap(); const e = byId(el.dataset.id); e.locked = !e.locked; ceCommit(); },
  'ce-grid': () => { CE.grid = !CE.grid; ceRender(); },
  'ce-undo': () => ceUndo(false),
  'ce-redo': () => ceUndo(true),
  'ce-add': (el) => {
    const type = el.dataset.type;
    const t = CE.meta.types[type];
    const L = lay();
    ceSnap();
    const e = { id: ceNewId(), type, name: t.name, x: Math.round((L.window.width - t.w) / 2 / GRID) * GRID, y: Math.round((L.window.height - t.h) / 2 / GRID) * GRID,
      w: t.w, h: t.h, opacity: 1, hidden: false, locked: false, showIf: 'always', props: JSON.parse(JSON.stringify(t.props)) };
    els().push(e);
    CE.sel = [e.id];
    ceCommit();
  },
  'ce-del': () => {
    if (!CE.sel.length) return;
    ceSnap();
    scr().elements = els().filter((e) => !CE.sel.includes(e.id));
    CE.sel = [];
    ceCommit();
  },
  'ce-dup': () => {
    if (!CE.sel.length) return;
    ceSnap();
    const copies = CE.sel.map(byId).map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: ceNewId(), x: e.x + 16, y: e.y + 16, name: `${e.name} (копия)` }));
    els().push(...copies);
    CE.sel = copies.map((e) => e.id);
    ceCommit();
  },
  'ce-z': (el) => {
    ceSnap();
    const list = els();
    for (const id of el.dataset.dir === 'up' ? [...CE.sel].reverse() : CE.sel) {
      const i = list.findIndex((e) => e.id === id);
      const j = el.dataset.dir === 'up' ? i + 1 : i - 1;
      if (j < 0 || j >= list.length) continue;
      [list[i], list[j]] = [list[j], list[i]];
    }
    ceCommit();
  },
  'ce-set': (el) => { ceSnap(); ceSetPath(el.dataset.path, el.dataset.val); changed({ tree: false }); ceStage(); ceProps(); },
  'ce-col': (el) => { ceSnap(); ceSetPath(el.dataset.path, el.dataset.val); changed({ tree: false }); ceStage(); ceProps(); },
  'ce-src': (el) => { ceSnap(); selected1().props.src = el.dataset.val; changed({ tree: false }); ceStage(); ceProps(); },
  'ce-src-pick': async () => {
    const rel = await call(api.pickImage);
    if (!rel) return;
    ceSnap();
    selected1().props.src = rel;
    changed({ tree: false });
    ceStage();
    ceProps();
  },
  'ce-bg-pick': async () => {
    const rel = await call(api.pickImage);
    if (!rel) return;
    ceSnap();
    scr().background.image = rel;
    ceCommit();
  },
  'ce-bg-clear': () => { ceSnap(); scr().background.image = null; ceCommit(); },
  'ce-center': (el) => {
    const e = selected1();
    const L = lay();
    ceSnap();
    if (el.dataset.axis === 'h') e.x = Math.round((L.window.width - e.w) / 2);
    else e.y = Math.round((L.window.height - e.h) / 2);
    changed({ tree: false });
    ceStage();
    ceProps();
  },
  'ce-align': (el) => {
    const b = ceBounds();
    const how = el.dataset.how;
    ceSnap();
    for (const id of CE.sel) {
      const e = byId(id);
      if (how === 'left') e.x = b.x;
      if (how === 'right') e.x = b.x + b.w - e.w;
      if (how === 'hcenter') e.x = Math.round(b.x + (b.w - e.w) / 2);
      if (how === 'top') e.y = b.y;
      if (how === 'bottom') e.y = b.y + b.h - e.h;
      if (how === 'vcenter') e.y = Math.round(b.y + (b.h - e.h) / 2);
    }
    changed({ tree: false });
    ceStage();
  },
  'ce-real': async () => {
    const r = modal({
      title: `Настоящее окно: «${CE.meta.screenNames[CE.screen]}»`, sub: 'Так этот экран нарисует установщик у игрока', ic: 'play', wide: true,
      body: '<div class="ip-shot" id="ce-real-shot"><div class="mock-loading">Собираю установщик и рисую экран…</div></div>',
      actions: [{ label: 'Закрыть', value: null }],
    });
    try {
      const img = await call(api.installerSnapshot, S.proj, await mpsAssets(S.proj, { previews: CE.screen === 'mods' }), CE.screen);
      const host = $('#ce-real-shot');
      if (host) host.innerHTML = `<img src="${img}" alt="">`;
    } catch (e) {
      const host = $('#ce-real-shot');
      if (host) host.innerHTML = `<div class="mock-loading">${esc(e.message)}</div>`;
    }
    await r;
  },
  'ce-templates': async () => {
    const r = await modal({
      title: 'Шаблоны раскладки', sub: 'Заменит расположение элементов на всех экранах. Палитра, шрифты и картинки сохранятся. Отменить — Ctrl+Z.', ic: 'catalog',
      body: `<div class="ce-tpls">${Object.entries(CE.meta.templates).map(([k, v]) => `<label class="ce-tpl"><input type="radio" name="tpl" value="${k}" ${k === lay().template ? 'checked' : ''}><b>${esc(v)}</b><small>${esc(TPL_HINTS[k] || '')}</small></label>`).join('')}</div>`,
      actions: [{ label: 'Отмена', value: null }, { label: 'Применить шаблон', value: 'ok', primary: true }],
    });
    if (!r?.data.tpl) return;
    ceSnap();
    S.proj.installer.layout = await call(api.layoutTemplate, r.data.tpl);
    CE.sel = [];
    ceCommit();
    toast('ok', 'Шаблон применён', 'Теперь двигайте и настраивайте элементы как угодно');
  },
});

const TPL_HINTS = {
  classic: 'Баннер и описание слева, папка игры и «Что нового» справа; карточки модов с описанием',
  hero: 'Огромный фон на весь экран, заголовок и кнопки по центру; категории меню слева',
  sidebar: 'Как классика, но категории модов — меню слева',
  compact: 'Окно поменьше, моды списком — для небольших сборок',
};
