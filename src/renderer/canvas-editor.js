// Визуальный редактор окна установщика: холст со свободным размещением элементов (как в Figma).
// Холст рисует элементы приближённо в HTML; «Проверить в настоящем окне» и «Автопроверка» показывают точный снимок установщика.
'use strict';

const CE = {
  meta: null,
  screen: 'welcome',
  sel: [],            // id выбранных элементов
  hist: [],           // снимки раскладки для отмены
  fut: [],
  clip: null,
  styleClip: null,
  grid: true,
  rulers: true,
  zoom: 'fit',        // 'fit' или число
  tab: 'canvas',      // canvas | theme
  scale: 1,
  drag: null,
  live: false,        // автопроверка в настоящем окне
  liveImg: null,
  liveTimer: null,
  liveBusy: false,
};

const lay = () => S.proj.installer.layout;
const scr = () => lay().screens[CE.screen] || lay().screens.welcome;
const els = () => scr().elements;
const byId = (id) => els().find((e) => e.id === id);
const selected1 = () => (CE.sel.length === 1 ? byId(CE.sel[0]) : null);
const GRID = 8;
const BASE_SCREENS = ['welcome', 'mods', 'progress', 'finish', 'manage'];
const screenList = () => [...BASE_SCREENS, ...Object.keys(lay().screens).filter((k) => k.startsWith('custom_'))];
const screenName = (k) => lay().screens[k]?.name || CE.meta?.screenNames[k] || k;

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
  ceLiveSchedule();
}
function ceUndo(redo = false) {
  const from = redo ? CE.fut : CE.hist;
  const to = redo ? CE.hist : CE.fut;
  if (!from.length) return;
  to.push(JSON.stringify(lay()));
  S.proj.installer.layout = JSON.parse(from.pop());
  if (!lay().screens[CE.screen]) CE.screen = 'welcome';
  CE.sel = CE.sel.filter((id) => byId(id));
  ceCommit();
}

// ---------- цвета и подстановки ----------

const TOKENS = ['bg', 'surface', 'card', 'border', 'text', 'muted', 'accent', 'accentText', 'danger', 'success'];
const TOKEN_NAMES = { bg: 'Фон', surface: 'Панели', card: 'Карточки', border: 'Рамки', text: 'Текст', muted: 'Второстеп.', accent: 'Акцент', accentText: 'На акценте', danger: 'Опасность', success: 'Успех' };
let paletteOverride = null; // для миниатюр галереи

