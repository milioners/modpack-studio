// Раскладка окна установщика: экраны и элементы со свободными координатами (как в Figma).
//
// layout = { version, window: { width, height, radius }, screens: { welcome, mods, progress, finish, manage, custom_… } }
// screen = { enabled, name, background: { color, image, video, dim, blur }, elements: [element] } — порядок = слои снизу вверх
// element = { id, type, name, x, y, w, h, opacity, hidden, locked, showIf, rotate, group, anim, hover, props }
//   anim  = { in: none|fade|slideLeft|slideRight|slideUp|slideDown|zoom|pop, delay, duration, loop: none|pulse|float|glow|spin|blink }
//   hover = { scale, glow, lift }
//
// Цвета: '#rrggbb' / '#aarrggbb' или ссылка на палитру темы: @bg @surface @card @border @text @muted @accent @accentText @danger @success.
// Шрифты: имя шрифта или @font / @titleFont. Картинки: путь проекта (images/…) или @logo / @banner.
// В текстах подставляются {name} {version} {author} {gameVersion} {description} {modsCount} {size}
// {selected} {selectedSize} {game} {gameVersion} {installedVersion} {updateVersion} {welcomeTitle} {finishTitle} {finishText}.
'use strict';

const SCREENS = ['welcome', 'mods', 'progress', 'finish', 'manage'];
const SCREEN_NAMES = { welcome: 'Приветствие', mods: 'Выбор модов', progress: 'Установка', finish: 'Готово', manage: 'Управление' };

// Типы элементов: название, размер по умолчанию, свойства по умолчанию
const TYPES = {
  text: { name: 'Текст', w: 320, h: 40, props: { text: 'Новый текст', font: '@font', size: 16, weight: 'normal', color: '@text', fill2: '', angle: 0, align: 'left', valign: 'top', italic: false, shadow: false, lineHeight: 0, spacing: 0, upper: false } },
  image: { name: 'Картинка', w: 320, h: 180, props: { src: null, fit: 'cover', radius: 12, border: '@border', borderWidth: 0 } },
  shape: { name: 'Фигура', w: 240, h: 140, props: { fill: '@surface', fill2: '', angle: 90, border: '@border', borderWidth: 1, radius: 12, shadow: false, frosted: 0 } },
  button: { name: 'Кнопка', w: 180, h: 46, props: { label: 'Кнопка', action: 'go:mods', url: '', fill: '@accent', color: '@accentText', border: '@accent', borderWidth: 0, radius: 9, size: 14, weight: 'bold', glow: true, hoverFill: '', hoverColor: '', icon: '' } },
  video: { name: 'Видео', w: 480, h: 270, props: { src: null, fit: 'cover', radius: 12, loop: true, muted: true } },
  slider: { name: 'Слайдер картинок', w: 480, h: 270, props: { images: [], interval: 4, fit: 'cover', radius: 12, arrows: true, dots: true } },
  social: { name: 'Соцсети', w: 220, h: 44, props: { links: [{ kind: 'discord', url: '' }, { kind: 'telegram', url: '' }, { kind: 'youtube', url: '' }], size: 40, gap: 10, fill: '@card', color: '@text', round: true } },
  stat: { name: 'Счётчик', w: 160, h: 80, props: { value: '{modsCount}', label: 'модов в сборке', valueSize: 36, color: '@accent', labelColor: '@muted', align: 'left' } },
  license: { name: 'Соглашение', w: 520, h: 260, props: { text: 'Устанавливая модпак, вы соглашаетесь использовать только разрешённые модификации.', label: 'Я принимаю условия', required: true } },
  presets: { name: 'Наборы модов', w: 520, h: 44, props: { title: 'Набор:' } },
  musicbtn: { name: 'Кнопка музыки', w: 40, h: 40, props: { fill: '@card', color: '@text', radius: 20 } },
  modlist: { name: 'Список модов', w: 680, h: 500, props: { layout: 'grid', cardSize: 'm', categories: 'tabs', search: true } },
  moddetail: { name: 'Описание мода', w: 330, h: 500, props: {} },
  gamecard: { name: 'Папка игры', w: 360, h: 150, props: {} },
  options: { name: 'Папка и опции', w: 620, h: 60, props: { clean: true, shortcut: true, game: true } },
  progress: { name: 'Прогресс установки', w: 520, h: 120, props: {} },
  changelog: { name: 'Что нового', w: 360, h: 200, props: {} },
  wincontrols: { name: 'Свернуть / закрыть', w: 76, h: 32, props: {} },
};

