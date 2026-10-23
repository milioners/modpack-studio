// Онлайн-каталог модов, настройки программы и автообновление.
// Подключается после app.js и пользуется его общим состоянием (S, ACTIONS, render…).
'use strict';

const CAT_NAMES = {
  crosshair: 'Прицелы', camera: 'Зум и камера', markers: 'Маркеры', lamp: 'Лампа и засвет', damage: 'Урон и статистика',
  minimap: 'Миникарта', hangar: 'Ангар', sound: 'Звуки', other: 'Разное',
};

function cmpVer(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// ---------- каталог ----------

const catName = (c) => S.cat.data?.categories?.[c] || CAT_NAMES[c] || c;

// Моды проекта, взятые из каталога: id каталога -> узел
function projectCatalogNodes() {
  const map = new Map();
  if (!S.proj) return map;
  for (const { node } of walk(S.proj.tree)) if (node.type === 'mod' && node.catalogId) map.set(node.catalogId, node);
  return map;
}

function catalogUpdatesCount() {
  if (!S.cat.data || !S.proj) return 0;
  const nodes = projectCatalogNodes();
  return S.cat.data.mods.filter((m) => nodes.has(m.id) && cmpVer(m.version, nodes.get(m.id).catalogVersion || '0') > 0).length;
}

async function loadCatalog(force = false) {
  S.cat.loading = true;
  S.cat.error = null;
  if (S.page === 'catalog') renderPage();
  try {
    S.cat.data = await call(api.loadCatalog, force);
  } catch (e) {
    S.cat.error = e.message;
  } finally {
    S.cat.loading = false;
    if (S.proj) renderSidebar();
    if (S.page === 'catalog') renderPage();
  }
}

function catalogStatus(m) {
  const node = projectCatalogNodes().get(m.id);
  if (!node) return { state: 'new' };
  if (cmpVer(m.version, node.catalogVersion || '0') > 0) return { state: 'update', node };
  return { state: 'have', node };
}

function catalogButton(m, big = false) {
  const busy = S.cat.busy[m.id];
  const cls = big ? 'btn' : 'btn sm';
  if (busy !== undefined) return `<button class="${cls} primary" disabled><span class="spinner"></span><span data-busy-id="${esc(m.id)}">${busy ? `${busy}%` : 'Загрузка…'}</span></button>`;
  const st = catalogStatus(m);
  if (st.state === 'update') return `<button class="${cls} primary" data-act="cat-update" data-id="${esc(m.id)}">${icon('refresh', 14)}Обновить до ${esc(m.version)}</button>`;
  if (st.state === 'have') return `<button class="${cls}" disabled>${icon('check', 14)}В проекте</button>`;
  return `<button class="${cls} primary" data-act="cat-add" data-id="${esc(m.id)}">${icon('plus', 14)}В проект</button>`;
}

function visibleCatalog() {
  const q = S.cat.q.trim().toLowerCase();
  return S.cat.data.mods.filter((m) => (S.cat.category === 'all' || m.category === S.cat.category)
    && (!q || [m.name, m.author, m.description, ...m.tags].join(' ').toLowerCase().includes(q)));
}

function pageCatalog() {
  const c = S.cat;
  const actions = `<button class="btn" data-act="cat-reload" ${c.loading ? 'disabled' : ''}>${icon('refresh', 16)}Обновить</button>`;
  const sub = 'Готовые моды с описанием и превью. Добавляются в проект одним кликом и обновляются, когда автор выпускает новую версию.';
  if (!c.data) {
    const body = c.loading
      ? `<div class="empty"><span class="spinner big-spin"></span><p>Загружаю каталог…</p></div>`
      : `<div class="empty"><div class="big">${icon('alert', 24)}</div><h3>Каталог недоступен</h3><p>${esc(c.error || '')}</p>
         <div class="row-btns"><button class="btn primary" data-act="cat-reload">${icon('refresh', 14)}Попробовать снова</button><button class="btn" data-act="app-settings">Адрес каталога</button></div></div>`;
    return head('Каталог модов', sub, actions) + body;
  }
  const mods = c.data.mods;
  const cats = [...new Set(mods.map((m) => m.category))];
  const list = visibleCatalog();
  const target = selected()?.node.type === 'group' ? selected().node : null;
  return `${head('Каталог модов', sub, actions)}
    ${c.data.offline ? `<div class="banner">${icon('alert', 20)}<div class="grow"><b>Нет связи — показана сохранённая копия каталога</b><small>${esc(c.data.error || '')}</small></div></div>` : ''}
    <div class="cat-toolbar">
      <label class="input-icon">${icon('search', 16)}<input class="input" id="cat-q" placeholder="Поиск по названию, автору, тегам" value="${esc(c.q)}"></label>
      <span class="cat-target">${icon('folder', 14)}Добавлять в: <b>${target ? esc(target.name) : 'корень списка'}</b></span>
    </div>
    <div class="chips">
      <button class="chip ${c.category === 'all' ? 'active' : ''}" data-act="cat-cat" data-cat="all">Все <span class="n">${mods.length}</span></button>
      ${cats.map((k) => `<button class="chip ${c.category === k ? 'active' : ''}" data-act="cat-cat" data-cat="${esc(k)}">${icon(k, 14)}${esc(catName(k))} <span class="n">${mods.filter((m) => m.category === k).length}</span></button>`).join('')}
    </div>
    ${list.length ? `<div class="grid">${list.map((m) => {
    const st = catalogStatus(m);
    const gv = m.gameVersion && S.proj.info.gameVersion && !m.gameVersion.startsWith(S.proj.info.gameVersion.split('.').slice(0, 2).join('.'));
    return `<article class="card" data-act="cat-open" data-id="${esc(m.id)}">
        <div class="thumb">${m.preview ? `<img data-cimg="${esc(m.preview)}" alt="">` : `<img data-ph="${esc(m.name)}" data-kind="mod" alt="">`}
          <span class="cat-pill">${icon(m.category, 13)}${esc(catName(m.category))}</span>
          <div class="badges">${st.state === 'have' ? `<span class="badge ok">${icon('check', 11)}В проекте</span>` : ''}${st.state === 'update' ? `<span class="badge info">${icon('refresh', 11)}Есть ${esc(m.version)}</span>` : ''}</div></div>
        <div class="card-body"><div class="card-title">${esc(m.name)}</div>
          <div class="card-meta">${esc(m.author || 'Автор не указан')} · v${esc(m.version)}${m.size ? ` · ${fmtSize(m.size)}` : ''}</div>
          <div class="card-desc">${esc(m.description.split('\n')[0])}</div></div>
        <div class="card-foot"><span class="size ${gv ? 'warn' : ''}">${m.gameVersion ? `${gv ? '⚠ ' : ''}для ${esc(m.gameVersion)}` : ''}</span>${catalogButton(m)}</div>
      </article>`;
  }).join('')}</div>`
    : `<div class="empty"><div class="big">${icon('search', 24)}</div><h3>Ничего не найдено</h3><p>Измените запрос или категорию.</p></div>`}
    <div class="note" style="margin-top:18px">Каталог: ${esc(c.data.title)} · ${mods.length} ${plural(mods.length, 'мод', 'мода', 'модов')}${c.data.updated ? ` · обновлён ${fmtDate(c.data.updated)}` : ''}.
      Каждый файл проверяется по контрольной сумме. Моды только копируются в проект и никогда не запускаются.</div>`;
}

async function hydrateCatalog(root = document) {
  for (const img of root.querySelectorAll('img[data-cimg]')) {
    api.catalogImage(img.dataset.cimg).then((r) => {
      if (r.ok && r.data && img.isConnected) img.src = r.data;
      else if (img.isConnected) {
        img.removeAttribute('data-cimg');
        img.dataset.ph = img.closest('[data-id]')?.querySelector('.card-title')?.textContent || 'Мод';
        img.dataset.kind = 'mod';
        hydrate(img.parentElement);
      }
    });
  }
}

async function catalogAdd(id, update = false) {
  const m = S.cat.data.mods.find((x) => x.id === id);
  S.cat.busy[id] = 0;
  refreshCatalogView();
  try {
    clearTimeout(S.saveTimer);
    if (update) {
      const node = projectCatalogNodes().get(id);
      applyProjectState(await call(api.updateFromCatalog, S.proj, node.id));
      toast('ok', `«${m.name}» обновлён до ${m.version}`, 'Не забудьте записать это в «Что нового»');
    } else {
      const target = selected()?.node.type === 'group' ? selected().node.id : null;
      const res = await call(api.addFromCatalog, S.proj, id, target);
      applyProjectState(res.project);
      toast('ok', `«${m.name}» добавлен в проект`, 'Его можно переместить в нужную группу в «Составе модпака»');
    }
  } catch { /* ошибка уже показана */ } finally {
    delete S.cat.busy[id];
    renderSidebar();
    refreshCatalogView();
  }
}

function refreshCatalogView() {
  if (S.page === 'catalog') {
    const q = $('#cat-q');
    const focused = document.activeElement === q;
    const pos = q?.selectionStart;
    renderPage();
    if (focused) {
      const n = $('#cat-q');
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  }
  const box = $('#cat-modal-btn');
  if (box) box.innerHTML = catalogButton(S.cat.data.mods.find((x) => x.id === box.dataset.id), true);
}

async function catalogOpen(id) {
  const m = S.cat.data.mods.find((x) => x.id === id);
  await modal({
    title: m.name, sub: `${esc(m.author || 'Автор не указан')} · версия ${esc(m.version)}${m.gameVersion ? ` · для игры ${esc(m.gameVersion)}` : ''}`, ic: m.category, wide: true,
    body: `<div class="cat-detail">
        <div class="preview-big">${m.preview ? `<img data-cimg="${esc(m.preview)}" alt="">` : `<img data-ph="${esc(m.name)}" data-kind="mod" alt="">`}</div>
        <div class="cat-detail-side">
          <div class="meta-list">
            <div><small>Категория</small><b>${esc(catName(m.category))}</b></div>
            <div><small>Размер</small><b>${m.size ? fmtSize(m.size) : '—'}</b></div>
            ${m.license ? `<div><small>Лицензия</small><b>${esc(m.license)}</b></div>` : ''}
            ${m.updated ? `<div><small>Обновлён</small><b>${fmtDate(m.updated)}</b></div>` : ''}
          </div>
          ${m.tags.length ? `<div class="tags">${m.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
          <div id="cat-modal-btn" data-id="${esc(m.id)}" class="row-btns">${catalogButton(m, true)}</div>
          ${m.homepage ? `<button class="btn sm ghost" data-act="external" data-url="${esc(m.homepage)}">${icon('external', 13)}Страница автора</button>` : ''}
        </div></div>
      <div class="cat-desc">${esc(m.description || 'Описание не указано.')}</div>`,
    actions: [{ label: 'Закрыть', value: null }],
    onMount: (root) => {
      hydrateCatalog(root);
      hydrate(root);
    },
  });
}

// ---------- настройки программы и обновления ----------

async function appSettingsDialog() {
  const a = S.st.app;
  const u = S.upd;
  const status = u.info
    ? (u.info.available ? `Доступна версия ${esc(u.info.version)}` : u.info.noReleases ? 'Релизов пока нет' : 'У вас последняя версия')
    : 'Ещё не проверялось';
  const r = await modal({
    title: 'Настройки программы', sub: `ModPack Studio ${esc(S.st.appVersion)}`, ic: 'settings',
    body: `<div class="field"><span>Обновления программы</span>
        <label class="toggle"><input type="checkbox" name="autoUpdate" ${a.autoUpdate ? 'checked' : ''}><span class="track"></span><span>Проверять обновления при запуске</span></label>
        <div class="row-btns"><button class="btn sm" id="upd-check">${icon('refresh', 13)}Проверить сейчас</button><span class="hint-text" id="upd-status">${status}</span></div>
        <small class="hint-text">Новые версии берутся из GitHub Releases репозитория <code>${esc(a.updateRepo || 'не указан')}</code> и проверяются по контрольной сумме.</small></div>
      <label class="field"><span>Адрес онлайн-каталога модов</span><input class="input" name="catalogUrl" value="${esc(a.catalogUrl)}" placeholder="${esc(a.defaultCatalogUrl)}">
        <small class="hint-text">Оставьте пустым для каталога по умолчанию. Можно указать свой каталог: ссылку https или путь к папке с index.json.</small></label>`,
    onMount: (root) => root.querySelector('#upd-check').addEventListener('click', async () => {
      const st = root.querySelector('#upd-status');
      st.textContent = 'Проверяю…';
      try {
        await checkForUpdate(true);
        st.textContent = S.upd.info.available ? `Доступна версия ${S.upd.info.version}` : S.upd.info.noReleases ? 'Релизов пока нет' : 'У вас последняя версия';
      } catch (e) {
        st.textContent = e.message;
      }
    }),
    actions: [{ label: 'Отмена', value: null }, { label: 'Сохранить', value: 'ok', primary: true }],
  });
  if (!r) return;
  const urlVal = r.data.catalogUrl.trim();
  const changedUrl = urlVal !== a.catalogUrl;
  S.st = await call(api.appSettings, { autoUpdate: r.data.autoUpdate, catalogUrl: urlVal });
  if (changedUrl) {
    S.cat.data = null;
    if (S.page === 'catalog') loadCatalog(true);
  }
  if (S.upd.info?.available) updateDialog();
}

async function checkForUpdate(manual = false) {
  const r = await api.checkUpdate();
  if (!r.ok) {
    if (manual) throw new Error(r.error);
    return;
  }
  S.upd.info = r.data;
  renderTitleActions();
}

async function updateDialog() {
  const i = S.upd.info;
  if (!i?.available) return;
  const r = await modal({
    title: `Доступна ModPack Studio ${i.version}`, sub: `У вас ${esc(i.current)} · ${fmtSize(i.size)}${i.publishedAt ? ` · ${fmtDate(i.publishedAt)}` : ''}`, ic: 'upload',
    body: `<div class="notes">${esc(i.notes || 'Описание изменений не указано.')}</div>
      <div class="progress" id="upd-progress" hidden><div></div></div>
      <small class="hint-text">Программа скачает установщик, проверит его контрольную сумму, закроется, обновится и запустится снова. Проекты не затрагиваются.</small>`,
    actions: [{ label: 'Позже', value: null }, { label: `${icon('upload', 15)}Обновить`, value: 'ok', primary: true }],
  });
  if (!r) return;
  S.upd.state = 'downloading';
  const pm = await modal({
    title: 'Скачиваю обновление…', ic: 'upload',
    body: '<div class="progress"><div id="upd-bar"></div></div><div class="hint-text" id="upd-text">Подключаюсь…</div>',
    actions: [],
    onMount: async () => {
      try {
        const file = await call(api.downloadUpdate, i);
        $('#upd-text').textContent = 'Проверено. Устанавливаю…';
        await call(api.installUpdate, file);
      } catch {
        $('#modal').innerHTML = '';
      }
    },
  });
  return pm;
}

api.onUpdateProgress(({ got, total }) => {
  const bar = $('#upd-bar');
  const text = $('#upd-text');
  if (bar && total) bar.style.width = `${Math.round((got / total) * 100)}%`;
  if (text) text.textContent = `${fmtSize(got)}${total ? ` из ${fmtSize(total)}` : ''}`;
});

api.onCatalogProgress(({ id, got, total }) => {
  if (S.cat.busy[id] === undefined) return;
  const pct = total ? Math.min(99, Math.round((got / total) * 100)) : 0;
  if (pct === S.cat.busy[id]) return;
  S.cat.busy[id] = pct;
  document.querySelectorAll(`[data-busy-id="${CSS.escape(id)}"]`).forEach((el) => { el.textContent = `${pct}%`; });
});

// ---------- действия ----------

Object.assign(ACTIONS, {
  itype: (el) => {
    S.proj.options.installerType = el.dataset.val;
    changed({ tree: false });
    renderPage();
  },
  'cat-reload': () => loadCatalog(true),
  'cat-cat': (el) => {
    S.cat.category = el.dataset.cat;
    refreshCatalogView();
  },
  'cat-open': (el) => catalogOpen(el.dataset.id),
  'cat-add': (el) => catalogAdd(el.dataset.id),
  'cat-update': (el) => catalogAdd(el.dataset.id, true),
  'node-cat-update': () => {
    const n = selected()?.node;
    if (n?.catalogId) catalogAdd(n.catalogId, true);
  },
  'app-settings': () => appSettingsDialog(),
  'update-open': () => updateDialog(),
  theme: (el) => {
    S.proj.design.theme = el.dataset.theme;
    document.querySelectorAll('[data-act=theme]').forEach((b) => b.classList.toggle('on', b === el));
    changed({ tree: false });
  },
  bump: async (el) => {
    const v = S.proj.info.version;
    const next = bump(v, el.dataset.kind);
    if (!(await confirmBox(`Новая версия ${next}?`, `Версия модпака станет ${esc(next)}. Опишите изменения в поле «Что нового» — их увидят игроки.`, 'Поднять версию'))) return;
    S.proj.info.version = next;
    S.proj.changelog.unshift({ version: next, date: new Date().toISOString(), text: '' });
    changed({ tree: false, shell: true });
    render();
    setTimeout(() => $('[data-clbind]')?.focus(), 30);
  },
  'hist-run': (el) => api.openPath(el.dataset.path),
  'hist-delete': async (el) => {
    if (!(await confirmBox('Удалить установщик?', `Файл ${esc(el.dataset.file)} будет удалён с диска.`, 'Удалить', true))) return;
    applyProjectState(await call(api.deleteBuild, el.dataset.file));
    renderPage();
  },
});

const baseNav = ACTIONS.nav;
ACTIONS.nav = (el) => {
  baseNav(el);
  if (el.dataset.page === 'catalog' && !S.cat.data && !S.cat.loading) loadCatalog();
};

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'cat-q') {
    S.cat.q = t.value;
    refreshCatalogView();
  } else if (t.dataset.clbind && S.proj) {
    let entry = clEntry();
    if (!entry) {
      entry = { version: S.proj.info.version, date: new Date().toISOString(), text: '' };
      S.proj.changelog.unshift(entry);
    }
    entry.text = t.value;
    changed({ tree: false });
  }
});

// Картинки каталога подгружаются после каждой отрисовки страницы
new MutationObserver(() => {
  if (document.querySelector('img[data-cimg]:not([src])')) hydrateCatalog();
}).observe(document.getElementById('page'), { childList: true, subtree: true });

// Проверка обновлений при запуске (в установленной программе, не чаще одного раза за запуск)
setTimeout(() => {
  if (S.st?.packaged && S.st.app.autoUpdate) quiet(checkForUpdate());
}, 4000);
