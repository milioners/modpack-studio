// Редактор оформления собственного установщика и публикация модпака.
// Предпросмотр — настоящий снимок окна установщика (рисуется вне экрана), поэтому что видно, то и получит игрок.
'use strict';

const THEME_PRESETS = {
  tactic: { name: 'Тактика', colors: { bg: '#0F1115', surface: '#181B21', card: '#1F232B', border: '#2C313B', text: '#EEE9DF', muted: '#8F8A80', accent: '#F0A53A', accentText: '#1D1305' }, titleFont: 'Bahnschrift', radius: 12 },
  steel: { name: 'Сталь', colors: { bg: '#0D1117', surface: '#161B22', card: '#1C2330', border: '#2A3445', text: '#E6EDF3', muted: '#7D8A9A', accent: '#4F9BE8', accentText: '#06121F' }, titleFont: 'Segoe UI', radius: 10 },
  khaki: { name: 'Хаки', colors: { bg: '#12140F', surface: '#1A1D16', card: '#22261C', border: '#343A2A', text: '#ECE9D8', muted: '#9A9A80', accent: '#A3B55A', accentText: '#11140A' }, titleFont: 'Bahnschrift', radius: 6 },
  neon: { name: 'Неон', colors: { bg: '#0C0A14', surface: '#151126', card: '#1D1734', border: '#2F2650', text: '#EFEAFF', muted: '#9088B0', accent: '#B06CFF', accentText: '#12061F' }, titleFont: 'Segoe UI', radius: 16 },
  crimson: { name: 'Багровый', colors: { bg: '#120C0C', surface: '#1B1313', card: '#241818', border: '#3A2626', text: '#F2E8E6', muted: '#A08A86', accent: '#E5484D', accentText: '#1C0505' }, titleFont: 'Bahnschrift', radius: 8 },
  arctic: { name: 'Светлая', colors: { bg: '#EEF0F3', surface: '#FFFFFF', card: '#FFFFFF', border: '#D9DDE3', text: '#1D2128', muted: '#6B7280', accent: '#E2741F', accentText: '#FFFFFF' }, titleFont: 'Segoe UI', radius: 12 },
};
const FONTS = ['Segoe UI', 'Bahnschrift', 'Arial', 'Tahoma', 'Verdana', 'Trebuchet MS', 'Georgia', 'Consolas', 'Impact'];
const COLOR_FIELDS = [['bg', 'Фон окна'], ['surface', 'Панели'], ['card', 'Карточки'], ['border', 'Рамки'], ['text', 'Текст'], ['muted', 'Второстепенный текст'], ['accent', 'Акцент'], ['accentText', 'Текст на акценте']];
const pct = (v) => `${Math.round(v * 100)}%`;
const SLIDER_FMT = { bgDim: pct, surfaceOpacity: pct, bgBlur: (v) => `${v}px`, radius: (v) => `${v}px` };
const SCREENS = [['welcome', 'Приветствие'], ['mods', 'Выбор модов'], ['progress', 'Установка'], ['finish', 'Готово']];

const IP = { screen: 'mods', img: null, busy: false, error: null, timer: null, seq: 0 };
const isMps = () => S.proj.options.installerType !== 'inno';

// ---------- картинки для установщика ----------

function canvasBytes(c, type = 'image/png', q = 0.88) {
  return new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), type, q));
}

// Картинка проекта, уменьшенная до maxW, в JPEG (фото) или PNG
async function encodeImage(rel, maxW, type = 'image/jpeg') {
  const url = await getImg(rel);
  const img = url && await ART.loadImage(url);
  if (!img) return null;
  const k = Math.min(1, maxW / (img.naturalWidth || img.width || maxW));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((img.naturalWidth || maxW) * k));
  c.height = Math.max(1, Math.round((img.naturalHeight || maxW * 0.56) * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return canvasBytes(c, type);
}

async function logoBytes(p) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const url = await getImg(p.design.icon);
  const img = url && await ART.loadImage(url);
  const ctx = c.getContext('2d');
  if (img) {
    const iw = img.naturalWidth || 256;
    const ih = img.naturalHeight || 256;
    const k = Math.max(256 / iw, 256 / ih);
    ctx.drawImage(img, (256 - iw * k) / 2, (256 - ih * k) / 2, iw * k, ih * k);
  } else {
    const ico = await ART.icon(p, { icon: null });
    // в ICO последняя картинка — 256 px в PNG
    const v = new DataView(ico.buffer);
    const n = v.getUint16(4, true);
    const off = v.getUint32(6 + (n - 1) * 16 + 12, true);
    return ico.slice(off);
  }
  return canvasBytes(c);
}

