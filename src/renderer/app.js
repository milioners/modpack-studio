// Интерфейс ModPack Studio — конструктора модпаков. Проект хранится здесь (S.proj),
// любое изменение сохраняется в главном процессе с небольшой задержкой.
'use strict';

// window.api объявлен в preload.js через contextBridge

const S = {
  st: null,          // состояние из главного процесса
  proj: null,        // данные проекта (project.json)
  dir: null,
  check: { errors: [], warnings: [] },
  stats: { mods: 0, groups: 0, files: 0, size: 0 },
  page: 'tree',
  selId: null,
  saveTimer: null,
  saving: false,
  drag: null,
  mockPage: 'mods',
  mock: null,        // состояние интерактивного предпросмотра установщика
  build: { running: false, log: [], result: null },
  cat: { data: null, loading: false, error: null, q: '', category: 'all', busy: {} }, // онлайн-каталог
  upd: { info: null, state: 'idle', got: 0, total: 0, file: null }, // автообновление программы
};

// ---------- утилиты ----------

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const nMods = (n) => `${n} ${plural(n, 'мод', 'мода', 'модов')}`;
function fmtSize(b) {
  if (!b) return '0 КБ';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} КБ`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '—');
const modSize = (n) => (n.files || []).reduce((s, f) => s + (f.size || 0), 0);
const accent = () => S.proj?.design.accent || '#f0a53a';

async function call(fn, ...args) {
  const r = await fn(...args);
  if (!r.ok) {
    toast('bad', 'Ошибка', r.error);
    throw new Error(r.error);
  }
  return r.data;
}
const quiet = (p) => p.catch(() => {});

// ---------- картинки ----------

const imgData = new Map(); // rel -> Promise<data: URL>
function getImg(rel) {
  if (!rel) return Promise.resolve(null);
  if (!imgData.has(rel)) imgData.set(rel, api.imageData(rel).then((r) => (r.ok ? r.data : null)));
  return imgData.get(rel);
}
const phCache = new Map();
function placeholder(name, kind) {
  const key = `${name}|${kind}|${accent()}`;
  if (!phCache.has(key)) {
    phCache.set(key, ART.preview({ name, type: kind }, null, accent(), [320, 180]).then((c) => c.toDataURL('image/png')));
  }
  return phCache.get(key);
}
// <img> с картинкой проекта или заглушкой; настоящая картинка подставляется в hydrate()
const thumb = (node, cls = '') => (node.preview
  ? `<img class="${cls}" data-rel="${esc(node.preview)}" alt="">`
  : `<img class="${cls}" data-ph="${esc(node.name)}" data-kind="${node.type}" alt="">`);
function hydrate(root = document) {
  root.querySelectorAll('img[data-rel]').forEach(async (img) => {
    const u = await getImg(img.dataset.rel);
    if (u && img.isConnected) img.src = u;
  });
  root.querySelectorAll('img[data-ph]').forEach(async (img) => {
    const u = await placeholder(img.dataset.ph, img.dataset.kind);
    if (img.isConnected) img.src = u;
  });
}

// ---------- дерево ----------

function* walk(nodes, parent = null, depth = 0) {
  for (const n of nodes) {
    yield { node: n, parent, depth };
    if (n.type === 'group') yield* walk(n.children, n, depth + 1);
  }
}
const allMods = () => [...walk(S.proj.tree)].filter((x) => x.node.type === 'mod').map((x) => x.node);
function locate(id, list = S.proj.tree, parent = null) {
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (n.id === id) return { node: n, list, index: i, parent };
    if (n.type === 'group') {
      const r = locate(id, n.children, n);
      if (r) return r;
    }
  }
  return null;
}
const selected = () => (S.selId ? locate(S.selId) : null);
function contains(group, id) {
  return group.type === 'group' && [...walk(group.children)].some((x) => x.node.id === id);
}
const newId = (p) => `${p}${Math.random().toString(16).slice(2, 12)}`;

// Можно ли положить узел drag рядом с target (pos: before/after/inside)
function canDrop(dragId, targetId, pos) {
  if (dragId === targetId) return false;
  const d = locate(dragId);
  const t = locate(targetId);
  if (!d || !t) return false;
  if (contains(d.node, targetId)) return false;
  const parent = pos === 'inside' ? t.node : t.parent;
  if (pos === 'inside' && t.node.type !== 'group') return false;
  if (parent && parent.mode === 'single' && d.node.type === 'group') return false;
  return true;
}
function moveNode(dragId, targetId, pos) {
  const d = locate(dragId);
  d.list.splice(d.index, 1);
  if (pos === 'inside') {
    const t = locate(targetId);
    t.node.children.push(d.node);
    t.node.expanded = true;
  } else {
    const t = locate(targetId);
    t.list.splice(t.index + (pos === 'after' ? 1 : 0), 0, d.node);
  }
}

// В группе «один из» по умолчанию включён ровно один вариант
function setDefault(id, on) {
  const r = locate(id);
  if (r.parent?.mode === 'single' && r.node.type === 'mod') {
    r.parent.children.forEach((c) => { if (c.type === 'mod') c.checked = c.id === id; });
  } else {
    r.node.checked = on;
  }
}

// ---------- сохранение ----------

function changed({ tree = true, inspector = false, shell = false } = {}) {
  setSaveState('dirty');
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => quiet(saveNow()), 450);
  if (S.page === 'tree') {
    if (tree) renderTree();
    if (inspector) renderInspector();
  }
  if (S.page === 'design') { if (isMps()) schedulePreview(); else renderMock(); }
  if (shell) renderSidebar();
}

async function saveNow() {
  clearTimeout(S.saveTimer);
  S.saveTimer = null;
  setSaveState('saving');
  try {
    const ps = await call(api.saveProject, S.proj);
    S.check = ps.check;
    S.stats = ps.stats;
    setSaveState('saved');
    renderSidebar();
    const statsEl = $('#tree-stats');
    if (statsEl) statsEl.innerHTML = statsLine();
  } catch {
    setSaveState('error');
  }
}

function setSaveState(s) {
  const el = $('#save-state');
  if (!el) return;
  const map = { dirty: ['', 'Изменено'], saving: ['busy', 'Сохранение…'], saved: ['ok', 'Сохранено'], error: ['bad', 'Не сохранено'] };
  const [cls, text] = map[s];
  el.className = `save-state ${cls}`;
  el.textContent = text;
}

function applyProjectState(ps) {
  if (!ps) {
    S.proj = null;
    S.dir = null;
    return;
  }
  if (S.dir !== ps.dir) {
    imgData.clear();
    S.selId = null;
    S.mock = null;
    S.build = { running: false, log: [], result: null };
  }
  S.proj = ps.data;
  S.dir = ps.dir;
  S.check = ps.check;
  S.stats = ps.stats;
  S.outputDir = ps.outputDir;
  S.builds = ps.builds || [];
}

// ---------- тосты и окна ----------

function toast(kind, title, text = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const ic = { ok: 'installed', bad: 'alert', info: 'info' }[kind] || 'info';
  el.innerHTML = `${icon(ic, 18)}<div><b>${esc(title)}</b>${text ? `<small>${esc(text)}</small>` : ''}</div>`;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  }, kind === 'bad' ? 8000 : 3800);
}

function modal({ title, sub = '', ic = 'info', danger = false, body = '', wide = false, actions = [], onMount }) {
  return new Promise((resolve) => {
    const root = $('#modal');
    root.innerHTML = `<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="m-head"><div class="m-icon ${danger ? 'bad' : ''}">${icon(ic, 20)}</div><div><h3>${esc(title)}</h3>${sub ? `<div class="m-sub">${sub}</div>` : ''}</div></div>
      ${body ? `<div class="m-body">${body}</div>` : '<div style="height:8px"></div>'}
      <div class="m-foot">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-i="${i}">${a.label}</button>`).join('')}</div>
    </div></div>`;
    const close = (val) => {
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const collect = () => {
      const data = {};
      root.querySelectorAll('[name]').forEach((el) => { data[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
      return data;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        const p = actions.findIndex((a) => a.primary);
        if (p >= 0) close({ action: actions[p].value, data: collect() });
      }
    };
    document.addEventListener('keydown', onKey, true);
    root.querySelector('.modal-back').addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-back')) close(null); });
    root.querySelectorAll('.m-foot button').forEach((b) => b.addEventListener('click', () => {
      const a = actions[+b.dataset.i];
      close(a.value === null ? null : { action: a.value, data: collect() });
    }));
    onMount?.(root);
    root.querySelector('input, textarea')?.focus();
  });
}