const ACTIONS = {
  'go:welcome': 'Экран приветствия', 'go:mods': 'Экран выбора модов', install: 'Установить выбранное', installDefaults: 'Установить рекомендуемое',
  update: 'Обновить модпак', checkUpdate: 'Проверить обновления', changelog: 'Показать «Что нового»', pickFolder: 'Выбрать папку игры',
  launchGame: 'Запустить игру', openFolder: 'Открыть папку игры', url: 'Открыть ссылку', uninstall: 'Удалить модпак', close: 'Закрыть окно', minimize: 'Свернуть окно',
  toggleMusic: 'Включить / выключить музыку',
};

const ANIM_IN = { none: 'Нет', fade: 'Проявление', slideLeft: 'Выезд слева', slideRight: 'Выезд справа', slideUp: 'Выезд снизу', slideDown: 'Выезд сверху', zoom: 'Увеличение', pop: 'Пружина' };
const ANIM_LOOP = { none: 'Нет', pulse: 'Пульсация', float: 'Покачивание', glow: 'Мерцание свечения', spin: 'Вращение', blink: 'Мигание' };
const SOCIAL = { discord: 'Discord', telegram: 'Telegram', vk: 'ВКонтакте', youtube: 'YouTube', twitch: 'Twitch', boosty: 'Boosty', site: 'Сайт' };

const SHOW_IF = {
  always: 'Всегда', updateAvailable: 'Есть обновление модпака', noUpdate: 'Обновления нет', hasUpdateSource: 'Обновления настроены',
  gameFound: 'Игра найдена', gameMissing: 'Игра не найдена', installed: 'Модпак уже установлен', notInstalled: 'Модпак не установлен',
  changelog: 'Есть «Что нового»', hasLaunch: 'Можно запустить игру', hasWelcome: 'Включён экран приветствия', hasBanner: 'Есть баннер',
  hasMusic: 'Есть музыка', hasPresets: 'Есть наборы модов',
};

let seq = 0;
const nid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

const ANIM = () => ({ in: 'none', delay: 0, duration: 450, loop: 'none' });
const HOVER = () => ({ scale: 1, glow: false, lift: 0 });

function el(type, x, y, w, h, props = {}, extra = {}) {
  return { id: nid(), type, name: extra.name || TYPES[type].name, x, y, w, h, opacity: 1, hidden: false, locked: false, showIf: 'always',
    rotate: 0, group: null, anim: ANIM(), hover: HOVER(), ...extra, props: { ...JSON.parse(JSON.stringify(TYPES[type].props)), ...props } };
}

// Шапка: логотип, название, версия, кнопка обновления, свернуть/закрыть
function header(W) {
  return [
    el('image', 24, 18, 42, 42, { src: '@logo', radius: 10 }, { name: 'Логотип' }),
    el('text', 78, 17, 520, 24, { text: '{name}', font: '@titleFont', size: 17, weight: 'bold' }, { name: 'Название' }),
    el('text', 78, 42, 520, 20, { text: 'Версия {version}  •  {author}', size: 12, color: '@muted' }, { name: 'Версия' }),
    el('button', W - 316, 18, 220, 34, { label: '⬆  Обновить до {updateVersion}', action: 'update', fill: '#00000000', color: '@accent', border: '@accent', borderWidth: 1, size: 13, weight: 'semibold', glow: false }, { name: 'Кнопка обновления', showIf: 'updateAvailable' }),
    el('wincontrols', W - 92, 18, 76, 32),
  ];
}