function col(v, def = '@text') {
  const s = v || def;
  if (s.startsWith('@')) return (paletteOverride || S.proj.installer.colors)[s.slice(1)] || '#ff00ff';
  if (/^#[0-9a-f]{8}$/i.test(s)) {
    const n = parseInt(s.slice(1), 16);
    return `rgba(${(n >>> 16) & 255},${(n >>> 8) & 255},${n & 255},${((n >>> 24) & 255) / 255})`;
  }
  return s;
}
const fontOf = (f) => (!f || f === '@font' ? S.proj.installer.font : f === '@titleFont' ? S.proj.installer.titleFont : f);
const alpha = (hex, k) => {
  const c = col(hex);
  if (!c.startsWith('#')) return c;
  const n = parseInt(c.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${k})`;
};

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

function imgSrc(src) {
  if (!src) return null;
  const rel = src === '@logo' ? S.proj.design.icon : src === '@banner' ? S.proj.design.bannerImage : src;
  if (!rel) return src === '@logo' ? 'logo-default' : null;
  return rel;
}

const SOCIAL_SVG = {
  telegram: 'M3 11 20 4 17 20 11 15 9 19 8 13ZM8 13 17 7', youtube: 'M4 7q0-2 2-2h12q2 0 2 2v10q0 2-2 2H6q-2 0-2-2ZM10 9l5 3-5 3Z',
  site: 'M12 3a9 9 0 1 0 .01 0ZM3 12h18M12 3q-5 9 0 18q5-9 0-18', discord: 'M7 7q5-2 10 0q3 5 2 10q-2 1.5-4 2l-1-2q-2 .6-4 0l-1 2q-2-.5-4-2q-1-5 2-10Z',
  twitch: 'M5 4h15v10l-5 5h-4l-3 3v-3H5ZM11 8v4M15 8v4', vk: 'M4 8q2 8 8 8v-4q3 0 4 3h3q-2-4-4-4.5q2-1.5 3-3.5h-3q-1 3-3 3.5V7H9v6q-2-1-2-5Z', boosty: 'M9 4 6 13h5l-2 7 9-10h-5l3-6Z',
};

function elHtml(e) {
  const p = e.props;
  const r = (v) => `${Math.max(0, v || 0)}px`;
  switch (e.type) {
    case 'text': {
      const jc = p.valign === 'center' ? 'center' : p.valign === 'bottom' ? 'flex-end' : 'flex-start';
      const grad = p.fill2 ? `background:linear-gradient(${(p.angle || 0) + 90}deg, ${col(p.color)}, ${col(p.fill2)});-webkit-background-clip:text;color:transparent;` : `color:${col(p.color)};`;
      const t = sampleFill(p.upper ? String(p.text).toUpperCase() : p.text);
      return `<div class="ce-text" style="justify-content:${jc};text-align:${p.align};font:${p.italic ? 'italic ' : ''}${p.weight === 'bold' ? 700 : p.weight === 'semibold' ? 600 : p.weight === 'light' ? 300 : 400} ${p.size}px '${fontOf(p.font)}', 'Segoe UI';${p.lineHeight ? `line-height:${p.lineHeight}px;` : ''}${p.shadow ? 'filter:drop-shadow(0 1px 6px rgba(0,0,0,.85));' : ''}"><span style="${grad}">${esc(t)}</span></div>`;
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
      return `<div class="ce-box" style="background:${bg};border-radius:${r(p.radius)};border:${p.borderWidth || 0}px solid ${col(p.border, '@border')};${p.shadow ? 'box-shadow:0 6px 24px rgba(0,0,0,.5);' : ''}${p.frosted ? `backdrop-filter:blur(${p.frosted}px);` : ''}"></div>`;
    }
    case 'button': {
      const fill = col(p.fill, '@accent');
      return `<div class="ce-btn" style="background:${fill};color:${col(p.color, '@accentText')};border-radius:${r(p.radius)};border:${p.borderWidth || 0}px solid ${col(p.border, '@accent')};font:${p.weight === 'bold' ? 700 : p.weight === 'semibold' ? 600 : 400} ${p.size}px '${fontOf(p.font)}', 'Segoe UI';${p.glow && !/,0\)$/.test(fill) ? `box-shadow:0 0 18px ${alpha(p.fill || '@accent', 0.35)};` : ''}">${esc(sampleFill(p.label))}</div>`;
    }
    case 'video':
      return p.src ? `<video class="ce-video" data-ce-video="${esc(p.src)}" muted loop autoplay style="object-fit:${p.fit === 'contain' ? 'contain' : p.fit === 'fill' ? 'fill' : 'cover'};border-radius:${r(p.radius)}"></video>`
        : `<div class="ce-img empty" style="border-radius:${r(p.radius)}">${icon('play', 22)}<span>Видео не выбрано</span></div>`;
    case 'slider': {
      const first = (p.images || [])[0];
      const n = (p.images || []).length;
      return first ? `<div class="ce-img" data-ce-img="${esc(first)}" style="border-radius:${r(p.radius)};background-size:${p.fit === 'contain' ? 'contain' : 'cover'}">
          ${p.arrows && n > 1 ? '<i class="ce-arrow l">‹</i><i class="ce-arrow r">›</i>' : ''}
          ${p.dots && n > 1 ? `<div class="ce-dots">${Array.from({ length: n }, (_, i) => `<i style="${i === 0 ? `background:${col('@accent')}` : ''}"></i>`).join('')}</div>` : ''}</div>`
        : `<div class="ce-img empty" style="border-radius:${r(p.radius)}">${icon('image', 22)}<span>Добавьте картинки в свойствах</span></div>`;
    }
    case 'social':
      return `<div class="ce-social" style="gap:${p.gap}px">${(p.links || []).map((l) => `<i style="width:${p.size}px;height:${p.size}px;border-radius:${p.round ? '50%' : `${p.size / 5}px`};background:${col(p.fill, '@card')};border:1px solid ${col('@border')}">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${col(p.color)}" stroke-width="1.6" stroke-linejoin="round"><path d="${SOCIAL_SVG[l.kind] || SOCIAL_SVG.site}"/></svg></i>`).join('')}</div>`;
    case 'stat':
      return `<div class="ce-stat" style="text-align:${p.align}"><b style="font-size:${p.valueSize}px;color:${col(p.color, '@accent')};font-family:'${fontOf('@titleFont')}'">${esc(sampleFill(p.value))}</b><small style="color:${col(p.labelColor, '@muted')}">${esc(p.label)}</small></div>`;
    case 'license':
      return `<div class="ce-panel ce-pad ce-license"><p>${esc(p.text)}</p><span><i class="ind"></i>${esc(p.label)}</span></div>`;
    case 'presets': {
      const names = ['Рекомендуемый', ...(S.proj.presets || []).map((x) => x.name)];
      return `<div class="ce-presets"><small>${esc(p.title)}</small>${names.map((n, i) => `<span style="${i === 0 ? `background:${col('@accent')};color:${col('@accentText')};border-color:${col('@accent')}` : ''}">${esc(n)}</span>`).join('')}${S.proj.presets?.length ? '' : '<em>создайте наборы в свойствах</em>'}</div>`;
    }
    case 'musicbtn':
      return `<div class="ce-btn" style="background:${col(p.fill, '@card')};color:${col(p.color)};border-radius:${r(p.radius)}">${S.proj.installer.media.music ? '♫' : '♪'}</div>`;
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
  const tabs = p.categories === 'tabs' ? `<div class="ce-tabs">${cats.map((c, i) => `<span style="${i === 0 ? `background:${col('@accent')};color:${col('@accentText')}` : ''}">${esc(c)}</span>`).join('')}</div>` : '<div style="flex:1"></div>';
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

const ADD_ICONS = {
  text: 'edit', image: 'image', shape: 'square', button: 'play', video: 'play', slider: 'squares', social: 'share', stat: 'damage', license: 'file',
  presets: 'profiles', musicbtn: 'sound', modlist: 'catalog', moddetail: 'file', gamecard: 'target', options: 'settings', progress: 'refresh', changelog: 'info', wincontrols: 'x',
};
const ADD_GROUPS = [['Основа', ['text', 'image', 'shape', 'button']], ['Медиа', ['video', 'slider', 'musicbtn', 'social']], ['Блоки', ['stat', 'presets', 'license', 'changelog']],
  ['Установщик', ['modlist', 'moddetail', 'gamecard', 'options', 'progress', 'wincontrols']]];

function pageCanvasEditor() {
  const L = lay();
  const tabs = `<div class="ce-topbar"><div class="seg-tabs ce-tabsbar"><button class="${CE.tab === 'canvas' ? 'on' : ''}" data-act="ce-tab" data-tab="canvas">${icon('edit', 14)}Холст</button><button class="${CE.tab === 'theme' ? 'on' : ''}" data-act="ce-tab" data-tab="theme">${icon('image', 14)}Палитра, шрифты, фон</button></div>
    <span class="grow"></span>
    <button class="btn sm" data-act="ce-gallery">${icon('sparkle', 13)}Галерея дизайнов</button>
    <button class="btn sm" data-act="ce-import">${icon('upload', 13)}Импорт</button>
    <button class="btn sm" data-act="ce-export">${icon('import', 13)}Экспорт дизайна</button></div>`;
  if (CE.tab === 'theme') return tabs + pageInstallerDesign();
  if (!CE.meta) return `${tabs}<div class="empty"><span class="spinner big-spin"></span><p>Загружаю редактор…</p></div>`;
  return `${tabs}
    <div class="ce" id="ce">
      <aside class="ce-left">
        <div class="ce-sect">Экраны</div>
        ${screenList().map((k) => `<button class="ce-scr ${CE.screen === k ? 'on' : ''}" data-act="ce-screen" data-screen="${k}">${k.startsWith('custom_') ? icon('file', 12) : ''}${esc(screenName(k))}
          ${L.screens[k].enabled === false ? '<span class="badge">выкл</span>' : ''}<span class="n">${L.screens[k].elements.length}</span></button>`).join('')}
        <div class="row-btns" style="margin-top:6px"><button class="btn sm" data-act="ce-add-screen">${icon('plus', 12)}Экран</button><button class="btn sm" data-act="ce-templates">${icon('catalog', 12)}Шаблоны</button></div>
        <div class="ce-sect">Добавить</div>
        ${ADD_GROUPS.map(([g, list]) => `<div class="ce-addgrp">${g}</div><div class="ce-add">${list.map((k) => `<button data-act="ce-add" data-type="${k}" title="${esc(CE.meta.types[k].name)}">${icon(ADD_ICONS[k] || 'plus', 14)}<span>${esc(CE.meta.types[k].name)}</span></button>`).join('')}</div>`).join('')}
        <div class="ce-sect">Слои <small>сверху — выше</small></div>
        <div class="ce-layers">${[...els()].reverse().map((e) => `<div class="ce-layer ${CE.sel.includes(e.id) ? 'on' : ''} ${e.hidden ? 'hid' : ''}" data-act="ce-pick" data-id="${e.id}">
          ${e.group ? '<b class="grp" title="В группе">▣</b>' : ''}${icon(ADD_ICONS[e.type] || 'other', 13)}<span>${esc(e.name)}</span>${e.showIf !== 'always' ? `<i title="${esc(CE.meta.showIf[e.showIf])}">?</i>` : ''}${e.anim?.in !== 'none' || e.anim?.loop !== 'none' ? '<i class="an" title="Анимация">✦</i>' : ''}
          <button data-act="ce-eye" data-id="${e.id}" title="${e.hidden ? 'Показать' : 'Скрыть'}">${e.hidden ? '◌' : '●'}</button>
          <button data-act="ce-lock" data-id="${e.id}" title="${e.locked ? 'Разблокировать' : 'Заблокировать'}">${e.locked ? '🔒' : '·'}</button></div>`).join('')}</div>
      </aside>
      <section class="ce-center">
        ${ceToolbar()}
        <div class="ce-stage-wrap ${CE.rulers ? 'rulers' : ''}" id="ce-wrap"><canvas class="ce-ruler h" id="ce-rh"></canvas><canvas class="ce-ruler v" id="ce-rv"></canvas><div class="ce-stage-scroll" id="ce-scroll"><div class="ce-stage-box" id="ce-box"><div class="ce-stage" id="ce-stage"></div></div></div></div>
        <div class="hint-text ce-hint">Мышь — двигать, маркеры — размер, Shift — несколько и пропорции, Alt — без привязки, Ctrl+колесо — масштаб, Ctrl+G — группа, Ctrl+Alt+C / V — стиль.</div>
        ${CE.live ? `<div class="ce-live"><div class="ce-live-head">${icon('play', 12)}Настоящее окно ${CE.liveBusy ? '<span class="spinner"></span>' : ''}</div>${CE.liveImg ? `<img src="${CE.liveImg}" alt="">` : '<div class="mock-loading">Рисую…</div>'}</div>` : ''}
      </section>
      <aside class="ce-right" id="ce-props"></aside>
    </div>`;
}

function ceToolbar() {
  const L = lay();
  const n = CE.sel.length;
  const z = CE.zoom === 'fit' ? 'По размеру' : `${Math.round(CE.zoom * 100)}%`;
  return `<div class="ce-toolbar">
    <button class="btn sm icon-only" data-act="ce-undo" title="Отменить (Ctrl+Z)" ${CE.hist.length ? '' : 'disabled'}>↶</button>
    <button class="btn sm icon-only" data-act="ce-redo" title="Повторить (Ctrl+Y)" ${CE.fut.length ? '' : 'disabled'}>↷</button>
    <span class="sep"></span>
    <button class="btn sm icon-only" data-act="ce-zoom" data-z="out" title="Уменьшить">−</button>
    <button class="btn sm ce-zoomval" data-act="ce-zoom" data-z="fit" title="Вписать">${z}</button>
    <button class="btn sm icon-only" data-act="ce-zoom" data-z="in" title="Увеличить">+</button>
    <button class="btn sm ${CE.grid ? 'on' : ''}" data-act="ce-grid" title="Сетка и привязка">${icon('catalog', 13)}</button>
    <button class="btn sm ${CE.rulers ? 'on' : ''}" data-act="ce-rulers" title="Линейки">📏</button>
    ${n ? `<span class="sep"></span><button class="btn sm" data-act="ce-dup" title="Копия (Ctrl+D)">${icon('squares', 13)}</button>
      <button class="btn sm" data-act="ce-z" data-dir="up" title="Слой выше">${icon('arrow', 13, 'up')}</button>
      <button class="btn sm" data-act="ce-z" data-dir="down" title="Слой ниже">${icon('arrow', 13, 'down')}</button>
      ${n > 1 ? `<button class="btn sm" data-act="ce-group" title="Сгруппировать (Ctrl+G)">▣</button>` : ''}
      ${CE.sel.some((id) => byId(id)?.group) ? `<button class="btn sm" data-act="ce-ungroup" title="Разгруппировать (Ctrl+Shift+G)">▢</button>` : ''}
      <button class="btn sm" data-act="ce-style-copy" title="Копировать стиль (Ctrl+Alt+C)">🖌</button>
      ${CE.styleClip ? `<button class="btn sm" data-act="ce-style-paste" title="Вставить стиль (Ctrl+Alt+V)">🖌+</button>` : ''}
      <button class="btn sm danger" data-act="ce-del" title="Удалить (Delete)">${icon('trash', 13)}</button>` : ''}
    <span class="grow"></span>
    <span class="hint-text">${L.window.width}×${L.window.height}</span>
    <button class="btn sm ${CE.live ? 'on' : ''}" data-act="ce-live" title="Показывать настоящее окно рядом и обновлять после каждого изменения">${icon('refresh', 13)}Автопроверка</button>
    <button class="btn sm" data-act="ce-real">${icon('play', 13)}Проверить</button>
    <button class="btn sm primary" data-act="ip-open">${icon('external', 13)}Открыть</button>
  </div>`;
}

function ceRender() {
  if (S.page !== 'design' || !isMps() || CE.tab !== 'canvas') {
    if (S.page === 'design') renderPage();
    return;
  }
  const page = $('#page');
  const st = page.scrollTop;
  const sc = $('#ce-scroll');
  const sx = sc?.scrollLeft;
  const sy = sc?.scrollTop;
  page.innerHTML = pageCanvasEditor();
  page.scrollTop = st;
  ceStage();
  ceProps();
  const nsc = $('#ce-scroll');
  if (nsc && sx !== undefined) { nsc.scrollLeft = sx; nsc.scrollTop = sy; }
}

function ceStage() {
  const stage = $('#ce-stage');
  const scroll = $('#ce-scroll');
  if (!stage) return;
  const L = lay();
  const sc = scr();
  const fit = Math.min(1, (scroll.clientWidth - 8) / L.window.width);
  CE.scale = CE.zoom === 'fit' ? fit : CE.zoom;
  const box = $('#ce-box');
  box.style.width = `${L.window.width * CE.scale}px`;
  box.style.height = `${L.window.height * CE.scale}px`;
  scroll.style.height = `${Math.min(L.window.height * CE.scale + 8, Math.max(380, window.innerHeight - 260))}px`;
  stage.style.width = `${L.window.width}px`;
  stage.style.height = `${L.window.height}px`;
  stage.style.transform = `scale(${CE.scale})`;
  stage.style.borderRadius = `${L.window.radius}px`;
  stage.style.background = col(sc.background.color, '@bg');
  stage.style.fontFamily = `'${S.proj.installer.font}', 'Segoe UI'`;
  stage.style.color = col('@text');
  const pi = S.proj.installer;
  const so = pi.surfaceOpacity ?? 0.9;
  stage.style.setProperty('--ce-surface', alpha('@surface', so));
  stage.style.setProperty('--ce-card', alpha('@card', so));
  stage.style.setProperty('--ce-border', col('@border'));
  stage.style.setProperty('--ce-muted', col('@muted'));
  stage.style.setProperty('--ce-radius', `${pi.radius}px`);
  stage.innerHTML = stageInner(sc, true);
  stage.querySelectorAll('[data-ce-img]').forEach(async (d) => {
    const u = await getImg(d.dataset.ceImg);
    if (u) d.style.backgroundImage = `url("${u}")`;
  });
  stage.querySelectorAll('[data-ce-video]').forEach(async (v) => {
    const r = await api.mediaUrl(v.dataset.ceVideo);
    if (r.ok) v.src = r.data;
  });
  hydrate(stage);
  drawRulers();
}

// Содержимое холста; edit=false — для миниатюр галереи
function stageInner(sc, edit) {
  const bgRel = sc.background.image || S.proj.installer.backgroundImage;
  const bgVideo = sc.background.video;
  const elements = sc.elements.map((e) => {
    const tr = e.rotate ? `transform:rotate(${e.rotate}deg);` : '';
    return `<div class="ce-el ${edit && CE.sel.includes(e.id) ? 'sel' : ''} ${e.hidden ? 'hid' : ''} ${e.locked ? 'locked' : ''}" ${edit ? `data-ce-el="${e.id}"` : ''}
      style="left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;opacity:${e.hidden ? (edit ? 0.15 : 0) : e.opacity};${tr}">${elHtml(e)}
      ${edit && e.showIf !== 'always' ? `<span class="ce-cond">${esc(CE.meta.showIf[e.showIf])}</span>` : ''}</div>`;
  }).join('');
  return `${bgVideo ? `<video class="ce-bg ce-video" data-ce-video="${esc(bgVideo)}" muted loop autoplay style="filter:blur(${sc.background.blur}px)"></video><div class="ce-dim" style="background:${col(sc.background.color, '@bg')};opacity:${sc.background.dim}"></div>`
    : bgRel ? `<div class="ce-bg" data-ce-img="${esc(bgRel)}" style="filter:blur(${sc.background.blur}px)"></div><div class="ce-dim" style="background:${col(sc.background.color, '@bg')};opacity:${sc.background.dim}"></div>` : ''}
    ${edit && CE.grid ? '<div class="ce-gridbg"></div>' : ''}${elements}
    ${edit ? `<div class="ce-guides" id="ce-guides"></div>${ceHandles()}` : ''}`;
}

function drawRulers() {
  for (const id of ['ce-rh', 'ce-rv']) {
    const c = $(`#${id}`);
    if (!c) continue;
    if (!CE.rulers) { c.width = 0; continue; }
    const scroll = $('#ce-scroll');
    const horiz = id === 'ce-rh';
    const len = horiz ? scroll.clientWidth : scroll.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    // вертикальная линейка рисуется в горизонтальной системе координат и поворачивается на холсте
    c.width = (horiz ? len : 18) * dpr;
    c.height = (horiz ? 18 : len) * dpr;
    c.style.width = `${horiz ? len : 18}px`;
    c.style.height = `${horiz ? 18 : len}px`;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    if (!horiz) {
      ctx.translate(18, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.fillStyle = '#16181c';
    ctx.fillRect(0, 0, len, 18);
    ctx.fillStyle = '#7d786f';
    ctx.strokeStyle = '#4a4d55';
    ctx.font = '9px Segoe UI';
    const off = horiz ? scroll.scrollLeft : scroll.scrollTop;
    const step = CE.scale > 0.75 ? 50 : 100;
    const b = ceBounds();
    if (b) {
      ctx.fillStyle = 'rgba(76,155,255,.35)';
      const a0 = (horiz ? b.x : b.y) * CE.scale - off;
      ctx.fillRect(a0, 0, (horiz ? b.w : b.h) * CE.scale, 18);
      ctx.fillStyle = '#7d786f';
    }
    for (let v = 0; v <= (horiz ? lay().window.width : lay().window.height); v += step / 5) {
      const x = Math.round(v * CE.scale - off) + 0.5;
      if (x < 0 || x > len) continue;
      const major = v % step === 0;
      ctx.beginPath();
      ctx.moveTo(x, major ? 4 : 12);
      ctx.lineTo(x, 18);
      ctx.stroke();
      if (major) {
        ctx.fillText(String(v), x + 2, 10);
      }
    }
  }
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
  const one = CE.sel.length === 1 && !byId(CE.sel[0])?.rotate;
  return `<div class="ce-selbox" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border-width:${1.5 * k}px">
    ${one ? hs.map((h) => `<i class="ce-h ${h}" data-handle="${h}" style="width:${10 * k}px;height:${10 * k}px;margin:${-5 * k}px"></i>`).join('') : ''}
    <span class="ce-size" style="transform:scale(${k});transform-origin:left bottom">${Math.round(b.x)}, ${Math.round(b.y)} · ${Math.round(b.w)}×${Math.round(b.h)}</span></div>`;
}

// ---------- мышь: выбор, перемещение, изменение размера ----------

function stagePoint(ev) {
  const r = $('#ce-stage').getBoundingClientRect();
  return { x: (ev.clientX - r.left) / CE.scale, y: (ev.clientY - r.top) / CE.scale };
}

// Привязка к сетке, краям и центрам других элементов и окна
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
  drawRulers();
}

