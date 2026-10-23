// Прогон редактора оформления своего установщика со снимками (только для разработки).
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
  const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('нет ' + ${JSON.stringify(sel)}); el.click(); })()`);
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
  const preview = async () => {
    await wait(1200);
    await until('!IP.busy && IP.img && !IP.timer?._pending', 60000);
    await until('!IP.busy');
  };
  try {
    win.setSize(1500, 950);
    await wait(1500);
    await click('[data-act=demo-project]');
    await wait(1500);
    await click('[data-act=nav][data-page=design]');
    await until('!!IP.img || !!IP.error', 90000);
    await wait(500);
    await shot('40-design-default');
    console.log('ошибка предпросмотра:', await js('IP.error'));

    await click('[data-act=tpreset][data-id=steel]');
    await wait(1500);
    await until('!IP.busy', 60000);
    await shot('41-design-steel');

    await click('[data-act=tset][data-path=layout][data-val=list]');
    await click('[data-act=tset][data-path=nav][data-val=sidebar]');
    await wait(1500);
    await until('!IP.busy', 60000);
    await shot('42-design-list-sidebar');

    await click('[data-act=ip-screen][data-screen=finish]');
    await wait(800);
    await until('!IP.busy', 60000);
    await shot('43-design-finish');
    fs.writeFileSync(path.join(out, 'preview-mods.png'), Buffer.from((await js('IP.img')).split(',')[1], 'base64'));

    await click('[data-act=nav][data-page=build]');
    await click('[data-act=pset][data-val=github]');
    await js(`(() => { const t = document.querySelector('[data-pbind=repo]'); t.value = 'author/my-modpack'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('[data-act=build]');
    await until('!S.build.running', 180000);
    await shot('44-build-mps', 1000);
    const res = await js('S.build.result');
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ res, dir: await js('S.dir') }));
    console.log('результат:', JSON.stringify(res));
    console.log('ошибки консоли:', errors.length ? errors.join('\n') : 'нет');
  } catch (e) {
    console.log('СБОЙ:', e.message, '\n', errors.join('\n'));
    await shot('zz-fail').catch(() => {});
  }
  app.quit();
};
