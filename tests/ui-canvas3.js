// Прогон галереи готовых дизайнов и удаления своего экрана (только для разработки).
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
  const real = async (name, sc) => {
    const img = await js(`(async () => (await window.api.installerSnapshot(S.proj, await mpsAssets(S.proj), '${sc}')).data)()`);
    if (img) fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(img.split(',')[1], 'base64'));
    else console.log('нет снимка', name);
  };
  try {
    win.setSize(1680, 1000);
    await wait(1500);
    await js(`document.querySelector('[data-act=demo-project]').click()`);
    await wait(1500);
    await js(`document.querySelector('[data-act=nav][data-page=design]').click()`);
    await until('!!document.querySelector("#ce-stage .ce-el")');

    await js(`document.querySelector('[data-act=ce-gallery]').click()`);
    await until('document.querySelectorAll(".ce-gal").length === 8');
    await shot('70-gallery', 900);
    await js(`document.querySelector('.modal-back .m-foot .btn').click()`);
    await wait(500);

    const list = await js('call(api.layoutDesigns)');
    for (let i = 0; i < list.length; i++) {
      await js(`document.querySelector('[data-act=ce-gallery]').click()`);
      await until('document.querySelectorAll(".ce-gal").length === 8');
      await js(`document.querySelectorAll('.ce-gal')[${i}].click(); document.querySelector('.modal-back .m-foot .btn.primary').click()`);
      await until(`S.proj.installer.radius === ${list[i].radius} && Object.keys(lay().screens).length === ${Object.keys(list[i].layout.screens).length}`);
      const scr = await js(`screenList().join(',')`);
      console.log(list[i].id, '→ экраны в редакторе:', scr);
      const first = await js('CE.screen');
      await real(`real-${list[i].id}-${first}`, first);
      for (const k of Object.keys(list[i].layout.screens).filter((k) => k.startsWith('custom_'))) await real(`real-${list[i].id}-${k}`, k);
    }
    // последний — «Светлый» без своих экранов; берём «Неон-аркаду» и удаляем «Авторы» крестиком
    const ai = list.findIndex((d) => d.id === 'arcade');
    await js(`document.querySelector('[data-act=ce-gallery]').click()`);
    await until('document.querySelectorAll(".ce-gal").length === 8');
    await js(`document.querySelectorAll('.ce-gal')[${ai}].click(); document.querySelector('.modal-back .m-foot .btn.primary').click()`);
    await until('!!lay().screens.custom_authors');
    await js(`document.querySelector('[data-act=ce-screen][data-screen=custom_about]').click()`);
    await shot('71-arcade-about', 900);
    await js(`document.querySelector('.ce-scr-del[data-screen=custom_authors]').click()`);
    await wait(500);
    await shot('72-delete-confirm', 300);
    await js(`document.querySelector('.modal-back .m-foot .btn.danger, .modal-back .m-foot .btn.primary').click()`);
    await until('!lay().screens.custom_authors');
    const dangling = await js(`Object.values(lay().screens).flatMap((s) => s.elements).filter((e) => e.props.action === 'go:custom_authors').length`);
    console.log('после удаления: экраны', await js(`screenList().join(',')`), '| висячих кнопок:', dangling, '| текущий:', await js('CE.screen'));
    await js('ceUndo(false)');
    await wait(300);
    console.log('после Ctrl+Z экран вернулся:', await js('!!lay().screens.custom_authors'));
    await shot('73-after-undo', 600);
    console.log('ошибки консоли:', errors.length ? errors.join('\n') : 'нет');
  } catch (e) {
    console.log('СБОЙ:', e.message, '\n', errors.join('\n'));
    await shot('zz-fail').catch(() => {});
  }
  app.quit();
};