async function mpsAssets(p, { previews = true, log = () => {} } = {}) {
  const urls = { icon: await getImg(p.design.icon) };
  log('Готовлю фон, баннер и логотип…');
  const assets = {
    background: await encodeImage(p.installer.backgroundImage, 1920),
    banner: await encodeImage(p.design.bannerImage, 1600),
    logo: await logoBytes(p),
    icon: await ART.icon(p, urls),
    previews: {},
    layoutImages: {},
  };
  const rels = new Set();
  for (const sc of Object.values(p.installer.layout.screens)) {
    if (sc.background.image) rels.add(sc.background.image);
    for (const e of sc.elements) if (e.type === 'image' && e.props.src && !e.props.src.startsWith('@')) rels.add(e.props.src);
  }
  for (const rel of rels) {
    const png = /\.(png|svg|gif|webp)$/i.test(rel);
    assets.layoutImages[rel] = await encodeImage(rel, 1920, png ? 'image/png' : 'image/jpeg');
  }
  if (previews) {
    const nodes = [...walk(p.tree)].map((x) => x.node);
    log(`Рисую превью модов (${nodes.length})…`);
    for (const n of nodes) {
      const c = await ART.preview(n, await getImg(n.preview), p.installer.colors.accent || p.design.accent, [512, 288]);
      assets.previews[n.id] = await canvasBytes(c, n.preview ? 'image/jpeg' : 'image/png');
    }
  }
  return assets;
}

// ---------- живой предпросмотр ----------

function schedulePreview(delay = 900) {
  clearTimeout(IP.timer);
  IP.timer = setTimeout(() => quiet(refreshPreview()), delay);
  const st = $('#ip-status');
  if (st) st.textContent = 'Изменения появятся через секунду…';
}

async function refreshPreview() {
  if (S.page !== 'design' || !isMps()) return;
  const seq = ++IP.seq;
  IP.busy = true;
  paintPreview();
  try {
    const assets = await mpsAssets(S.proj, { previews: IP.screen === 'mods' || IP.screen === 'welcome' });
    const img = await call(api.installerSnapshot, S.proj, assets, IP.screen);
    if (seq !== IP.seq) return;
    IP.img = img;
    IP.error = null;
  } catch (e) {
    if (seq === IP.seq) IP.error = e.message;
  } finally {
    if (seq === IP.seq) {
      IP.busy = false;
      paintPreview();
    }
  }
}

function paintPreview() {
  const host = $('#ip-shot');
  if (!host) return;
  host.innerHTML = IP.img ? `<img src="${IP.img}" alt="">` : `<div class="mock-loading">${IP.error ? esc(IP.error) : 'Рисую установщик…'}</div>`;
  host.classList.toggle('busy', IP.busy);
  const st = $('#ip-status');
  if (st) st.textContent = IP.busy ? 'Обновляю предпросмотр…' : IP.error ? 'Ошибка предпросмотра' : 'Это настоящий снимок окна установщика';
}

// ---------- страница оформления ----------

