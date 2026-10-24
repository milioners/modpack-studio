// Оболочка TankAir Studio: темы и обои студии, «Обзор» проекта, витрина модов,
// командная палитра Ctrl+K и окно «Оформление студии».
'use strict';

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* без памяти вида */ } },
};
S.view = store.get('tankair.view', 'list');

// ---------- темы и обои ----------

const STUDIO_THEMES = [
  ['tactic', 'Тактика', ['#0e0f12', '#17191d', '#f0a53a']],
  ['steel', 'Сталь', ['#0d1117', '#1c2330', '#4f9be8']],
  ['khaki', 'Хаки', ['#11130e', '#22261c', '#a3b55a']],
  ['neon', 'Неон', ['#0c0a14', '#1d1734', '#b06cff']],
  ['light', 'Светлая', ['#eeece7', '#ffffff', '#e2741f']],
  ['pack', 'Цвет модпака', ['#0e0f12', '#17191d', null]],
  ['auto', 'Как в Windows', ['#0e0f12', '#ffffff', '#f0a53a']],
];
const uiSettings = () => ({ theme: 'tactic', wallpaper: 'gradient', glass: true, scale: 100, animations: true, ...(S.st?.app?.ui || {}) });
const packAccent = () => S.proj?.installer?.colors?.accent || S.proj?.design?.accent || '#f0a53a';
let appliedZoom = 1;
let wallKey = '';

function applyUi(ui = uiSettings()) {
  const root = document.documentElement;
  let theme = ui.theme;
  if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'tactic';
  if (theme === 'tactic' || theme === 'pack') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
  if (ui.theme === 'pack') root.style.setProperty('--accent', packAccent());
  else root.style.removeProperty('--accent');
  root.classList.toggle('glass', !!ui.glass);
  root.classList.toggle('no-anim', !ui.animations);
  const z = Math.max(0.8, Math.min(1.4, (Number(ui.scale) || 100) / 100));
  if (z !== appliedZoom && api.setZoom) { api.setZoom(z); appliedZoom = z; }
  paintWall(ui.wallpaper);
}

// Обои: градиент темы, размытый баннер модпака или ровный фон
async function paintWall(mode) {
  const wall = $('#wall');
  if (!wall) return;
  const rel = S.proj ? S.proj.design.bannerImage || S.proj.installer?.backgroundImage : null;
  const key = `${mode}|${rel}`;
  if (key === wallKey) return;
  wallKey = key;
  wall.className = mode === 'none' ? 'plain' : 'grad';
  wall.innerHTML = '';
  if (mode === 'banner' && rel) {
    const url = await getImg(rel);
    if (url && wallKey === key) {
      wall.className = 'img';
      wall.innerHTML = `<img src="${url}" alt="">`;
    }
  }
}

// ---------- окно «Оформление студии» ----------

