// Прогон визуального редактора окна установщика (только для разработки).
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
  // настоящий ввод мышью через Chromium
  const mouse = async (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  try {
    win.setSize(1600, 980);
    await wait(1500);
    await js(`document.querySelector('[data-act=demo-project]').click()`);
    await wait(1500);
    await js(`document.querySelector('[data-act=nav][data-page=design]').click()`);
    await until('!!document.querySelector("#ce-stage .ce-el")');
    await shot('50-canvas-welcome', 1200);

    // перетаскивание заголовка мышью
    const title = await js(`(() => { const e = els().find((x) => x.name === 'Заголовок'); const r = document.querySelector('[data-ce-el="' + e.id + '"]').getBoundingClientRect(); return { id: e.id, x: e.x, y: e.y, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
    await mouse('mouseDown', title.cx, title.cy);
    for (let i = 1; i <= 10; i++) { await mouse('mouseMove', title.cx + i * 12, title.cy - i * 9); await wait(16); }
    await shot('51-canvas-dragging', 50);
    await mouse('mouseUp', title.cx + 120, title.cy - 90);
    await wait(300);
    const moved = await js(`(() => { const e = byId(${JSON.stringify(title.id)}); return { x: e.x, y: e.y }; })()`);
    console.log('заголовок сдвинут:', title.x, title.y, '→', moved.x, moved.y);

    // новая кнопка-ссылка
    await js(`ACTIONS['ce-add']({ dataset: { type: 'button' } })`);
    await js(`(() => { const e = selected1(); e.props.label = 'Наш Discord'; e.props.action = 'url'; e.props.url = 'https://example.com'; e.props.fill = '#5865F2'; e.props.color = '#FFFFFF'; e.x = 60; e.y = 620; e.w = 200; changed({ tree: false }); ceRender(); })()`);
    await shot('52-canvas-button-props', 800);

    await js(`document.querySelector('[data-act=ce-screen][data-screen=mods]').click()`);
    await shot('53-canvas-mods', 1200);

    // шаблон «Большой фон», затем отмена Ctrl+Z
    await js(`(async () => { ceSnap(); S.proj.installer.layout = (await window.api.layoutTemplate('hero')).data; CE.sel = []; ceCommit(); })()`);
    await js(`document.querySelector('[data-act=ce-screen][data-screen=welcome]').click()`);
    await shot('54-canvas-hero', 1200);
    const tplBefore = await js('lay().template');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] });
    await wait(500);
    console.log('шаблон:', tplBefore, '→ после Ctrl+Z:', await js('lay().template'), '| кнопка Discord на месте:', await js(`!!lay().screens.welcome.elements.find((e) => e.props.label === 'Наш Discord')`));

    await js(`document.querySelector('[data-act=ce-real]').click()`);
    await until('!!document.querySelector("#ce-real-shot img")', 90000);
    await shot('55-real-window', 800);
    fs.writeFileSync(path.join(out, 'real-welcome.png'), Buffer.from((await js(`document.querySelector('#ce-real-shot img').src`)).split(',')[1], 'base64'));
    await js(`document.querySelector('.modal-back .m-foot button').click()`);

    console.log('ошибки консоли:', errors.length ? errors.join('\n') : 'нет');
  } catch (e) {
    console.log('СБОЙ:', e.message, '\n', errors.join('\n'));
    await shot('zz-fail').catch(() => {});
  }
  app.quit();
};
