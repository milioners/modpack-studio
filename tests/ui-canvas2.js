// Прогон новых возможностей редактора оформления (только для разработки).
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
  const add = (type, patch) => js(`(() => { ACTIONS['ce-add']({ dataset: { type: '${type}' } }); const e = selected1(); Object.assign(e, ${JSON.stringify(patch.el || {})}); Object.assign(e.props, ${JSON.stringify(patch.props || {})}); changed({ tree: false }); ceRender(); return e.id; })()`);
  try {
    win.setSize(1680, 1000);
    await wait(1500);
    await js(`document.querySelector('[data-act=demo-project]').click()`);
    await wait(1500);
    await js(`document.querySelector('[data-act=nav][data-page=design]').click()`);
    await until('!!document.querySelector("#ce-stage .ce-el")');

    // галерея: применяем «Неон»
    await js(`document.querySelector('[data-act=ce-gallery]').click()`);
    await until('document.querySelectorAll(".ce-gal").length === 8');
    await shot('60-gallery', 900);
    await js(`document.querySelectorAll('.ce-gal')[3].click(); document.querySelector('.modal-back .m-foot .btn.primary').click()`);
    await until('S.proj.installer.preset === "neon"');

    // новые блоки на приветствии
    const imgs = await js(`allMods().map((m) => m.preview).filter(Boolean).slice(0, 4)`);
    await add('slider', { el: { x: 620, y: 300, w: 420, h: 236 }, props: { images: imgs, interval: 3 } });
    await add('social', { el: { x: 60, y: 620, w: 200, h: 44 }, props: { links: [{ kind: 'discord', url: 'https://example.com/d' }, { kind: 'telegram', url: 'https://t.me/x' }, { kind: 'youtube', url: 'https://youtube.com' }, { kind: 'vk', url: 'https://vk.com' }] } });
    const s1 = await add('stat', { el: { x: 620, y: 560, w: 140, h: 80 }, props: { value: '{modsCount}', label: 'модов' } });
    const s2 = await add('stat', { el: { x: 780, y: 560, w: 140, h: 80 }, props: { value: '{size}', label: 'размер', valueSize: 30 } });
    const s3 = await add('stat', { el: { x: 960, y: 560, w: 100, h: 80 }, props: { value: '{version}', label: 'версия', valueSize: 30 } });
    // группа и распределение
    await js(`CE.sel = [${JSON.stringify(s1)}, ${JSON.stringify(s2)}, ${JSON.stringify(s3)}]; ACTIONS['ce-group'](); ACTIONS['ce-distribute']({ dataset: { axis: 'x' } })`);
    const xs = await js(`[${JSON.stringify(s1)}, ${JSON.stringify(s2)}, ${JSON.stringify(s3)}].map((id) => byId(id)).map((e) => [e.x, e.w])`);
    console.log('распределение:', JSON.stringify(xs));
    // анимация заголовка
    await js(`(() => { const e = els().find((x) => x.name === 'Заголовок'); e.anim = { in: 'pop', delay: 100, duration: 600, loop: 'none' }; e.props.fill2 = '@accent'; CE.sel = [e.id]; changed({ tree: false }); ceRender(); })()`);
    await shot('61-canvas-new-blocks', 1200);

    // набор модов и соглашение — на экране выбора модов
    await js(`S.proj.presets.push({ id: 'pmin', name: 'Минимальный', mods: allMods().slice(0, 2).map((m) => m.id) })`);
    await js(`document.querySelector('[data-act=ce-screen][data-screen=mods]').click()`);
    await add('presets', { el: { x: 24, y: 72, w: 600, h: 40 } });
    await js(`(() => { const l = els().find((e) => e.type === 'modlist'); l.y = 120; l.h -= 40; changed({ tree: false }); ceRender(); })()`);
    await shot('62-canvas-presets', 1000);

    // свой экран
    await js(`(() => { ceSnap(); const k = 'custom_test'; lay().screens[k] = JSON.parse(JSON.stringify(lay().screens.finish)); lay().screens[k].name = 'О модпаке'; CE.screen = k; ceCommit(); })()`);
    await add('license', { el: { x: 290, y: 140, w: 520, h: 220 } });
    await shot('63-canvas-custom-screen', 900);

    // масштаб и автопроверка
    await js(`CE.zoom = 1; CE.screen = 'welcome'; ceRender()`);
    await shot('64-canvas-zoom100', 900);
    await js(`CE.zoom = 'fit'; ceRender(); document.querySelector('[data-act=ce-live]').click()`);
    await until('!!CE.liveImg && !CE.liveBusy', 90000);
    await shot('65-canvas-live', 900);
    fs.writeFileSync(path.join(out, 'real-welcome.png'), Buffer.from((await js('CE.liveImg')).split(',')[1], 'base64'));

    // настоящий снимок экрана выбора модов и своего экрана
    for (const sc of ['mods', 'custom_test']) {
      const img = await js(`(async () => (await window.api.installerSnapshot(S.proj, await mpsAssets(S.proj), '${sc}')).data)()`);
      if (img) fs.writeFileSync(path.join(out, `real-${sc}.png`), Buffer.from(img.split(',')[1], 'base64'));
      else console.log('нет снимка', sc);
    }
    console.log('ошибки консоли:', errors.length ? errors.join('\n') : 'нет');
  } catch (e) {
    console.log('СБОЙ:', e.message, '\n', errors.join('\n'));
    await shot('zz-fail').catch(() => {});
  }
  app.quit();
};