const confirmBox = (title, sub, label = 'Да', danger = false) => modal({
  title, sub, ic: danger ? 'trash' : 'info', danger,
  actions: [{ label: 'Отмена', value: null }, { label, value: 'ok', primary: !danger, danger }],
}).then((r) => r?.action === 'ok');

// ---------- общий каркас ----------

function render() {
  document.body.classList.toggle('home-mode', !S.proj);
  renderSidebar();
  renderPage();
  const center = $('#title-center');
  center.innerHTML = S.proj ? `<span class="t-name">${esc(S.proj.info.name)}</span><span id="save-state" class="save-state ok">Сохранено</span>` : '';
  renderTitleActions();
}

// Кнопки справа в заголовке: обновление программы и настройки
function renderTitleActions() {
  const el = $('#title-actions');
  if (!el) return;
  const u = S.upd;
  const badge = u.info?.available
    ? `<button class="title-btn upd" data-act="update-open" title="Доступна новая версия">${icon('upload', 14)}Обновление ${esc(u.info.version)}</button>` : '';
  el.innerHTML = `${badge}<button class="title-btn" data-act="app-settings" title="Настройки программы">${icon('settings', 15)}</button>`;
}

function renderSidebar() {
  const sb = $('#sidebar');
  if (!S.proj) {
    sb.innerHTML = '';
    return;
  }
  const errs = S.check.errors.length;
  const warns = S.check.warnings.length;
  const nav = [
    ['tree', 'catalog', 'Состав модпака', `<span class="count">${S.stats.mods}</span>`],
    ['catalog', 'search', 'Каталог модов', catalogUpdatesCount() ? `<span class="count upd">${catalogUpdatesCount()}</span>` : ''],
    ['design', 'image', 'Оформление', ''],
    ['info', 'edit', 'Сведения', ''],
    ['build', 'build', 'Сборка', errs ? `<span class="count bad">${errs}</span>` : `<span class="count ok">${icon('check', 11)}</span>`],
  ];
  sb.innerHTML = `<div class="nav-label">Модпак</div>
    ${nav.map(([page, ic, label, extra]) => `<button class="nav-item ${S.page === page ? 'active' : ''}" data-act="nav" data-page="${page}">${icon(ic, 18)}<span>${label}</span>${extra}</button>`).join('')}
    <div class="spacer"></div>
    <div class="game-card">
      <div class="row"><div class="mini-logo" id="side-logo"></div><div class="grow"><div class="title">${esc(S.proj.info.name)}</div><div class="path">версия ${esc(S.proj.info.version)}${warns ? ` · ${warns} ${plural(warns, 'замечание', 'замечания', 'замечаний')}` : ''}</div></div></div>
      <div class="path" style="margin-top:8px">${esc(S.dir)}</div>
      <div class="actions"><button class="btn sm" data-act="open-dir">${icon('folder', 14)}Папка</button><button class="btn sm ghost" data-act="close-project">Закрыть</button></div>
    </div>`;
  renderSideLogo();
}

async function renderSideLogo() {
  const el = $('#side-logo');
  if (!el) return;
  const url = await getImg(S.proj.design.icon);
  if (url) el.innerHTML = `<img src="${url}" alt="">`;
  else el.innerHTML = LOGO;
}

function renderPage() {
  const page = $('#page');
  if (!S.proj) {
    page.innerHTML = pageHome();
    return;
  }
  const pages = { tree: pageTree, catalog: pageCatalog, design: pageDesign, info: pageInfo, build: pageBuild };
  page.innerHTML = pages[S.page]();
  if (S.page === 'tree') {
    renderTree();
    renderInspector();
  }
  if (S.page === 'design') {
    if (isMps()) { paintPreview(); schedulePreview(IP.img ? 900 : 50); } else renderMock();
  }
  hydrate(page);
  if (S.page === 'build') {
    const c = $('#console');
    if (c) c.scrollTop = c.scrollHeight;
  }
}

