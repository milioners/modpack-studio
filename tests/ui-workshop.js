// Прогон Мастерской модов в окне студии (только для разработки): новый мод, редактор, превью,
// сборка, справочник игры с перехватом метода, отладчик. Мод в игру не ставится.
//   MPS_DEV_SCRIPT=tests/ui-workshop.js MPS_USER_DATA=<временная папка> MPS_SHOT_DIR=<папка снимков> electron .
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
  const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
  try {
    win.setSize(1440, 900);
    await wait(1500);
    await shot('w0-home');
    await click('[data-act=nav][data-page=workshop]');
    await until('S.page === "workshop" && !!document.querySelector(".ws-mods")');
    await shot('w1-list', 900);

    await click('.ws-mod.new');
    await until('!!document.querySelector(".tpl-grid")');
    await js(`(() => { const n = document.querySelector('[name=name]'); n.value = 'Счётчик сессии'; n.dispatchEvent(new Event('input')); })()`);
    await shot('w2-new', 600);
    await js(`[...document.querySelectorAll('.m-foot button')].find((b) => /Создать/.test(b.textContent)).click()`);
    await until('WS.view === "editor" && !!document.querySelector("#ed-ta")');
    await shot('w3-editor', 900);

    await click('[data-act=ed-preview]');
    await until('!!WS.preview', 30000);
    await shot('w4-preview', 600);

    // ошибка в коде: подсветка строки и проверка Python 2.7
    await js(`(() => { const t = document.querySelector('#ed-ta'); t.value = t.value.replace('def _show():', 'def _show()'); t.dispatchEvent(new Event('input')); })()`);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))`);
    await until('WS.errors.length > 0', 30000);
    await shot('w5-error', 600);
    await js(`(() => { const t = document.querySelector('#ed-ta'); t.value = t.value.replace('def _show()\\n', 'def _show():\\n'); t.dispatchEvent(new Event('input')); })()`);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))`);
    await until('WS.errors.length === 0 && WS.text === WS.saved', 30000);

    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))`);
    await until('WS.view === "build" && WS.build && !WS.build.running', 120000);
    console.log('сборка:', await js('JSON.stringify(WS.build.result || WS.build.error)'));
    await shot('w6-build', 600);

    await click('[data-act=nav][data-page=gameref]');
    await until('S.page === "gameref"');
    await shot('w7-ref-empty', 600);
    if (await js('!!document.querySelector("[data-act=ref-build]") && !WS.st.ref.ready')) {
      await click('[data-act=ref-build]');
      await until('WS.st.ref.ready && !!document.querySelector("#ref-q")', 180000);
    }
    await js(`(() => { const q = document.querySelector('#ref-q'); q.value = 'BattleResultsMeta'; q.dispatchEvent(new Event('input')); })()`);
    await until('WS.ref.hits.length > 0', 20000);
    await click('[data-act=ref-pick][data-i="0"]');
    await until('!!WS.ref.detail');
    await shot('w8-ref', 600);
    await js(`[...document.querySelectorAll('[data-act=ref-intercept]')].find((b) => b.dataset.method === 'as_setDataS').click()`);
    await until('WS.view === "editor" && WS.text.includes("_on_as_setDataS")', 30000);
    await js(`(() => { const t = document.querySelector('#ed-ta'); const i = t.value.indexOf('def _on_as_setDataS'); const line = t.value.slice(0, i).split('\\n').length; t.scrollTop = Math.max(0, (line - 6) * 20.6); t.dispatchEvent(new Event('scroll')); })()`);
    await shot('w9-intercept', 700);

    await click('[data-act=nav][data-page=debug]');
    await until('S.page === "debug" && !!document.querySelector("#dbg-log")');
    await click('[data-act=dbg-mine][data-v="0"]');
    await shot('w10-debug', 1500);

    await click('[data-act=nav][data-page=workshop]');
    await until('!!document.querySelector(".ws-mods")');
    await shot('w11-list-after', 900);
    console.log('ошибки консоли:', errors.length ? errors.join(' | ') : 'нет');
  } catch (e) {
    console.log('СБОЙ:', e.message);
    console.log('ошибки консоли:', errors.join(' | '));
    await shot('w-fail', 100);
  }
  app.quit();
};
