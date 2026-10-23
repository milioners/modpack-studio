// Готовые дизайны установщика: палитра, шрифты, раскладка с разным набором экранов и анимациями.
// Каждый дизайн — полноценная стартовая точка: дальше автор меняет в редакторе что угодно.
'use strict';

const { el, header, bg, template } = require('./layout');

const PALETTES = {
  tactic: { bg: '#0F1115', surface: '#181B21', card: '#1F232B', border: '#2C313B', text: '#EEE9DF', muted: '#8F8A80', accent: '#F0A53A', accentText: '#1D1305', danger: '#EF5D55', success: '#5CC98A' },
  steel: { bg: '#0D1117', surface: '#161B22', card: '#1C2330', border: '#2A3445', text: '#E6EDF3', muted: '#7D8A9A', accent: '#4F9BE8', accentText: '#06121F', danger: '#EF5D55', success: '#5CC98A' },
  khaki: { bg: '#12140F', surface: '#1A1D16', card: '#22261C', border: '#343A2A', text: '#ECE9D8', muted: '#9A9A80', accent: '#A3B55A', accentText: '#11140A', danger: '#E5484D', success: '#8FC46A' },
  neon: { bg: '#0C0A14', surface: '#151126', card: '#1D1734', border: '#2F2650', text: '#EFEAFF', muted: '#9088B0', accent: '#B06CFF', accentText: '#12061F', danger: '#FF5C8A', success: '#5CF2C0' },
  crimson: { bg: '#120C0C', surface: '#1B1313', card: '#241818', border: '#3A2626', text: '#F2E8E6', muted: '#A08A86', accent: '#E5484D', accentText: '#1C0505', danger: '#FF7A6B', success: '#5CC98A' },
  arctic: { bg: '#EEF0F3', surface: '#FFFFFF', card: '#FFFFFF', border: '#D9DDE3', text: '#1D2128', muted: '#6B7280', accent: '#E2741F', accentText: '#FFFFFF', danger: '#D93B3B', success: '#2E9E5B' },
  gold: { bg: '#0E0D0A', surface: '#17150F', card: '#201D15', border: '#3A3322', text: '#F3EBD7', muted: '#A39A82', accent: '#E8C25A', accentText: '#1A1405', danger: '#E5484D', success: '#9BC25A' },
  ocean: { bg: '#071318', surface: '#0E1F26', card: '#132A33', border: '#1F3E4A', text: '#E3F4F7', muted: '#7FA3AD', accent: '#2EC4B6', accentText: '#04201D', danger: '#FF6B6B', success: '#7BE495' },
};

const anim = (type, delay = 0, loop = 'none', duration = 500) => ({ in: type, delay, duration, loop });
const W = 1100;
const H = 700;

// Пустой свой экран с шапкой
function custom(name, elements, background = bg()) {
  return { enabled: true, name, background, elements: [...header(W).filter((e) => e.type !== 'button'), ...elements] };
}

const back = (to, label = '← Назад', x = 60, y = H - 96) => el('button', x, y, 150, 46, { label, action: to, fill: '@card', color: '@text', border: '@border', borderWidth: 1, glow: false }, { name: 'Кнопка «Назад»' });
const next = (to, label, x, y = H - 96, w = 200) => el('button', x, y, w, 46, { label, action: to }, { name: `Кнопка «${label}»` });

// Анимация появления по очереди для набора элементов
function stagger(elements, type = 'slideUp', step = 90, start = 80) {
  elements.forEach((e, i) => { e.anim = anim(type, start + i * step); });
  return elements;
}