const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="actions">${actions}</div></div>`;

// ---------- стартовый экран ----------

function pageHome() {
  const recent = S.st.recent;
  const steps = [['import', 'Добавьте моды', '.mtmod, .wotmod, архивы и папки — раскладка определится сама'],
    ['profiles', 'Разложите по группам', 'Группы «выбери один» для прицелов, обычные — для остального'],
    ['image', 'Оформите', 'Баннер, картинка, иконка, превью и описания модов'],
    ['build', 'Соберите .exe', 'Красивый установщик с галочками и превью для игроков']];
  return `<div class="home">
    <div class="hero">
      <div class="hero-logo">${LOGO.replace('width="26" height="26"', 'width="72" height="72"')}</div>
      <h1>ModPack <span>Studio</span></h1>
      <p>Конструктор модпаков для «Мира танков». Соберите свои моды в один красивый установщик —<br>с баннером, группами, превью и описанием каждого мода.</p>
      <div class="hero-actions">
        <button class="btn primary big" data-act="new-project">${icon('plus', 18)}Новый модпак</button>
        <button class="btn big" data-act="open-project">${icon('folder', 18)}Открыть проект</button>
        <button class="btn big ghost" data-act="demo-project">${icon('sparkle', 18)}Пример модпака</button>
      </div>
    </div>
    <div class="steps">${steps.map(([ic, t, d], i) => `<div class="step"><div class="step-n">${i + 1}</div>${icon(ic, 22)}<b>${t}</b><small>${d}</small></div>`).join('')}</div>
    ${recent.length ? `<div class="recent"><div class="nav-label">Недавние проекты</div><div class="list">${recent.map((r) => `
      <div class="row-item ${r.exists ? '' : 'missing'}" ${r.exists ? `data-act="open-recent" data-dir="${esc(r.dir)}"` : ''}>
        <div class="recent-ic">${icon('build', 20)}</div>
        <div class="grow"><div class="name">${esc(r.name)} <span class="badge">${esc(r.version)}</span>${r.exists ? '' : ' <span class="badge bad">папка не найдена</span>'}</div><div class="meta">${esc(r.dir)} · ${fmtDate(r.opened)}</div></div>
        <button class="btn sm icon-only ghost" data-act="forget-recent" data-dir="${esc(r.dir)}" title="Убрать из списка">${icon('x', 14)}</button>
      </div>`).join('')}</div></div>` : ''}
    ${S.st.iscc ? '' : `<div class="banner bad" style="margin-top:22px">${icon('alert', 22)}<div class="grow"><b>Не найден Inno Setup 6</b><small>Он нужен, чтобы собирать установщики. Установите его: <code>winget install JRSoftware.InnoSetup</code></small></div>
      <button class="btn sm" data-act="external" data-url="https://jrsoftware.org/isdl.php">${icon('external', 14)}Скачать</button></div>`}
  </div>`;
}

async function newProjectDialog() {
  const r = await modal({
    title: 'Новый модпак', sub: 'Всё можно поменять позже в разделе «Сведения»', ic: 'plus',
    body: `<div class="form-grid">
      <label class="field full"><span>Название</span><input class="input" name="name" placeholder="Например: Модпак Артёма" maxlength="60"></label>
      <label class="field"><span>Версия модпака</span><input class="input" name="version" value="1.0"></label>
      <label class="field"><span>Для версии игры</span><input class="input" name="gameVersion" placeholder="1.30.0"></label>
      <label class="field full"><span>Автор</span><input class="input" name="author" placeholder="Ваш ник"></label></div>
      <div class="note">Дальше выберите, где создать папку проекта: в ней будут храниться моды, картинки и готовые установщики.</div>`,
    actions: [{ label: 'Отмена', value: null }, { label: 'Создать', value: 'ok', primary: true }],
  });
  if (!r) return;
  const info = { ...r.data, name: r.data.name.trim() || 'Мой модпак' };
  const st = await call(api.newProject, info);
  if (st) openState(st, 'tree');
}

function openState(st, page = 'tree') {
  S.st = st;
  applyProjectState(st.project);
  S.page = page;
  render();
}

// ---------- состав ----------

function statsLine() {
  return `${nMods(S.stats.mods)} · ${S.stats.groups} ${plural(S.stats.groups, 'группа', 'группы', 'групп')} · ${fmtSize(S.stats.size)}`;
}

function pageTree() {
  return `${head('Состав модпака', 'Так моды будут выглядеть в установщике. Перетаскивайте, чтобы менять порядок и вкладывать в группы.',
    `<button class="btn" data-act="add-group">${icon('folder', 16)}Группа</button>
     <button class="btn" data-act="add-folder">${icon('plus', 16)}Мод из папки</button>
     <button class="btn primary" data-act="add-files">${icon('import', 16)}Добавить моды</button>`)}
    <div class="editor">
      <div class="panel tree-panel">
        <div class="tree-head"><span id="tree-stats">${statsLine()}</span><span class="grow"></span>
          <button class="btn sm ghost" data-act="expand-all" title="Развернуть всё">${icon('plus', 14)}</button>
          <button class="btn sm ghost" data-act="collapse-all" title="Свернуть всё">${icon('minus', 14)}</button>
          <button class="btn sm" data-act="preview-installer">${icon('play', 13)}Предпросмотр</button></div>
        <div id="tree" class="tree"></div>
      </div>
      <div class="panel inspector" id="inspector"></div>
    </div>`;
}

function renderTree() {
  const el = $('#tree');
  if (!el) return;
  if (!S.proj.tree.length) {
    el.innerHTML = `<div class="tree-empty" data-drop-root="1"><div class="big">${icon('import', 30)}</div><h3>Перетащите моды сюда</h3>
      <p>.mtmod, .wotmod, .zip-архивы или папки с модами. Картинка и readme из архива подхватятся автоматически.</p>
      <div style="display:flex;gap:8px;justify-content:center"><button class="btn primary" data-act="add-files">${icon('import', 16)}Выбрать файлы</button>
      <button class="btn" data-act="add-group">${icon('folder', 16)}Создать группу</button></div></div>`;
    return;
  }
  const rows = [];
  const visit = (nodes, depth, parent) => {
    for (const n of nodes) {
      const sel = n.id === S.selId ? 'sel' : '';
      const radio = parent?.mode === 'single' && n.type === 'mod';
      const check = `<button class="defcheck ${radio ? 'radio' : ''} ${n.checked ? 'on' : ''}" data-act="toggle-default" data-id="${n.id}" title="${n.checked ? 'Включён по умолчанию' : 'Выключен по умолчанию'}">${n.checked ? icon('check', 12) : ''}</button>`;
      if (n.type === 'group') {
        const mods = [...walk(n.children)].filter((x) => x.node.type === 'mod').length;
        rows.push(`<div class="tnode group ${sel}" data-node="${n.id}" draggable="true" style="--lvl:${depth}">
          <button class="chev ${n.expanded ? 'open' : ''}" data-act="toggle-exp" data-id="${n.id}">${icon('arrow', 13)}</button>
          ${check}<span class="g-ic">${icon('folder', 16)}</span>
          <span class="t-name">${esc(n.name)}</span>
          ${n.mode === 'single' ? '<span class="badge warn">один из</span>' : ''}
          <span class="t-meta">${nMods(mods)}</span></div>`);
        if (n.expanded) {
          if (!n.children.length) rows.push(`<div class="tnode hint" style="--lvl:${depth + 1}">Пусто — перетащите сюда моды</div>`);
          visit(n.children, depth + 1, n);
        }
      } else {
        const bad = !n.files.length;
        rows.push(`<div class="tnode mod ${sel}" data-node="${n.id}" draggable="true" style="--lvl:${depth}">
          <span class="chev-space"></span>${check}${thumb(n, 't-thumb')}
          <span class="t-name">${esc(n.name)}${bad ? ` <span class="badge bad">нет файлов</span>` : ''}</span>
          <span class="t-meta">${n.version ? `v${esc(n.version)} · ` : ''}${fmtSize(modSize(n))}</span></div>`);
      }
    }
  };
  visit(S.proj.tree, 0, null);
  el.innerHTML = rows.join('') + '<div class="tree-tail" data-drop-root="1">Перетащите сюда моды или узел, чтобы положить в конец списка</div>';
  hydrate(el);
}

function imageBox(rel, act, extra = '', aspect = '16 / 9', fallbackNode = null) {
  const img = rel ? `<img data-rel="${esc(rel)}" alt="">` : (fallbackNode ? thumb(fallbackNode) : '');
  return `<div class="imgbox" style="aspect-ratio:${aspect}" data-drop-image="${act}" ${extra}>
    ${img}${rel ? '' : `<div class="imgbox-hint">${icon('image', 22)}<span>${fallbackNode ? 'Своя картинка не выбрана — в установщике будет заглушка' : 'Картинка не выбрана'}</span></div>`}</div>`;
}

function renderInspector() {
  const el = $('#inspector');
  if (!el) return;
  const r = selected();
  if (!r) {
    el.innerHTML = `<div class="insp-empty"><div class="big">${icon('edit', 26)}</div><h3>Выберите мод или группу</h3>
      <p>Здесь редактируются название, описание, превью и поведение в установщике.</p>
      <div class="tips">
        <div>${icon('folder', 16)}<span><b>Группа «один из»</b> — игрок сможет выбрать только один вариант. Подходит для прицелов, маркеров, озвучек.</span></div>
        <div>${icon('check', 16)}<span><b>Галочка слева</b> — включён ли мод в установщике по умолчанию.</span></div>
        <div>${icon('image', 16)}<span><b>Превью</b> показывается игроку справа от списка. Картинку можно перетащить прямо на поле превью.</span></div>
      </div></div>`;
    return;
  }
  const n = r.node;
  const inSingle = r.parent?.mode === 'single';
  const common = `<label class="field"><span>Название</span><input class="input" data-bind="name" value="${esc(n.name)}" maxlength="80"></label>`;
  const preview = `<div class="field"><span>Превью в установщике</span>${imageBox(n.preview, 'node-preview', '', '16 / 9', n)}
    <div class="row-btns"><button class="btn sm" data-act="pick-preview">${icon('image', 14)}Выбрать картинку</button>
    ${n.preview ? `<button class="btn sm ghost" data-act="clear-preview">Убрать</button>` : ''}</div></div>`;
  const move = `<div class="row-btns">
    <button class="btn sm" data-act="move" data-dir="-1" title="Выше">${icon('arrow', 13, 'up')}</button>
    <button class="btn sm" data-act="move" data-dir="1" title="Ниже">${icon('arrow', 13, 'down')}</button>
    <span class="grow"></span>`;
  if (n.type === 'group') {
    el.innerHTML = `<div class="insp-head">${icon('folder', 18)}<b>Группа</b><span class="grow"></span>${move}
      <button class="btn sm" data-act="ungroup">Разгруппировать</button><button class="btn sm danger icon-only" data-act="delete-node" title="Удалить">${icon('trash', 14)}</button></div></div>
      ${common}
      <div class="field"><span>Как выбирать моды в группе</span><div class="segmented">
        <button class="${n.mode !== 'single' ? 'on' : ''}" data-act="group-mode" data-mode="multi">${icon('check', 14)}Можно несколько</button>
        <button class="${n.mode === 'single' ? 'on' : ''}" data-act="group-mode" data-mode="single">${icon('target', 14)}Только один</button></div>
        <small class="hint-text">${n.mode === 'single' ? 'В установщике будут кружки (радиокнопки): выбрать можно один вариант.' : 'В установщике будут галочки: можно выбрать любые моды группы.'}</small></div>
      <label class="toggle"><input type="checkbox" data-bind-check="checked" ${n.checked ? 'checked' : ''}><span class="track"></span><span>Группа включена по умолчанию</span></label>
      <label class="field"><span>Описание группы</span><textarea class="textarea" data-bind="description" placeholder="Что внутри, как выбирать">${esc(n.description)}</textarea></label>
      ${preview}`;
  } else {
    const cm = n.catalogId && S.cat.data?.mods.find((x) => x.id === n.catalogId);
    const catNote = n.catalogId ? `<div class="banner info slim">${icon('search', 16)}<div class="grow"><b>Мод из онлайн-каталога</b><small>Версия в проекте ${esc(n.catalogVersion || n.version)}${cm && cmpVer(cm.version, n.catalogVersion || '0') > 0 ? ` · в каталоге уже ${esc(cm.version)}` : ''}</small></div>
      ${cm && cmpVer(cm.version, n.catalogVersion || '0') > 0 ? `<button class="btn sm primary" data-act="node-cat-update">${icon('refresh', 13)}Обновить</button>` : ''}</div>` : '';
    el.innerHTML = `${catNote}<div class="insp-head">${icon('other', 18)}<b>Мод</b><span class="grow"></span>${move}
      <button class="btn sm danger icon-only" data-act="delete-node" title="Удалить">${icon('trash', 14)}</button></div></div>
      ${preview}
      ${common}
      <div class="form-grid">
        <label class="field"><span>Версия</span><input class="input" data-bind="version" value="${esc(n.version)}"></label>
        <label class="field"><span>Автор мода</span><input class="input" data-bind="author" value="${esc(n.author)}" placeholder="Кто сделал"></label></div>
      <label class="toggle"><input type="checkbox" data-bind-check="checked" ${n.checked ? 'checked' : ''}><span class="track"></span>
        <span>${inSingle ? 'Выбран по умолчанию в группе' : 'Включён по умолчанию'}</span></label>
      <label class="field"><span>Описание для игрока</span><textarea class="textarea tall" data-bind="description" placeholder="Что делает мод, как им пользоваться">${esc(n.description)}</textarea></label>
      <div class="field"><span>Файлы мода · ${n.files.length} · ${fmtSize(modSize(n))}</span>
        <div class="table-wrap"><table class="files-table"><thead><tr><th>Куда ставится в игре</th><th>Размер</th></tr></thead><tbody>
        ${n.files.map((f) => `<tr><td class="dst">${esc(f.dst.replace('{game_version}', '<версия>'))}</td><td>${fmtSize(f.size)}</td></tr>`).join('') || '<tr><td colspan="2">Файлов нет</td></tr>'}
        </tbody></table></div>
        ${n.skipped?.length ? `<small class="hint-text">Не попали в установщик (readme, картинки): ${n.skipped.map(esc).join(', ')}</small>` : ''}
        <div class="row-btns"><button class="btn sm" data-act="replace-files">${icon('refresh', 14)}Заменить файлы (новая версия мода)</button></div></div>`;
  }
  hydrate(el);
}

// ---------- предпросмотр установщика ----------

// Повторяет логику установщика: группы, «один из», выбор по умолчанию
function mockItems() {
  const items = [];
  const visit = (nodes, level, parentIdx, parentGroup) => {
    const firstChecked = parentGroup?.mode === 'single'
      ? (nodes.find((n) => n.type === 'mod' && n.checked) || nodes.find((n) => n.type === 'mod')) : null;
    for (const n of nodes) {
      if (n.type === 'group' && ![...walk(n.children)].some((x) => x.node.type === 'mod')) continue;
      const idx = items.length;
      const radio = parentGroup?.mode === 'single' && n.type === 'mod';
      items.push({ node: n, idx, level, parentIdx, radio, checked: radio ? n === firstChecked : n.checked });
      if (n.type === 'group') visit(n.children, level + 1, idx, n);
    }
  };
  visit(S.proj.tree, 0, -1, null);
  return items;
}

function resetMock() {
  const items = mockItems();
  S.mock = { items, sel: -1 };
}

const mockSel = (i) => {
  const it = S.mock.items[i];
  let ok = it.checked;
  let p = it.parentIdx;
  while (ok && p >= 0) {
    ok = S.mock.items[p].checked;
    p = S.mock.items[p].parentIdx;
  }
  return ok;
};

async function mockHtml(page) {
  const p = S.proj;
  const urls = { banner: await getImg(p.design.bannerImage), sidebar: await getImg(p.design.sidebarImage), icon: await getImg(p.design.icon) };
  const dark = p.design.theme === 'dark' || (p.design.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const mockCls = `mock ${dark ? 'dark' : ''}`;
  const title = `<div class="mock-title"><span class="mock-ico" id="mock-ico"></span>Установка — ${esc(p.info.name)}<span class="grow"></span><span class="mock-x">✕</span></div>`;
  const foot = (back, next) => `<div class="mock-foot"><span class="grow"></span>${back ? '<span class="mock-btn">&lt; Назад</span>' : ''}<span class="mock-btn primary">${next}</span><span class="mock-btn">Отмена</span></div>`;
  if (page === 'welcome' || page === 'finish') {
    const side = (await ART.sidebar(p, urls)).toDataURL('image/png');
    const welcome = p.design.welcomeText || `${p.info.description}\n\nВерсия модпака: ${p.info.version}${p.info.author ? `\nАвтор: ${p.info.author}` : ''}\n\nПеред установкой закройте игру.`;
    const finish = p.design.finishText || `Модпак «${p.info.name}» установлен. Можно запускать игру!`;
    const launch = page === 'finish' && p.options.launchGame ? '<div class="mock-clean" style="margin-top:16px"><span class="mk-check on">✓</span>Запустить «Мир танков»</div>' : '';
    return `<div class="${mockCls}">${title}<div class="mock-welcome"><img class="mock-side" src="${side}" alt="">
      <div class="mock-wtext"><h2>${page === 'welcome' ? `Установка модпака «${esc(p.info.name)}»` : 'Готово!'}</h2><p>${esc(page === 'welcome' ? welcome : finish)}</p>${launch}</div></div>
      ${page === 'welcome' ? foot(false, 'Далее &gt;') : foot(false, 'Завершить')}</div>`;
  }
  if (page === 'changelog') {
    const banner = (await ART.banner(p, urls)).toDataURL('image/png');
    const text = changelogPreview();
    return `<div class="${mockCls}">${title}
      <div class="mock-banner"><img src="${banner}" alt=""><span>Что нового</span></div>
      <div class="mock-body"><div class="mock-sub">Изменения в модпаке «${esc(p.info.name)}»:</div>
        <div class="mock-memo">${text ? esc(text) : '<i>Список изменений пуст — страница «Что нового» не появится. Заполните его в разделе «Сборка».</i>'}</div>
        <div class="mock-sub" style="margin-top:8px">Нажмите «Далее», чтобы продолжить установку.</div></div>
      ${foot(true, 'Далее &gt;')}</div>`;
  }
  if (!S.mock || S.mock.items.length !== mockItems().length) resetMock();
  const banner = (await ART.banner(p, urls)).toDataURL('image/png');
  const items = S.mock.items;
  const rows = items.map((it, i) => {
    const n = it.node;
    const parentOff = it.parentIdx >= 0 && !mockSel(it.parentIdx);
    const box = it.radio ? `<span class="mk-radio ${it.checked ? 'on' : ''}"></span>` : `<span class="mk-check ${it.checked ? 'on' : ''}">${it.checked ? '✓' : ''}</span>`;
    return `<div class="mk-row ${S.mock.sel === i ? 'sel' : ''} ${parentOff ? 'off' : ''}" data-act="mock-sel" data-i="${i}" style="--lvl:${it.level}">
      <span data-act="mock-check" data-i="${i}">${box}</span><span class="mk-name ${n.type === 'group' ? 'grp' : ''}">${esc(n.name)}</span>
      <span class="mk-size">${n.type === 'mod' ? fmtSize(modSize(n)) : ''}</span></div>`;
  }).join('');
  const cur = S.mock.sel >= 0 ? items[S.mock.sel]?.node : null;
  const info = cur || { name: p.info.name, type: 'pack', description: p.info.description, preview: p.design.bannerImage };
  const meta = cur
    ? [cur.type === 'mod' && cur.version ? `Версия ${cur.version}` : '', cur.author ? `Автор: ${cur.author}` : '', cur.type === 'mod' ? fmtSize(modSize(cur)) : ''].filter(Boolean).join('   •   ')
    : [`Версия ${p.info.version}`, p.info.author ? `Автор: ${p.info.author}` : '', p.info.gameVersion ? `Для игры ${p.info.gameVersion}` : ''].filter(Boolean).join('   •   ');
  const prevUrl = (await ART.preview(info, await getImg(info.preview), p.design.accent)).toDataURL('image/png');
  const selMods = items.filter((it, i) => it.node.type === 'mod' && mockSel(i));
  const desc = info.description || (info.type === 'group' ? (info.mode === 'single' ? 'Группа: можно выбрать один вариант.' : 'Группа модов.') : 'Описание не указано.');
  return `<div class="${mockCls}">${title}
    <div class="mock-banner"><img src="${banner}" alt=""><span>Выбор модов</span></div>
    <div class="mock-body">
      <div class="mock-sub">Версия игры: 1.30.0.0. Нажмите на мод, чтобы увидеть описание и превью.</div>
      <div class="mock-cols">
        <div class="mock-left"><div class="mock-list">${rows || '<div class="mk-empty">Добавьте моды — они появятся здесь</div>'}</div>
          <div class="mock-sum"><b>Выбрано модов: ${selMods.length}   •   ${fmtSize(selMods.reduce((s, it) => s + modSize(it.node), 0))}</b><span class="mock-btn sm" data-act="mock-reset">По умолчанию</span></div>
          <div class="mock-clean"><span class="mk-check ${p.options.cleanDefault ? 'on' : ''}">${p.options.cleanDefault ? '✓' : ''}</span>Убрать старые моды (сохранятся в modpack_backup)</div></div>
        <div class="mock-info"><img src="${prevUrl}" alt=""><b>${esc(info.name)}</b><small>${esc(meta)}</small><p>${esc(desc)}</p></div>
      </div></div>
    ${foot(true, 'Далее &gt;')}</div>`;
}

async function renderMock(target = $('#mock-host')) {
  if (!target) return;
  const token = Symbol('mock');
  target.mockToken = token;
  const html = await mockHtml(target.dataset.page || S.mockPage);
  if (target.mockToken !== token || !target.isConnected) return;
  target.innerHTML = html;
  const icoUrl = await getImg(S.proj.design.icon);
  const ico = target.querySelector('#mock-ico');
  if (ico) ico.innerHTML = icoUrl ? `<img src="${icoUrl}" alt="">` : LOGO;
}

async function previewInstaller() {
  resetMock();
  const tabs = ['welcome', 'changelog', 'mods', 'finish'];
  await modal({
    title: 'Так установщик увидит игрок', sub: 'Список интерактивный: ставьте галочки и нажимайте на моды', ic: 'play', wide: true,
    body: `<div class="seg-tabs">${tabs.map((t) => `<button class="${t === 'mods' ? 'on' : ''}" data-mock-tab="${t}">${{ welcome: 'Приветствие', changelog: 'Что нового', mods: 'Выбор модов', finish: 'Завершение' }[t]}</button>`).join('')}</div>
      <div class="mock-host" id="mock-modal" data-page="mods"><div class="mock-loading">Рисую установщик…</div></div>`,
    actions: [{ label: 'Закрыть', value: null }],
    onMount: (root) => {
      const host = root.querySelector('#mock-modal');
      renderMock(host);
      root.querySelectorAll('[data-mock-tab]').forEach((b) => b.addEventListener('click', () => {
        root.querySelectorAll('[data-mock-tab]').forEach((x) => x.classList.toggle('on', x === b));
        host.dataset.page = b.dataset.mockTab;
        renderMock(host);
      }));
    },
  });
}

// ---------- оформление ----------

const ACCENTS = ['#f0a53a', '#e2741f', '#e0675a', '#d6455d', '#c17ad6', '#7d8cf0', '#4f9be8', '#4fb3a9', '#5cc98a', '#9bc25a', '#e8d26a', '#b9b3a7'];

function imagePicker(field, label, hint, aspect) {
  const rel = S.proj.design[field];
  return `<div class="field"><span>${label}</span>
    <div class="picker">${imageBox(rel, `design:${field}`, '', aspect)}
      <div class="picker-side"><small class="hint-text">${hint}</small>
        <div class="row-btns"><button class="btn sm" data-act="pick-design" data-field="${field}">${icon('image', 14)}Выбрать</button>
        ${rel ? `<button class="btn sm ghost" data-act="clear-design" data-field="${field}">Убрать</button>` : ''}</div></div></div></div>`;
}

function pageDesign() {
  if (isMps()) return pageInstallerDesign();
  const d = S.proj.design;
  return `${head('Оформление', 'Баннер, картинки и тексты установщика. Справа — как это увидит игрок.')}
    <div class="design-grid">
      <div class="panel">
        <h2>Цвет и картинки</h2><p class="sub">Без картинок программа нарисует оформление сама в выбранном цвете</p>
        <div class="field"><span>Тема окна установщика</span><div class="segmented">
          ${[['light', 'Светлая'], ['dark', 'Тёмная'], ['auto', 'Как в Windows']].map(([v, l]) => `<button class="${(d.theme || 'light') === v ? 'on' : ''}" data-act="theme" data-theme="${v}">${l}</button>`).join('')}</div></div>
        <div class="field"><span>Акцентный цвет</span><div class="colors">
          ${ACCENTS.map((c) => `<button style="background:${c}" class="${c === d.accent ? 'on' : ''}" data-act="accent" data-color="${c}" title="${c}"></button>`).join('')}
          <label class="color-custom" title="Свой цвет"><input type="color" id="accent-custom" value="${esc(d.accent)}">${icon('plus', 14)}</label></div></div>
        ${imagePicker('bannerImage', 'Фон баннера', 'Полоса над страницами установщика. Лучше широкая картинка: скриншот из игры, арт. Текст ляжет поверх.', '16 / 6')}
        ${imagePicker('sidebarImage', 'Картинка приветствия', 'Вертикальная картинка слева на первой и последней странице. Если не выбрана — берётся фон баннера.', '3 / 4')}
        ${imagePicker('icon', 'Иконка / логотип', 'Квадратная картинка: иконка .exe и логотип на баннере.', '1 / 1')}
        <div class="form-grid">
          <label class="field"><span>Заголовок на баннере</span><input class="input" data-dbind="bannerTitle" value="${esc(d.bannerTitle)}" placeholder="${esc(S.proj.info.name)}"></label>
          <label class="field"><span>Подзаголовок</span><input class="input" data-dbind="bannerSubtitle" value="${esc(d.bannerSubtitle)}" placeholder="Версия ${esc(S.proj.info.version)}"></label>
          <label class="field full"><span>Текст приветствия</span><textarea class="textarea" data-dbind="welcomeText" placeholder="По умолчанию — описание модпака, версия и автор">${esc(d.welcomeText)}</textarea></label>
          <label class="field full"><span>Текст в конце установки</span><input class="input" data-dbind="finishText" value="${esc(d.finishText)}" placeholder="Модпак установлен. Можно запускать игру!"></label>
        </div>
      </div>
      <div class="panel sticky">
        <div class="seg-tabs">${['welcome', 'changelog', 'mods', 'finish'].map((t) => `<button class="${S.mockPage === t ? 'on' : ''}" data-act="mock-tab" data-tab="${t}">${{ welcome: 'Приветствие', changelog: 'Что нового', mods: 'Выбор модов', finish: 'Завершение' }[t]}</button>`).join('')}</div>
        <div class="mock-host" id="mock-host" data-page="${S.mockPage}"><div class="mock-loading">Рисую установщик…</div></div>
      </div>
    </div>`;
}

// ---------- сведения ----------

function pageInfo() {
  const i = S.proj.info;
  const o = S.proj.options;
  return `${head('Сведения', 'Название, версия и параметры сборки.')}
    <div class="settings-grid">
      <div class="panel"><h2>О модпаке</h2><p class="sub">Видно в установщике и в «Приложениях» Windows</p>
        <div class="form-grid">
          <label class="field full"><span>Название</span><input class="input" data-ibind="name" value="${esc(i.name)}" maxlength="60"></label>
          <label class="field"><span>Версия модпака</span><input class="input" data-ibind="version" value="${esc(i.version)}"></label>
          <label class="field"><span>Для версии игры</span><input class="input" data-ibind="gameVersion" value="${esc(i.gameVersion)}" placeholder="например 1.30.0"></label>
          <label class="field"><span>Автор</span><input class="input" data-ibind="author" value="${esc(i.author)}"></label>
          <label class="field"><span>Сайт или группа</span><input class="input" data-ibind="website" value="${esc(i.website)}" placeholder="https://…"></label>
          <label class="field full"><span>Описание модпака</span><textarea class="textarea" data-ibind="description">${esc(i.description)}</textarea></label>
        </div>
        <div class="note">Если указана версия игры, установщик предупредит игрока, если у него другая версия клиента.</div></div>
      <div class="panel"><h2>Установка и сборка</h2><p class="sub">Как ведёт себя установщик</p>
        <div class="field" style="margin-bottom:16px"><span>Тип установщика</span><div class="segmented">
          <button class="${o.installerType !== 'inno' ? 'on' : ''}" data-act="itype" data-val="mps">Свой дизайн (ModPack Installer)</button>
          <button class="${o.installerType === 'inno' ? 'on' : ''}" data-act="itype" data-val="inno">Классический Inno Setup</button></div>
          <small class="hint-text">${o.installerType !== 'inno' ? 'Полностью своё оформление, карточки модов с превью, кнопка «Обновить модпак». Ничего устанавливать не нужно — собирается встроенным в Windows компилятором.' : 'Стандартное окно мастера установки. Нужен Inno Setup 6.'}</small></div>
        <label class="toggle"><input type="checkbox" data-obind-check="cleanDefault" ${o.cleanDefault ? 'checked' : ''}><span class="track"></span><span>Предлагать убрать старые моды перед установкой</span></label>
        <div class="note" style="margin:6px 0 16px 50px">Папки <code>mods/&lt;версия&gt;</code> и <code>res_mods/&lt;версия&gt;</code> переносятся в <code>modpack_backup</code> — ничего не теряется. Игрок может снять эту галочку.</div>
        <label class="toggle"><input type="checkbox" data-obind-check="showChangelog" ${o.showChangelog ? 'checked' : ''}><span class="track"></span><span>Показывать страницу «Что нового»</span></label>
        <label class="toggle" style="margin-top:12px"><input type="checkbox" data-obind-check="launchGame" ${o.launchGame ? 'checked' : ''}><span class="track"></span><span>Предлагать запустить игру после установки</span></label>
        <label class="field" style="margin-top:16px"><span>Сжатие</span><select class="select" data-obind="compression">
          <option value="max" ${o.compression !== 'fast' ? 'selected' : ''}>Максимальное — меньше файл</option>
          <option value="fast" ${o.compression === 'fast' ? 'selected' : ''}>Быстрое — для проверок</option></select></label>
        <label class="field" style="margin-top:14px"><span>Куда сохранять установщики</span><div style="display:flex;gap:8px">
          <input class="input" data-obind="outputDir" value="${esc(o.outputDir)}" placeholder="${esc(S.dir)}\\output"><button class="btn" data-act="pick-output">${icon('folder', 16)}</button></div></label>
      </div>
    </div>`;
}

// ---------- сборка ----------

function pageBuild() {
  const { errors, warnings } = S.check;
  const b = S.build;
  const st = S.stats;
  const tile = (ic, n, label) => `<div class="stat"><div class="ico-wrap">${icon(ic, 20)}</div><div><b>${n}</b><small>${label}</small></div></div>`;
  return `${head('Сборка установщика', 'Один .exe-файл: игрок запускает его, выбирает моды и получает их в своей игре.')}
    ${S.st.iscc || isMps() ? '' : `<div class="banner bad">${icon('alert', 22)}<div class="grow"><b>Inno Setup 6 не найден</b><small>Установите его: <code>winget install JRSoftware.InnoSetup</code></small></div>
      <button class="btn sm" data-act="external" data-url="https://jrsoftware.org/isdl.php">${icon('external', 14)}Скачать</button><button class="btn sm" data-act="recheck">${icon('refresh', 14)}Проверить снова</button></div>`}
    <div class="stats">${tile('catalog', st.mods, plural(st.mods, 'мод', 'мода', 'модов'))}${tile('folder', st.groups, plural(st.groups, 'группа', 'группы', 'групп'))}${tile('file', st.files, plural(st.files, 'файл', 'файла', 'файлов'))}${tile('build', fmtSize(st.size), 'до сжатия')}</div>
    ${versionPanel()}
    <div class="build-grid">
      <div class="panel">
        <h2>Проверка</h2><p class="sub">${errors.length ? 'Исправьте ошибки, чтобы собрать установщик' : warnings.length ? 'Можно собирать, но стоит взглянуть на замечания' : 'Всё в порядке — можно собирать'}</p>
        <div class="checks">
          ${errors.map((e) => `<div class="chk bad">${icon('alert', 16)}<span>${esc(e)}</span></div>`).join('')}
          ${warnings.map((w) => `<div class="chk warn">${icon('info', 16)}<span>${esc(w)}</span></div>`).join('')}
          ${!errors.length && !warnings.length ? `<div class="chk ok">${icon('installed', 16)}<span>Ошибок и замечаний нет</span></div>` : ''}
        </div>
        <div style="margin-top:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn primary big" data-act="build" ${(!isMps() && !S.st.iscc) || b.running || errors.length ? 'disabled' : ''}>
            ${b.running ? '<span class="spinner"></span>Собираю…' : `${icon('build', 18)}Собрать установщик`}</button>
          <button class="btn big" data-act="preview-installer">${icon('play', 16)}Предпросмотр</button>
        </div>
        ${b.log.length ? `<h4 class="sect">Журнал</h4><div class="console" id="console">${b.log.map((l) => `<div class="${/ошибк|error/i.test(l) ? 'err' : ''}">${esc(l)}</div>`).join('')}</div>` : ''}
      </div>
      <div class="panel">
        <h2>Результат</h2><p class="sub">Папка: ${esc(S.proj.options.outputDir || `${S.dir}\\output`)}</p>
        ${b.result ? `<div class="result"><div class="ico-wrap">${icon('installed', 24)}</div><div class="grow"><b>Установщик готов · ${fmtSize(b.result.size)}</b><div class="path">${esc(b.result.exePath)}</div></div></div>
          <div class="row-btns" style="margin-top:12px"><button class="btn primary" data-act="run-installer">${icon('play', 14)}Запустить установщик</button>
          <button class="btn" data-act="show-result">${icon('folder', 14)}Показать в папке</button></div>`
    : `<div class="empty small"><div class="big">${icon('build', 24)}</div><p>Здесь появится готовый .exe</p></div>`}
        <h4 class="sect">История сборок</h4>
        ${buildHistory()}
      </div>
    </div>
    ${isMps() ? publishPanel() : ''}`;
}

async function runBuild() {
  if (S.build.running) return;
  await saveNow();
  if (S.check.errors.length) {
    toast('bad', 'Есть ошибки', S.check.errors[0]);
    return;
  }
  const log = (l) => {
    S.build.log.push(l);
    const c = $('#console');
    if (c) {
      const div = document.createElement('div');
      div.textContent = l;
      if (/ошибк|error/i.test(l)) div.className = 'err';
      c.append(div);
      c.scrollTop = c.scrollHeight;
    } else if (S.page === 'build') renderPage();
  };
  S.build = { running: true, log: [], result: null };
  renderPage();
  try {
    const p = S.proj;
    let assets;
    if (isMps()) assets = await mpsAssets(p, { log });
    else {
    const urls = { banner: await getImg(p.design.bannerImage), sidebar: await getImg(p.design.sidebarImage), icon: await getImg(p.design.icon) };
    log('Рисую баннер, картинку приветствия и иконку…');
    assets = {
      banner: ART.toRgba(await ART.banner(p, urls)),
      sidebar: ART.toRgba(await ART.sidebar(p, urls)),
      packImage: ART.toRgba(await ART.preview({ name: p.info.name, type: 'pack' }, urls.banner, p.design.accent)),
      icon: await ART.icon(p, urls),
      previews: {},
    };
    const nodes = [...walk(p.tree)].map((x) => x.node);
    log(`Рисую превью модов (${nodes.length})…`);
    for (const n of nodes) assets.previews[n.id] = ART.toRgba(await ART.preview(n, await getImg(n.preview), p.design.accent));
    }
    const res = await call(api.build, S.proj, assets);
    S.builds = res.project.builds;
    S.build.result = res;
    log(`Готово: ${S.build.result.exePath}`);
    toast('ok', 'Установщик собран', S.build.result.exePath);
  } catch (e) {
    log(e.message);
  } finally {
    S.build.running = false;
    if (S.page === 'build') renderPage();
  }
}

// Версия модпака и «Что нового»
const clEntry = () => S.proj.changelog.find((e) => e.version === S.proj.info.version);

function changelogPreview() {
  return S.proj.changelog.filter((e) => e.text.trim()).slice(0, 3)
    .map((e) => `Версия ${e.version}${e.date ? ` — ${new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}\n${e.text.trim()}`)
    .join('\n\n');
}

