// Прогон новой оболочки студии: обзор, витрина, Ctrl+K, сборка, темы (только для разработки).
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function run(win, app) {
  const out = process.env.MPS_SHOT_DIR;
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(msg); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
  const until = async (expr, ms = 60000) => {
    for (let t = 0; t < ms; t += 250) {
      if (await js(expr)) return;
      await wait(250);
    }
    throw new Error(`не дождался: ${expr}`);
  };
  const shot = async (name, ms = 700) => {
    await wait(ms);
    fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    console.log('снимок', name);
  };
  const nav = (page) => js(`document.querySelector('[data-act=nav][data-page=${page}]').click()`);
  const theme = (id) => js(`setTheme('${id}')`);
  try {
    win.setSize(1440, 900);
    await wait(1500);
    await shot('80-home');
    await js(`document.querySelector('[data-act=demo-project]').click()`);
    await until('S.page === "overview" && !!document.querySelector(".ov-hero")');
    await shot('81-overview', 1200);

    await nav('tree');
    await js(`document.querySelector('[data-act=tree-view][data-view=cards]').click()`);
    await until('!!document.querySelector(".mcard")');
    await js(`document.querySelectorAll('.mcard')[1].click()`);
    await shot('82-showcase', 1200);

    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
    await until('!!document.querySelector("#pal-input")');
    await shot('83-palette-empty', 500);
    await js(`(() => { const i = document.querySelector('#pal-input'); i.value = 'при'; i.dispatchEvent(new Event('input')); })()`);
    await shot('84-palette-query', 500);
    await js(`document.querySelector('#pal-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await wait(600);
    console.log('после Enter в палитре: страница', await js('S.page'), 'выбран', await js('selected()?.node.name'));

    await nav('build');
    await until('!!document.querySelector("#build-card")');
    await shot('85-build-before', 800);
    await js(`document.querySelector('[data-act=build]').click()`);
    await until('S.build.running && S.build.stage >= 1', 30000);
    await shot('86-build-running', 300);
    await until('!S.build.running && !!S.build.result', 240000);
    await shot('87-build-done', 500);

    await theme('neon');
    await nav('overview');
    await shot('88-overview-neon', 1200);
    await theme('light');
    await shot('89-overview-light', 1200);
    await nav('build');
    await shot('90-build-light', 1000);
    await nav('design');
    await until('!!document.querySelector("#ce-stage .ce-el")', 60000);
    await shot('91-design-light', 1500);
    await theme('steel');
    await js(`document.querySelector('[data-act=studio-look]').click()`);
    await until('!!document.querySelector(".look-grid")');
    await shot('92-look-dialog', 700);
    await js(`document.querySelector('.modal-back .m-foot .btn').click()`);
    await theme('tactic');
    console.log('ошибки консоли:', errors.length ? errors.join('\n') : 'нет');
  } catch (e) {
    console.log('СБОЙ:', e.message, '\n', errors.join('\n'));
    await shot('zz-fail').catch(() => {});
  }
  app.quit();
};
