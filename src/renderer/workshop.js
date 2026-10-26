// Мастерская модов, справочник игры и отладчик — раздел «Разработка» студии.
// Работает и без открытого модпака: свои моды хранятся отдельно, в папке Мастерской.
'use strict';

const DEV_PAGES = new Set(['workshop', 'gameref', 'debug']);
const W = {
  st: null,            // состояние Мастерской из главного процесса
  view: 'list',        // list | editor | build
  mod: null,           // открытый мод
  files: [],
  file: null,          // открытый файл
  text: '',
  saved: '',
  errors: [],
  preview: null,       // { image, logs, at }
  previewBusy: false,
  build: null,         // { steps: [...], result, error, running }
  templates: null,
  log: { lines: [], filter: '', mine: true, errorsOnly: false },
  shots: [],
  ref: { q: '', kind: 'all', hits: [], sel: null, detail: null, building: false, progress: '' },
  timers: {},
};
const isDev = () => DEV_PAGES.has(S.page);
const wsPlural = (n, a, b, c) => `${n} ${plural(n, a, b, c)}`;

// ---------- данные ----------

async function wsLoad() {
  W.st = await call(api.ws.state);
  return W.st;
}

const myTags = () => (W.st?.mods || []).map((m) => m.tag).filter(Boolean);

async function wsRefreshLog() {
  if (!W.st?.game) return;
  const r = await call(api.ws.log, { lines: 500 });
  W.log.lines = r.lines;
}

// Пока открыт раздел «Разработка» — следим за игрой и логом
function wsStartPolling() {
  clearInterval(W.timers.poll);
  W.timers.poll = setInterval(async () => {
    if (!isDev() || document.hidden) return;
    try {
      const running = await call(api.ws.running);
      if (W.st?.game && W.st.game.running !== running) {
        W.st.game.running = running;
        renderSidebar();
        if (S.page === 'workshop' && W.view !== 'editor') wsRenderPage();
      }
      if (S.page === 'debug' || (S.page === 'workshop' && W.view === 'list')) {
        const before = W.log.lines.length ? W.log.lines[W.log.lines.length - 1].text : '';
        await wsRefreshLog();
        const after = W.log.lines.length ? W.log.lines[W.log.lines.length - 1].text : '';
        if (before !== after) {
          if (S.page === 'debug') dbgPaintLog();
          else wsPaintFeed();
        }
      }
    } catch { /* следующая попытка через пару секунд */ }
  }, 2500);
}

// ---------- встраивание в каркас студии ----------

const baseRenderSidebar = renderSidebar;
const baseRenderPage = renderPage;
const basePageHome = pageHome;
const baseRender = render;

function devNavHtml() {
  const n = W.st?.mods?.length || 0;
  const items = [['workshop', 'edit', 'Мастерская', n ? `<span class="count">${n}</span>` : ''], ['gameref', 'command', 'Справочник игры', ''], ['debug', 'alert', 'Отладчик', '']];
  return `<div class="nav-label">Разработка</div>${items.map(([page, ic, label, extra]) => `<button class="nav-item ${S.page === page ? 'active' : ''}" data-act="nav" data-page="${page}">${icon(ic, 18)}<span>${label}</span>${extra}</button>`).join('')}`;
}

function gameTipHtml() {
  const g = W.st?.game;
  if (!W.st) return '';
  if (!g) return `<button class="side-game none" data-act="ws-pick-game"><b>Игра не найдена</b><small>Укажите папку «Мира танков»</small></button>`;
  return g.running
    ? `<button class="side-game run" data-act="nav" data-page="debug"><b><span class="dot-run"></span>Игра запущена</b><small>Установка модов подождёт закрытия · ${esc(g.version)}</small></button>`
    : `<button class="side-game" data-act="ws-launch"><b><span class="dot-run off"></span>Игра закрыта</b><small>Можно ставить моды · ${esc(g.version)}</small></button>`;
}

renderSidebar = function () {
  if (S.proj) {
    baseRenderSidebar();
    const sp = document.querySelector('#sidebar .spacer');
    if (sp) sp.insertAdjacentHTML('beforebegin', devNavHtml());
    if (isDev()) document.querySelector('#sidebar .side-tip')?.insertAdjacentHTML('beforebegin', gameTipHtml());
    return;
  }
  const sb = $('#sidebar');
  if (!isDev()) {
    sb.innerHTML = '';
    return;
  }
  sb.innerHTML = `<button class="dev-sidebar-home" data-act="ws-home"><div class="mini-logo">${LOGO}</div><div class="grow"><b>TankAir Studio</b><small>к модпакам</small></div></button>
    ${devNavHtml()}<div class="spacer"></div>${gameTipHtml()}`;
};

render = function () {
  baseRender();
  document.body.classList.toggle('home-mode', !S.proj && !isDev());
  if (isDev()) $('#title-crumb').innerHTML = `/&nbsp;<span class="t-name">${{ workshop: 'Мастерская', gameref: 'Справочник игры', debug: 'Отладчик' }[S.page]}</span>`;
};

renderPage = function () {
  if (!isDev()) {
    baseRenderPage();
    return;
  }
  wsRenderPage();
};

pageHome = function () {
  const html = basePageHome();
  const dev = `<div class="home-dev panel" style="margin-top:22px;display:flex;align-items:center;gap:16px">
    <div class="m-icon" style="width:46px;height:46px">${icon('edit', 22)}</div>
    <div class="grow"><b style="font-size:15px">Мастерская модов</b><div class="mut" style="color:var(--muted);font-size:13px;margin-top:3px">Свои моды для «Мира танков»: окно в ангаре, экран в бою, перехват данных игры — по шаблону, со сборкой и установкой в игру.</div></div>
    <button class="btn" data-act="nav" data-page="gameref">${icon('command', 16)}Справочник игры</button><button class="btn primary" data-act="nav" data-page="workshop">${icon('edit', 16)}Открыть Мастерскую</button></div>`;
  const i = html.lastIndexOf('</div>');
  return i > 0 ? html.slice(0, i) + dev + html.slice(i) : html + dev;
};

function wsRenderPage() {
  const page = $('#page');
  if (!W.st) {
    page.innerHTML = `<div class="ws-empty">Загружаю…</div>`;
    quiet(wsLoad().then(() => { render(); }));
    return;
  }
  if (S.page === 'gameref') {
    page.innerHTML = refPage();
    refMount();
    return;
  }
  if (S.page === 'debug') {
    page.innerHTML = dbgPage();
    dbgPaintLog();
    return;
  }
  if (W.view === 'editor' && W.mod) {
    page.innerHTML = edPage();
    edMount();
    return;
  }
  if (W.view === 'build' && W.mod) {
    page.innerHTML = wsbPage();
    return;
  }
  page.innerHTML = wsListPage();
  wsPaintFeed();
}

// ---------- 1. список модов ----------

const TPL_ART = {
  hangar: icon('hangar', 40), battle: icon('crosshair', 40), hook: icon('zap', 40), config: icon('settings', 40), files: icon('file', 40), blank: icon('plus', 40),
};
const TPL_BG = { hangar: 'linear-gradient(135deg,#3a2614,#120c08)', battle: 'linear-gradient(135deg,#132535,#081018)', hook: 'linear-gradient(135deg,#1b1b2b,#0b0b12)', config: 'linear-gradient(135deg,#2c2a14,#100f07)', files: 'linear-gradient(135deg,#132a1f,#08120d)', blank: 'linear-gradient(135deg,#1c1d22,#0d0e10)' };
const TPL_TECH = { hangar: 'Gameface', battle: 'Flash', hook: 'Python', config: 'Python', files: 'Файлы', blank: 'Python' };