function slider(path, label, min, max, step, fmt = (v) => v) {
  const v = getT(path);
  return `<label class="field"><span>${label} <b class="slider-val" data-for="${path}">${fmt(v)}</b></span>
    <input type="range" class="range" data-tbind="${path}" data-num="1" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
}
function seg(path, label, options) {
  const v = getT(path);
  return `<div class="field"><span>${label}</span><div class="segmented">${options.map(([val, l]) => `<button class="${String(v) === String(val) ? 'on' : ''}" data-act="tset" data-path="${path}" data-val="${val}">${l}</button>`).join('')}</div></div>`;
}
function getT(path) { return path.split('.').reduce((o, k) => o?.[k], S.proj.installer); }
function setT(path, val) {
  const keys = path.split('.');
  let o = S.proj.installer;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = val;
}

function pageInstallerDesign() {
  const t = S.proj.installer;
  const presets = Object.entries(THEME_PRESETS).map(([id, p]) => `<button class="preset ${t.preset === id ? 'on' : ''}" data-act="tpreset" data-id="${id}">
      <span class="sw">${['bg', 'card', 'accent', 'text'].map((k) => `<i style="background:${p.colors[k]}"></i>`).join('')}</span>${esc(p.name)}</button>`).join('');
  return `${head('Оформление установщика', 'Настройте всё: цвета, фон, шрифты, форму карточек и тексты. Справа — настоящий снимок окна, которое увидит игрок.',
    `<button class="btn" data-act="ip-open">${icon('play', 15)}Открыть установщик для проверки</button>`)}
    <div class="design-grid">
      <div class="ip-editor">
        <div class="panel"><h2>Готовые темы</h2><p class="sub">Начните с темы и подправьте под себя</p><div class="presets">${presets}</div></div>
        <div class="panel"><h2>Цвета</h2><p class="sub">Любой цвет можно задать точно</p><div class="color-grid">
          ${COLOR_FIELDS.map(([k, l]) => `<label class="color-field"><input type="color" data-tbind="colors.${k}" value="${esc(t.colors[k])}"><span>${l}</span><code>${esc(t.colors[k])}</code></label>`).join('')}
        </div></div>
        <div class="panel"><h2>Фон и картинки</h2><p class="sub">Фон окна — скриншот из игры или арт. Баннер и логотип общие с оформлением модпака</p>
          ${imagePickerAny('inst:backgroundImage', t.backgroundImage, 'Фон окна', 'Широкая картинка, лучше 1920×1080. Её можно затемнить и размыть.', '16 / 9')}
          ${slider('bgDim', 'Затемнение фона', 0, 0.95, 0.05, (v) => `${Math.round(v * 100)}%`)}
          ${slider('bgBlur', 'Размытие фона', 0, 30, 1, (v) => `${v}px`)}
          ${slider('surfaceOpacity', 'Плотность панелей', 0.4, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
          ${imagePickerAny('design:bannerImage', S.proj.design.bannerImage, 'Баннер на приветствии', 'Крупная картинка над заголовком на первом экране.', '16 / 6')}
          ${imagePickerAny('design:icon', S.proj.design.icon, 'Логотип и иконка .exe', 'Квадратная картинка.', '1 / 1')}
        </div>
        <div class="panel"><h2>Шрифты и форма</h2><p class="sub">Как выглядят текст, кнопки и карточки</p>
          <div class="form-grid">
            <label class="field"><span>Основной шрифт</span><select class="select" data-tbind="font">${FONTS.map((f) => `<option ${t.font === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
            <label class="field"><span>Шрифт заголовков</span><select class="select" data-tbind="titleFont">${FONTS.map((f) => `<option ${t.titleFont === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
          </div>
          ${slider('fontSize', 'Размер текста', 12, 16, 0.5)}
          ${slider('radius', 'Скругление углов', 0, 24, 1, (v) => `${v}px`)}
          ${seg('layout', 'Моды показываются', [['grid', 'Карточками'], ['list', 'Списком']])}
          ${seg('cardSize', 'Размер карточек', [['s', 'Мелкие'], ['m', 'Средние'], ['l', 'Крупные']])}
          ${seg('nav', 'Категории', [['tabs', 'Вкладками сверху'], ['sidebar', 'Меню слева']])}
          ${seg('width', 'Размер окна', [['1000', '1000×640'], ['1100', '1100×700'], ['1280', '1280×780']])}
          <div class="toggles">
            <label class="toggle"><input type="checkbox" data-tbind="welcomeScreen" data-bool="1" ${t.welcomeScreen ? 'checked' : ''}><span class="track"></span><span>Экран приветствия перед выбором модов</span></label>
            <label class="toggle"><input type="checkbox" data-tbind="animations" data-bool="1" ${t.animations ? 'checked' : ''}><span class="track"></span><span>Анимации</span></label>
          </div>
        </div>
        <div class="panel"><h2>Тексты</h2><p class="sub">Пустое поле — текст по умолчанию</p>
          <div class="form-grid">
            <label class="field full"><span>Заголовок приветствия</span><input class="input" data-tbind="texts.welcomeTitle" value="${esc(t.texts.welcomeTitle)}" placeholder="${esc(S.proj.info.name)}"></label>
            <label class="field full"><span>Текст приветствия</span><textarea class="textarea" data-tbind="texts.welcomeText" placeholder="Описание модпака из «Сведений»">${esc(t.texts.welcomeText)}</textarea></label>
            <label class="field"><span>Кнопка установки</span><input class="input" data-tbind="texts.installButton" value="${esc(t.texts.installButton)}" placeholder="Установить"></label>
            <label class="field"><span>Заголовок в конце</span><input class="input" data-tbind="texts.finishTitle" value="${esc(t.texts.finishTitle)}" placeholder="Готово!"></label>
            <label class="field full"><span>Текст в конце</span><input class="input" data-tbind="texts.finishText" value="${esc(t.texts.finishText)}" placeholder="Модпак установлен. Можно запускать игру!"></label>
          </div>
        </div>
      </div>
      <div class="panel sticky ip-preview">
        <div class="seg-tabs">${SCREENS.map(([k, l]) => `<button class="${IP.screen === k ? 'on' : ''}" data-act="ip-screen" data-screen="${k}">${l}</button>`).join('')}</div>
        <div class="ip-shot" id="ip-shot"></div>
        <div class="ip-foot"><span class="hint-text" id="ip-status"></span><button class="btn sm ghost" data-act="ip-refresh">${icon('refresh', 13)}Обновить</button></div>
      </div>
    </div>`;
}

function imagePickerAny(target, rel, label, hint, aspect) {
  return `<div class="field"><span>${label}</span>
    <div class="picker">${imageBox(rel, target, '', aspect)}
      <div class="picker-side"><small class="hint-text">${hint}</small>
        <div class="row-btns"><button class="btn sm" data-act="ip-pick" data-target="${target}">${icon('image', 14)}Выбрать</button>
        ${rel ? `<button class="btn sm ghost" data-act="ip-clear" data-target="${target}">Убрать</button>` : ''}</div></div></div></div>`;
}

// ---------- публикация обновлений ----------

function publishPanel() {
  const pub = S.proj.publish;
  const builtThis = (S.builds || []).some((b) => b.version === S.proj.info.version);
  return `<div class="panel publish-panel">
    <h2>Обновления модпака у игроков</h2>
    <p class="sub">Установщик и копия «Управление модпаком» в игре сами проверяют новую версию и показывают кнопку «Обновить»</p>
    ${seg2('publish.type', [['none', 'Выключены'], ['github', 'GitHub Releases'], ['url', 'Свой сайт']])}
    ${pub.type === 'github' ? `<div class="form-grid" style="margin-top:14px">
        <label class="field full"><span>Репозиторий на GitHub</span><input class="input" data-pbind="repo" value="${esc(pub.repo)}" placeholder="ваш-ник/мой-модпак"></label></div>
      <div class="row-btns" style="margin-top:12px">
        <button class="btn primary" data-act="publish-github" ${builtThis && pub.repo ? '' : 'disabled'}>${icon('upload', 15)}Опубликовать версию ${esc(S.proj.info.version)}</button>
        ${builtThis ? '' : '<span class="hint-text">Сначала соберите установщик этой версии</span>'}</div>
      <div class="note" style="margin-top:10px">Нужен GitHub CLI: <code>winget install GitHub.cli</code> и вход <code>gh auth login</code>. Новый релиз появится в репозитории, а установщики игроков предложат обновиться.</div>`
    : pub.type === 'url' ? `<div class="form-grid" style="margin-top:14px">
        <label class="field full"><span>Адрес файла update.json</span><input class="input" data-pbind="url" value="${esc(pub.url)}" placeholder="https://мой-сайт.ru/modpack/update.json"></label></div>
      <div class="note" style="margin-top:10px">При сборке рядом с установщиком появится <code>update.json</code>. Загрузите его и сам установщик в одну папку на сайте — ссылка в update.json указывает на файл рядом с ним.</div>`
    : '<div class="note" style="margin-top:12px">Игроки узнают о новой версии только от вас.</div>'}
  </div>`;
}

function seg2(path, options) {
  const v = S.proj.publish.type;
  return `<div class="segmented">${options.map(([val, l]) => `<button class="${v === val ? 'on' : ''}" data-act="pset" data-val="${val}">${l}</button>`).join('')}</div>`;
}

// ---------- действия ----------

Object.assign(ACTIONS, {
  'ip-screen': (el) => {
    IP.screen = el.dataset.screen;
    document.querySelectorAll('[data-act=ip-screen]').forEach((b) => b.classList.toggle('on', b === el));
    quiet(refreshPreview());
  },
  'ip-refresh': () => quiet(refreshPreview()),
  'ip-open': async () => {
    toast('info', 'Открываю установщик', 'Это предпросмотр: файлы в игру не ставятся');
    await call(api.installerPreview, S.proj, await mpsAssets(S.proj));
  },
  tpreset: (el) => {
    const p = THEME_PRESETS[el.dataset.id];
    Object.assign(S.proj.installer.colors, p.colors);
    S.proj.installer.titleFont = p.titleFont;
    S.proj.installer.radius = p.radius;
    S.proj.installer.preset = el.dataset.id;
    S.proj.design.accent = p.colors.accent;
    phCache.clear();
    changed({ tree: false });
    renderPage();
  },
  tset: (el) => {
    const path = el.dataset.path;
    setT(path, path === 'width' ? Number(el.dataset.val) : el.dataset.val);
    if (path === 'width') S.proj.installer.height = { 1000: 640, 1100: 700, 1280: 780 }[el.dataset.val];
    el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
    changed({ tree: false });
  },
  'ip-pick': async (el) => {
    const rel = await call(api.pickImage);
    if (rel) setImageTarget(el.dataset.target, rel);
  },
  'ip-clear': (el) => setImageTarget(el.dataset.target, null),
  pset: (el) => {
    S.proj.publish.type = el.dataset.val;
    changed({ tree: false });
    renderPage();
  },
  'publish-github': async () => {
    await saveNow();
    S.build.log = ['Публикация на GitHub…'];
    S.build.running = true;
    renderPage();
    try {
      const url = await call(api.publishGithub, S.proj);
      toast('ok', 'Версия опубликована', url);
      S.build.log.push(url);
    } catch (e) {
      S.build.log.push(e.message);
    } finally {
      S.build.running = false;
      renderPage();
    }
  },
});

function setImageTarget(target, rel) {
  if (target.startsWith('inst:')) S.proj.installer[target.slice(5)] = rel;
  else S.proj.design[target.slice(7)] = rel;
  changed({ tree: false, shell: true });
  renderPage();
}

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.tbind && S.proj) {
    const v = t.dataset.num ? Number(t.value) : t.dataset.bool ? t.checked : t.value;
    setT(t.dataset.tbind, v);
    if (t.dataset.tbind.startsWith('colors.')) {
      S.proj.installer.preset = 'custom';
      const code = t.parentElement.querySelector('code');
      if (code) code.textContent = t.value;
      if (t.dataset.tbind === 'colors.accent') { S.proj.design.accent = t.value; phCache.clear(); }
    }
    const lbl = document.querySelector(`.slider-val[data-for="${t.dataset.tbind}"]`);
    if (lbl) lbl.textContent = (SLIDER_FMT[t.dataset.tbind] || ((x) => x))(Number(t.value));
    changed({ tree: false });
  } else if (t.dataset.pbind && S.proj) {
    S.proj.publish[t.dataset.pbind] = t.value.trim();
    changed({ tree: false });
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.tbind && (t.tagName === 'SELECT' || t.dataset.bool)) {
    setT(t.dataset.tbind, t.dataset.bool ? t.checked : t.value);
    changed({ tree: false });
  }
});