function bump(v, kind) {
  const parts = String(v || '1.0').split('.').map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x));
  while (parts.length < 2) parts.push(0);
  if (kind === 'major') return `${parts[0] + 1}.0`;
  parts[parts.length - 1] += 1;
  return parts.join('.');
}

function versionPanel() {
  const v = S.proj.info.version;
  const cur = clEntry();
  const older = S.proj.changelog.filter((e) => e.version !== v && e.text.trim());
  return `<div class="panel version-panel">
    <div class="vp-head"><div class="vp-ver"><small>Версия модпака</small><b>${esc(v)}</b></div>
      <div class="grow"><h2>Что нового в этой версии</h2><p class="sub">Игроки увидят это на странице «Что нового» в установщике${S.proj.options.showChangelog ? '' : ' (сейчас страница выключена в «Сведениях»)'}</p></div>
      <div class="row-btns"><button class="btn sm" data-act="bump" data-kind="minor" title="Новая версия с мелкими изменениями">${icon('plus', 13)}Версия ${esc(bump(v, 'minor'))}</button>
        <button class="btn sm ghost" data-act="bump" data-kind="major" title="Крупное обновление">${icon('plus', 13)}${esc(bump(v, 'major'))}</button></div></div>
    <textarea class="textarea" data-clbind="text" placeholder="• Добавлен прицел «Тактик»&#10;• Обновлены маркеры под новый патч&#10;• Исправлена лампа">${esc(cur?.text || '')}</textarea>
    ${older.length ? `<details class="cl-older"><summary>Прошлые версии (${older.length})</summary>${older.map((e) => `<div class="cl-item"><b>Версия ${esc(e.version)}</b><small>${e.date ? fmtDate(e.date) : ''}</small><p>${esc(e.text)}</p></div>`).join('')}</details>` : ''}
  </div>`;
}