function bg(color = '@bg', extra = {}) {
  return { color, image: null, video: null, dim: 0.6, blur: 6, ...extra };
}

// Шаблоны раскладки. palette — для ориентира (шаблоны используют ссылки на палитру)
function template(name = 'classic', size = {}) {
  const W = size.width || (name === 'compact' ? 980 : 1100);
  const H = size.height || (name === 'compact' ? 620 : 700);
  const s = {};
  const hero = name === 'hero';
  const sidebar = name === 'sidebar' || hero;
  const list = name === 'compact';

  s.welcome = hero
    ? { enabled: true, background: bg('@bg', { dim: 0.45, blur: 0 }), elements: [
      ...header(W),
      el('shape', 0, H - 260, W, 260, { fill: '#00000000', fill2: '@bg', angle: 90, borderWidth: 0, radius: 0 }, { name: 'Затемнение снизу' }),
      el('text', 60, H - 330, W - 120, 70, { text: '{welcomeTitle}', font: '@titleFont', size: 48, weight: 'bold', align: 'center', shadow: true }, { name: 'Заголовок' }),
      el('text', W / 2 - 330, H - 252, 660, 70, { text: '{description}', size: 16, align: 'center', shadow: true }, { name: 'Описание' }),
      el('button', W / 2 - 190, H - 150, 180, 52, { label: 'Выбрать моды', action: 'go:mods', size: 15 }, { name: 'Кнопка «Выбрать моды»' }),
      el('button', W / 2 + 10, H - 150, 180, 52, { label: 'Рекомендуемое', action: 'installDefaults', fill: '@card', color: '@text', border: '@border', borderWidth: 1, glow: false, size: 15 }, { name: 'Кнопка «Рекомендуемое»' }),
      el('text', 60, H - 80, W - 120, 22, { text: '{game}', size: 12, color: '@muted', align: 'center' }, { name: 'Статус игры' }),
    ] }
    : { enabled: true, background: bg(), elements: [
      ...header(W),
      el('image', 40, 96, 620, 230, { src: '@banner', radius: 14 }, { name: 'Баннер', showIf: 'hasBanner' }),
      el('text', 40, 346, 620, 52, { text: '{welcomeTitle}', font: '@titleFont', size: 36, weight: 'bold' }, { name: 'Заголовок' }),
      el('text', 40, 404, 620, 96, { text: '{description}', size: 15, lineHeight: 22 }, { name: 'Описание' }),
      el('text', 40, 506, 620, 22, { text: '{modsCount} модов  •  {size}', size: 13, color: '@accent', weight: 'semibold' }, { name: 'Состав' }),
      el('button', 40, 548, 180, 48, { label: 'Выбрать моды', action: 'go:mods' }, { name: 'Кнопка «Выбрать моды»' }),
      el('button', 232, 548, 250, 48, { label: 'Установить рекомендуемое', action: 'installDefaults', fill: '@card', color: '@text', border: '@border', borderWidth: 1, glow: false }, { name: 'Кнопка «Рекомендуемое»' }),
      el('gamecard', W - 400, 200, 360, 160),
      el('changelog', W - 400, 380, 360, 210, {}, { showIf: 'changelog' }),
    ] };

  const footerY = H - 82;
  const detailW = list ? 300 : 330;
  const listX = 24;
  const listW = W - detailW - 24 - 20 - 24;
  s.mods = { enabled: true, background: bg(), elements: [
    ...header(W),
    el('modlist', listX, 80, listW, footerY - 96, { layout: list ? 'list' : 'grid', cardSize: 'm', categories: sidebar ? 'sidebar' : 'tabs', search: true }),
    el('moddetail', W - detailW - 24, 80, detailW, footerY - 96),
    el('shape', 0, footerY, W, H - footerY, { fill: '@surface', borderWidth: 0, radius: 0 }, { name: 'Нижняя панель', opacity: 0.92 }),
    el('options', 24, footerY + 12, 560, 60),
    el('text', W - 470, footerY + 30, 200, 22, { text: 'Выбрано: {selected}  ·  {selectedSize}', size: 13, color: '@muted', align: 'right', weight: 'semibold' }, { name: 'Счётчик выбранного' }),
    el('button', W - 258, footerY + 18, 84, 46, { label: 'Назад', action: 'go:welcome', fill: '#00000000', color: '@text', borderWidth: 0, glow: false }, { name: 'Кнопка «Назад»', showIf: 'hasWelcome' }),
    el('button', W - 166, footerY + 18, 142, 46, { label: 'Установить', action: 'install' }, { name: 'Кнопка «Установить»' }),
  ] };

  s.progress = { enabled: true, background: bg(), elements: [
    ...header(W).filter((e) => e.type !== 'button'),
    el('text', W / 2 - 260, H / 2 - 110, 520, 44, { text: 'Устанавливаю моды…', font: '@titleFont', size: 28, weight: 'bold' }, { name: 'Заголовок' }),
    el('progress', W / 2 - 260, H / 2 - 50, 520, 110),
  ] };

  s.finish = { enabled: true, background: bg(), elements: [
    ...header(W).filter((e) => e.type !== 'button'),
    el('shape', W / 2 - 44, H / 2 - 190, 88, 88, { fill: '@accent', borderWidth: 2, border: '@accent', radius: 44, shadow: true }, { name: 'Круг', opacity: 0.9 }),
    el('text', W / 2 - 44, H / 2 - 172, 88, 52, { text: '✓', size: 40, weight: 'bold', color: '@accentText', align: 'center' }, { name: 'Галочка' }),
    el('text', W / 2 - 300, H / 2 - 80, 600, 50, { text: '{finishTitle}', font: '@titleFont', size: 34, weight: 'bold', align: 'center' }, { name: 'Заголовок' }),
    el('text', W / 2 - 300, H / 2 - 22, 600, 54, { text: '{finishText}', size: 15, align: 'center', color: '@text' }, { name: 'Текст' }),
    el('button', W / 2 - 290, H / 2 + 56, 190, 48, { label: 'Запустить игру', action: 'launchGame' }, { name: 'Кнопка «Запустить игру»', showIf: 'hasLaunch' }),
    el('button', W / 2 - 90, H / 2 + 56, 200, 48, { label: 'Открыть папку игры', action: 'openFolder', fill: '@card', color: '@text', border: '@border', borderWidth: 1, glow: false }, { name: 'Кнопка «Папка игры»' }),
    el('button', W / 2 + 120, H / 2 + 56, 170, 48, { label: 'Закрыть', action: 'close', fill: '#00000000', color: '@text', borderWidth: 0, glow: false }, { name: 'Кнопка «Закрыть»' }),
  ] };

  s.manage = { enabled: true, background: bg(), elements: [
    ...header(W),
    el('text', 60, 150, 620, 50, { text: 'Модпак установлен', font: '@titleFont', size: 34, weight: 'bold' }, { name: 'Заголовок', showIf: 'installed' }),
    el('text', 60, 150, 620, 50, { text: 'Модпак не найден в игре', font: '@titleFont', size: 34, weight: 'bold' }, { name: 'Заголовок (не установлен)', showIf: 'notInstalled' }),
    el('text', 60, 206, 620, 24, { text: 'Установлена версия {installedVersion}  •  в архиве версия {version}', size: 14, color: '@muted' }, { name: 'Версии', showIf: 'installed' }),
    el('gamecard', 60, 250, 420, 160),
    el('button', 60, 440, 250, 48, { label: 'Обновить до {updateVersion}', action: 'update' }, { name: 'Кнопка «Обновить»', showIf: 'updateAvailable' }),
    el('button', 60, 440, 250, 48, { label: 'Проверить обновления', action: 'checkUpdate', fill: '@card', color: '@text', border: '@border', borderWidth: 1, glow: false }, { name: 'Кнопка «Проверить»', showIf: 'noUpdate' }),
    el('button', 322, 440, 200, 48, { label: 'Удалить модпак', action: 'uninstall', fill: '#00000000', color: '@danger', border: '@danger', borderWidth: 1, glow: false }, { name: 'Кнопка «Удалить»', showIf: 'installed' }),
    el('changelog', W - 420, 150, 360, 260, {}, { showIf: 'changelog' }),
  ] };

  if (hero) s.welcome.background = bg('@bg', { image: null, dim: 0.35, blur: 0 });
  for (const k of SCREENS) s[k].name = SCREEN_NAMES[k];
  return { version: 1, template: name, window: { width: W, height: H, radius: 14 }, screens: s };
}

