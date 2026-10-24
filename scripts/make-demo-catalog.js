// Генерирует встроенный демо-каталог (catalog/) с превью в SVG.
// Демо-моды кладут безвредные текстовые файлы в res_mods/<версия>/modpack_demo/.
// Запуск: node scripts/make-demo-catalog.js
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'catalog');

const bg = (a, b, accent) => `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#ffffff" stroke-opacity="0.04"/></pattern>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/><rect width="640" height="360" fill="url(#grid)"/>
  <circle cx="320" cy="180" r="220" fill="url(#glow)"/>`;

const svg = (body, colors) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">${bg(...colors)}${body}</svg>\n`;

const tank = (x, y, s, fill) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}">
  <rect x="-120" y="20" width="240" height="34" rx="17"/>
  <polygon points="-110,20 110,20 96,-8 -96,-8"/>
  <rect x="-48" y="-40" width="96" height="34" rx="10"/>
  <rect x="40" y="-30" width="130" height="10" rx="4"/>
  <g fill="#000" fill-opacity="0.35">${[-90, -54, -18, 18, 54, 90].map((cx) => `<circle cx="${cx}" cy="37" r="11"/>`).join('')}</g>
</g>`;

const DEMOS = [
  {
    id: 'demo_sight_classic', name: 'Прицел «Классика»', category: 'crosshair', author: 'TankAir Studio',
    description: 'Минималистичный круглый прицел с точкой сведения и делениями дальности. Не перекрывает цель, хорошо читается на любых картах.',
    tags: ['прицел', 'минимализм'], conflicts: ['demo_sight_tactic'],
    colors: ['#141a1f', '#24201a', '#ffb547'],
    art: `<g stroke="#ffb547" stroke-width="3" fill="none">
      <circle cx="320" cy="180" r="78"/><circle cx="320" cy="180" r="118" stroke-dasharray="6 10" stroke-opacity="0.5"/>
      <path d="M320 70v60M320 230v60M210 180h60M370 180h60"/>
      ${[0, 1, 2, 3].map((i) => `<path d="M${338 + i * 14} 196v${8 + (i % 2) * 6}"/>`).join('')}
    </g><circle cx="320" cy="180" r="5" fill="#ffd27a"/>`,
  },
  {
    id: 'demo_sight_tactic', name: 'Прицел «Тактик»', category: 'crosshair', author: 'TankAir Studio',
    description: 'Шевронный прицел в стиле военных оптических систем. Цвет меняется при сведении. Несовместим с другими прицелами.',
    tags: ['прицел', 'шеврон'], conflicts: [],
    colors: ['#101a16', '#1b2420', '#6fe3a1'],
    art: `<g stroke="#6fe3a1" stroke-width="4" fill="none" stroke-linecap="round">
      <path d="M260 150l60 50 60-50"/><path d="M180 180h80M380 180h80" stroke-opacity="0.7"/>
      <path d="M300 240h40M290 260h60M280 280h80" stroke-opacity="0.5"/>
    </g><circle cx="320" cy="200" r="4" fill="#b8ffd5"/>`,
  },
  {
    id: 'demo_lamp', name: 'Лампа «Шестое чувство»', category: 'lamp', author: 'TankAir Studio',
    description: 'Крупная анимированная лампа засвета с таймером на 10 секунд и звуковым сигналом. Сразу видно, когда вас обнаружили.',
    tags: ['лампа', 'засвет', 'таймер'], conflicts: [],
    colors: ['#1d1610', '#2b1d12', '#ff9a2f'],
    art: `<circle cx="320" cy="160" r="110" fill="#ff9a2f" fill-opacity="0.12"/>
      <path d="M320 70a72 72 0 0 1 44 129c-10 8-14 18-14 30h-60c0-12-4-22-14-30a72 72 0 0 1 44-129z" fill="#ffb347"/>
      <rect x="290" y="236" width="60" height="14" rx="5" fill="#d07a28"/><rect x="296" y="254" width="48" height="12" rx="5" fill="#a85f1e"/>
      <text x="320" y="178" font-family="Segoe UI, Arial" font-size="64" font-weight="800" fill="#2b1d12" text-anchor="middle">6</text>
      <text x="320" y="320" font-family="Segoe UI, Arial" font-size="26" font-weight="700" fill="#ffd8a8" text-anchor="middle" letter-spacing="4">00:07</text>`,
    files: { 'lamp/lamp.ini': 'lamp=on\nsound=on\n', 'lamp/timer.ini': 'timer=10\n' },
  },
  {
    id: 'demo_zoom', name: 'Зум x30 и отдаление камеры', category: 'camera', author: 'TankAir Studio',
    description: 'Добавляет кратности x16, x25, x30 в снайперский режим и увеличивает отдаление камеры в аркадном режиме.',
    tags: ['зум', 'камера'], conflicts: [],
    colors: ['#121722', '#1d2433', '#6aa8ff'],
    art: `<circle cx="300" cy="170" r="92" fill="none" stroke="#6aa8ff" stroke-width="12"/>
      <path d="M368 238l70 70" stroke="#6aa8ff" stroke-width="22" stroke-linecap="round"/>
      <text x="300" y="192" font-family="Segoe UI, Arial" font-size="58" font-weight="800" fill="#cfe2ff" text-anchor="middle">x30</text>
      ${[16, 25].map((z, i) => `<text x="${500 + i * 0}" y="${110 + i * 50}" font-family="Segoe UI, Arial" font-size="28" font-weight="700" fill="#6aa8ff" fill-opacity="${0.5 + i * 0.2}" text-anchor="middle">x${z}</text>`).join('')}`,
  },
  {
    id: 'demo_markers', name: 'Маркеры с полосками ХП', category: 'markers', author: 'TankAir Studio',
    description: 'Компактные маркеры над танками: название, полоска прочности с числом ХП и иконка класса техники.',
    tags: ['маркеры', 'хп'], conflicts: [],
    colors: ['#1a1414', '#251a1a', '#ff6159'],
    art: [[130, 120, 0.8, '#ff6159', 'ИС-7', 1640], [330, 200, 0.6, '#ff6159', 'Т-62А', 640], [500, 110, 0.9, '#6fe3a1', 'Объект 140', 1850]]
      .map(([x, y, hp, c, n, v]) => `<g transform="translate(${x} ${y})">
        <text x="0" y="0" font-family="Segoe UI, Arial" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">${n}</text>
        <rect x="-70" y="10" width="140" height="16" rx="3" fill="#000" fill-opacity="0.5"/>
        <rect x="-70" y="10" width="${140 * hp}" height="16" rx="3" fill="${c}"/>
        <text x="0" y="23" font-family="Segoe UI, Arial" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${v}</text>
        <path d="M-8 40h16l-8 12z" fill="${c}"/></g>`).join('') + tank(330, 300, 0.7, '#3a2a2a'),
  },
  {
    id: 'demo_damage', name: 'Лог урона и ассиста', category: 'damage', author: 'TankAir Studio',
    description: 'Подробный журнал: нанесённый и полученный урон, урон по засвету и сбитым гусеницам, итог за бой.',
    tags: ['урон', 'лог', 'статистика'], conflicts: [],
    colors: ['#16141c', '#211d2b', '#c17ad6'],
    art: [['+430', 'ИС-7 · бронебойный', '#ffb547'], ['+390', 'Т-10 · подкалиберный', '#ffb547'], ['+210', 'Ассист по засвету', '#6aa8ff'], ['−320', 'Получено · E 100', '#ff6159'], ['+180', 'Ассист по гусенице', '#6fe3a1']]
      .map(([v, t, c], i) => `<g transform="translate(150 ${70 + i * 52})">
        <rect width="340" height="40" rx="8" fill="#000" fill-opacity="0.3"/><rect width="5" height="40" rx="2" fill="${c}"/>
        <text x="22" y="27" font-family="Segoe UI, Arial" font-size="20" font-weight="800" fill="${c}">${v}</text>
        <text x="100" y="26" font-family="Segoe UI, Arial" font-size="16" fill="#e6e1d6">${t}</text></g>`).join(''),
  },
  {
    id: 'demo_minimap', name: 'Расширенная миникарта', category: 'minimap', author: 'TankAir Studio',
    description: 'Круги обзора и отрисовки, последние позиции пропавших из засвета противников и направление стволов.',
    tags: ['миникарта', 'обзор'], conflicts: [],
    colors: ['#121a14', '#1a2418', '#9bc25a'],
    art: `<g transform="translate(180 40)"><rect width="280" height="280" rx="6" fill="#2a3a24" stroke="#9bc25a" stroke-opacity="0.6"/>
      <path d="M0 70h280M0 140h280M0 210h280M70 0v280M140 0v280M210 0v280" stroke="#000" stroke-opacity="0.25"/>
      <circle cx="110" cy="190" r="80" fill="none" stroke="#9bc25a" stroke-dasharray="5 6"/>
      <circle cx="110" cy="190" r="42" fill="none" stroke="#ffffff" stroke-opacity="0.6"/>
      <path d="M110 190l-36-70a80 80 0 0 1 72 0z" fill="#ffffff" fill-opacity="0.12"/>
      <rect x="104" y="184" width="12" height="12" fill="#6fe3a1"/>
      ${[[200, 60], [230, 110], [180, 40]].map(([x, y]) => `<rect x="${x}" y="${y}" width="11" height="11" fill="#ff6159"/>`).join('')}
      <rect x="150" y="130" width="11" height="11" fill="none" stroke="#ff6159" stroke-width="2"/></g>`,
  },
  {
    id: 'demo_hangar', name: 'Удобный ангар', category: 'hangar', author: 'TankAir Studio',
    description: 'Карусель техники в несколько рядов, процент отметок и опыт на каждой машине, быстрые фильтры.',
    tags: ['ангар', 'карусель'], conflicts: [],
    colors: ['#18181b', '#26231f', '#e8a33d'],
    art: `${tank(320, 150, 1, '#4a4436')}
      ${[0, 1, 2, 3, 4].map((i) => `<g transform="translate(${70 + i * 104} 250)"><rect width="92" height="70" rx="6" fill="#000" fill-opacity="0.35" stroke="${i === 2 ? '#e8a33d' : '#ffffff'}" stroke-opacity="${i === 2 ? 1 : 0.15}"/>
        <rect x="10" y="50" width="${30 + i * 10}" height="6" rx="3" fill="#e8a33d"/><text x="10" y="24" font-family="Segoe UI, Arial" font-size="13" font-weight="700" fill="#e6e1d6">${['Т-34', 'ИС-3', 'Об. 140', 'Т-10', 'КВ-2'][i]}</text></g>`).join('')}`,
  },
];

fs.rmSync(OUT, { recursive: true, force: true });
const mods = [];
for (const d of DEMOS) {
  const dir = path.join(OUT, 'mods', d.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'preview.svg'), svg(d.art, d.colors));
  const files = d.files || { [`${d.id}.txt`]: `Демо-мод «${d.name}». Безвредный текстовый файл для проверки установки.\n` };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, 'files', rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'files', rel), text);
  }
  const top = [...new Set(Object.keys(files).map((r) => r.split('/')[0]))];
  mods.push({
    id: d.id, name: `Демо: ${d.name}`, category: d.category, version: '1.0', author: d.author,
    description: `${d.description}\n\nЭто демонстрационный мод: он кладёт текстовый файл в res_mods/<версия>/modpack_demo/ и ничего не меняет в игре.`,
    tags: d.tags, conflicts: d.conflicts, preview: 'preview.svg',
    files: top.map((t) => ({ src: `files/${t}`, dst: `res_mods/{game_version}/modpack_demo/${d.category === 'crosshair' ? 'crosshair.txt' : t}` })),
  });
}
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify({ mods }, null, 2));
console.log(`Демо-каталог: ${mods.length} модов → ${OUT}`);