function designs() {
  const list = [];

  // 1. Минимал — 3 экрана: сразу выбор модов, установка, готово
  {
    const L = template('compact');
    L.screens.welcome.enabled = false;
    const mods = L.screens.mods.elements;
    const listEl = mods.find((e) => e.type === 'modlist');
    listEl.y += 50;
    listEl.h -= 50;
    mods.push(el('presets', 24, 80, 600, 40, {}, { showIf: 'hasPresets' }));
    mods.splice(mods.findIndex((e) => e.name === 'Кнопка «Назад»'), 1);
    list.push({ id: 'minimal', name: 'Минимал', description: 'Без приветствия: сразу список модов. Для небольших сборок.', palette: 'steel', font: 'Segoe UI', titleFont: 'Segoe UI', radius: 8, layout: L });
  }

  // 2. Классика — 5 экранов
  list.push({ id: 'classic', name: 'Классика', description: 'Баннер и описание, папка игры и «Что нового», карточки модов.', palette: 'tactic', font: 'Segoe UI', titleFont: 'Bahnschrift', radius: 12, layout: template('classic') });

  // 3. Презентация — 6 экранов: приветствие → «О модпаке» (слайдер, цифры) → моды
  {
    const L = template('hero');
    const wel = L.screens.welcome.elements;
    const pick = wel.find((e) => e.name === 'Кнопка «Выбрать моды»');
    const rec = wel.find((e) => e.name === 'Кнопка «Рекомендуемое»');
    rec.props.label = 'О модпаке';
    rec.props.action = 'go:custom_about';
    stagger([wel.find((e) => e.name === 'Заголовок'), wel.find((e) => e.name === 'Описание'), pick, rec], 'slideUp', 120);
    L.screens.custom_about = custom('О модпаке', [
      ...stagger([
        el('text', 60, 92, 520, 50, { text: 'Что внутри', font: '@titleFont', size: 34, weight: 'bold' }, { name: 'Заголовок' }),
        el('text', 60, 150, 470, 150, { text: '{description}', size: 15, lineHeight: 23 }, { name: 'Описание' }),
        el('stat', 60, 330, 140, 80, { value: '{modsCount}', label: 'модов' }),
        el('stat', 220, 330, 140, 80, { value: '{size}', label: 'размер', valueSize: 30 }),
        el('stat', 380, 330, 140, 80, { value: '{version}', label: 'версия', valueSize: 30 }),
      ], 'slideLeft', 90),
      Object.assign(el('slider', 570, 92, 470, 264, { images: [], interval: 4 }), { anim: anim('zoom', 200) }),
      el('changelog', 570, 376, 470, 160, {}, { showIf: 'changelog' }),
      back('go:welcome'),
      next('go:mods', 'Выбрать моды →', W - 260),
    ]);
    list.push({ id: 'presentation', name: 'Презентация', description: 'Большой экран приветствия и отдельный экран «О модпаке» со слайдером и цифрами.', palette: 'ocean', font: 'Segoe UI', titleFont: 'Bahnschrift', radius: 14, layout: L, fillSlider: true });
  }

  // 4. Комьюнити — 6 экранов: приветствие с соцсетями → «Авторы»
  {
    const L = template('sidebar');
    const wel = L.screens.welcome.elements;
    wel.push(el('social', 40, 618, 260, 44, { links: [{ kind: 'discord', url: '' }, { kind: 'telegram', url: '' }, { kind: 'youtube', url: '' }, { kind: 'vk', url: '' }], fill: '@card' }));
    wel.push(next('go:custom_authors', 'Авторы', 494, 548, 130));
    wel.find((e) => e.name === 'Кнопка «Рекомендуемое»').w = 240;
    stagger(wel.filter((e) => ['Заголовок', 'Описание', 'Состав', 'Кнопка «Выбрать моды»', 'Кнопка «Рекомендуемое»', 'Кнопка «Авторы»'].includes(e.name)), 'slideUp', 70);
    L.screens.custom_authors = custom('Авторы', [
      ...stagger([
        el('text', 60, 92, 980, 50, { text: 'Над модпаком работали', font: '@titleFont', size: 32, weight: 'bold' }, { name: 'Заголовок' }),
        el('shape', 60, 170, 470, 300, { fill: '@surface', radius: 18 }, { name: 'Карточка автора' }),
        el('image', 90, 200, 96, 96, { src: '@logo', radius: 48 }, { name: 'Аватар' }),
        el('text', 206, 214, 300, 34, { text: '{author}', size: 22, weight: 'bold' }, { name: 'Имя' }),
        el('text', 206, 250, 300, 22, { text: 'Автор сборки', size: 13, color: '@accent' }, { name: 'Роль' }),
        el('text', 90, 320, 420, 120, { text: 'Расскажите о себе: стрим, канал, как давно собираете моды и где вас найти.', size: 14, lineHeight: 21 }, { name: 'О себе' }),
        el('shape', 570, 170, 470, 300, { fill: '@surface', radius: 18 }, { name: 'Карточка «Спасибо»' }),
        el('text', 600, 200, 410, 34, { text: 'Спасибо авторам модов', size: 20, weight: 'bold' }, { name: 'Заголовок' }),
        el('text', 600, 244, 410, 200, { text: 'Все моды в сборке принадлежат их авторам и используются с их разрешения.', size: 14, lineHeight: 21, color: '@muted' }, { name: 'Текст' }),
      ], 'fade', 70),
      el('social', 60, 500, 260, 44, { links: [{ kind: 'discord', url: '' }, { kind: 'telegram', url: '' }, { kind: 'youtube', url: '' }, { kind: 'boosty', url: '' }] }),
      back('go:welcome'),
      next('go:mods', 'К модам →', W - 260),
    ]);
    list.push({ id: 'community', name: 'Комьюнити', description: 'Соцсети на первом экране и отдельный экран «Авторы».', palette: 'neon', font: 'Segoe UI', titleFont: 'Segoe UI', radius: 16, layout: L });
  }

  // 5. С соглашением — 6 экранов: приветствие → соглашение (без галочки дальше нельзя) → моды
  {
    const L = template('classic');
    const wel = L.screens.welcome.elements;
    wel.find((e) => e.name === 'Кнопка «Выбрать моды»').props.action = 'go:custom_rules';
    wel.find((e) => e.name === 'Кнопка «Выбрать моды»').props.label = 'Далее';
    wel.find((e) => e.name === 'Кнопка «Рекомендуемое»').hidden = true;
    L.screens.custom_rules = custom('Соглашение', [
      el('text', 60, 92, 980, 50, { text: 'Перед установкой', font: '@titleFont', size: 32, weight: 'bold' }, { name: 'Заголовок' }),
      el('text', 60, 146, 980, 24, { text: 'Прочитайте условия и отметьте согласие — без этого установка не начнётся.', size: 14, color: '@muted' }, { name: 'Подзаголовок' }),
      Object.assign(el('license', 60, 190, 980, 360, { text: '1. Модпак содержит только модификации, разрешённые правилами игры.\n2. Моды распространяются с разрешения их авторов.\n3. Перед установкой старые моды переносятся в резервную копию.\n4. Удалить модпак можно в «Приложениях» Windows — файлы игры вернутся в исходное состояние.' }), { anim: anim('fade', 100) }),
      back('go:welcome'),
      next('go:mods', 'Принимаю, дальше →', W - 290, H - 96, 230),
    ]);
    list.push({ id: 'agreement', name: 'С соглашением', description: 'Отдельный экран с правилами и обязательной галочкой перед выбором модов.', palette: 'khaki', font: 'Segoe UI', titleFont: 'Bahnschrift', radius: 6, layout: L });
  }

  // 6. Кинематограф — 5 экранов, большой фон, стекло, градиентный заголовок, анимации
  {
    const L = template('hero');
    const wel = L.screens.welcome.elements;
    const title = wel.find((e) => e.name === 'Заголовок');
    Object.assign(title.props, { fill2: '@accent', angle: 0, size: 58, upper: true });
    title.anim = anim('pop', 150, 'none', 700);
    wel.splice(wel.indexOf(title), 0, Object.assign(el('shape', W / 2 - 380, H - 350, 760, 280, { fill: '#66000000', frosted: 18, radius: 22, borderWidth: 1, border: '@border' }, { name: 'Стекло' }), { anim: anim('fade', 0, 'none', 700) }));
    wel.find((e) => e.name === 'Описание').anim = anim('fade', 450);
    wel.find((e) => e.name === 'Кнопка «Выбрать моды»').anim = anim('slideUp', 650, 'glow');
    wel.find((e) => e.name === 'Кнопка «Рекомендуемое»').anim = anim('slideUp', 750);
    wel.find((e) => e.name === 'Логотип').anim = anim('fade', 0, 'float');
    L.screens.finish.elements.find((e) => e.name === 'Круг').anim = anim('pop', 0, 'pulse', 600);
    L.screens.welcome.background.dim = 0.3;
    list.push({ id: 'cinema', name: 'Кинематограф', description: 'Фон на весь экран, «стеклянная» плашка, огромный градиентный заголовок и анимации.', palette: 'gold', font: 'Segoe UI', titleFont: 'Bahnschrift', radius: 14, layout: L });
  }

  // 7. Неон-аркада — 7 экранов: приветствие → «О модпаке» → «Авторы» → моды…
  {
    const L = template('classic');
    const wel = L.screens.welcome.elements;
    wel.push(Object.assign(el('shape', W - 260, -80, 360, 360, { fill: '@accent', fill2: '#00000000', angle: 45, borderWidth: 0, radius: 60 }, { name: 'Неоновый ромб', opacity: 0.35, rotate: 45 }), { anim: anim('fade', 0, 'spin') }));
    wel.find((e) => e.name === 'Кнопка «Выбрать моды»').anim = anim('pop', 300, 'pulse');
    wel.find((e) => e.name === 'Кнопка «Рекомендуемое»').props.label = 'О модпаке';
    wel.find((e) => e.name === 'Кнопка «Рекомендуемое»').props.action = 'go:custom_about';
    wel.find((e) => e.name === 'Кнопка «Рекомендуемое»').w = 190;
    stagger(wel.filter((e) => ['Заголовок', 'Описание', 'Состав'].includes(e.name)), 'slideLeft', 100);
    L.screens.custom_about = custom('О модпаке', [
      ...stagger([
        el('text', 60, 100, 600, 56, { text: 'Почему этот модпак', font: '@titleFont', size: 36, weight: 'bold', fill2: '@accent' }, { name: 'Заголовок' }),
        el('stat', 60, 190, 200, 90, { value: '{modsCount}', label: 'проверенных модов', valueSize: 44 }),
        el('stat', 300, 190, 200, 90, { value: '{size}', label: 'весь модпак', valueSize: 44 }),
        el('stat', 540, 190, 200, 90, { value: '1 клик', label: 'установка и обновление', valueSize: 44 }),
        el('text', 60, 320, 680, 160, { text: '{description}', size: 16, lineHeight: 25 }, { name: 'Описание' }),
      ], 'pop', 110),
      back('go:welcome'),
      next('go:custom_authors', 'Авторы →', W - 480, H - 96, 180),
      next('go:mods', 'Выбрать моды →', W - 280),
    ]);
    L.screens.custom_authors = custom('Авторы', [
      el('text', 60, 100, 600, 56, { text: 'Авторы', font: '@titleFont', size: 36, weight: 'bold' }, { name: 'Заголовок' }),
      el('text', 60, 170, 700, 200, { text: '{author} — автор сборки.\nСпасибо авторам модов, которые разрешили их использовать.', size: 16, lineHeight: 26 }, { name: 'Текст' }),
      el('social', 60, 400, 300, 48, { links: [{ kind: 'discord', url: '' }, { kind: 'twitch', url: '' }, { kind: 'youtube', url: '' }], size: 48 }),
      back('go:custom_about'),
      next('go:mods', 'Выбрать моды →', W - 280),
    ]);
    list.push({ id: 'arcade', name: 'Неон-аркада', description: 'Вращающийся неоновый ромб, пульсирующие кнопки, экраны «О модпаке» и «Авторы».', palette: 'neon', font: 'Segoe UI', titleFont: 'Bahnschrift', radius: 16, layout: L });
  }

  // 8. Светлый — 4 экрана: без приветствия, светлая палитра, моды списком с наборами
  {
    const L = template('classic');
    L.screens.welcome.enabled = false;
    const mods = L.screens.mods.elements;
    mods.find((e) => e.type === 'modlist').props.layout = 'list';
    mods.splice(mods.findIndex((e) => e.name === 'Кнопка «Назад»'), 1);
    mods.push(el('button', W - 360, H - 64, 180, 46, { label: 'Что нового', action: 'changelog', fill: '#00000000', color: '@accent', borderWidth: 0, glow: false }, { name: 'Кнопка «Что нового»', showIf: 'changelog' }));
    list.push({ id: 'light', name: 'Светлый', description: 'Светлая палитра, моды списком, без экрана приветствия.', palette: 'arctic', font: 'Segoe UI', titleFont: 'Segoe UI', radius: 12, layout: L });
  }

  // Число экранов, которые реально увидит игрок (экран управления — отдельно, после установки)
  for (const d of list) {
    d.colors = PALETTES[d.palette];
    d.screens = Object.entries(d.layout.screens).filter(([k, s]) => k !== 'manage' && s.enabled !== false).length;
    d.custom = Object.keys(d.layout.screens).filter((k) => k.startsWith('custom_')).map((k) => d.layout.screens[k].name);
  }
  return list;
}

module.exports = { designs, PALETTES };