const TEMPLATES = { classic: 'Классика', hero: 'Большой фон', sidebar: 'Меню слева', compact: 'Компактный список' };

// Достраивает раскладку старых проектов и правит повреждённые значения
function normalizeLayout(layout) {
  if (!layout || !layout.screens) return template('classic');
  const out = { version: 1, template: layout.template || 'custom', window: { width: 1100, height: 700, radius: 14, ...layout.window }, screens: {} };
  const base = template('classic', out.window);
  // свои экраны: custom_<id>, у них есть название
  const keys = [...SCREENS, ...Object.keys(layout.screens).filter((k) => /^custom_[\w-]+$/.test(k))];
  for (const sc of keys) {
    const src = layout.screens[sc] || base.screens[sc];
    out.screens[sc] = {
      enabled: src.enabled !== false,
      name: sc.startsWith('custom_') ? String(src.name || 'Свой экран') : SCREEN_NAMES[sc],
      background: { ...bg(), ...src.background },
      elements: (src.elements || []).filter((e) => TYPES[e.type]).map((e) => ({
        ...e, id: e.id || nid(), name: e.name || TYPES[e.type].name, opacity: e.opacity ?? 1, showIf: SHOW_IF[e.showIf] ? e.showIf : 'always',
        x: Math.round(e.x || 0), y: Math.round(e.y || 0), w: Math.max(8, Math.round(e.w || 8)), h: Math.max(8, Math.round(e.h || 8)),
        rotate: Number(e.rotate) || 0, group: e.group || null,
        anim: { ...ANIM(), ...e.anim }, hover: { ...HOVER(), ...e.hover },
        props: { ...JSON.parse(JSON.stringify(TYPES[e.type].props)), ...e.props },
      })),
    };
  }
  return out;
}