async function studioLookDialog() {
  const before = uiSettings();
  const ui = { ...before };
  const tile = ([id, name, [bg, s, a]]) => `<button class="look-tile ${ui.theme === id ? 'on' : ''}" data-theme-id="${id}">
      <div class="lt-mini" style="background:${id === 'auto' ? 'linear-gradient(135deg,#0e0f12 50%,#eeece7 50%)' : bg}"><i style="background:${s};box-shadow:inset 3px 0 0 ${a || packAccent()}"></i>
        <div style="background:${s}"><em style="width:62%;background:${a || packAccent()}"></em><em style="width:86%"></em><em style="width:44%"></em><em class="b" style="background:${a || packAccent()}"></em></div></div>
      <span>${name}</span></button>`;
  const seg = (key, opts) => `<div class="segmented" data-seg="${key}">${opts.map(([v, l]) => `<button class="${String(ui[key]) === String(v) ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const r = await modal({
    title: 'Оформление студии', sub: 'Меняется сразу. Влияет только на TankAir Studio, не на установщики модпаков.', ic: 'brush', wide: true,
    body: `<div class="look-grid">${STUDIO_THEMES.map(tile).join('')}</div>
      <div class="look-rows">
        <div class="look-row"><div><b>Обои</b><small>Фон окна студии под панелями</small></div>${seg('wallpaper', [['gradient', 'Градиент темы'], ['banner', 'Баннер модпака'], ['none', 'Без обоев']])}</div>
        <div class="look-row"><div><b>Стеклянные панели</b><small>Полупрозрачные панели с размытием, сквозь них видны обои</small></div><label class="toggle"><input type="checkbox" data-k="glass" ${ui.glass ? 'checked' : ''}><span class="track"></span></label></div>
        <div class="look-row"><div><b>Размер интерфейса</b><small id="look-scale">${ui.scale}%</small></div><input type="range" class="look-range" min="80" max="130" step="5" value="${ui.scale}" data-k="scale"></div>
        <div class="look-row"><div><b>Анимации</b><small>Плавное появление разделов, карточек и конфетти после сборки</small></div><label class="toggle"><input type="checkbox" data-k="animations" ${ui.animations ? 'checked' : ''}><span class="track"></span></label></div>
      </div>`,
    actions: [{ label: 'Отмена', value: null }, { label: 'Сохранить', value: 'ok', primary: true }],
    onMount: (root) => {
      const live = () => { wallKey = ''; applyUi(ui); };
      root.querySelectorAll('[data-theme-id]').forEach((b) => b.addEventListener('click', () => {
        ui.theme = b.dataset.themeId;
        root.querySelectorAll('[data-theme-id]').forEach((x) => x.classList.toggle('on', x === b));
        live();
      }));
      root.querySelectorAll('[data-seg] button').forEach((b) => b.addEventListener('click', () => {
        ui[b.parentElement.dataset.seg] = b.dataset.v;
        b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        live();
      }));
      root.querySelectorAll('input[data-k]').forEach((inp) => inp.addEventListener('input', () => {
        ui[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
        if (inp.dataset.k === 'scale') root.querySelector('#look-scale').textContent = `${inp.value}%`;
        live();
      }));
    },
  });
  wallKey = '';
  if (!r) { applyUi(before); return; }
  S.st = await call(api.appSettings, { ui });
  applyUi();
  toast('ok', 'Оформление студии сохранено');
}

// ---------- что сделать дальше ----------

// Подсказки для «Обзора» и карточки внизу боковой панели — по реальному состоянию проекта
function nextSteps() {
  if (!S.proj) return [];
  const out = [];
  const v = S.proj.info.version;
  const mods = allMods();
  const built = (S.builds || []).some((b) => b.version === v);
  const cl = S.proj.changelog.find((e) => e.version === v);
  const errs = S.check.errors;
  if (errs.length) out.push({ kind: 'bad', ic: 'alert', title: `${errs.length} ${plural(errs.length, 'ошибка мешает', 'ошибки мешают', 'ошибок мешают')} сборке`, text: errs[0], act: 'nav', attrs: 'data-page="build"', btn: 'Открыть' });
  if (!mods.length) out.push({ kind: 'info', ic: 'import', title: 'Добавьте моды', text: '.mtmod, .wotmod, архивы или папки — либо из онлайн-каталога', act: 'add-files', btn: 'Добавить' });
  const upd = typeof catalogUpdatesCount === 'function' ? catalogUpdatesCount() : 0;
  if (upd) out.push({ kind: 'warn', ic: 'refresh', title: `Авторы обновили ${nMods(upd)}`, text: 'Новые версии уже в онлайн-каталоге', act: 'nav', attrs: 'data-page="catalog"', btn: 'Обновить' });
  if (mods.length && !errs.length && !built) out.push({ kind: 'accent', ic: 'build', title: `Соберите версию ${v}`, text: 'Получится один .exe для игроков', act: 'nav', attrs: 'data-page="build"', btn: 'Собрать' });
  if (mods.length && !cl?.text.trim()) out.push({ kind: 'info', ic: 'edit', title: `Опишите, что нового в ${v}`, text: 'Игроки увидят это в установщике', act: 'nav', attrs: 'data-page="build"', btn: 'Написать' });
  const noPrev = mods.filter((m) => !m.preview).length;
  if (noPrev) out.push({ kind: 'info', ic: 'image', title: `${nMods(noPrev)} без превью`, text: 'В установщике будет нарисованная заглушка', act: 'nav', attrs: 'data-page="tree"', btn: 'Открыть' });
  const noDesc = mods.filter((m) => !m.description.trim()).length;
  if (noDesc) out.push({ kind: 'info', ic: 'info', title: `${nMods(noDesc)} без описания`, text: 'Игроку будет непонятно, что делает мод', act: 'nav', attrs: 'data-page="tree"', btn: 'Открыть' });
  if (typeof isMps === 'function' && isMps() && S.proj.publish.type === 'none' && mods.length) out.push({ kind: 'info', ic: 'upload', title: 'Включите обновления у игроков', text: 'Кнопка «Обновить модпак» в установщике', act: 'goto-publish', btn: 'Настроить' });
  if (built && !errs.length) out.push({ kind: 'ok', ic: 'installed', title: `Версия ${v} собрана`, text: 'Для следующих изменений начните новую версию', act: 'bump', attrs: 'data-kind="minor"', btn: `Начать ${bump(v, 'minor')}` });
  for (const w of S.check.warnings.slice(0, 2)) out.push({ kind: 'warn', ic: 'info', title: 'Замечание', text: w, act: 'nav', attrs: 'data-page="build"', btn: 'Открыть' });
  return out;
}