function buildHistory() {
  const list = S.builds || [];
  if (!list.length) return '<div class="note">Пока ни одной сборки.</div>';
  return `<div class="history">${list.slice(0, 12).map((b, i) => `<div class="hist-row ${i === 0 ? 'latest' : ''}">
      <div class="hist-ic">${icon('build', 16)}</div>
      <div class="grow"><b>${esc(b.file)}</b><small>Версия ${esc(b.version)} · ${nMods(b.mods || 0)} · ${fmtSize(b.size)} · ${fmtDate(b.builtAt)}</small></div>
      <button class="btn sm icon-only" data-act="hist-run" data-path="${esc(b.exePath)}" title="Запустить">${icon('play', 13)}</button>
      <button class="btn sm icon-only" data-act="show-item" data-path="${esc(b.exePath)}" title="Показать в папке">${icon('folder', 13)}</button>
      <button class="btn sm icon-only danger" data-act="hist-delete" data-file="${esc(b.file)}" title="Удалить файл">${icon('trash', 13)}</button></div>`).join('')}</div>`;
}

// ---------- действия ----------

async function addMods(sources, parentId = null) {
  if (!sources?.length) return;
  clearTimeout(S.saveTimer);
  toast('info', `Добавляю ${nMods(sources.length)}…`);
  const res = await call(api.addMods, S.proj, sources, parentId);
  applyProjectState(res.project);
  if (res.added.length) S.selId = res.added[res.added.length - 1];
  if (S.page !== 'tree') S.page = 'tree';
  render();
  if (res.added.length) toast('ok', `Добавлено: ${nMods(res.added.length)}`, 'Проверьте название, описание и превью справа');
  if (res.failed.length) toast('bad', 'Не удалось добавить', res.failed.join('\n'));
}