function gameBarHtml() {
  const st = W.st;
  const g = st.game;
  const tools = `${st.tools.python ? 'Python 2.7' : '<span style="color:var(--bad)">нет Python 2.7</span>'} · ${st.tools.haxe ? 'Haxe 4.3' : '<span style="color:var(--bad)">нет Haxe</span>'}`;
  if (!g) {
    return `<div class="ws-game"><span class="gi bad">${icon('alert', 20)}</span><div><b>Игра не найдена</b><small>Укажите папку, где установлен «Мир танков» — туда студия будет ставить моды</small></div>
      <div class="acts"><button class="btn primary" data-act="ws-pick-game">${icon('folder', 16)}Указать папку игры</button></div></div>`;
  }
  return `<div class="ws-game"><span class="gi">${icon('target', 20)}</span>
    <div><b>Мир танков ${esc(g.version)}</b><small>${esc(g.dir)} · моды в mods\\${esc(g.version)}</small></div><span class="sep"></span>
    <div><b><span class="dot-run ${g.running ? '' : 'off'}"></span>${g.running ? 'Игра запущена' : 'Игра закрыта'}</b><small>${g.running ? 'установка подождёт закрытия' : 'установка сразу'}</small></div><span class="sep"></span>
    <div><b>${tools}</b><small>сборщики встроены в студию</small></div>
    <div class="acts">${g.running ? `<button class="btn" data-act="ws-kill">${icon('square', 15)}Закрыть игру</button>` : `<button class="btn" data-act="ws-launch">${icon('play', 15)}Запустить игру</button>`}
      <button class="btn" data-act="ws-open-path" data-path="${esc(g.modsDir)}">${icon('folder', 15)}Папка модов</button><button class="btn ghost icon-only" data-act="ws-pick-game" title="Другая папка игры">${icon('settings', 15)}</button></div></div>`;
}

function modStatusChip(m) {
  if (m.broken) return '<span class="chip bad">ошибка в workshop.json</span>';
  if (m.installed && m.installed === m.version && !m.dirty) return `<span class="chip ok">● в игре ${esc(m.installed)}</span>`;
  if (m.dirty && m.lastBuild) return '<span class="chip warn">изменён · не собран</span>';
  if (!m.lastBuild) return '<span class="chip">не собран</span>';
  if (m.installed) return `<span class="chip warn">в игре ${esc(m.installed)} · есть ${esc(m.version)}</span>`;
  return `<span class="chip">собран ${esc(m.lastBuild.version)}</span>`;
}

function wsListPage() {
  const mods = W.st.mods;
  const cards = mods.map((m) => `<div class="ws-mod" data-act="ws-open" data-dir="${esc(m.dir)}">
      <div class="pv" style="background:${m.preview ? `url('${esc(fileUrl(m.preview))}') center/cover` : TPL_BG[m.template] || TPL_BG.blank}">${m.preview ? '' : `<span style="color:var(--accent);opacity:.75;position:relative;z-index:0">${TPL_ART[m.template] || TPL_ART.blank}</span>`}
        <div class="chips">${modStatusChip(m)}</div><span class="chip tech glass">${esc(TPL_TECH[m.template] || '')}</span></div>
      <div class="bd"><b>${esc(m.name)}</b><div class="id">${esc(m.id)} · ${esc(m.version)}</div>${m.description ? `<p>${esc(m.description)}</p>` : ''}
        <div class="acts"><button class="btn sm primary" data-act="ws-build" data-dir="${esc(m.dir)}">${icon('build', 14)}Собрать</button>
          <button class="btn sm" data-act="ws-install" data-dir="${esc(m.dir)}" ${m.lastBuild ? '' : 'disabled'}>${icon('upload', 14)}Поставить</button>
          <button class="btn sm" data-act="ws-open" data-dir="${esc(m.dir)}">Открыть</button></div></div></div>`).join('');
  return `${head('Мастерская', `Свои моды для «Мира танков»: шаблон, редактор, сборка и установка в игру. Моды лежат в ${esc(W.st.root)}`,
    `<button class="btn" data-act="ws-open-path" data-path="${esc(W.st.root)}">${icon('folder', 16)}Папка модов студии</button><button class="btn primary" data-act="ws-new">${icon('plus', 16)}Новый мод</button>`)}
    ${gameBarHtml()}
    <div class="ws-mods">${cards}
      <div class="ws-mod new" data-act="ws-new"><div><div class="plus">${icon('plus', 26)}</div><b style="font-size:14px">Новый мод</b><p style="color:var(--muted);font-size:12px;margin:6px auto 0;line-height:1.5;max-width:230px">Окно в ангаре, экран в бою, перехват данных игры или замена файлов — по шаблону за минуту</p></div></div>
    </div>
    <div class="panel ws-feed"><div style="display:flex;align-items:center;margin-bottom:8px"><h2 style="margin:0">Последние события в игре</h2><button class="btn sm" style="margin-left:auto" data-act="nav" data-page="debug">${icon('alert', 14)}Отладчик</button></div><div id="ws-feed"></div></div>`;
}

const fileUrl = (p) => `file:///${String(p).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')}`;

function logLineHtml(l, mine) {
  return `<div class="log-line ${l.kind} ${mine ? 'mine' : ''}"><span class="t">${esc(l.time)}</span>${l.tag ? `<span class="tag">[${esc(l.tag)}]</span>` : ''}<span>${esc(l.text)}</span></div>`;
}

function wsPaintFeed() {
  const el = $('#ws-feed');
  if (!el) return;
  if (!W.st.game) {
    el.innerHTML = '<div style="color:var(--muted)">Укажите папку игры, чтобы видеть её лог.</div>';
    return;
  }
  const tags = myTags();
  const rows = W.log.lines.filter((l) => tags.some((t) => l.tag.startsWith(t))).slice(-6);
  el.innerHTML = rows.length ? rows.map((l) => logLineHtml(l, true)).join('') : '<div style="color:var(--muted)">Ваши моды пока ничего не писали в python.log — соберите мод, поставьте в игру и запустите её.</div>';
  if (!W.log.lines.length) quiet(wsRefreshLog().then(() => { if ($('#ws-feed') && W.log.lines.length) wsPaintFeed(); }));
}

// ---------- новый мод ----------

