// Прогон интерфейса конструктора со снимками экрана (только для разработки).
// MPS_DEV_SCRIPT=tests/ui-shots.js MPS_USER_DATA=<tmp> MPS_DOCS=<tmp> MPS_SHOT_DIR=<dir> MPS_CATALOG_URL=<index.json> electron .
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
  const until = async (expr, ms = 30000) => {
    for (let t = 0; t < ms; t += 250) {
      if (await js(expr)) return;
      await wait(250);
    }
    throw new Error(`не дождался: ${expr}`);
  };
  const shot = async (name, ms = 900) => {
    await wait(ms);
    fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    console.log('снимок', name);
  };
  try {
    win.setSize(1400, 900);
    await wait(1500);
    await click('[data-act=demo-project]');
    await wait(1500);

    await click('[data-act=nav][data-page=catalog]');
    await until('S.cat.data && document.querySelectorAll(".card").length > 0');
    await shot('20-catalog', 1500);
    await js(`document.querySelector('.card[data-id=demo_lamp]').click()`);
    await shot('21-catalog-detail', 1200);
    await js(`document.querySelector('.modal-back .m-foot button').click()`);
    await click('[data-act=cat-add][data-id=demo_lamp]');
    await until('!Object.keys(S.cat.busy).length');
    await shot('22-catalog-added', 900);
    // мод из каталога «устарел» — должна появиться кнопка обновления
    await js(`(() => { for (const { node } of walk(S.proj.tree)) if (node.catalogId === 'demo_lamp') node.catalogVersion = '0.9'; renderSidebar(); renderPage(); })()`);
    await shot('23-catalog-update', 900);
    await click('[data-act=cat-update][data-id=demo_lamp]');
    await until('!Object.keys(S.cat.busy).length');

    await click('[data-act=nav][data-page=tree]');
    await js(`ACTIONS.select([...document.querySelectorAll('#tree .tnode.mod')].pop())`);
    await shot('24-tree-catalog-mod', 1200);

    await click('[data-act=nav][data-page=design]');
    await shot('25-design-dark', 2000);
    await click('[data-act=mock-tab][data-tab=changelog]');
    await shot('26-design-changelog-empty', 1500);

    await click('[data-act=nav][data-page=build]');
    await js(`(() => { const t = document.querySelector('[data-clbind]'); t.value = '• Первый выпуск модпака\\n• Прицелы на выбор\\n• Лампа из онлайн-каталога'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('[data-act=build]');
    await until('!S.build.running', 120000);
    await click('[data-act=bump][data-kind=minor]');
    await wait(500);
    await click('.modal-back .m-foot .btn.primary');
    await wait(500);
    await js(`(() => { const t = document.querySelector('[data-clbind]'); t.value = '• Обновлена лампа\\n• Новая тема установщика'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('[data-act=build]');
    await until('!S.build.running', 120000);
    await shot('27-build-history', 1000);

    await click('[data-act=nav][data-page=design]');
    await click('[data-act=mock-tab][data-tab=changelog]');
    await shot('28-design-changelog', 1800);

    await click('[data-act=app-settings]');
    await shot('29-app-settings', 900);
    await js(`document.querySelector('.modal-back .m-foot button').click()`);

    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ res: await js('S.build.result'), dir: await js('S.dir') }));
    console.log('сборок в истории:', await js('S.builds.length'));
    console.log('ошибки консоли:', errors.length ? errors.join('\n') : 'нет');
  } catch (e) {
    console.log('СБОЙ:', e.message, '\n', errors.join('\n'));
    await shot('zz-fail').catch(() => {});
  }
  app.quit();
};