// Щелчок по элементу группы выбирает всю группу; с Ctrl — только сам элемент
const withGroup = (id, single) => {
  const g = byId(id)?.group;
  return !g || single ? [id] : els().filter((e) => e.group === g).map((e) => e.id);
};

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
      ceRefreshSel();
      return;
    }
    const ids = withGroup(id, ev.ctrlKey);
    if (ev.shiftKey) CE.sel = CE.sel.includes(id) ? CE.sel.filter((x) => !ids.includes(x)) : [...new Set([...CE.sel, ...ids])];
    else if (!CE.sel.includes(id)) CE.sel = ids;
    ceRefreshSel();
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
      if (e.locked) continue;
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
    if (ev.shiftKey && hd.length === 2) {
      const k = s0.w / s0.h;
      if (w / h > k) w = h * k; else h = w / k;
      if (hd.includes('w')) x = s0.x + s0.w - w;
      if (hd.includes('n')) y = s0.y + s0.h - h;
    }
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
  ceLiveSchedule();
});

// Масштаб колесом с Ctrl
document.addEventListener('wheel', (ev) => {
  if (!ev.ctrlKey || !ev.target.closest?.('#ce-wrap')) return;
  ev.preventDefault();
  const cur = CE.scale;
  CE.zoom = Math.max(0.25, Math.min(2, +(cur * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)).toFixed(2)));
  ceStage();
  const zv = document.querySelector('.ce-zoomval');
  if (zv) zv.textContent = `${Math.round(CE.zoom * 100)}%`;
}, { passive: false });
document.addEventListener('scroll', (ev) => { if (ev.target.id === 'ce-scroll') drawRulers(); }, true);