async function wsNewDialog() {
  W.templates ||= await call(api.ws.templates);
  let tpl = 'hangar';
  const filesFor = (t, py) => {
    const base = ['meta.xml', `scripts/…/mod_${py}.py`, `scripts/…/${py}.py`];
    if (t === 'hangar') base.push(`gameface/mods/${py}/…html`, 'res_map.json — регистрация экрана сама');
    if (t === 'battle') base.push('flash/src/…UI.hx → gui/flash/….swf');
    if (t === 'files') return ['meta.xml', 'res/ — ваши файлы с путями как в игре'];
    return base;
  };
  const slug = (s) => String(s || '').toLowerCase().replace(/[а-яё]/g, (c) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }[c])).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'my_mod';
  const author = W.st.mods.find((m) => m.author)?.author || '';
  const r = await modal({
    title: 'Новый мод', sub: 'Выберите, что будет делать мод, — студия создаст рабочий каркас с комментариями', ic: 'plus', wide: true,
    body: `<div class="nm"><div class="l"><div class="tpl-grid">${W.templates.map((t) => `<button type="button" class="tpl ${t.id === tpl ? 'on' : ''}" data-tpl="${t.id}"><div class="tp" style="background:${TPL_BG[t.id]}">${TPL_ART[t.id]}<span class="chip glass">${esc(t.tech)}</span></div><div class="tb"><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></div></button>`).join('')}</div></div>
      <div class="r"><label class="field"><span>Название</span><input class="input" name="name" value="Мой мод" autocomplete="off"></label>
        <label class="field"><span>Идентификатор</span><input class="input" name="id" value="${esc(author ? `${slug(author)}.my_mod` : 'my.my_mod')}" autocomplete="off"></label>
        <div class="kv2"><label class="field"><span>Версия</span><input class="input" name="version" value="0.1"></label><label class="field"><span>Автор</span><input class="input" name="author" value="${esc(author)}"></label></div>
        <div class="field"><span>Будут созданы файлы</span><div class="nm-files" id="nm-files"></div></div>
        <input type="hidden" name="template" value="${tpl}"></div></div>`,
    actions: [{ label: 'Отмена', value: null }, { label: 'Создать мод', value: 'ok', primary: true }],
    onMount: (root) => {
      root.querySelector('.modal').classList.add('xwide');
      const nameEl = root.querySelector('[name=name]');
      const idEl = root.querySelector('[name=id]');
      let idTouched = false;
      const paint = () => {
        const py = slug(nameEl.value);
        root.querySelector('#nm-files').innerHTML = filesFor(tpl, py).map((f) => `<div>${esc(f)}</div>`).join('');
      };
      idEl.addEventListener('input', () => { idTouched = true; });
      nameEl.addEventListener('input', () => {
        if (!idTouched) idEl.value = `${slug(author || 'my')}.${slug(nameEl.value)}`;
        paint();
      });
      root.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
        tpl = b.dataset.tpl;
        root.querySelector('[name=template]').value = tpl;
        root.querySelectorAll('[data-tpl]').forEach((x) => x.classList.toggle('on', x === b));
        paint();
      }));
      nameEl.select();
      paint();
    },
  });
  if (r?.action !== 'ok') return;
  const m = await call(api.ws.create, { template: r.data.template, name: r.data.name.trim() || 'Мой мод', id: r.data.id.trim(), version: r.data.version.trim() || '0.1', author: r.data.author.trim() });
  await wsLoad();
  toast('ok', 'Мод создан', `${m.name} · ${m.id}`);
  await wsOpen(m.dir);
}

// ---------- 2. редактор ----------

const FILE_COL = { py: '#82aaff', html: '#f78c6c', css: '#c792ea', xml: '#ffcf7a', hx: '#5cc98a', json: '#e8d26a', txt: '#b9b3a7', swf: '#6aa8ff', pyc: '#545861' };
const extOf = (rel) => (rel.match(/\.(\w+)$/)?.[1] || '').toLowerCase();

async function wsOpen(dir, file) {
  W.mod = await call(api.ws.mod, dir);
  W.files = await call(api.ws.tree, dir);
  W.view = 'editor';
  W.preview = null;
  W.errors = [];
  const main = W.files.find((f) => f.rel.endsWith(`/${W.mod.py}.py`)) || W.files.find((f) => f.text && f.rel.endsWith('.py')) || W.files.find((f) => f.text);
  S.page = 'workshop';
  await edLoadFile(file || main?.rel || null);
  render();
  $('#page').scrollTop = 0;
}

async function edLoadFile(rel) {
  W.file = rel;
  W.text = rel ? await call(api.ws.read, W.mod.dir, rel) : '';
  W.saved = W.text;
  W.errors = [];
}

const pageFiles = () => W.files.filter((f) => f.rel.endsWith('.html'));

function edPage() {
  const m = W.mod;
  const groups = {};
  for (const f of W.files) {
    const parts = f.rel.split('/');
    const dir = parts.slice(0, -1).join('/').replace(/^src\/res\/scripts\/client\/gui\/mods$/, 'scripts / mods').replace(/^src\/res\/gui\/gameface\/mods\/.+/, 'gameface').replace(/^flash\/src.*/, 'flash').replace(/^src$/, 'мод');
    (groups[dir] ||= []).push(f);
  }
  const tree = Object.entries(groups).map(([dir, files]) => `<div class="dir">▾ ${esc(dir)}</div>${files.map((f) => {
    const ext = extOf(f.rel);
    return `<button class="f ${f.rel === W.file ? 'on' : ''} ${f.text ? '' : 'bin'}" ${f.text ? `data-act="ed-file" data-rel="${esc(f.rel)}"` : ''} title="${esc(f.rel)}"><i style="background:${FILE_COL[ext] || '#8a857b'}">${esc(ext.slice(0, 3).toUpperCase())}</i>${esc(f.rel.split('/').pop())}</button>`;
  }).join('')}`).join('');
  const pages = pageFiles();
  const canPack = !!S.proj;
  return `<div class="ws-head"><button class="btn ghost icon-only ws-back" data-act="ws-back" title="К списку модов">${icon('arrow', 16)}</button><h1>${esc(m.name)}</h1>
      <span class="chip">${esc(m.id)} · ${esc(m.version)}</span>${modStatusChip(m)}
      <div class="acts">${canPack ? `<button class="btn" data-act="ws-to-modpack" ${m.lastBuild ? '' : 'disabled'} title="Добавить последнюю сборку в открытый модпак">${icon('import', 15)}В модпак</button>` : ''}
        <button class="btn" data-act="ws-open-path" data-path="${esc(m.dir)}">${icon('folder', 15)}Папка</button>
        <button class="btn" data-act="ws-install" data-dir="${esc(m.dir)}" ${m.lastBuild ? '' : 'disabled'}>${icon('upload', 15)}Поставить в игру</button>
        <button class="btn primary" data-act="ws-build" data-dir="${esc(m.dir)}">${icon('build', 15)}Собрать .mtmod <kbd style="margin-left:4px">Ctrl B</kbd></button></div></div>
    <div class="ide">
      <div class="ide-files">${tree}</div>
      <div class="ide-code">
        <div class="ide-tabs"><span class="name">${esc((W.file || 'нет файлов').split('/').pop())}</span><span class="mod" id="ed-dirty">${W.text !== W.saved ? '● изменён' : ''}</span><span class="sp"></span><span style="color:var(--muted)">Ctrl+S — сохранить и проверить</span></div>
        <div class="ed"><div class="gut" id="ed-gut"></div><div class="wrap"><pre id="ed-hl"></pre><textarea id="ed-ta" spellcheck="false" ${W.file ? '' : 'disabled'}></textarea></div></div>
        <div class="ide-lint" id="ed-lint"></div>
      </div>
      <div class="ide-side">
        ${pages.length ? `<div class="panel"><div style="display:flex;align-items:center;margin-bottom:8px"><h2 style="margin:0">Превью страницы</h2><button class="btn sm" style="margin-left:auto" data-act="ed-preview">${icon('refresh', 14)}Обновить</button></div>
          <div class="pv-shot" id="ed-pv" data-act="ed-preview-big" title="Открыть крупно" style="cursor:zoom-in">${W.preview ? '' : 'Нажмите «Обновить» или сохраните страницу'}</div><div id="ed-pv-logs" class="mini-log" style="${W.preview?.logs?.length ? '' : 'display:none'}"></div></div>` : ''}
        <div class="panel"><h2>Карточка мода</h2>
          <div class="kv2" style="margin-top:8px"><label class="field"><span>Название</span><input class="input" data-wsbind="name" value="${esc(m.name)}"></label><label class="field"><span>Версия</span><input class="input" data-wsbind="version" value="${esc(m.version)}"></label></div>
          <label class="field" style="margin-top:8px"><span>Автор</span><input class="input" data-wsbind="author" value="${esc(m.author || '')}"></label>
          <label class="field" style="margin-top:8px"><span>Описание</span><input class="input" data-wsbind="description" value="${esc(m.description || '')}" placeholder="Что делает мод"></label>
          <div class="build-list">${(m.builds || []).slice(0, 4).map((b) => `<div class="b">${icon('build', 13)}${esc(b.version)}<span>${fmtSize(b.size)} · ${fmtDate(b.builtAt)}</span></div>`).join('') || '<div style="color:var(--muted);font-size:12px">Ещё не собирался</div>'}</div>
          <button class="btn sm danger" style="margin-top:12px" data-act="ws-delete">${icon('trash', 14)}Удалить мод</button></div>
        <div class="panel"><div style="display:flex;align-items:center"><h2 style="margin:0">Лог мода</h2><button class="btn sm" style="margin-left:auto" data-act="nav" data-page="debug">Отладчик</button></div><div class="mini-log" id="ed-log"></div></div>
      </div>
    </div>`;
}