function targetGroupFor(el) {
  const row = el?.closest?.('[data-node]');
  if (!row) return null;
  const r = locate(row.dataset.node);
  if (!r) return null;
  return r.node.type === 'group' ? r.node.id : r.parent?.id || null;
}

async function setImage(target, rel) {
  if (target === 'node-preview') {
    const r = selected();
    if (!r) return;
    r.node.preview = rel;
    changed({ inspector: true });
  } else if (target.startsWith('design:')) {
    S.proj.design[target.slice(7)] = rel;
    changed({ tree: false, shell: true });
    renderPage();
  }
}

const ACTIONS = {
  'win-min': () => api.win.minimize(),
  'win-max': () => api.win.maximize(),
  'win-close': async () => {
    if (S.saveTimer) await saveNow();
    api.win.close();
  },
  nav: (el) => {
    S.page = el.dataset.page;
    render();
    $('#page').scrollTop = 0;
  },
  'new-project': () => newProjectDialog(),
  'open-project': async () => {
    const st = await call(api.openProject);
    if (st) openState(st);
  },
  'demo-project': async () => {
    const st = await call(api.demoProject);
    openState(st);
    toast('ok', 'Пример модпака создан', 'Посмотрите группы, оформление и соберите установщик');
  },
  'open-recent': async (el) => openState(await call(api.openProject, el.dataset.dir)),
  'forget-recent': async (el) => {
    S.st = await call(api.forgetProject, el.dataset.dir);
    render();
  },
  'close-project': async () => {
    if (S.saveTimer) await saveNow();
    openState(await call(api.closeProject));
  },
  'open-dir': () => api.openPath(S.dir),
  external: (el) => api.openExternal(el.dataset.url),
  recheck: async () => {
    S.st = await call(api.getState);
    render();
  },

  'add-files': async () => addMods(await call(api.pickMods, 'file'), selected()?.node.type === 'group' ? S.selId : selected()?.parent?.id),
  'add-folder': async () => addMods(await call(api.pickMods, 'folder'), selected()?.node.type === 'group' ? S.selId : selected()?.parent?.id),
  'add-group': () => {
    const g = { id: newId('g'), type: 'group', name: 'Новая группа', description: '', mode: 'multi', checked: true, expanded: true, preview: null, children: [] };
    const r = selected();
    if (r && r.node.type === 'group' && r.node.mode !== 'single') r.node.children.push(g);
    else S.proj.tree.push(g);
    S.selId = g.id;
    changed({ inspector: true, shell: true });
    setTimeout(() => $('#inspector [data-bind=name]')?.select(), 30);
  },
  select: (el) => {
    S.selId = el.dataset.node;
    renderTree();
    renderInspector();
  },
  'toggle-exp': (el) => {
    const r = locate(el.dataset.id);
    r.node.expanded = !r.node.expanded;
    changed();
  },
  'expand-all': () => { for (const { node } of walk(S.proj.tree)) if (node.type === 'group') node.expanded = true; changed(); },
  'collapse-all': () => { for (const { node } of walk(S.proj.tree)) if (node.type === 'group') node.expanded = false; changed(); },
  'toggle-default': (el) => {
    const r = locate(el.dataset.id);
    setDefault(r.node.id, !r.node.checked);
    changed({ inspector: r.node.id === S.selId || r.parent?.id === S.selId });
  },
  'group-mode': (el) => {
    const r = selected();
    if (el.dataset.mode === 'single' && r.node.children.some((c) => c.type === 'group')) {
      toast('bad', 'Нельзя', 'В группе «только один» не может быть вложенных групп. Сначала вынесите их.');
      return;
    }
    r.node.mode = el.dataset.mode;
    if (r.node.mode === 'single') {
      const first = r.node.children.find((c) => c.checked) || r.node.children[0];
      if (first) setDefault(first.id, true);
    }
    changed({ inspector: true });
  },
  move: (el) => {
    const r = selected();
    const j = r.index + Number(el.dataset.dir);
    if (j < 0 || j >= r.list.length) return;
    [r.list[r.index], r.list[j]] = [r.list[j], r.list[r.index]];
    changed();
  },
  ungroup: () => {
    const r = selected();
    r.list.splice(r.index, 1, ...r.node.children);
    S.selId = null;
    changed({ inspector: true, shell: true });
  },
  'delete-node': async () => {
    const r = selected();
    const what = r.node.type === 'group'
      ? `Группа «${esc(r.node.name)}» и все моды в ней (${[...walk(r.node.children)].filter((x) => x.node.type === 'mod').length}) будут удалены из проекта.`
      : `Мод «${esc(r.node.name)}» и его файлы будут удалены из проекта.`;
    if (!(await confirmBox('Удалить?', what, 'Удалить', true))) return;
    r.list.splice(r.index, 1);
    S.selId = null;
    changed({ inspector: true, shell: true });
  },
  'pick-preview': async () => {
    const rel = await call(api.pickImage);
    if (rel) setImage('node-preview', rel);
  },
  'clear-preview': () => setImage('node-preview', null),
  'replace-files': async () => {
    clearTimeout(S.saveTimer);
    const ps = await call(api.replaceFiles, S.proj, S.selId);
    if (!ps) return;
    applyProjectState(ps);
    render();
    toast('ok', 'Файлы мода заменены');
  },
  'preview-installer': () => previewInstaller(),

  accent: (el) => {
    S.proj.design.accent = el.dataset.color;
    phCache.clear();
    document.querySelectorAll('[data-act=accent]').forEach((b) => b.classList.toggle('on', b === el));
    changed({ tree: false });
  },
  'pick-design': async (el) => {
    const rel = await call(api.pickImage);
    if (rel) setImage(`design:${el.dataset.field}`, rel);
  },
  'clear-design': (el) => setImage(`design:${el.dataset.field}`, null),
  'mock-tab': (el) => {
    S.mockPage = el.dataset.tab;
    document.querySelectorAll('[data-act=mock-tab]').forEach((b) => b.classList.toggle('on', b === el));
    $('#mock-host').dataset.page = S.mockPage;
    renderMock();
  },
  'mock-sel': (el) => {
    S.mock.sel = Number(el.dataset.i);
    renderMock(el.closest('.mock-host'));
  },
  'mock-check': (el) => {
    const i = Number(el.dataset.i);
    const it = S.mock.items[i];
    if (it.radio) S.mock.items.forEach((x) => { if (x.parentIdx === it.parentIdx && x.radio) x.checked = x === it; });
    else it.checked = !it.checked;
    S.mock.sel = i;
    renderMock(el.closest('.mock-host'));
  },
  'mock-reset': (el) => {
    resetMock();
    renderMock(el.closest('.mock-host'));
  },

  'pick-output': async () => {
    const d = await call(api.pickOutput, S.proj.options.outputDir || S.dir);
    if (!d) return;
    S.proj.options.outputDir = d;
    changed({ tree: false });
    renderPage();
  },
  build: () => runBuild(),
  'run-installer': () => api.openPath(S.build.result.exePath),
  'show-result': () => api.showItem(S.build.result.exePath),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) {
    const fn = ACTIONS[el.dataset.act];
    if (fn) {
      e.preventDefault();
      e.stopPropagation();
      quiet(Promise.resolve(fn(el)));
      return;
    }
  }
  const row = e.target.closest('#tree [data-node]');
  if (row) ACTIONS.select(row);
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.bind) {
    const r = selected();
    if (!r) return;
    r.node[t.dataset.bind] = t.value;
    changed({ tree: t.dataset.bind !== 'description' });
  } else if (t.dataset.dbind) {
    S.proj.design[t.dataset.dbind] = t.value;
    changed({ tree: false });
  } else if (t.dataset.ibind) {
    S.proj.info[t.dataset.ibind] = t.value;
    changed({ tree: false, shell: t.dataset.ibind === 'name' || t.dataset.ibind === 'version' });
    if (t.dataset.ibind === 'name') $('.t-name', $('#title-center')).textContent = t.value;
  } else if (t.dataset.obind) {
    S.proj.options[t.dataset.obind] = t.value;
    changed({ tree: false });
  } else if (t.id === 'accent-custom') {
    S.proj.design.accent = t.value;
    phCache.clear();
    changed({ tree: false });
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.bindCheck) {
    const r = selected();
    setDefault(r.node.id, t.checked);
    changed();
  } else if (t.dataset.obindCheck) {
    S.proj.options[t.dataset.obindCheck] = t.checked;
    changed({ tree: false });
  } else if (t.dataset.obind) {
    S.proj.options[t.dataset.obind] = t.value;
    changed({ tree: false });
  }
});

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (S.proj) quiet(saveNow().then(() => toast('ok', 'Сохранено')));
  }
  if (!typing && e.key === 'Delete' && S.page === 'tree' && S.selId && !$('#modal').innerHTML) quiet(ACTIONS['delete-node']());
});