document.addEventListener('keydown', (ev) => {
  if (S.page !== 'design' || !isMps() || CE.tab !== 'canvas' || !S.proj) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || $('#modal').innerHTML) return;
  const k = ev.key;
  const kl = k.toLowerCase();
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl && kl === 'z') { ev.preventDefault(); ceUndo(ev.shiftKey); return; }
  if (ctrl && kl === 'y') { ev.preventDefault(); ceUndo(true); return; }
  if (ctrl && kl === 'a') { ev.preventDefault(); CE.sel = els().map((e) => e.id); ceRender(); return; }
  if (ctrl && kl === 'v' && !ev.altKey && CE.clip) {
    ev.preventDefault();
    ceSnap();
    const items = JSON.parse(CE.clip).filter(Boolean).map((e) => ({ ...e, id: ceNewId(), x: e.x + 16, y: e.y + 16, group: null }));
    els().push(...items);
    CE.sel = items.map((e) => e.id);
    ceCommit();
    return;
  }
  if (ctrl && ev.altKey && kl === 'v') { ev.preventDefault(); ACTIONS['ce-style-paste'](); return; }
  if (!CE.sel.length) return;
  if (ctrl && ev.altKey && kl === 'c') { ev.preventDefault(); ACTIONS['ce-style-copy'](); return; }
  if (ctrl && kl === 'c') { CE.clip = JSON.stringify(CE.sel.map(byId)); toast('info', 'Скопировано', `${CE.sel.length} эл.`); return; }
  if (ctrl && kl === 'd') { ev.preventDefault(); ACTIONS['ce-dup'](); return; }
  if (ctrl && kl === 'g') { ev.preventDefault(); ACTIONS[ev.shiftKey ? 'ce-ungroup' : 'ce-group'](); return; }
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
    CE.nudge = setTimeout(() => { changed({ tree: false }); ceLiveSchedule(); }, 300);
  }
}, true);

window.addEventListener('resize', () => { if (S.page === 'design' && CE.tab === 'canvas') ceStage(); });

// После смены выбора перерисовываются холст, свойства, слои и панель инструментов
function ceRefreshSel() {
  ceStage();
  ceProps();
  document.querySelectorAll('.ce-layer').forEach((d) => d.classList.toggle('on', CE.sel.includes(d.dataset.id)));
  const tb = document.querySelector('.ce-toolbar');
  if (tb) {
    const t = document.createElement('div');
    t.innerHTML = ceToolbar();
    tb.replaceWith(t.firstElementChild);
  }
}

const ceNewId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------- автопроверка в настоящем окне ----------

function ceLiveSchedule() {
  if (!CE.live) return;
  clearTimeout(CE.liveTimer);
  CE.liveTimer = setTimeout(() => quiet(ceLiveRun()), 1400);
}
async function ceLiveRun() {
  if (!CE.live || CE.liveBusy) return;
  CE.liveBusy = true;
  ceLivePaint();
  try {
    CE.liveImg = await call(api.installerSnapshot, S.proj, await mpsAssets(S.proj, { previews: CE.screen === 'mods' }), CE.screen.startsWith('custom_') ? CE.screen : CE.screen);
  } catch { /* ошибка уже показана */ } finally {
    CE.liveBusy = false;
    ceLivePaint();
  }
}
function ceLivePaint() {
  const box = document.querySelector('.ce-live');
  if (!box) return;
  box.innerHTML = `<div class="ce-live-head">${icon('play', 12)}Настоящее окно ${CE.liveBusy ? '<span class="spinner"></span>' : ''}</div>${CE.liveImg ? `<img src="${CE.liveImg}" alt="">` : '<div class="mock-loading">Рисую…</div>'}`;
}

// ---------- панель свойств ----------

function colorField(path, label, value, allowNone = false) {
  const custom = value && !value.startsWith('@') && value !== '#00000000';
  return `<div class="field"><span>${label}</span><div class="ce-color">
    ${TOKENS.map((t) => `<button class="sw ${value === `@${t}` ? 'on' : ''}" style="background:${col(`@${t}`)}" title="${TOKEN_NAMES[t]} (из палитры)" data-act="ce-col" data-path="${path}" data-val="@${t}"></button>`).join('')}
    ${allowNone ? `<button class="sw none ${value === '#00000000' ? 'on' : ''}" title="Прозрачный" data-act="ce-col" data-path="${path}" data-val="#00000000"></button>` : ''}
    <label class="sw custom ${custom ? 'on' : ''}" title="Свой цвет" style="${custom ? `background:${col(value)}` : ''}">
      <input type="color" data-ceprop="${path}" value="${value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}">+</label></div></div>`;
}