// Картинки, на которые ссылается раскладка (чтобы не удалить их при уборке)
function layoutImages(layout) {
  const out = [];
  for (const sc of SCREENS) {
    const s = layout?.screens?.[sc];
    if (!s) continue;
    if (s.background?.image) out.push(s.background.image);
    for (const e of s.elements) {
      if (e.type === 'image' && e.props.src && !e.props.src.startsWith('@')) out.push(e.props.src);
      if (e.type === 'slider') out.push(...(e.props.images || []));
    }
  }
  return out;
}

// Видео и звуки раскладки — пакуются в установщик как есть
function layoutMedia(layout) {
  const out = [];
  for (const s of Object.values(layout?.screens || {})) {
    if (s.background?.video) out.push(s.background.video);
    for (const e of s.elements) if (e.type === 'video' && e.props.src) out.push(e.props.src);
  }
  return out;
}

// Все экраны раскладки по порядку, со своими экранами в конце
function screenKeys(layout) {
  return [...SCREENS, ...Object.keys(layout?.screens || {}).filter((k) => k.startsWith('custom_'))];
}

module.exports = { el, header, bg, SCREENS, SCREEN_NAMES, TYPES, ACTIONS, SHOW_IF, ANIM_IN, ANIM_LOOP, SOCIAL, TEMPLATES, template, normalizeLayout, layoutImages, layoutMedia, screenKeys };