// ---------- перетаскивание узлов дерева ----------

const clearDrop = () => document.querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-inside'));

document.addEventListener('dragstart', (e) => {
  const row = e.target.closest?.('#tree [data-node]');
  if (!row) return;
  S.drag = row.dataset.node;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', S.drag);
  row.classList.add('dragging');
});
document.addEventListener('dragend', () => {
  S.drag = null;
  clearDrop();
  document.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
});

function dropPos(row, e) {
  const r = row.getBoundingClientRect();
  const k = (e.clientY - r.top) / r.height;
  const node = locate(row.dataset.node)?.node;
  if (node?.type === 'group' && k > 0.28 && k < 0.72) return 'inside';
  return k < 0.5 ? 'before' : 'after';
}

// ---------- файлы из проводника ----------

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $('#dropzone').hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) {
    e.preventDefault();
    clearDrop();
    const box = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.dataset?.dropImage || x.dataset?.node);
    if (box?.dataset.dropImage) box.classList.add('drop-inside');
    else if (box?.dataset.node && locate(box.dataset.node)?.node.type === 'group') box.classList.add('drop-inside');
    return;
  }
  if (!S.drag) return;
  const row = e.target.closest?.('#tree [data-node]');
  const tail = e.target.closest?.('[data-drop-root]');
  clearDrop();
  if (row) {
    const pos = dropPos(row, e);
    if (canDrop(S.drag, row.dataset.node, pos)) {
      e.preventDefault();
      row.classList.add(`drop-${pos}`);
    }
  } else if (tail) {
    e.preventDefault();
    tail.classList.add('drop-inside');
  }
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('#dropzone').hidden = true;
  }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  clearDrop();
  if (S.drag) {
    const row = e.target.closest?.('#tree [data-node]');
    const tail = e.target.closest?.('[data-drop-root]');
    if (row) {
      const pos = dropPos(row, e);
      if (canDrop(S.drag, row.dataset.node, pos)) moveNode(S.drag, row.dataset.node, pos);
    } else if (tail) {
      const d = locate(S.drag);
      d.list.splice(d.index, 1);
      S.proj.tree.push(d.node);
    }
    S.drag = null;
    changed({ inspector: true });
    return;
  }
  dragDepth = 0;
  $('#dropzone').hidden = true;
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  if (paths.length) quiet(handleExternal(paths, document.elementFromPoint(e.clientX, e.clientY)));
});