const num = (path, label, value, step = 1) => `<label class="field ce-num"><span>${label}</span><input class="input" type="number" step="${step}" data-ceprop="${path}" data-num="1" value="${value}"></label>`;
const sel = (path, label, value, opts) => `<label class="field"><span>${label}</span><select class="select" data-ceprop="${path}">${Object.entries(opts).map(([k, v]) => `<option value="${esc(k)}" ${String(value) === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
const chk = (path, label, value) => `<label class="toggle"><input type="checkbox" data-ceprop="${path}" data-bool="1" ${value ? 'checked' : ''}><span class="track"></span><span>${label}</span></label>`;
const txt = (path, label, value, area = false, ph = '') => `<label class="field"><span>${label}</span>${area ? `<textarea class="textarea" data-ceprop="${path}" placeholder="${esc(ph)}">${esc(value)}</textarea>` : `<input class="input" data-ceprop="${path}" value="${esc(value)}" placeholder="${esc(ph)}">`}</label>`;
const segBtns = (path, label, value, opts) => `<div class="field"><span>${label}</span><div class="segmented">${opts.map(([k, l]) => `<button class="${String(value) === String(k) ? 'on' : ''}" data-act="ce-set" data-path="${path}" data-val="${k}">${l}</button>`).join('')}</div></div>`;
const FONT_OPTS = () => Object.fromEntries([['@font', `Основной (${S.proj.installer.font})`], ['@titleFont', `Заголовков (${S.proj.installer.titleFont})`], ...FONTS.map((f) => [f, f])]);
const WEIGHTS = { light: 'Тонкий', normal: 'Обычный', semibold: 'Полужирный', bold: 'Жирный' };
const actionOpts = () => ({
  ...CE.meta.actions,
  ...Object.fromEntries(screenList().filter((k) => k.startsWith('custom_')).map((k) => [`go:${k}`, `Экран «${screenName(k)}»`])),
  'go:progress': 'Экран установки (показать)', 'go:finish': 'Экран «Готово» (показать)',
});

function imageSrcField(e) {
  const v = e.props.src;
  return `<div class="field"><span>Картинка</span><div class="segmented ce-src">
      <button class="${v === '@logo' ? 'on' : ''}" data-act="ce-src" data-val="@logo">Логотип</button>
      <button class="${v === '@banner' ? 'on' : ''}" data-act="ce-src" data-val="@banner">Баннер</button>
      <button class="${v && !v.startsWith('@') ? 'on' : ''}" data-act="ce-src-pick">${icon('image', 12)}Своя…</button></div>
    ${v && !v.startsWith('@') ? `<div class="imgbox" style="aspect-ratio:16/9;margin-top:8px"><img data-rel="${esc(v)}" alt=""></div>` : ''}</div>`;
}

function mediaField(label, rel, act, kind) {
  return `<div class="field"><span>${label}</span><div class="ce-media">${rel ? `${icon(kind === 'video' ? 'play' : 'sound', 14)}<code>${esc(rel.split('/').pop())}</code>` : '<em>не выбрано</em>'}
    <span class="grow"></span><button class="btn sm" data-act="${act}" data-kind="${kind}">${rel ? 'Заменить' : 'Выбрать'}</button>${rel ? `<button class="btn sm ghost" data-act="${act}" data-kind="${kind}" data-clear="1">✕</button>` : ''}</div></div>`;
}

function effectsSection(e) {
  const a = e.anim || {};
  const h = e.hover || {};
  return `<details class="ce-fx" ${a.in !== 'none' || a.loop !== 'none' || h.scale !== 1 || h.glow || h.lift || e.rotate ? 'open' : ''}><summary>${icon('sparkle', 13)}Анимация и эффекты</summary>
    ${sel('anim.in', 'Появление', a.in, CE.meta.animIn)}
    ${a.in !== 'none' ? `<div class="ce-grid2">${num('anim.delay', 'Задержка, мс', a.delay, 50)}${num('anim.duration', 'Длительность, мс', a.duration, 50)}</div>` : ''}
    ${sel('anim.loop', 'Постоянный эффект', a.loop, CE.meta.animLoop)}
    ${ceRange('hover.scale', 'Увеличение при наведении', h.scale, 1, 1.3, 0.01)}
    ${ceRange('hover.lift', 'Подъём при наведении, px', h.lift, 0, 12, 1)}
    ${chk('hover.glow', 'Свечение при наведении', h.glow)}
    ${ceRange('rotate', 'Поворот, °', e.rotate || 0, -180, 180, 1)}
    <div class="note">Анимации видны в настоящем окне («Открыть»). На холсте и в снимках показан итоговый вид.</div>
  </details>`;
}

function ceProps() {
  const box = $('#ce-props');
  if (!box) return;
  const L = lay();
  const sc = scr();
  if (CE.sel.length > 1) {
    box.innerHTML = `<div class="ce-ptitle">Выбрано элементов: ${CE.sel.length}</div>
      <div class="field"><span>Выровнять</span><div class="ce-align">${[['left', '⇤ Левые'], ['hcenter', '↔ Центры'], ['right', 'Правые ⇥'], ['top', '⤒ Верх'], ['vcenter', '↕ Середины'], ['bottom', 'Низ ⤓']].map(([k, l]) => `<button class="btn sm" data-act="ce-align" data-how="${k}">${l}</button>`).join('')}</div></div>
      ${CE.sel.length > 2 ? `<div class="field"><span>Распределить с равным шагом</span><div class="ce-align" style="grid-template-columns:1fr 1fr"><button class="btn sm" data-act="ce-distribute" data-axis="x">↔ По горизонтали</button><button class="btn sm" data-act="ce-distribute" data-axis="y">↕ По вертикали</button></div></div>` : ''}
      <div class="row-btns"><button class="btn sm" data-act="ce-group">▣ Сгруппировать</button>${CE.sel.some((id) => byId(id)?.group) ? '<button class="btn sm" data-act="ce-ungroup">▢ Разгруппировать</button>' : ''}</div>
      <div class="note" style="margin-top:12px">Группа выбирается целиком одним щелчком; Ctrl+щелчок — отдельный элемент внутри.</div>`;
    return;
  }
  const e = selected1();
  if (!e) {
    const custom = CE.screen.startsWith('custom_');
    const m = S.proj.installer.media;
    box.innerHTML = `<div class="ce-ptitle">Экран «${esc(screenName(CE.screen))}»</div>
      ${custom ? `${txt('screen.name', 'Название экрана', sc.name)}<div class="note" style="margin:-4px 0 12px">Переход сюда — кнопка с действием «Экран «${esc(sc.name)}»».</div>
        <button class="btn sm danger" data-act="ce-del-screen" style="margin-bottom:14px">${icon('trash', 12)}Удалить экран</button>` : ''}
      ${CE.screen === 'welcome' ? chk('screen.enabled', 'Показывать этот экран', sc.enabled !== false) : ''}
      ${colorField('screen.background.color', 'Цвет фона', sc.background.color)}
      <div class="field"><span>Картинка фона</span><div class="picker">${imageBox(sc.background.image, 'ce:bg', '', '16 / 9')}
        <div class="picker-side"><small class="hint-text">Если не выбрана — общий фон из «Палитра, шрифты, фон».</small>
        <div class="row-btns"><button class="btn sm" data-act="ce-bg-pick">${icon('image', 13)}Выбрать</button>${sc.background.image ? '<button class="btn sm ghost" data-act="ce-bg-clear">Убрать</button>' : ''}</div></div></div></div>
      ${mediaField('Видео на фоне (mp4, без звука, по кругу)', sc.background.video, 'ce-bgvideo', 'video')}
      ${ceRange('screen.background.dim', 'Затемнение фона', sc.background.dim, 0, 0.95, 0.05)}
      ${ceRange('screen.background.blur', 'Размытие фона', sc.background.blur, 0, 30, 1)}
      <div class="ce-ptitle" style="margin-top:18px">Музыка и звуки</div>
      ${mediaField('Фоновая музыка (mp3)', m.music, 'ce-media', 'music')}
      ${m.music ? `${ceRange('media.musicVolume', 'Громкость', m.musicVolume, 0, 1, 0.05)}${chk('media.musicAutoplay', 'Играть сразу при запуске', m.musicAutoplay)}<div class="note" style="margin:8px 0 12px">Добавьте элемент «Кнопка музыки», чтобы игрок мог выключить звук.</div>` : ''}
      ${mediaField('Звук нажатия на кнопки', m.clickSound, 'ce-media', 'click')}
      <div class="ce-ptitle" style="margin-top:18px">Окно установщика</div>
      <div class="ce-grid2">${num('window.width', 'Ширина', L.window.width, 10)}${num('window.height', 'Высота', L.window.height, 10)}</div>
      ${ceRange('window.radius', 'Скругление углов окна', L.window.radius, 0, 30, 1)}
      <div class="note">Выберите элемент на холсте или в «Слоях», чтобы изменить его. Новые элементы — в «Добавить» слева.</div>`;
    hydrate(box);
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
      ${colorField('props.color', p.fill2 ? 'Цвет (начало градиента)' : 'Цвет текста', p.color)}
      ${chk('props.textgrad', 'Градиентный текст', !!p.fill2)}
      ${p.fill2 ? `${colorField('props.fill2', 'Конец градиента', p.fill2)}${ceRange('props.angle', 'Угол градиента', p.angle, 0, 360, 15)}` : ''}
      ${segBtns('props.align', 'Выравнивание', p.align, [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']])}
      ${segBtns('props.valign', 'По вертикали', p.valign, [['top', 'Сверху'], ['center', 'Центр'], ['bottom', 'Снизу']])}
      ${num('props.lineHeight', 'Межстрочный интервал (0 — авто)', p.lineHeight, 1)}
      <div class="ce-checks">${chk('props.upper', 'ВСЕ ЗАГЛАВНЫЕ', p.upper)}${chk('props.italic', 'Курсив', p.italic)}${chk('props.shadow', 'Тень под текстом', p.shadow)}</div>`;
  } else if (e.type === 'image') {
    specific = `${imageSrcField(e)}
      ${sel('props.fit', 'Вписать', p.fit, { cover: 'Заполнить (обрезать края)', contain: 'Целиком', fill: 'Растянуть' })}
      ${ceRange('props.radius', 'Скругление', p.radius, 0, 200, 1)}
      ${num('props.borderWidth', 'Толщина рамки', p.borderWidth, 1)}${p.borderWidth ? colorField('props.border', 'Цвет рамки', p.border) : ''}`;
  } else if (e.type === 'shape') {
    specific = `${colorField('props.fill', 'Заливка', p.fill, true)}
      ${chk('props.grad', 'Градиент', !!p.fill2)}
      ${p.fill2 ? `${colorField('props.fill2', 'Второй цвет градиента', p.fill2, true)}${ceRange('props.angle', 'Угол градиента', p.angle, 0, 360, 15)}` : ''}
      ${ceRange('props.frosted', 'Матовое стекло (размытие фона под фигурой)', p.frosted || 0, 0, 40, 1)}
      ${ceRange('props.radius', 'Скругление', p.radius, 0, 300, 1)}
      ${num('props.borderWidth', 'Толщина рамки', p.borderWidth, 1)}${p.borderWidth ? colorField('props.border', 'Цвет рамки', p.border) : ''}
      ${chk('props.shadow', 'Тень', p.shadow)}
      ${p.frosted ? '<div class="note" style="margin-top:8px">Для стекла сделайте заливку полупрозрачной — «Прозрачный» или свой цвет с прозрачностью (#80RRGGBB).</div>' : ''}`;
  } else if (e.type === 'button') {
    specific = `${txt('props.label', 'Надпись', p.label)}
      ${sel('props.action', 'Что делает', p.action, actionOpts())}
      ${p.action === 'url' ? txt('props.url', 'Ссылка', p.url, false, 'https://…') : ''}
      ${colorField('props.fill', 'Цвет кнопки', p.fill, true)}${colorField('props.color', 'Цвет надписи', p.color)}
      ${colorField('props.hoverFill', 'Цвет кнопки при наведении', p.hoverFill, true)}${colorField('props.hoverColor', 'Цвет надписи при наведении', p.hoverColor)}
      <div class="ce-grid2">${num('props.size', 'Размер текста', p.size, 1)}${sel('props.weight', 'Насыщенность', p.weight, WEIGHTS)}</div>
      ${sel('props.font', 'Шрифт', p.font || '@font', FONT_OPTS())}
      ${ceRange('props.radius', 'Скругление', p.radius, 0, 40, 1)}
      ${num('props.borderWidth', 'Толщина рамки', p.borderWidth, 1)}${p.borderWidth ? colorField('props.border', 'Цвет рамки', p.border) : ''}
      ${chk('props.glow', 'Свечение', p.glow)}`;
  } else if (e.type === 'video') {
    specific = `${mediaField('Видео (mp4)', p.src, 'ce-video-pick', 'video')}
      ${sel('props.fit', 'Вписать', p.fit, { cover: 'Заполнить', contain: 'Целиком', fill: 'Растянуть' })}
      ${ceRange('props.radius', 'Скругление', p.radius, 0, 100, 1)}
      <div class="ce-checks">${chk('props.loop', 'По кругу', p.loop)}${chk('props.muted', 'Без звука', p.muted)}</div>
      <div class="note">Видео проигрывается встроенным в Windows плеером: используйте mp4 (H.264).</div>`;
  } else if (e.type === 'slider') {
    specific = `<div class="field"><span>Картинки (${(p.images || []).length})</span><div class="ce-slides">${(p.images || []).map((rel, i) => `<div class="ce-slide"><img data-rel="${esc(rel)}" alt="">
        <span><button data-act="ce-slide-move" data-i="${i}" data-dir="-1" title="Раньше">‹</button><button data-act="ce-slide-move" data-i="${i}" data-dir="1" title="Позже">›</button><button data-act="ce-slide-del" data-i="${i}" title="Убрать">✕</button></span></div>`).join('')}
        <button class="ce-slide add" data-act="ce-slide-add">${icon('plus', 18)}</button></div></div>
      ${num('props.interval', 'Смена каждые, сек', p.interval, 1)}
      ${sel('props.fit', 'Вписать', p.fit, { cover: 'Заполнить', contain: 'Целиком', fill: 'Растянуть' })}
      ${ceRange('props.radius', 'Скругление', p.radius, 0, 100, 1)}
      <div class="ce-checks">${chk('props.arrows', 'Стрелки', p.arrows)}${chk('props.dots', 'Точки', p.dots)}</div>`;
  } else if (e.type === 'social') {
    specific = `<div class="field"><span>Ссылки</span>${(p.links || []).map((l, i) => `<div class="ce-link">
        <select class="select" data-ceprop="props.links.${i}.kind">${Object.entries(CE.meta.social).map(([k, v]) => `<option value="${k}" ${l.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input class="input" data-ceprop="props.links.${i}.url" value="${esc(l.url)}" placeholder="https://…"><button class="btn sm ghost icon-only" data-act="ce-link-del" data-i="${i}">✕</button></div>`).join('')}
      <button class="btn sm" data-act="ce-link-add">${icon('plus', 12)}Ссылка</button></div>
      <div class="ce-grid2">${num('props.size', 'Размер кнопок', p.size, 2)}${num('props.gap', 'Промежуток', p.gap, 1)}</div>
      ${colorField('props.fill', 'Фон кнопок', p.fill, true)}${colorField('props.color', 'Цвет значков', p.color)}
      ${chk('props.round', 'Круглые', p.round)}`;
  } else if (e.type === 'stat') {
    specific = `${txt('props.value', 'Число', p.value, false, '{modsCount}')}${txt('props.label', 'Подпись', p.label)}
      ${num('props.valueSize', 'Размер числа', p.valueSize, 1)}
      ${colorField('props.color', 'Цвет числа', p.color)}${colorField('props.labelColor', 'Цвет подписи', p.labelColor)}
      ${segBtns('props.align', 'Выравнивание', p.align, [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']])}`;
  } else if (e.type === 'license') {
    specific = `${txt('props.text', 'Текст соглашения', p.text, true)}${txt('props.label', 'Подпись галочки', p.label)}
      ${chk('props.required', 'Без согласия установка не начнётся', p.required)}`;
  } else if (e.type === 'presets') {
    specific = `${txt('props.title', 'Подпись', p.title)}
      <div class="field"><span>Наборы модов (${(S.proj.presets || []).length})</span>${(S.proj.presets || []).map((x) => `<div class="ce-link"><b class="grow">${esc(x.name)}</b><small class="hint-text">${x.mods.length} модов</small>
        <button class="btn sm" data-act="ce-preset-edit" data-id="${x.id}">${icon('edit', 12)}</button><button class="btn sm ghost icon-only" data-act="ce-preset-del" data-id="${x.id}">✕</button></div>`).join('')}
        <button class="btn sm" data-act="ce-preset-edit">${icon('plus', 12)}Новый набор</button></div>
      <div class="note">Первым всегда идёт «Рекомендуемый» — выбор по умолчанию из «Состава модпака».</div>`;
  } else if (e.type === 'musicbtn') {
    specific = `${colorField('props.fill', 'Фон', p.fill, true)}${colorField('props.color', 'Цвет значка', p.color)}${ceRange('props.radius', 'Скругление', p.radius, 0, 40, 1)}
      ${S.proj.installer.media.music ? '' : '<div class="note">Музыка не выбрана: снимите выделение и укажите её в свойствах экрана.</div>'}`;
  } else if (e.type === 'modlist') {
    specific = `${segBtns('props.layout', 'Моды показываются', p.layout, [['grid', 'Карточками'], ['list', 'Списком']])}
      ${p.layout === 'grid' ? segBtns('props.cardSize', 'Размер карточек', p.cardSize, [['s', 'Мелкие'], ['m', 'Средние'], ['l', 'Крупные']]) : ''}
      ${sel('props.categories', 'Категории (группы)', p.categories, { tabs: 'Вкладками сверху', sidebar: 'Меню слева', none: 'Не показывать' })}
      ${chk('props.search', 'Поиск модов', p.search)}
      <div class="note">Цвета карточек — из палитры темы («Карточки», «Рамки», «Акцент»).</div>`;
  } else if (e.type === 'options') {
    specific = `<div class="ce-checks">${chk('props.game', 'Папка игры и «Изменить»', p.game)}${chk('props.clean', 'Переключатель «Убрать старые моды»', p.clean)}${chk('props.shortcut', 'Переключатель «Ярлык»', p.shortcut)}</div>`;
  } else {
    specific = `<div class="note">${esc(t.name)} — готовый блок установщика. Его вид задаётся палитрой темы, а размер и место — здесь, на холсте.</div>`;
  }
  box.innerHTML = `<div class="ce-ptitle">${icon(ADD_ICONS[e.type] || 'other', 15)}${esc(t.name)}${e.group ? '<span class="badge">в группе</span>' : ''}</div>
    ${txt('name', 'Название слоя', e.name)}
    <div class="ce-grid4" id="ce-geom">${num('x', 'X', e.x)}${num('y', 'Y', e.y)}${num('w', 'Ш', e.w)}${num('h', 'В', e.h)}</div>
    ${ceRange('opacity', 'Непрозрачность', e.opacity, 0.05, 1, 0.05)}
    ${sel('showIf', 'Когда показывать', e.showIf, CE.meta.showIf)}
    <div class="ce-sep"></div>
    ${specific}
    <div class="ce-sep"></div>
    ${effectsSection(e)}
    <div class="row-btns" style="margin-top:12px"><button class="btn sm" data-act="ce-center" data-axis="h">↔ По центру окна</button><button class="btn sm" data-act="ce-center" data-axis="v">↕ По середине</button></div>`;
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

// Путь свойства: screen.* — экран, window.* — окно, media.* — музыка, остальное — выбранный элемент
function ceSetPath(path, value) {
  let obj;
  let keys;
  if (path.startsWith('screen.')) { obj = scr(); keys = path.slice(7).split('.'); }
  else if (path.startsWith('window.')) { obj = lay().window; keys = path.slice(7).split('.'); }
  else if (path.startsWith('media.')) { obj = S.proj.installer.media; keys = path.slice(6).split('.'); }
  else { obj = selected1(); keys = path.split('.'); }
  if (!obj) return;
  for (const k of keys.slice(0, -1)) obj = obj[k] ??= {};
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
  if (path === 'props.grad' || path === 'props.textgrad') {
    selected1().props.fill2 = t.checked ? (path === 'props.grad' ? '@bg' : '@accent') : '';
    changed({ tree: false });
    ceRender();
    ceLiveSchedule();
    return;
  }
  if (['x', 'y', 'w', 'h'].includes(path)) v = Math.round(v);
  ceSetPath(path, v);
  const lbl = document.querySelector(`[data-cefor="${path}"]`);
  if (lbl) lbl.textContent = v;
  if (path.startsWith('window.')) lay().template = 'custom';
  changed({ tree: false });
  ceLiveSchedule();
  if (path === 'name') { const l = document.querySelector(`.ce-layer[data-id="${selected1()?.id}"] span`); if (l) l.textContent = v; return; }
  if (path === 'screen.name') { const b = document.querySelector(`.ce-scr[data-screen="${CE.screen}"]`); if (b) b.childNodes[1].textContent = v; return; }
  ceStage();
  if (t.type === 'color' || t.tagName === 'SELECT' || t.dataset.bool) ceProps();
});

// ---------- действия ----------

// Свойства оформления, которые переносит «копировать стиль»
const STYLE_SKIP = new Set(['text', 'label', 'src', 'images', 'links', 'value', 'url', 'action', 'title']);
const pickStyle = (e) => ({ type: e.type, props: Object.fromEntries(Object.entries(e.props).filter(([k]) => !STYLE_SKIP.has(k))), anim: e.anim, hover: e.hover, opacity: e.opacity });

async function editPreset(id) {
  const presets = S.proj.presets;
  const cur = presets.find((x) => x.id === id) || { id: `p${Date.now().toString(36)}`, name: '', mods: allMods().filter((m) => m.checked).map((m) => m.id) };
  const rows = [];
  const visit = (nodes, depth) => {
    for (const n of nodes) {
      if (n.type === 'group') { rows.push(`<div class="ce-pm-grp" style="padding-left:${depth * 16}px">${esc(n.name)}${n.mode === 'single' ? ' <small>(один из)</small>' : ''}</div>`); visit(n.children, depth + 1); }
      else rows.push(`<label class="ce-pm" style="padding-left:${depth * 16}px"><input type="checkbox" name="m_${n.id}" ${cur.mods.includes(n.id) ? 'checked' : ''}>${esc(n.name)}</label>`);
    }
  };
  visit(S.proj.tree, 0);
  const r = await modal({
    title: id ? 'Набор модов' : 'Новый набор модов', sub: 'Игрок выберет набор одним щелчком — галочки расставятся сами', ic: 'profiles', wide: true,
    body: `<label class="field"><span>Название</span><input class="input" name="name" value="${esc(cur.name)}" placeholder="Например: Минимальный"></label><div class="ce-pm-list">${rows.join('')}</div>`,
    actions: [{ label: 'Отмена', value: null }, { label: 'Сохранить', value: 'ok', primary: true }],
  });
  if (!r) return;
  cur.name = r.data.name.trim() || 'Набор';
  cur.mods = Object.entries(r.data).filter(([k, v]) => k.startsWith('m_') && v).map(([k]) => k.slice(2));
  if (!presets.includes(cur)) presets.push(cur);
  changed({ tree: false });
  ceRender();
  ceLiveSchedule();
}

// Галерея готовых дизайнов: шаблон раскладки + палитра
const GALLERY = [
  ['Тактика', 'classic', 'tactic'], ['Сталь', 'sidebar', 'steel'], ['Большой фон', 'hero', 'tactic'], ['Неон', 'hero', 'neon'],
  ['Хаки', 'classic', 'khaki'], ['Багровый', 'sidebar', 'crimson'], ['Компактный', 'compact', 'steel'], ['Светлый', 'classic', 'arctic'],
];

async function openGallery() {
  const layouts = {};
  for (const [, tpl] of GALLERY) if (!layouts[tpl]) layouts[tpl] = await call(api.layoutTemplate, tpl);
  const cards = GALLERY.map(([name, tpl, pal], i) => {
    paletteOverride = THEME_PRESETS[pal].colors;
    const L = layouts[tpl];
    const k = 260 / L.window.width;
    const inner = stageInner(L.screens.welcome, false);
    const html = `<button class="ce-gal" data-gi="${i}"><div class="ce-gal-shot" style="height:${L.window.height * k}px"><div class="ce-stage" style="width:${L.window.width}px;height:${L.window.height}px;transform:scale(${k});background:${col('@bg')};color:${col('@text')};--ce-surface:${alpha('@surface', 0.92)};--ce-card:${alpha('@card', 0.92)};--ce-border:${col('@border')};--ce-muted:${col('@muted')};--ce-radius:12px">${inner}</div></div><b>${esc(name)}</b></button>`;
    paletteOverride = null;
    return html;
  }).join('');
  let chosen = null;
  const r = await modal({
    title: 'Галерея дизайнов', sub: 'Выберите готовый дизайн — затем меняйте что угодно. Ваши картинки, музыка и тексты сохранятся. Отменить — Ctrl+Z.', ic: 'sparkle', wide: true,
    body: `<div class="ce-gallery">${cards}</div>`,
    onMount: (root) => root.querySelectorAll('.ce-gal').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('.ce-gal').forEach((x) => x.classList.toggle('on', x === b));
      chosen = Number(b.dataset.gi);
    })),
    actions: [{ label: 'Отмена', value: null }, { label: 'Применить', value: 'ok', primary: true }],
  });
  if (!r || chosen === null) return;
  const [name, tpl, pal] = GALLERY[chosen];
  ceSnap();
  S.proj.installer.layout = JSON.parse(JSON.stringify(layouts[tpl]));
  Object.assign(S.proj.installer.colors, THEME_PRESETS[pal].colors);
  S.proj.installer.titleFont = THEME_PRESETS[pal].titleFont;
  S.proj.installer.radius = THEME_PRESETS[pal].radius;
  S.proj.installer.preset = pal;
  S.proj.design.accent = THEME_PRESETS[pal].colors.accent;
  phCache.clear();
  CE.sel = [];
  CE.screen = 'welcome';
  ceCommit();
  toast('ok', `Дизайн «${name}» применён`);
}

Object.assign(ACTIONS, {
  'ce-tab': (el) => { CE.tab = el.dataset.tab; renderPage(); },
  'ce-screen': (el) => { CE.screen = el.dataset.screen; CE.sel = []; CE.liveImg = null; ceRender(); ceLiveSchedule(); },
  'ce-pick': (el) => { CE.sel = withGroup(el.dataset.id, true); ceRefreshSel(); },
  'ce-eye': (el) => { ceSnap(); const e = byId(el.dataset.id); e.hidden = !e.hidden; ceCommit(); },
  'ce-lock': (el) => { ceSnap(); const e = byId(el.dataset.id); e.locked = !e.locked; ceCommit(); },
  'ce-grid': () => { CE.grid = !CE.grid; ceRender(); },
  'ce-rulers': () => { CE.rulers = !CE.rulers; ceRender(); },
  'ce-zoom': (el) => {
    const z = el.dataset.z;
    if (z === 'fit') CE.zoom = CE.zoom === 'fit' ? 1 : 'fit';
    else CE.zoom = Math.max(0.25, Math.min(2, +(CE.scale * (z === 'in' ? 1.25 : 0.8)).toFixed(2)));
    ceRender();
  },
  'ce-undo': () => ceUndo(false),
  'ce-redo': () => ceUndo(true),
  'ce-add': (el) => {
    const type = el.dataset.type;
    const t = CE.meta.types[type];
    const L = lay();
    ceSnap();
    const e = { id: ceNewId(), type, name: t.name, x: Math.round((L.window.width - t.w) / 2 / GRID) * GRID, y: Math.round((L.window.height - t.h) / 2 / GRID) * GRID,
      w: t.w, h: t.h, opacity: 1, hidden: false, locked: false, showIf: 'always', rotate: 0, group: null,
      anim: { in: 'none', delay: 0, duration: 450, loop: 'none' }, hover: { scale: 1, glow: false, lift: 0 }, props: JSON.parse(JSON.stringify(t.props)) };
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
    const map = {};
    const copies = CE.sel.map(byId).map((e) => {
      const c = { ...JSON.parse(JSON.stringify(e)), id: ceNewId(), x: e.x + 16, y: e.y + 16, name: `${e.name} (копия)` };
      if (e.group) c.group = map[e.group] ??= `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      return c;
    });
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
  'ce-group': () => {
    if (CE.sel.length < 2) return;
    ceSnap();
    const g = `g${Date.now().toString(36)}`;
    for (const id of CE.sel) byId(id).group = g;
    ceCommit();
    toast('ok', 'Сгруппировано', 'Щелчок выбирает всю группу, Ctrl+щелчок — один элемент');
  },
  'ce-ungroup': () => {
    ceSnap();
    for (const id of CE.sel) byId(id).group = null;
    ceCommit();
  },
  'ce-distribute': (el) => {
    const axis = el.dataset.axis;
    const size = axis === 'x' ? 'w' : 'h';
    const list = CE.sel.map(byId).sort((a, b) => a[axis] - b[axis]);
    const first = list[0];
    const last = list[list.length - 1];
    const total = list.reduce((s, e) => s + e[size], 0);
    const gap = (last[axis] + last[size] - first[axis] - total) / (list.length - 1);
    ceSnap();
    let pos = first[axis];
    for (const e of list) { e[axis] = Math.round(pos); pos += e[size] + gap; }
    ceCommit();
  },
  'ce-style-copy': () => {
    const e = selected1() || byId(CE.sel[0]);
    if (!e) return;
    CE.styleClip = pickStyle(e);
    toast('info', 'Стиль скопирован', `${CE.meta.types[e.type].name}: вставьте Ctrl+Alt+V на другой элемент того же типа`);
    ceRefreshSel();
  },
  'ce-style-paste': () => {
    const st = CE.styleClip;
    if (!st || !CE.sel.length) return;
    ceSnap();
    let n = 0;
    for (const id of CE.sel) {
      const e = byId(id);
      if (e.type !== st.type) continue;
      Object.assign(e.props, JSON.parse(JSON.stringify(st.props)));
      e.anim = { ...st.anim };
      e.hover = { ...st.hover };
      e.opacity = st.opacity;
      n++;
    }
    ceCommit();
    toast(n ? 'ok' : 'info', n ? `Стиль применён: ${n}` : 'Стиль переносится только на элементы того же типа');
  },
  'ce-set': (el) => { ceSnap(); ceSetPath(el.dataset.path, el.dataset.val); changed({ tree: false }); ceStage(); ceProps(); ceLiveSchedule(); },
  'ce-col': (el) => { ceSnap(); ceSetPath(el.dataset.path, el.dataset.val); changed({ tree: false }); ceStage(); ceProps(); ceLiveSchedule(); },
  'ce-src': (el) => { ceSnap(); selected1().props.src = el.dataset.val; ceCommit(); },
  'ce-src-pick': async () => {
    const rel = await call(api.pickImage);
    if (!rel) return;
    ceSnap();
    selected1().props.src = rel;
    ceCommit();
  },
  'ce-bg-pick': async () => {
    const rel = await call(api.pickImage);
    if (!rel) return;
    ceSnap();
    scr().background.image = rel;
    ceCommit();
  },
  'ce-bg-clear': () => { ceSnap(); scr().background.image = null; ceCommit(); },
  'ce-bgvideo': async (el) => {
    const rel = el.dataset.clear ? null : await call(api.pickMedia, 'video');
    if (rel === null && !el.dataset.clear) return;
    ceSnap();
    scr().background.video = rel;
    ceCommit();
  },
  'ce-video-pick': async (el) => {
    const rel = el.dataset.clear ? null : await call(api.pickMedia, 'video');
    if (rel === null && !el.dataset.clear) return;
    ceSnap();
    selected1().props.src = rel;
    ceCommit();
  },
  'ce-media': async (el) => {
    const key = el.dataset.kind === 'music' ? 'music' : 'clickSound';
    const rel = el.dataset.clear ? null : await call(api.pickMedia, 'audio');
    if (rel === null && !el.dataset.clear) return;
    S.proj.installer.media[key] = rel;
    changed({ tree: false });
    ceProps();
  },
  'ce-slide-add': async () => {
    const rel = await call(api.pickImage);
    if (!rel) return;
    ceSnap();
    selected1().props.images.push(rel);
    ceCommit();
  },
  'ce-slide-del': (el) => { ceSnap(); selected1().props.images.splice(+el.dataset.i, 1); ceCommit(); },
  'ce-slide-move': (el) => {
    const arr = selected1().props.images;
    const i = +el.dataset.i;
    const j = i + +el.dataset.dir;
    if (j < 0 || j >= arr.length) return;
    ceSnap();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    ceCommit();
  },
  'ce-link-add': () => { ceSnap(); selected1().props.links.push({ kind: 'site', url: '' }); ceCommit(); },
  'ce-link-del': (el) => { ceSnap(); selected1().props.links.splice(+el.dataset.i, 1); ceCommit(); },
  'ce-preset-edit': (el) => editPreset(el.dataset.id),
  'ce-preset-del': async (el) => {
    const pr = S.proj.presets.find((x) => x.id === el.dataset.id);
    if (!(await confirmBox('Удалить набор?', `«${esc(pr.name)}»`, 'Удалить', true))) return;
    S.proj.presets = S.proj.presets.filter((x) => x !== pr);
    changed({ tree: false });
    ceRender();
  },
  'ce-add-screen': async () => {
    const r = await modal({
      title: 'Новый экран', sub: 'Например «О модпаке», «Авторы», «Правила». Переход — кнопкой с действием «Экран …».', ic: 'file',
      body: '<label class="field"><span>Название</span><input class="input" name="name" placeholder="О модпаке"></label>',
      actions: [{ label: 'Отмена', value: null }, { label: 'Создать', value: 'ok', primary: true }],
    });
    if (!r) return;
    ceSnap();
    const key = `custom_${Date.now().toString(36)}`;
    const L = lay();
    const W = L.window.width;
    const H = L.window.height;
    const base = (type, x, y, w, h, props, name) => ({ id: ceNewId(), type, name: name || CE.meta.types[type].name, x, y, w, h, opacity: 1, hidden: false, locked: false, showIf: 'always', rotate: 0, group: null,
      anim: { in: 'none', delay: 0, duration: 450, loop: 'none' }, hover: { scale: 1, glow: false, lift: 0 }, props: { ...JSON.parse(JSON.stringify(CE.meta.types[type].props)), ...props } });
    L.screens[key] = {
      enabled: true, name: r.data.name.trim() || 'Свой экран', background: { color: '@bg', image: null, video: null, dim: 0.6, blur: 6 },
      elements: [
        base('text', 60, 80, W - 120, 50, { text: r.data.name.trim() || 'Свой экран', font: '@titleFont', size: 34, weight: 'bold' }, 'Заголовок'),
        base('text', 60, 150, W - 120, 200, { text: 'Текст экрана', size: 15 }, 'Текст'),
        base('button', 60, H - 100, 160, 46, { label: '← Назад', action: 'go:welcome', fill: '@card', color: '@text', border: '@border', borderWidth: 1, glow: false }, 'Кнопка «Назад»'),
        base('wincontrols', W - 92, 18, 76, 32, {}),
      ],
    };
    CE.screen = key;
    CE.sel = [];
    ceCommit();
  },
  'ce-del-screen': async () => {
    if (!(await confirmBox('Удалить экран?', `«${esc(scr().name)}» и все его элементы. Отменить — Ctrl+Z.`, 'Удалить', true))) return;
    ceSnap();
    delete lay().screens[CE.screen];
    CE.screen = 'welcome';
    CE.sel = [];
    ceCommit();
  },
  'ce-center': (el) => {
    const e = selected1();
    const L = lay();
    ceSnap();
    if (el.dataset.axis === 'h') e.x = Math.round((L.window.width - e.w) / 2);
    else e.y = Math.round((L.window.height - e.h) / 2);
    ceCommit();
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
    ceCommit();
  },
  'ce-live': () => {
    CE.live = !CE.live;
    ceRender();
    if (CE.live) quiet(ceLiveRun());
  },
  'ce-real': async () => {
    const r = modal({
      title: `Настоящее окно: «${screenName(CE.screen)}»`, sub: 'Так этот экран нарисует установщик у игрока', ic: 'play', wide: true,
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
    CE.screen = 'welcome';
    ceCommit();
    toast('ok', 'Шаблон применён', 'Теперь двигайте и настраивайте элементы как угодно');
  },
  'ce-gallery': () => openGallery(),
  'ce-export': async () => {
    await saveNow();
    const f = await call(api.exportDesign, S.proj);
    if (f) { toast('ok', 'Дизайн сохранён', f); api.showItem(f); }
  },
  'ce-import': async () => {
    if (!(await confirmBox('Импортировать дизайн?', 'Оформление установщика заменится дизайном из файла. Моды и сведения не изменятся.', 'Выбрать файл'))) return;
    clearTimeout(S.saveTimer);
    const ps = await call(api.importDesign, S.proj);
    if (!ps) return;
    applyProjectState(ps);
    imgData.clear();
    CE.sel = [];
    CE.screen = 'welcome';
    CE.hist = [];
    CE.fut = [];
    render();
    toast('ok', 'Дизайн импортирован');
  },
});

const TPL_HINTS = {
  classic: 'Баннер и описание слева, папка игры и «Что нового» справа; карточки модов с описанием',
  hero: 'Огромный фон на весь экран, заголовок и кнопки по центру; категории меню слева',
  sidebar: 'Как классика, но категории модов — меню слева',
  compact: 'Окно поменьше, моды списком — для небольших сборок',
};