// ---------- обзор проекта ----------

function tankArt() {
  return `<svg class="tank-art" viewBox="0 0 400 200" aria-hidden="true"><defs><linearGradient id="ta-g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent-2)" stop-opacity=".95"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".35"/></linearGradient></defs>
    <path fill="url(#ta-g)" d="M40 150h330l-25 38H70zM90 110h200l40 36H60zM150 78h110v34H150zM255 88h130v12H255z"/>
    <g fill="rgba(0,0,0,.45)"><circle cx="100" cy="168" r="14"/><circle cx="145" cy="170" r="14"/><circle cx="190" cy="170" r="14"/><circle cx="235" cy="170" r="14"/><circle cx="280" cy="170" r="14"/><circle cx="322" cy="168" r="14"/></g></svg>`;
}

function spark(values, cls = '') {
  if (values.length < 2) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => [(i * 100) / (values.length - 1), 34 - ((v - min) / (max - min || 1)) * 30]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return `<svg class="spark ${cls}" viewBox="0 0 100 36" preserveAspectRatio="none"><path class="a" d="${line} L100 36 L0 36Z"/><path class="l" d="${line}"/></svg>`;
}

function pageOverview() {
  const p = S.proj;
  const st = S.stats;
  const builds = [...(S.builds || [])].reverse();
  const last = (S.builds || [])[0];
  const built = (S.builds || []).some((b) => b.version === p.info.version);
  const steps = nextSteps();
  const versions = [...p.changelog].sort((a, b) => (cmpVer ? cmpVer(b.version, a.version) : 0)).slice(0, 5);
  if (!versions.some((e) => e.version === p.info.version)) versions.unshift({ version: p.info.version, text: '', date: null });
  const mods = allMods();
  return `<div class="ov">
    <div class="ov-hero" id="ov-hero"><div class="ov-hero-bg" id="ov-hero-bg"></div>${tankArt()}
      <div class="ov-chips">${built ? `<span class="chip ok">${icon('check', 11)}Собран</span>` : '<span class="chip warn">Черновик</span>'}<span class="chip glass">v${esc(p.info.version)}${p.info.gameVersion ? ` · для игры ${esc(p.info.gameVersion)}` : ''}</span></div>
      <h1>${esc(p.info.name)}</h1>
      <p>${esc(p.info.description || 'Добавьте описание модпака в «Сведениях» — его увидят игроки.')}</p>
      <div class="ov-acts"><button class="btn primary big" data-act="nav" data-page="build">${icon('build', 17)}Собрать ${esc(p.info.version)}</button>
        <button class="btn big glass" data-act="preview-or-open">${icon('play', 15)}Проверить установщик</button>
        <button class="btn big glass" data-act="nav" data-page="design">${icon('brush', 15)}Оформление</button></div>
      <div class="ov-badge"><b>${st.mods}</b>${plural(st.mods, 'мод', 'мода', 'модов')} в модпаке</div>
    </div>
    <div class="ov-stats">
      <div class="panel ov-stat"><small>Модов</small><b>${st.mods}</b><em>${st.groups} ${plural(st.groups, 'группа', 'группы', 'групп')}</em>${spark(builds.map((b) => b.mods || 0), 'ok')}</div>
      <div class="panel ov-stat"><small>Размер модов</small><b>${fmtSize(st.size)}</b><em>${st.files} ${plural(st.files, 'файл', 'файла', 'файлов')}</em>${spark(builds.map((b) => b.size || 0))}</div>
      <div class="panel ov-stat"><small>Сборок</small><b>${(S.builds || []).length}</b><em>${last ? `последняя ${fmtDate(last.builtAt)}` : 'ещё не собирали'}</em></div>
      <div class="panel ov-stat"><small>Установщик</small><b class="sm">${isMps() ? 'TankAir Installer' : 'Inno Setup'}</b><em>${isMps() ? `${Object.keys(p.installer.layout.screens).filter((k) => k !== 'manage' && p.installer.layout.screens[k].enabled !== false).length} экранов · ${p.publish.type === 'none' ? 'без автообновления' : 'с кнопкой «Обновить»'}` : 'классический мастер'}</em></div>
    </div>
    <div class="ov-grid">
      <div class="panel ov-todo"><h2>Что дальше</h2>
        ${steps.length ? steps.slice(0, 5).map((t) => `<div class="todo-i ${t.kind}"><span class="ic">${icon(t.ic, 16)}</span><div class="grow"><b>${esc(t.title)}</b><small>${esc(t.text)}</small></div>
          <button class="btn sm" data-act="${t.act}" ${t.attrs || ''}>${esc(t.btn)}</button></div>`).join('') : '<div class="note">Всё готово. Можно собирать и публиковать.</div>'}
      </div>
      <div class="panel ov-tl"><h2>Версии</h2>
        ${versions.map((e) => {
    const b = (S.builds || []).find((x) => x.version === e.version);
    const first = (e.text || '').split(/\r?\n/).map((l) => l.replace(/^[•\-*\s]+/, '').trim()).filter(Boolean)[0];
    const cur = e.version === p.info.version;
    return `<div class="tl-i ${cur ? 'cur' : ''}"><i></i><div class="grow"><b>${esc(e.version)}${cur && !b ? ' — черновик' : ''}</b><small>${esc(first || (cur ? 'изменения ещё не описаны' : '—'))}</small></div><span>${b ? fmtDate(b.builtAt).split(',')[0] : cur ? 'сейчас' : ''}</span></div>`;
  }).join('')}
      </div>
    </div>
    ${mods.length ? `<div class="panel ov-mods"><div class="ov-mods-h"><h2>Состав</h2><button class="btn sm ghost" data-act="nav-cards">Витрина ${icon('arrow', 13)}</button></div>
      <div class="ov-strip">${mods.slice(0, 8).map((m) => `<button class="ov-mod" data-act="open-mod" data-id="${m.id}">${thumb(m)}<b>${esc(m.name)}</b><small>${m.version ? `v${esc(m.version)} · ` : ''}${fmtSize(modSize(m))}</small></button>`).join('')}</div></div>` : ''}
  </div>`;
}