// ---------- подсветка кода ----------

const PY_KW = /\b(def|class|return|import|from|as|if|elif|else|for|while|try|except|finally|with|in|not|and|or|is|None|True|False|pass|break|continue|global|lambda|yield|raise|del|print|assert)\b/;
function hlPython(src) {
  const re = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|[ubrUBR]{0,2}"(?:\\.|[^"\\\n])*"|[ubrUBR]{0,2}'(?:\\.|[^'\\\n])*')|\b(def|class)(\s+)([A-Za-z_]\w*)|\b(\d+(?:\.\d+)?)\b|\b(def|class|return|import|from|as|if|elif|else|for|while|try|except|finally|with|in|not|and|or|is|None|True|False|pass|break|continue|global|lambda|yield|raise|del|print|assert|self)\b/g;
  let out = '';
  let last = 0;
  for (const m of src.matchAll(re)) {
    out += esc(src.slice(last, m.index));
    if (m[1]) out += `<span class="hl-c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="hl-s">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="hl-k">${m[3]}</span>${m[4]}<span class="hl-f">${esc(m[5])}</span>`;
    else if (m[6]) out += `<span class="hl-n">${m[6]}</span>`;
    else out += `<span class="hl-k">${m[7]}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}
function hlMarkup(src) {
  const re = /(<!--[\s\S]*?-->)|(<\/?)([\w-]+)((?:\s+[\w-:]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?>)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/g;
  let out = '';
  let last = 0;
  for (const m of src.matchAll(re)) {
    out += esc(src.slice(last, m.index));
    if (m[1] || m[6]) out += `<span class="hl-c">${esc(m[1] || m[6])}</span>`;
    else if (m[3]) {
      const attrs = esc(m[4]).replace(/([\w-:]+)(=)(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="hl-a">$1</span>$2<span class="hl-s">$3</span>');
      out += `${esc(m[2])}<span class="hl-t">${m[3]}</span>${attrs}${esc(m[5])}`;
    } else out += `<span class="hl-s">${esc(m[7])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}
function highlight(rel, src) {
  const ext = extOf(rel || '');
  if (ext === 'py') return hlPython(src);
  if (['html', 'htm', 'xml', 'css', 'hx', 'js', 'json'].includes(ext)) return hlMarkup(src);
  return esc(src);
}

function edPaint() {
  const ta = $('#ed-ta');
  if (!ta) return;
  $('#ed-hl').innerHTML = `${highlight(W.file, W.text)}\n`;
  const n = W.text.split('\n').length;
  const bad = new Set(W.errors.map((e) => e.line));
  $('#ed-gut').innerHTML = Array.from({ length: n }, (_, i) => `<div class="${bad.has(i + 1) ? 'er' : ''}">${i + 1}</div>`).join('');
  $('#ed-dirty').textContent = W.text !== W.saved ? '● изменён' : '';
  edLint();
}

function edLint() {
  const el = $('#ed-lint');
  if (!el) return;
  if (!W.file) { el.innerHTML = ''; return; }
  if (W.errors.length) {
    el.innerHTML = W.errors.map((e) => `<span class="chip bad">${icon('alert', 12)}${e.line ? `строка ${e.line}: ` : ''}${esc(e.msg)}</span>`).join('');
    return;
  }
  const ext = extOf(W.file);
  el.innerHTML = ext === 'py' ? '<span class="chip ok">✓ синтаксис Python 2.7</span><span style="color:var(--muted)">проверка при каждом сохранении</span>'
    : ext === 'html' ? '<span class="chip ok">Gameface</span><span style="color:var(--muted)">только flex, rem, без CSS-переменных и grid</span>'
      : ext === 'hx' ? '<span class="chip">Haxe → SWF при сборке</span>' : '';
}

function edMount() {
  const ta = $('#ed-ta');
  if (!ta) return;
  ta.value = W.text;
  const hl = $('#ed-hl');
  const gut = $('#ed-gut');
  ta.addEventListener('scroll', () => {
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
    gut.scrollTop = ta.scrollTop;
  });
  ta.addEventListener('input', () => {
    W.text = ta.value;
    edPaint();
    hl.scrollTop = ta.scrollTop;
    gut.scrollTop = ta.scrollTop;
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText('    ', s, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter') {
      // перенос строки с отступом предыдущей (и +4 после двоеточия в Python)
      e.preventDefault();
      const s = ta.selectionStart;
      const line = ta.value.slice(ta.value.lastIndexOf('\n', s - 1) + 1, s);
      let ind = line.match(/^\s*/)[0];
      if (extOf(W.file) === 'py' && /:\s*$/.test(line)) ind += '    ';
      ta.setRangeText(`\n${ind}`, s, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  });
  edPaint();
  if (W.preview) edShowPreview();
  edPaintLog();
}

async function edSave() {
  if (!W.mod || !W.file || W.text === W.saved) return;
  const r = await call(api.ws.write, W.mod.dir, W.file, W.text);
  W.saved = W.text;
  W.errors = r.errors || [];
  edPaint();
  W.mod = await call(api.ws.mod, W.mod.dir);
  if (W.errors.length) toast('bad', 'Ошибка в коде', `строка ${W.errors[0].line}: ${W.errors[0].msg}`);
  if (W.file.endsWith('.html')) quiet(edPreview());
}

async function edPreview() {
  const page = W.file?.endsWith('.html') ? W.file : pageFiles()[0]?.rel;
  if (!page || W.previewBusy) return;
  W.previewBusy = true;
  try {
    W.preview = await call(api.ws.preview, W.mod.dir, page);
    edShowPreview();
  } finally {
    W.previewBusy = false;
  }
}

function edShowPreview() {
  const el = $('#ed-pv');
  if (!el || !W.preview) return;
  el.style.backgroundImage = `url('${W.preview.image}')`;
  el.innerHTML = '<span class="chip ok">● образец данных из preview.json</span>';
  const logs = $('#ed-pv-logs');
  if (logs) {
    logs.style.display = W.preview.logs.length ? '' : 'none';
    logs.innerHTML = W.preview.logs.map((l) => `<div class="log-line ${/ошибка/i.test(l) ? 'error' : ''}"><span>${esc(l)}</span></div>`).join('');
  }
}

function edPaintLog() {
  const el = $('#ed-log');
  if (!el) return;
  const rows = W.log.lines.filter((l) => W.mod && l.tag.startsWith(W.mod.tag)).slice(-8);
  el.innerHTML = rows.length ? rows.map((l) => logLineHtml(l)).join('') : `<div style="color:var(--muted);font-size:12px">Строки с [${esc(W.mod?.tag || '')}] из python.log появятся здесь после запуска игры с модом.</div>`;
}

// ---------- 3. сборка и установка ----------

function wsbPage() {
  const m = W.mod;
  const b = W.build;
  const steps = W.st.steps.map((s, i) => {
    const st = b.steps[i] || { state: 'wait', detail: '' };
    const mark = st.state === 'done' ? icon('check', 14) : st.state === 'fail' ? icon('x', 14) : st.state === 'skip' ? '–' : '';
    return `<div class="wsb-step ${st.state}"><span class="st">${mark}</span><div class="grow"><b>${esc(s.title)}</b><small>${esc(st.detail || (st.state === 'wait' ? 'ждёт' : st.state === 'run' ? 'идёт…' : ''))}</small></div>${st.ms != null ? `<span class="t">${(st.ms / 1000).toFixed(1).replace('.', ',')} с</span>` : ''}</div>`;
  }).join('');
  const g = W.st.game;
  const res = b.result;
  const card = res ? `<div class="wsb-card"><div class="top"><span class="chip glass" style="align-self:flex-start;margin-bottom:auto">${b.installed ? 'установлен в игру' : 'готово к установке'}</span><h3>${esc(res.version)}</h3><span style="color:rgba(255,255,255,.75);font-size:12px">${esc(m.id)} · Мир танков ${esc(g?.version || '')}</span></div>
      <div class="bd"><div class="wsb-file"><span class="ic">${icon('file', 18)}</span><div class="grow"><b>${esc(res.file.split(/[\\/]/).pop())}</b><small>${fmtSize(res.size)} · dist</small></div><button class="btn sm ghost" data-act="ws-show" data-path="${esc(res.file)}">${icon('folder', 14)}</button></div>
      ${b.installed ? `<div style="color:var(--ok);font-weight:600">${icon('check', 14)} Стоит в mods\\${esc(g?.version || '')}</div>${g?.running ? '<div style="color:var(--muted);font-size:12.5px">Игра запущена — мод заработает после перезапуска игры.</div>' : `<button class="btn primary" data-act="ws-launch">${icon('play', 15)}Запустить игру</button>`}<button class="btn" data-act="nav" data-page="debug">${icon('alert', 15)}Открыть отладчик</button>`
    : !g ? `<div style="color:var(--muted);font-size:12.5px">Игра не найдена — укажите её папку, чтобы ставить моды.</div><button class="btn" data-act="ws-pick-game">${icon('folder', 15)}Указать папку игры</button>`
      : g.running ? `<b style="margin-top:4px">Игра запущена</b><div style="color:var(--muted);font-size:12.5px;line-height:1.5">Файл мода занят игрой. Студия может закрыть игру и сразу поставить мод.</div><button class="btn primary" data-act="ws-install" data-dir="${esc(m.dir)}" data-kill="1">${icon('square', 15)}Закрыть игру и поставить</button><button class="btn" data-act="ws-install" data-dir="${esc(m.dir)}">Попробовать снова</button>`
        : `<button class="btn primary" data-act="ws-install" data-dir="${esc(m.dir)}">${icon('upload', 15)}Поставить в игру</button>`}
      ${S.proj ? `<button class="btn" data-act="ws-to-modpack">${icon('import', 15)}Добавить в модпак «${esc(S.proj.info.name)}»</button>` : ''}</div></div>`
    : `<div class="wsb-card"><div class="top"><h3>${esc(m.version)}</h3><span style="color:rgba(255,255,255,.75);font-size:12px">${esc(m.id)}</span></div><div class="bd"><div style="color:var(--muted);font-size:12.5px">${b.error ? 'Сборка не удалась — исправьте ошибку и соберите снова.' : 'Собираю…'}</div>${b.error ? `<button class="btn primary" data-act="ws-build" data-dir="${esc(m.dir)}">${icon('refresh', 15)}Собрать снова</button>` : ''}</div></div>`;
  return `<div class="ws-head"><button class="btn ghost icon-only ws-back" data-act="ws-back-editor" title="К редактору">${icon('arrow', 16)}</button><h1>Сборка ${esc(m.name)} ${esc(m.version)}</h1>
      ${b.running ? '<span class="chip warn">идёт</span>' : b.error ? '<span class="chip bad">ошибка</span>' : '<span class="chip ok">готово</span>'}
      <div class="acts"><button class="btn" data-act="ws-back-editor">${icon('edit', 15)}К коду</button></div></div>
    <div class="wsb"><div class="panel"><h2>Этапы</h2><p class="sub">Те же шаги, что у сборки мода TankAir: Python 2.7 той же версии, что у игры, Haxe для Flash, упаковка .mtmod</p><div class="wsb-steps">${steps}</div></div>${card}</div>`;
}

async function wsBuild(dir) {
  if (W.mod?.dir === dir && W.text !== W.saved) await edSave();
  if (!W.mod || W.mod.dir !== dir) W.mod = await call(api.ws.mod, dir);
  W.build = { steps: [], running: true, result: null, error: null, installed: false };
  W.view = 'build';
  S.page = 'workshop';
  render();
  try {
    const r = await call(api.ws.build, dir);
    W.build.result = r.entry;
    W.mod = r.mod;
    toast('ok', 'Мод собран', r.entry.file.split(/[\\/]/).pop());
  } catch (e) {
    W.build.error = e.message;
  } finally {
    W.build.running = false;
    await wsLoad();
    if (S.page === 'workshop' && W.view === 'build') wsRenderPage();
  }
}

api.ws.onStep((p) => {
  if (!W.build || p.dir !== W.mod?.dir) return;
  W.build.steps[p.i] = { state: p.state, detail: p.detail, ms: p.ms };
  if (S.page === 'workshop' && W.view === 'build') wsRenderPage();
});

async function wsInstall(dir, kill) {
  const res = await api.ws.install(dir, { kill: !!kill });
  if (!res.ok) {
    if (res.error === 'GAME_RUNNING') {
      const ok = await confirmBox('Игра запущена', 'Файл мода занят игрой. Закрыть игру и поставить мод?', 'Закрыть игру и поставить');
      if (ok) return wsInstall(dir, true);
      return;
    }
    toast('bad', 'Не удалось поставить мод', res.error);
    return;
  }
  toast('ok', 'Мод в игре', res.data.file);
  if (W.mod?.dir === dir) W.mod = res.data.mod;
  if (W.build && W.mod?.dir === dir) W.build.installed = true;
  await wsLoad();
  render();
}

// ---------- 4. справочник игры ----------

function refPage() {
  const st = W.st.ref;
  if (!W.st.game) {
    return `${head('Справочник игры', 'Классы, методы и Flash-компоненты текущей версии игры')}<div class="panel"><div class="ref-empty"><div><b>Игра не найдена</b>Укажите папку «Мира танков» — справочник строится из её файлов.<div style="margin-top:14px"><button class="btn primary" data-act="ws-pick-game">${icon('folder', 15)}Указать папку игры</button></div></div></div></div>`;
  }
  const meta = st.ready ? `<span class="chip">Мир танков ${esc(st.version)} · ${wsPlural(st.modules, 'модуль', 'модуля', 'модулей')} · ${wsPlural(st.classes, 'класс', 'класса', 'классов')} Python · ${st.flash} Flash</span>` : '';
  const actions = `<button class="btn" data-act="ref-build" ${W.ref.building ? 'disabled' : ''}>${icon('refresh', 15)}${st.ready ? 'Обновить после патча' : 'Построить справочник'}</button>`;
  if (!st.ready) {
    return `${head('Справочник игры', 'Классы, методы и Flash-компоненты текущей версии игры — чтобы знать, что можно перехватить в моде', actions)}
      <div class="panel"><div class="ref-empty"><div><b>${W.ref.building ? esc(W.ref.progress || 'Строю справочник…') : 'Справочник ещё не построен'}</b>Студия разберёт скрипты клиента ${esc(W.st.game.version)} тем же Python 2.7, что у игры, и классы Flash. Около полуминуты; файлы игры не меняются и никуда не отправляются.
        ${W.ref.building ? '' : `<div style="margin-top:14px"><button class="btn primary" data-act="ref-build">${icon('zap', 15)}Построить</button></div>`}</div></div></div>`;
  }
  return `<div class="page-head"><div><h1>Справочник игры</h1><p>${meta}</p></div><div class="actions">${actions}</div></div>
    <div class="ref"><div class="ref-list">
      <div class="ref-q">${icon('search', 18)}<input id="ref-q" placeholder="Класс, метод или функция: BattleResults, as_setDataS…" value="${esc(W.ref.q)}" autocomplete="off"></div>
      <div class="ref-kinds">${[['all', 'Всё'], ['python', 'Python'], ['flash', 'Flash']].map(([k, n]) => `<button data-act="ref-kind" data-kind="${k}" class="${W.ref.kind === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="results" id="ref-results"></div></div>
      <div class="ref-detail" id="ref-detail"></div></div>`;
}

const hlq = (text, q) => {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 || !q ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
};

function refPaintResults() {
  const el = $('#ref-results');
  if (!el) return;
  if (W.ref.q.trim().length < 2) {
    el.innerHTML = `<div style="color:var(--muted);font-size:12.5px;padding:10px 4px;line-height:1.6">Начните вводить имя. Например:<br>${['BattleResultsMeta', 'Hangar', 'CurrentVehicle', 'as_setDataS', 'AbstractView'].map((x) => `<button class="btn sm ghost" data-act="ref-try" data-q="${x}" style="margin:4px 4px 0 0">${x}</button>`).join('')}</div>`;
    return;
  }
  if (!W.ref.hits.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12.5px;padding:10px 4px">Ничего не найдено</div>';
    return;
  }
  const kindName = { class: 'класс', method: 'метод', function: 'функция', module: 'модуль', interface: 'интерфейс' };
  el.innerHTML = W.ref.hits.map((h, i) => `<button class="hit ${W.ref.sel === i ? 'on' : ''}" data-act="ref-pick" data-i="${i}"><span class="chip ${h.lang === 'python' ? 'ok' : ''}">${h.lang === 'python' ? 'Python' : 'Flash'}</span><b>${hlq(h.name, W.ref.q.trim())}</b><small>${esc(kindName[h.kind] || h.kind)} · ${esc(h.mod || h.file || '')}</small></button>`).join('');
}

function refPaintDetail() {
  const el = $('#ref-detail');
  if (!el) return;
  const d = W.ref.detail;
  if (!d) {
    el.innerHTML = `<div class="ref-empty"><div><b>Выберите класс или метод</b>Здесь будут его методы с аргументами и кнопка, которая вставит готовый перехват в ваш мод.</div></div>`;
    return;
  }
  const target = W.mod ? `в «${esc(W.mod.name)}»` : 'в мод';
  if (d.lang === 'flash') {
    el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h2>${esc(d.name)}</h2><span class="chip">Flash · ${esc(d.file)}</span></div>
      <p style="color:var(--muted);font-size:12.5px;margin:8px 0 0">Наследует <b style="color:var(--text);font-family:Consolas">${esc(d.super)}</b>${d.ifaces.length ? ` · реализует ${d.ifaces.map(esc).join(', ')}` : ''}. Класс из ${esc(d.file)} — его можно наследовать в своём Flash-экране (как AbstractView в шаблоне «Экран в бою»).</p>
      <div class="mems">${d.members.map((t) => `<div class="mem"><div class="nm2"><span class="vis">${esc(t.v)} ${esc(t.k)}</span> <b>${esc(t.n)}</b>${t.k === 'var' ? `:${esc(t.t)}` : `(${(t.a || []).map(esc).join(', ')}):${esc(t.t)}`}</div></div>`).join('')}</div>`;
    return;
  }
  if (d.kind === 'module') {
    el.innerHTML = `<h2>${esc(d.mod)}</h2><p style="color:var(--muted);font-size:12.5px;margin:6px 0 0;font-family:Consolas">${esc(d.file)}</p>
      <h3 style="margin:16px 0 0;font-size:14px">Классы</h3><div class="mems">${d.classes.map((c) => `<div class="mem"><div class="nm2"><b>${esc(c)}</b></div><button data-act="ref-open-class" data-mod="${esc(d.mod)}" data-cls="${esc(c)}">Открыть</button></div>`).join('') || '<div style="color:var(--muted)">нет</div>'}</div>
      <h3 style="margin:16px 0 0;font-size:14px">Функции</h3><div class="mems">${d.functions.map(([f, a]) => `<div class="mem"><div class="nm2"><b>${esc(f)}</b>(${a.map(esc).join(', ')})</div></div>`).join('') || '<div style="color:var(--muted)">нет</div>'}</div>`;
    return;
  }
  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h2>${esc(d.name)}</h2><span class="chip ok">Python</span><span class="chip">${wsPlural(d.methods.length, 'метод', 'метода', 'методов')}</span></div>
    <p style="color:var(--muted);font-size:12.5px;margin:8px 0 0;line-height:1.5"><span style="font-family:Consolas;color:var(--text-2)">from ${esc(d.mod)} import ${esc(d.name)}</span><br>Кнопка «Перехватить» добавит ${target} обёртку метода: ваш код выполнится сразу после игрового.</p>
    <div class="mems">${d.methods.map(([mn, args]) => `<div class="mem ${d.focus === mn ? 'focus' : ''}"><div class="nm2"><b>${esc(mn)}</b>(${args.map(esc).join(', ')})</div><button data-act="ref-intercept" data-method="${esc(mn)}" title="Вставить перехват ${target}">Перехватить</button></div>`).join('')}</div>`;
}

function refMount() {
  const q = $('#ref-q');
  if (!q) return;
  q.addEventListener('input', () => {
    W.ref.q = q.value;
    clearTimeout(W.timers.ref);
    W.timers.ref = setTimeout(refSearch, 160);
  });
  refPaintResults();
  refPaintDetail();
  q.focus();
}

async function refSearch() {
  W.ref.hits = W.ref.q.trim().length >= 2 ? await call(api.ref.search, W.ref.q, W.ref.kind) : [];
  W.ref.sel = null;
  refPaintResults();
}

api.ref.onProgress((m) => {
  W.ref.progress = m;
  if (S.page === 'gameref') wsRenderPage();
});

// Вставляет перехват метода в главный файл мода: функцию — перед def init(), подключение — в конец init()
function insertIntercept(src, snippet) {
  const lines = src.split('\n');
  const initAt = lines.findIndex((l) => /^def init\(\):/.test(l));
  if (initAt < 0) throw new Error('В файле нет функции init()');
  let end = initAt + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]))) end++;
  while (end > initAt + 1 && lines[end - 1].trim() === '') end--;
  const body = snippet.init.split('\n');
  const out = [...lines.slice(0, end), ...body, ...lines.slice(end)];
  const funcAt = out.findIndex((l) => /^def init\(\):/.test(l));
  out.splice(funcAt, 0, ...snippet.func.replace(/^\n/, '').split('\n'), '');
  let text = out.join('\n');
  if (!/def _patch\(/.test(text)) {
    const helper = `\n_patched = []\n\n\ndef _patch(cls, name, wrapper):\n    original = getattr(cls, name)\n\n    def patched(self, *args, **kwargs):\n        return wrapper(original, self, *args, **kwargs)\n\n    setattr(cls, name, patched)\n    _patched.append((cls, name, original))\n\n`;
    text = text.replace(/\n(?=def _on_)/, helper);
  }
  return text;
}

async function refIntercept(method) {
  const d = W.ref.detail;
  if (!W.mod) {
    const mods = W.st.mods.filter((m) => !m.broken && m.template !== 'files');
    if (!mods.length) {
      toast('info', 'Сначала создайте мод', 'Перехват вставляется в мод из Мастерской');
      return;
    }
    W.mod = await call(api.ws.mod, mods[0].dir);
  }
  const files = await call(api.ws.tree, W.mod.dir);
  const main = files.find((f) => f.rel.endsWith(`/${W.mod.py}.py`));
  if (!main) {
    toast('bad', 'Нет файла кода', `В моде «${W.mod.name}» нет ${W.mod.py}.py`);
    return;
  }
  const args = d.methods.find(([mn]) => mn === method)?.[1] || [];
  const snippet = await call(api.ref.snippet, d.mod, d.name, method, args);
  const src = await call(api.ws.read, W.mod.dir, main.rel);
  const text = insertIntercept(src, snippet);
  const r = await call(api.ws.write, W.mod.dir, main.rel, text);
  toast(r.errors.length ? 'bad' : 'ok', r.errors.length ? 'Перехват вставлен, но есть ошибка' : 'Перехват добавлен в мод', `${d.name}.${method} → ${W.mod.name}`);
  await wsOpen(W.mod.dir, main.rel);
}

// ---------- 5. отладчик ----------

function dbgPage() {
  const g = W.st.game;
  if (!g) return `${head('Отладчик', 'Лог игры и скриншоты')}<div class="panel"><div class="ref-empty"><div><b>Игра не найдена</b><button class="btn primary" style="margin-top:12px" data-act="ws-pick-game">${icon('folder', 15)}Указать папку игры</button></div></div></div>`;
  return `${head('Отладчик', `python.log и скриншоты игры · ${esc(g.dir)}`, `<button class="btn" data-act="ws-open-path" data-path="${esc(g.log)}">${icon('file', 15)}Открыть python.log</button>${g.running ? `<button class="btn" data-act="ws-kill">${icon('square', 15)}Закрыть игру</button>` : `<button class="btn primary" data-act="ws-launch">${icon('play', 15)}Запустить игру</button>`}`)}
    <div class="dbg-bar"><input class="input" id="dbg-q" placeholder="Фильтр: текст или [Тег]" value="${esc(W.log.filter)}">
      <div class="segmented"><button class="${W.log.mine ? 'on' : ''}" data-act="dbg-mine" data-v="1">Мои моды</button><button class="${W.log.mine ? '' : 'on'}" data-act="dbg-mine" data-v="0">Весь лог</button></div>
      <button class="btn sm ${W.log.errorsOnly ? 'primary' : ''}" data-act="dbg-errors">${icon('alert', 14)}Только ошибки</button>
      <span style="margin-left:auto;color:var(--muted);font-size:12px">обновляется сам, пока открыт раздел</span></div>
    <div class="dbg"><div class="dbg-log" id="dbg-log"></div><div class="shots" id="dbg-shots"></div></div>`;
}

function dbgPaintLog() {
  const el = $('#dbg-log');
  if (!el) return;
  const tags = myTags();
  const q = W.log.filter.trim().toLowerCase();
  let rows = W.log.lines;
  if (W.log.mine) rows = rows.filter((l) => tags.some((t) => l.tag.startsWith(t)));
  if (W.log.errorsOnly) rows = rows.filter((l) => l.kind === 'error');
  if (q) rows = rows.filter((l) => `[${l.tag}] ${l.text}`.toLowerCase().includes(q));
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
  el.innerHTML = rows.length ? rows.slice(-400).map((l) => logLineHtml(l, tags.some((t) => l.tag.startsWith(t)))).join('')
    : `<div style="color:var(--muted);padding:8px">${W.log.mine ? 'Ваши моды ещё ничего не писали в лог. Переключитесь на «Весь лог» или запустите игру с модом.' : 'Пусто'}</div>`;
  if (stick || !W.timers.dbgScrolled) el.scrollTop = el.scrollHeight;
  W.timers.dbgScrolled = true;
  if (!W.log.lines.length) quiet(wsRefreshLog().then(() => { if (W.log.lines.length && $('#dbg-log')) dbgPaintLog(); }));
  dbgPaintShots();
}

async function dbgPaintShots() {
  const el = $('#dbg-shots');
  if (!el) return;
  W.shots = await call(api.ws.shots);
  el.innerHTML = W.shots.length ? W.shots.map((s) => `<div class="shot" data-act="ws-open-path" data-path="${esc(s.path)}"><img src="${esc(s.url)}" alt="" loading="lazy"><small>${esc(s.name)} · ${new Date(s.time).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>`).join('')
    : '<div style="color:var(--muted);font-size:12.5px">Скриншотов нет. В игре — клавиша PrtScr.</div>';
}

// ---------- действия ----------

Object.assign(ACTIONS, {
  'ws-home': () => {
    S.page = S.proj ? 'overview' : 'tree';
    render();
  },
  'ws-new': () => wsNewDialog(),
  'ws-open': (el) => wsOpen(el.dataset.dir),
  'ws-back': async () => {
    if (W.text !== W.saved) await edSave();
    W.view = 'list';
    W.mod = null;
    await wsLoad();
    render();
  },
  'ws-back-editor': () => wsOpen(W.mod.dir, W.file),
  'ws-build': (el) => wsBuild(el.dataset.dir),
  'ws-install': (el) => wsInstall(el.dataset.dir || W.mod?.dir, el.dataset.kill === '1'),
  'ws-launch': async () => {
    await call(api.ws.launch);
    toast('ok', 'Игра запускается', 'Лог мода появится в Отладчике');
  },
  'ws-kill': async () => {
    if (!(await confirmBox('Закрыть игру?', 'Игра закроется без сохранения боя, как при снятии задачи.', 'Закрыть игру', true))) return;
    await call(api.ws.kill);
    await wsLoad();
    render();
  },
  'ws-pick-game': async () => {
    const st = await call(api.ws.pickGame);
    if (st) {
      W.st = st;
      render();
    }
  },
  'ws-open-path': (el) => api.openPath(el.dataset.path),
  'ws-show': (el) => api.showItem(el.dataset.path),
  'ws-delete': async () => {
    if (!(await confirmBox(`Удалить «${W.mod.name}»?`, 'Папка мода уйдёт в корзину Windows — её можно будет восстановить.', 'Удалить', true))) return;
    W.st = await call(api.ws.remove, W.mod.dir);
    W.view = 'list';
    W.mod = null;
    render();
  },
  'ws-to-modpack': async () => {
    if (!S.proj) return;
    const r = await call(api.ws.addToModpack, S.proj, W.mod.dir);
    applyProjectState(r.project);
    toast('ok', 'Мод добавлен в модпак', `${W.mod.name} ${W.mod.version} → ${S.proj.info.name}`);
  },
  'ed-file': async (el) => {
    if (W.text !== W.saved) await edSave();
    await edLoadFile(el.dataset.rel);
    wsRenderPage();
  },
  'ed-preview': () => edPreview(),
  'ed-preview-big': () => {
    if (!W.preview) return quiet(edPreview());
    return modal({ title: 'Превью страницы', sub: 'Экран 1280×720, образец данных из preview.json мода', ic: 'image', wide: true,
      body: `<img src="${W.preview.image}" alt="" style="width:100%;border-radius:10px;border:1px solid var(--border-2);display:block">`,
      actions: [{ label: 'Закрыть', value: null, primary: true }],
      onMount: (root) => root.querySelector('.modal').classList.add('xwide') });
  },
  'ref-build': async () => {
    W.ref.building = true;
    W.ref.progress = 'Разбираю скрипты игры…';
    wsRenderPage();
    try {
      W.st.ref = await call(api.ref.build);
      toast('ok', 'Справочник готов', `${W.st.ref.classes} классов Python, ${W.st.ref.flash} Flash`);
    } finally {
      W.ref.building = false;
      if (S.page === 'gameref') wsRenderPage();
    }
  },
  'ref-kind': (el) => {
    W.ref.kind = el.dataset.kind;
    document.querySelectorAll('.ref-kinds button').forEach((b) => b.classList.toggle('on', b === el));
    quiet(refSearch());
  },
  'ref-try': (el) => {
    W.ref.q = el.dataset.q;
    $('#ref-q').value = W.ref.q;
    quiet(refSearch());
  },
  'ref-pick': async (el) => {
    W.ref.sel = +el.dataset.i;
    W.ref.detail = await call(api.ref.detail, W.ref.hits[W.ref.sel]);
    refPaintResults();
    refPaintDetail();
  },
  'ref-open-class': async (el) => {
    W.ref.detail = await call(api.ref.detail, { lang: 'python', kind: 'class', mod: el.dataset.mod, name: el.dataset.cls });
    refPaintDetail();
  },
  'ref-intercept': (el) => refIntercept(el.dataset.method),
  'dbg-mine': (el) => {
    W.log.mine = el.dataset.v === '1';
    wsRenderPage();
  },
  'dbg-errors': () => {
    W.log.errorsOnly = !W.log.errorsOnly;
    wsRenderPage();
  },
});

// переход в раздел «Разработка» — загрузить состояние и следить за игрой
const navBeforeWs = ACTIONS.nav;
ACTIONS.nav = async (el) => {
  if (S.page === 'workshop' && W.view === 'editor' && W.text !== W.saved) await edSave();
  const to = el.dataset.page;
  if (to === 'workshop' && S.page === 'workshop' && W.view !== 'list') {
    W.view = 'list';
    W.mod = null;
  }
  if (DEV_PAGES.has(to)) {
    S.page = to;
    if (!W.st) await wsLoad();
    wsStartPolling();
    if (to === 'debug') quiet(wsRefreshLog().then(() => { if (S.page === 'debug') dbgPaintLog(); }));
    render();
    $('#page').scrollTop = 0;
    return;
  }
  navBeforeWs(el);
};

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'dbg-q') {
    W.log.filter = t.value;
    dbgPaintLog();
  } else if (t.dataset.wsbind && W.mod) {
    clearTimeout(W.timers.bind);
    const key = t.dataset.wsbind;
    W.timers.bind = setTimeout(async () => {
      W.mod = await call(api.ws.update, W.mod.dir, { [key]: t.value });
    }, 500);
  }
});

// Ctrl+S и Ctrl+B в редакторе мода — раньше общих сочетаний студии
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || S.page !== 'workshop' || !W.mod || $('#modal').innerHTML) return;
  const k = e.key.toLowerCase();
  if (k === 's' || k === 'ы') {
    e.preventDefault();
    e.stopImmediatePropagation();
    quiet(edSave().then(() => { if (!W.errors.length) toast('ok', 'Сохранено'); }));
  } else if ((k === 'b' || k === 'и') && W.view !== 'build') {
    e.preventDefault();
    e.stopImmediatePropagation();
    quiet(wsBuild(W.mod.dir));
  }
}, true);

// Мастерская в палитре Ctrl+K
if (typeof paletteItems === 'function') {
  const basePaletteItems = paletteItems;
  paletteItems = function () {
    const items = basePaletteItems();
    const add = (group, title, sub, ic, run) => items.push({ group, title, sub, ic, run });
    add('Разработка', 'Мастерская модов', 'свои моды для игры', 'edit', () => ACTIONS.nav({ dataset: { page: 'workshop' } }));
    add('Разработка', 'Новый мод', 'по шаблону', 'plus', async () => { await ACTIONS.nav({ dataset: { page: 'workshop' } }); wsNewDialog(); });
    add('Разработка', 'Справочник игры', 'классы и методы клиента', 'command', () => ACTIONS.nav({ dataset: { page: 'gameref' } }));
    add('Разработка', 'Отладчик', 'python.log и скриншоты', 'alert', () => ACTIONS.nav({ dataset: { page: 'debug' } }));
    for (const m of W.st?.mods || []) add('Мои моды', m.name, `${m.id} · ${m.version}`, 'edit', () => wsOpen(m.dir));
    return items;
  };
}

window.WS = W;
window.insertIntercept = insertIntercept;