async function handleExternal(paths, under) {
  const first = paths[0];
  const kind = await call(api.pathKind, first);
  if (kind === 'project' || kind === 'project-file') {
    openState(await call(api.openProject, kind === 'project' ? first : first.replace(/[\\/]project\.json$/i, '')));
    return;
  }
  if (!S.proj) {
    toast('info', 'Сначала создайте или откройте проект', 'Моды добавляются в проект модпака');
    return;
  }
  const imgTarget = under?.closest?.('[data-drop-image]');
  if (imgTarget && /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(first)) {
    setImage(imgTarget.dataset.dropImage, await call(api.storeImage, first));
    return;
  }
  const images = paths.filter((p) => /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(p));
  if (images.length === paths.length) {
    toast('info', 'Это картинка', 'Перетащите её на поле превью или на картинку в «Оформлении»');
    return;
  }
  await addMods(paths.filter((p) => !images.includes(p)), targetGroupFor(under));
}

api.onBuildLog((line) => {
  if (!S.build.running) return;
  S.build.log.push(line);
  const c = $('#console');
  if (c) {
    const div = document.createElement('div');
    div.textContent = line;
    if (/ошибк|error/i.test(line)) div.className = 'err';
    c.append(div);
    c.scrollTop = c.scrollHeight;
  }
});
api.onOpenFile((p) => quiet(handleExternal([p], null)));

// ---------- старт ----------

(async function init() {
  $('#logo').innerHTML = LOGO;
  const st = await call(api.getState);
  S.st = st;
  applyProjectState(st.project);
  render();
}());
