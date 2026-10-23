// Рисует логотип и сохраняет build/icon.ico (16–256 px). Запуск: npx electron scripts/make-icon.js
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="256" height="256">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc061"/><stop offset="1" stop-color="#e2741f"/></linearGradient></defs>
  <path d="M20 1.5 37 11v18L20 38.5 3 29V11z" fill="url(#lg)"/>
  <g fill="#1a1308"><rect x="9" y="22" width="22" height="6" rx="3"/><path d="M11 22h18l-2-4H13z"/><rect x="15" y="14" width="10" height="5" rx="1.5"/><rect x="24" y="15.5" width="9" height="2" rx="1"/></g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, transparent: true, frame: false, useContentSize: true });
  await win.loadURL(`data:text/html,<body style="margin:0;background:transparent">${encodeURIComponent(SVG)}</body>`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => (s === 256 ? img : img.resize({ width: s, height: s, quality: 'best' })).toPNG());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const o = 6 + i * 16;
    header.writeUInt8(s === 256 ? 0 : s, o); header.writeUInt8(s === 256 ? 0 : s, o + 1);
    header.writeUInt16LE(1, o + 4); header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(pngs[i].length, o + 8); header.writeUInt32LE(offset, o + 12);
    offset += pngs[i].length;
  });
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...pngs]));
  fs.writeFileSync(path.join(out, 'icon.png'), pngs[pngs.length - 1]);
  console.log('build/icon.ico готов');
  app.quit();
});