async function mountOverview() {
  const rel = S.proj.design.bannerImage || S.proj.installer?.backgroundImage;
  const url = rel ? await getImg(rel) : null;
  const bg = $('#ov-hero-bg');
  if (url && bg) { bg.style.backgroundImage = `url("${url}")`; $('#ov-hero').classList.add('has-img'); }
}

async function paintReleaseArt() {
  const el = $('#rc-art');
  if (!el) return;
  const rel = S.proj.design.bannerImage || S.proj.installer?.backgroundImage;
  const url = rel ? await getImg(rel) : null;
  if (url && el.isConnected) { el.style.backgroundImage = `linear-gradient(180deg, transparent 30%, rgba(0,0,0,.78)), url("${url}")`; el.classList.add('has-img'); }
}

// Конфетти после успешной сборки
function celebrate(host) {
  if (!host || document.documentElement.classList.contains('no-anim')) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['var(--accent)', 'var(--accent-2)', 'var(--ok)', 'var(--info)', '#fff'];
  box.innerHTML = Array.from({ length: 46 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:${colors[i % colors.length]};animation-delay:${(i % 9) * 0.05}s;--dx:${((i * 53) % 120) - 60}px;--r:${(i * 97) % 720}deg"></i>`).join('');
  host.append(box);
  setTimeout(() => box.remove(), 2600);
}

// ---------- витрина модов ----------

function showcaseHtml() {
  const sections = [];
  const loose = [];
  for (const n of S.proj.tree) {
    if (n.type === 'group') sections.push(n);
    else loose.push(n);
  }
  const card = (n, parent) => {
    const radio = parent?.mode === 'single';
    const cm = n.catalogId && S.cat.data?.mods.find((x) => x.id === n.catalogId);
    const upd = cm && cmpVer(cm.version, n.catalogVersion || '0') > 0;
    return `<div class="mcard ${n.id === S.selId ? 'sel' : ''}" data-node="${n.id}">
      <div class="mc-pv">${thumb(n)}${parent ? `<span class="chip glass">${esc(parent.name)}</span>` : ''}
        <button class="mc-check ${radio ? 'radio' : ''} ${n.checked ? 'on' : ''}" data-act="toggle-default" data-id="${n.id}" title="${n.checked ? 'Включён по умолчанию' : 'Выключен по умолчанию'}">${n.checked ? icon('check', 13) : ''}</button></div>
      <div class="mc-bd"><b>${esc(n.name)}</b><p>${esc(n.description || 'Нет описания')}</p>
        <div class="mc-meta">${!n.files.length ? '<span class="chip bad">нет файлов</span>' : upd ? `<span class="chip warn">${icon('refresh', 11)}есть ${esc(cm.version)}</span>` : n.catalogId ? '<span class="chip ok">из каталога</span>' : ''}
          ${radio ? '<span class="chip">один из</span>' : ''}<span class="r">${n.version ? `v${esc(n.version)} · ` : ''}${fmtSize(modSize(n))}</span></div></div></div>`;
  };
  const collect = (g) => {
    const items = [];
    const visit = (nodes, parent) => nodes.forEach((n) => (n.type === 'group' ? visit(n.children, n) : items.push([n, parent])));
    visit(g.children, g);
    return items;
  };
  const html = sections.map((g) => {
    const items = collect(g);
    return `<div class="mc-sec"><div class="mc-sec-h ${g.id === S.selId ? 'sel' : ''}" data-node="${g.id}">${icon('folder', 15)}<b>${esc(g.name)}</b>${g.mode === 'single' ? '<span class="badge warn">один из</span>' : ''}<span class="t-meta">${nMods(items.length)}</span></div>
      <div class="mc-grid">${items.map(([n, p]) => card(n, p)).join('') || '<div class="note">Пустая группа — перетащите сюда моды в режиме списка</div>'}</div></div>`;
  }).join('');
  return `<div class="showcase">${loose.length ? `<div class="mc-sec"><div class="mc-sec-h">${icon('layers', 15)}<b>Без группы</b><span class="t-meta">${nMods(loose.length)}</span></div><div class="mc-grid">${loose.map((n) => card(n, null)).join('')}</div></div>` : ''}${html}</div>`;
}

// ---------- командная палитра Ctrl+K ----------

const PAL = { open: false, q: '', sel: 0, items: [] };

function paletteItems() {
  const items = [];
  const add = (group, title, sub, ic, run, extra = {}) => items.push({ group, title, sub, ic, run, ...extra });
  if (S.proj) {
    for (const [page, ic, t] of [['overview', 'home', 'Обзор'], ['tree', 'grid', 'Состав модпака'], ['catalog', 'search', 'Каталог модов'], ['design', 'brush', 'Оформление установщика'], ['info', 'edit', 'Сведения'], ['build', 'build', 'Сборка']]) {
      add('Разделы', t, '', ic, () => ACTIONS.nav({ dataset: { page } }));
    }
    for (const m of allMods()) add('Моды', m.name, `в модпаке${m.version ? ` · ${m.version}` : ''}`, 'other', () => openMod(m.id), { img: m });
    for (const { node } of walk(S.proj.tree)) if (node.type === 'group') add('Моды', node.name, `группа · ${node.mode === 'single' ? 'один из' : 'несколько'}`, 'folder', () => openMod(node.id));
    const have = new Set(allMods().map((m) => m.catalogId).filter(Boolean));
    for (const c of S.cat.data?.mods || []) {
      if (!have.has(c.id)) add('Каталог', c.name, `каталог · ${c.author || ''} · добавить`, 'search', () => { S.cat.q = c.name; ACTIONS.nav({ dataset: { page: 'catalog' } }); });
    }
    add('Действия', 'Собрать установщик', `версия ${S.proj.info.version}`, 'build', () => { ACTIONS.nav({ dataset: { page: 'build' } }); runBuild(); }, { kbd: 'Ctrl B' });
    add('Действия', 'Предпросмотр установщика', 'как его увидит игрок', 'play', () => ACTIONS['preview-or-open']());
    add('Действия', 'Добавить моды', '.mtmod, .wotmod, .zip, папки', 'import', () => ACTIONS['add-files']());
    add('Действия', 'Новая группа модов', '', 'folder', () => { ACTIONS.nav({ dataset: { page: 'tree' } }); ACTIONS['add-group'](); });
    add('Действия', `Начать версию ${bump(S.proj.info.version, 'minor')}`, 'поднять версию модпака', 'plus', () => { ACTIONS.bump({ dataset: { kind: 'minor' } }); });
    if (typeof isMps === 'function' && isMps()) add('Действия', 'Галерея дизайнов установщика', '8 готовых дизайнов', 'sparkle', () => { ACTIONS.nav({ dataset: { page: 'design' } }); setTimeout(() => quiet(openGallery()), 300); });
    add('Действия', 'Открыть папку проекта', S.dir, 'folder', () => api.openPath(S.dir));
    add('Действия', 'Закрыть проект', '', 'x', () => ACTIONS['close-project']());
  } else {
    add('Действия', 'Новый модпак', '', 'plus', () => ACTIONS['new-project']());
    add('Действия', 'Открыть проект', '', 'folder', () => ACTIONS['open-project']());
    add('Действия', 'Пример модпака', '', 'sparkle', () => ACTIONS['demo-project']());
    for (const r of S.st.recent.filter((x) => x.exists)) add('Недавние', r.name, r.dir, 'build', () => ACTIONS['open-recent']({ dataset: { dir: r.dir } }));
  }
  add('Настройки', 'Оформление студии', 'тема, обои, стекло, масштаб', 'brush', () => studioLookDialog());
  for (const [id, name] of STUDIO_THEMES) add('Настройки', `Тема студии: ${name}`, '', 'brush', () => quiet(setTheme(id)));
  add('Настройки', 'Настройки программы', 'обновления, адрес каталога', 'settings', () => ACTIONS['app-settings']());
  return items;
}

async function setTheme(id) {
  S.st = await call(api.appSettings, { ui: { ...uiSettings(), theme: id } });
  wallKey = '';
  applyUi();
}

function openMod(id) {
  S.selId = id;
  if (S.page !== 'tree') { S.page = 'tree'; render(); } else { renderTree(); renderInspector(); }
  setTimeout(() => document.querySelector(`#tree [data-node="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
}

const hl = (text, q) => {
  const t = esc(text);
  if (!q) return t;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 ? t : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
};

function paletteFiltered() {
  const q = PAL.q.trim().toLowerCase();
  const all = paletteItems();
  if (!q) return all.filter((x) => x.group !== 'Каталог' && !x.title.startsWith('Тема студии')).slice(0, 40);
  const words = q.split(/\s+/);
  return all.filter((x) => words.every((w) => `${x.title} ${x.sub}`.toLowerCase().includes(w)))
    .sort((a, b) => (a.title.toLowerCase().startsWith(q) ? 0 : 1) - (b.title.toLowerCase().startsWith(q) ? 0 : 1))
    .slice(0, 40);
}

function openPalette() {
  if (PAL.open) return;
  PAL.open = true;
  PAL.q = '';
  PAL.sel = 0;
  const root = document.createElement('div');
  root.id = 'palette';
  root.innerHTML = `<div class="pal-back"></div><div class="pal" role="dialog" aria-label="Командная палитра">
    <div class="pal-q">${icon('search', 19)}<input id="pal-input" placeholder="Мод, раздел, действие или настройка…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
    <div class="pal-list" id="pal-list"></div>
    <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> выбрать</span><span><kbd>Enter</kbd> открыть</span><span class="grow"></span><span>TankAir Studio</span></div></div>`;
  document.body.append(root);
  const input = root.querySelector('#pal-input');
  input.focus();
  input.addEventListener('input', () => { PAL.q = input.value; PAL.sel = 0; paintPalette(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); PAL.sel = Math.min(PAL.items.length - 1, PAL.sel + 1); paintPalette(true); }
    if (e.key === 'ArrowUp') { e.preventDefault(); PAL.sel = Math.max(0, PAL.sel - 1); paintPalette(true); }
    if (e.key === 'Enter') { e.preventDefault(); runPalette(PAL.sel); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
  });
  root.querySelector('.pal-back').addEventListener('mousedown', closePalette);
  root.querySelector('#pal-list').addEventListener('click', (e) => {
    const it = e.target.closest('[data-pi]');
    if (it) runPalette(Number(it.dataset.pi));
  });
  root.querySelector('#pal-list').addEventListener('mousemove', (e) => {
    const it = e.target.closest('[data-pi]');
    if (it && Number(it.dataset.pi) !== PAL.sel) { PAL.sel = Number(it.dataset.pi); paintPalette(true); }
  });
  paintPalette();
}

function paintPalette(keepScroll = false) {
  const list = $('#pal-list');
  if (!list) return;
  if (!keepScroll) PAL.items = paletteFiltered();
  let group = '';
  list.innerHTML = PAL.items.map((x, i) => {
    const h = x.group !== group ? `<div class="pal-grp">${esc(x.group)}</div>` : '';
    group = x.group;
    return `${h}<div class="pal-it ${i === PAL.sel ? 'on' : ''}" data-pi="${i}"><span class="ic">${x.img ? thumb(x.img) : icon(x.ic, 15)}</span>
      <span class="grow"><span class="t">${hl(x.title, PAL.q.trim())}</span>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>${x.kbd ? `<kbd>${x.kbd}</kbd>` : ''}${i === PAL.sel ? '<kbd>Enter</kbd>' : ''}</div>`;
  }).join('') || '<div class="pal-empty">Ничего не нашлось</div>';
  hydrate(list);
  list.querySelector('.pal-it.on')?.scrollIntoView({ block: 'nearest' });
}

function runPalette(i) {
  const it = PAL.items[i];
  closePalette();
  if (it) quiet(Promise.resolve(it.run()));
}

function closePalette() {
  PAL.open = false;
  $('#palette')?.remove();
}

// ---------- действия и клавиши ----------

Object.assign(ACTIONS, {
  palette: () => openPalette(),
  'studio-look': () => studioLookDialog(),
  'tree-view': (el) => {
    S.view = el.dataset.view;
    store.set('tankair.view', S.view);
    renderPage();
  },
  'nav-cards': () => {
    S.view = 'cards';
    store.set('tankair.view', 'cards');
    ACTIONS.nav({ dataset: { page: 'tree' } });
  },
  'open-mod': (el) => openMod(el.dataset.id),
  'show-item': (el) => api.showItem(el.dataset.path),
  'preview-or-open': () => (typeof isMps === 'function' && isMps() ? ACTIONS['ip-open']() : previewInstaller()),
  'goto-publish': () => {
    if (S.page !== 'build') ACTIONS.nav({ dataset: { page: 'build' } });
    setTimeout(() => $('.publish-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  },
});

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === 'k' || k === 'л')) {
    e.preventDefault();
    if (PAL.open) closePalette(); else openPalette();
  }
  if ((e.ctrlKey || e.metaKey) && (k === 'b' || k === 'и') && S.proj && !PAL.open && !$('#modal').innerHTML) {
    e.preventDefault();
    if (S.page !== 'build') ACTIONS.nav({ dataset: { page: 'build' } });
    quiet(runBuild());
  }
}, true);

// «Как в Windows»: тема меняется вместе с системной
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (uiSettings().theme === 'auto') applyUi(); });
