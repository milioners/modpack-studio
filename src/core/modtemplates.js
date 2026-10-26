// Шаблоны модов Мастерской: из названия и ID получается рабочий каркас мода для «Мира танков»
// (Python 2.7 для игры, страницы Gameface, исходник Flash на Haxe). Код каркасов повторяет то,
// что проверено на моде TankAir: регистрация экрана в res_map, окна в ангаре, Flash-экран в бою.
'use strict';

const TEMPLATES = [
  { id: 'hangar', name: 'Окно в ангаре', tech: 'Gameface', desc: 'Своя панель поверх ангара: HTML и CSS, данные из игры, кнопки.' },
  { id: 'battle', name: 'Экран в бою', tech: 'Flash', desc: 'Своя панель в бою. Код на Haxe, студия соберёт SWF.' },
  { id: 'hook', name: 'Перехват данных', tech: 'Python', desc: 'Подписка на событие игры: пример — результаты боя.' },
  { id: 'config', name: 'Мод с настройками', tech: 'Python', desc: 'Настройки в JSON, горячая клавиша и сообщения в ангаре.' },
  { id: 'files', name: 'Замена файлов', tech: 'Файлы', desc: 'Озвучка, текстуры, прицелы: файлы кладутся в res/ мода.' },
  { id: 'blank', name: 'Пустой мод', tech: 'Python', desc: 'Только meta.xml и точка входа init/fini.' },
];

// «Счётчик сессии» → «session_counter» / «SessionCounter»; кириллица транслитерируется
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
function slug(name) {
  const s = String(name || '').toLowerCase().split('').map((c) => (TR[c] !== undefined ? TR[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const out = s || 'my_mod';
  return /^[0-9]/.test(out) ? `mod_${out}` : out;
}
const camel = (py) => py.split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'MyMod';
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// строка Python 2 в одинарных кавычках (u'' для кириллицы)
const pyStr = (s) => `u'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// Имена мода: id — для meta.xml и файла .mtmod, py — модуль Python, tag — префикс в python.log
function names(opts) {
  const py = slug(opts.py || opts.name);
  const id = opts.id || `my.${py}`;
  return { id, py, tag: camel(py), name: opts.name || 'Мой мод', version: opts.version || '0.1', author: opts.author || '' };
}

function metaXml(n, description) {
  return `<root>
\t<id>${xmlEsc(n.id)}</id>
\t<version>${xmlEsc(n.version)}</version>
\t<name>${xmlEsc(n.name)}</name>
\t<description>${xmlEsc(description)}</description>
</root>
`;
}

function entryPy(n) {
  return `# -*- coding: utf-8 -*-
# Точка входа мода «${n.name}»: игра загружает gui/mods/mod_*.pyc и вызывает init/fini.
import logging

_LOGGER = logging.getLogger('${n.tag}')


def init():
    try:
        import ${n.py}
        ${n.py}.init()
    except Exception:
        _LOGGER.exception('Мод не запустился')


def fini():
    try:
        import ${n.py}
        ${n.py}.fini()
    except Exception:
        _LOGGER.exception('Ошибка при выгрузке мода')
`;
}

// Общая часть для модов с экранами Gameface: регистрация страницы в gui/unbound/gen/res_map.json.
// Берётся действующая копия (в ней уже могут быть экраны других модов) и дополняется своими;
// если игра обновила свой res_map, копия пересобирается из пакета игры. После записи — один перезапуск.
function layoutPy(n) {
  return `
# ---------- регистрация экрана в res_map ----------

RES_MAP = 'gui/unbound/gen/res_map.json'
CRC_STAMP = 'res_map.package.crc'
RESTART_FLAG = '${n.py}_restart'


def _res_mods_dir():
    try:
        for path in ResMgr.openSection('../paths.xml')['Paths'].values():
            folder = path.asString.replace('./', '')
            if 'res_mods' in folder and os.path.isdir(folder):
                return folder
    except Exception:
        LOGGER.exception('Не удалось прочитать paths.xml')
    return None


def _package_res_map():
    for name in sorted(os.listdir('res/packages')):
        if not name.startswith('gui-part'):
            continue
        package = os.path.join('res', 'packages', name)
        try:
            with zipfile.ZipFile(package) as z:
                for info in z.infolist():
                    if info.filename.lower() == RES_MAP:
                        return package, info
        except Exception:
            LOGGER.exception('Не удалось открыть %s', package)
    return None, None


def _find_layout(data, path):
    marker = '"path":"%s"' % path
    pos = data.find(marker)
    if pos < 0:
        return None
    start = data.rfind('":{', 0, pos)
    key_start = data.rfind('"', 0, start)
    try:
        return int(data[key_start + 1:start], 16)
    except ValueError:
        return None


def _ensure_layout(path, entrance):
    """layoutID экрана или None, если клиент уходит на перезапуск."""
    res_mods = _res_mods_dir()
    package, info = _package_res_map()
    if not res_mods or info is None:
        LOGGER.error('Не найден res_mods или %s в пакетах игры', RES_MAP)
        return None
    target = os.path.join(res_mods, RES_MAP)
    stamp = os.path.join(os.path.dirname(target), CRC_STAMP)
    try:
        with open(stamp, 'rb') as f:
            fresh = int(f.read().strip() or 0) == info.CRC
    except Exception:
        fresh = False
    fresh = fresh and os.path.isfile(target)
    section = ResMgr.openSection(RES_MAP)
    effective = section.asBinary if section is not None else ''
    found = _find_layout(effective, path) if fresh else None
    if found is not None:
        if os.path.isfile(RESTART_FLAG):
            os.remove(RESTART_FLAG)
        return found
    if os.path.isfile(RESTART_FLAG):
        LOGGER.error('Экран не зарегистрировался после перезапуска — мод выключен')
        os.remove(RESTART_FLAG)
        return None
    if fresh:
        raw = effective
    else:
        with zipfile.ZipFile(package) as z:
            raw = z.read(info.filename)
    resource_map = json.loads(raw.decode('utf-8').replace(',}', '}'), object_pairs_hook=OrderedDict)
    key = max([int(k, 16) for k in resource_map] or [0]) + 1
    resource_map[format(key, 'x')] = OrderedDict([
        ('type', 'Layout'), ('path', path),
        ('parameters', OrderedDict([('entrance', entrance), ('extension', ''), ('impl', 'gameface')]))])
    folder = os.path.dirname(target)
    if not os.path.isdir(folder):
        os.makedirs(folder)
    text = json.dumps(resource_map, ensure_ascii=False, separators=(',', ':'))
    with open(target, 'wb') as f:
        f.write(text.encode('utf-8') if isinstance(text, unicode) else text)
    with open(stamp, 'wb') as f:
        f.write(str(info.CRC))
    with open(RESTART_FLAG, 'wb') as f:
        f.write('1')
    LOGGER.info('Экран зарегистрирован, перезапускаю клиент один раз')
    try:
        import WGC
        WGC.notifyRestart()
    except Exception:
        pass
    BigWorld.worldDrawEnabled(False)
    BigWorld.restartGame()
    return None
`;
}

const patchPy = `

def _patch(cls, name, wrapper):
    """Обёртка метода игры: wrapper(original, self, *args, **kwargs)."""
    original = getattr(cls, name)

    def patched(self, *args, **kwargs):
        return wrapper(original, self, *args, **kwargs)

    setattr(cls, name, patched)
    _patched.append((cls, name, original))


def _unpatch():
    for cls, name, original in reversed(_patched):
        setattr(cls, name, original)
    del _patched[:]
`;

// ---------- шаблон «Окно в ангаре» ----------

function hangarFiles(n) {
  const html = `${n.tag}`;
  const layout = `coui://gui/gameface/mods/${n.py}/${html}.html`;
  const py = `# -*- coding: utf-8 -*-
"""${n.name}: окно Gameface в ангаре. Создано в TankAir Studio по шаблону «Окно в ангаре».

Окно показывается, пока открыт ангар. Данные для страницы собирает _collect() —
меняйте её, чтобы показать своё. Нажатия на кнопки страницы приходят в _on_action().
"""
import json
import logging
import os
import zipfile
from collections import OrderedDict

import BigWorld
import ResMgr

LOGGER = logging.getLogger('${n.tag}')
LOGGER.setLevel(logging.INFO)

VERSION = '${n.version}'
LAYOUT_PATH = '${layout}'
LAYOUT_ENTRANCE = '${html}'

_layoutID = None
_View = None
_window = [None]
_patched = []
_clicks = [0]
${layoutPy(n)}

# ---------- данные для окна ----------

def _collect():
    """Что показать в окне: словарь уходит на страницу как JSON."""
    from CurrentVehicle import g_currentVehicle
    item = g_currentVehicle.item
    return {
        'title': ${pyStr(n.name)},
        'vehicle': item.userName if item else u'',
        'tier': item.level if item else 0,
        'clicks': _clicks[0],
    }


def _on_action(name):
    """Кнопка на странице: window.model.onAction({name: ...})."""
    if name == 'click':
        _clicks[0] += 1
        _refresh()


# ---------- окно ----------

def _create_view_class():
    from frameworks.wulf import ViewModel, ViewSettings
    from gui.impl.pub import ViewImpl

    class Model(ViewModel):
        __slots__ = ('onAction', 'onLog')

        def __init__(self, properties=1, commands=2):
            super(Model, self).__init__(properties=properties, commands=commands)

        def _initialize(self):
            super(Model, self)._initialize()
            self._addStringProperty('data', '{}')
            self.onAction = self._addCommand('onAction')
            self.onLog = self._addCommand('onLog')

    class View(ViewImpl):

        def __init__(self, layoutID):
            settings = ViewSettings(layoutID)
            settings.model = Model()
            super(View, self).__init__(settings)

        @property
        def viewModel(self):
            return super(View, self).getViewModel()

        def _onLoading(self, *args, **kwargs):
            super(View, self)._onLoading(*args, **kwargs)
            self.viewModel.onAction += self.__onAction
            self.viewModel.onLog += self.__onLog
            self.refresh()

        def _finalize(self):
            self.viewModel.onAction -= self.__onAction
            self.viewModel.onLog -= self.__onLog
            super(View, self)._finalize()

        def refresh(self):
            try:
                self.viewModel._setString(0, json.dumps(_collect(), ensure_ascii=False))
            except Exception:
                LOGGER.exception('Не удалось собрать данные')

        def __onAction(self, args=None):
            try:
                _on_action((args or {}).get('name'))
            except Exception:
                LOGGER.exception('Действие %r не выполнилось', args)

        def __onLog(self, args=None):
            LOGGER.info('[js] %s', (args or {}).get('msg'))

    return View


def _show():
    global _View
    if _window[0] is not None or _layoutID is None:
        return
    try:
        from frameworks.wulf import WindowFlags, WindowLayer
        from gui.impl.pub import WindowImpl
        if _View is None:
            _View = _create_view_class()
        window = WindowImpl(WindowFlags.WINDOW, content=_View(_layoutID), layer=WindowLayer.SUB_VIEW, name='${n.tag}')
        window.load()
        _window[0] = window
    except Exception:
        LOGGER.exception('Не удалось показать окно')


def _hide():
    window = _window[0]
    _window[0] = None
    if window is not None:
        try:
            window.destroy()
        except Exception:
            LOGGER.exception('Не удалось закрыть окно')


def _refresh(*_):
    window = _window[0]
    if window is not None and window.content is not None:
        window.content.refresh()
${patchPy}

def _hangar_populate(original, self, *args, **kwargs):
    result = original(self, *args, **kwargs)
    BigWorld.callback(0.2, _show)
    return result


def _hangar_dispose(original, self, *args, **kwargs):
    _hide()
    return original(self, *args, **kwargs)


def init():
    global _layoutID
    try:
        _layoutID = _ensure_layout(LAYOUT_PATH, LAYOUT_ENTRANCE)
    except Exception:
        LOGGER.exception('Не удалось зарегистрировать экран')
        _layoutID = None
    if _layoutID is None:
        return
    from gui.Scaleform.daapi.view.lobby.hangar.Hangar import Hangar
    _patch(Hangar, '_populate', _hangar_populate)
    _patch(Hangar, '_dispose', _hangar_dispose)
    from CurrentVehicle import g_currentVehicle
    g_currentVehicle.onChanged += _refresh
    LOGGER.info('${n.name} %s: экран %s', VERSION, _layoutID)


def fini():
    _hide()
    _unpatch()
`;
  const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  /* ${n.name} — окно в ангаре. 1rem = 1px при масштабе интерфейса 100%.
     Gameface: только flex, без CSS-переменных и grid; подписи одним текстом;
     картинки — ресурсы игры через img://gui/maps/icons/... */
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  body { font-size: 14rem; color: #f1ece2; }
  #panel { position: absolute; right: 24rem; top: 120rem; width: 300rem; padding: 16rem 18rem; border-radius: 6rem;
    background: linear-gradient(180deg, rgba(20, 21, 25, .96), rgba(11, 12, 14, .96)); border: 1rem solid rgba(255, 255, 255, .08); }
  .lbl { color: #8a857b; font-size: 11rem; letter-spacing: 2rem; }
  .title { font-size: 18rem; font-weight: bold; margin-bottom: 10rem; }
  .row { display: flex; flex-direction: row; align-items: center; margin-top: 8rem; }
  .grow { flex: 1; }
  .val { font-weight: bold; color: #ffcf7a; }
  .btn { margin-top: 14rem; height: 34rem; border-radius: 4rem; display: flex; align-items: center; justify-content: center;
    font-weight: bold; color: #1a1206; background: linear-gradient(180deg, #ffcf7a, #f0a53a); cursor: pointer; }
</style>
</head>
<body>
<div id="panel">
  <div class="lbl">МОД</div>
  <div class="title" id="title"></div>
  <div class="row"><div class="grow">Машина</div><div class="val" id="vehicle"></div></div>
  <div class="row"><div class="grow">Уровень</div><div class="val" id="tier"></div></div>
  <div class="row"><div class="grow">Нажатий</div><div class="val" id="clicks"></div></div>
  <div class="btn" id="btn">НАЖМИ МЕНЯ</div>
</div>
<script>
(function () {
  function $(id) { return document.getElementById(id); }
  function log(msg) { try { window.model.onLog({ msg: String(msg) }); } catch (e) { /* модель ещё не готова */ } }

  function render() {
    var d = {};
    try { d = JSON.parse(window.model.data || '{}'); } catch (e) { log('data: ' + e); }
    $('title').textContent = d.title || '';
    $('vehicle').textContent = d.vehicle || '—';
    $('tier').textContent = d.tier || '—';
    $('clicks').textContent = d.clicks || 0;
    hitArea();
  }

  // клики принимает только панель, остальное достаётся ангару
  function hitArea() {
    var size = viewEnv.getViewSizeRem(), p = $('panel');
    var left = p.offsetLeft, top = p.offsetTop;
    try { viewEnv.setHitAreaPaddingsRem(top, size.width - left - p.offsetWidth, size.height - top - p.offsetHeight, left, 15); } catch (e) { log('hit area: ' + e); }
  }

  function start() {
    $('btn').addEventListener('click', function () { window.model.onAction({ name: 'click' }); });
    viewEnv.addDataChangedCallback('model', 0, true);
    engine.on('viewEnv.onDataChanged', render);
    engine.on('clientResized', hitArea);
    render();
  }

  window.onerror = function (msg, src, line) { log('ошибка JS: ' + msg + ' @' + line); };
  engine.whenReady.then(function () {
    if (window.model) start();
    else { var tries = 0; var t = setInterval(function () { if (window.model || ++tries > 50) { clearInterval(t); start(); } }, 100); }
  });
}());
</script>
</body>
</html>
`;
  return {
    [`src/res/scripts/client/gui/mods/${n.py}.py`]: py,
    [`src/res/gui/gameface/mods/${n.py}/${html}.html`]: page,
    'preview.json': JSON.stringify({ page: `src/res/gui/gameface/mods/${n.py}/${html}.html`, data: { title: n.name, vehicle: 'Объект 120 «Таран»', tier: 10, clicks: 3 } }, null, 2),
  };
}

// ---------- шаблон «Экран в бою» (Flash) ----------

function battleFiles(n) {
  const ui = `${n.tag}UI`;
  const swf = `${n.tag}.swf`;
  const py = `# -*- coding: utf-8 -*-
"""${n.name}: своя Flash-панель в бою. Создано в TankAir Studio по шаблону «Экран в бою».

В бою «Мира танков» отдельные окна Gameface не выводятся, поэтому экран сделан на Flash:
исходник flash/src/${ui}.hx, студия собирает его в gui/flash/${swf}.
Панель открывается после загрузки боя; данные раз в секунду собирает _collect().
"""
import logging

import BigWorld

LOGGER = logging.getLogger('${n.tag}')
LOGGER.setLevel(logging.INFO)

VERSION = '${n.version}'
VIEW_ALIAS = '${n.tag}View'
SWF_URL = '${swf}'
REFRESH_PERIOD = 1.0

_View = None
_view = [None]
_timer = [None]
_patched = []


def _collect():
    """Что показать на панели: словарь уходит во Flash (as_setData)."""
    player = BigWorld.player()
    vehicle = getattr(player, 'vehicle', None)
    health = getattr(vehicle, 'health', None)
    return {'title': ${pyStr(n.name)}, 'text': u'Прочность: %s' % (health if health is not None else u'—')}


def _register_view():
    global _View
    if _View is not None:
        return
    from frameworks.wulf import WindowLayer
    from gui.Scaleform.framework import g_entitiesFactories, ViewSettings, ScopeTemplates
    from gui.Scaleform.framework.entities.View import View

    class PanelView(View):

        def _populate(self):
            super(PanelView, self)._populate()
            _view[0] = self
            self.update()

        def _dispose(self):
            if _view[0] is self:
                _view[0] = None
            super(PanelView, self)._dispose()

        def update(self):
            self.flashObject.as_setData(_collect())

        def py_log(self, msg):
            LOGGER.info('[flash] %s', msg)

    _View = PanelView
    g_entitiesFactories.addSettings(ViewSettings(VIEW_ALIAS, PanelView, SWF_URL, WindowLayer.WINDOW, None,
                                                 ScopeTemplates.DEFAULT_SCOPE, canDrag=False, canClose=False,
                                                 isModal=False, isCentered=False))


def _tick():
    _timer[0] = None
    view = _view[0]
    if view is None:
        return
    try:
        view.update()
    except Exception:
        LOGGER.exception('Не удалось обновить панель')
    _timer[0] = BigWorld.callback(REFRESH_PERIOD, _tick)


def _open(page):
    try:
        from gui.Scaleform.framework.managers.loaders import SFViewLoadParams
        _register_view()
        page.app.loadView(SFViewLoadParams(VIEW_ALIAS))
        _timer[0] = BigWorld.callback(REFRESH_PERIOD, _tick)
    except Exception:
        LOGGER.exception('Не удалось открыть панель')


def _close():
    if _timer[0] is not None:
        try:
            BigWorld.cancelCallback(_timer[0])
        except Exception:
            pass
        _timer[0] = None
    view = _view[0]
    _view[0] = None
    if view is not None:
        try:
            view.destroy()
        except Exception:
            LOGGER.exception('Не удалось закрыть панель')
${patchPy}

def _loading_finish(original, self, *args, **kwargs):
    result = original(self, *args, **kwargs)
    _open(self)
    return result


def _page_dispose(original, self, *args, **kwargs):
    _close()
    return original(self, *args, **kwargs)


def init():
    try:
        from gui.Scaleform.daapi.view.battle.classic.page import ClassicPage
        _patch(ClassicPage, '_onBattleLoadingFinish', _loading_finish)
        _patch(ClassicPage, '_dispose', _page_dispose)
        LOGGER.info('${n.name} %s: панель %s', VERSION, SWF_URL)
    except Exception:
        LOGGER.exception('Панель в бою недоступна')


def fini():
    _close()
    _unpatch()
`;
  const hx = `import flash.display.Sprite;
import flash.text.TextField;
import flash.text.TextFormat;

/**
 * ${n.name} — Flash-панель в бою. Наследник AbstractView из battle.swf игры.
 * Python вызывает as_setData(словарь); метод py_log игра подставляет в одноимённое поле.
 * Не используйте trace и статические поля с начальными значениями: загрузочный код Haxe
 * в SWF не попадает, поэтому заполняйте их в конструкторе.
 */
class ${ui} extends net.wg.infrastructure.base.AbstractView {
  public var py_log:Dynamic;

  var panel:Sprite;
  var title:TextField;
  var text:TextField;

  public function new() {
    super();
    panel = new Sprite();
    panel.x = 20;
    panel.y = 120;
    panel.graphics.beginFill(0x0b0c0e, 0.85);
    panel.graphics.drawRoundRect(0, 0, 260, 64, 8, 8);
    panel.graphics.endFill();
    addChild(panel);
    title = label(12, 8, 12, 0xffcf7a, true);
    text = label(12, 30, 15, 0xf1ece2, false);
  }

  public function as_setData(d:Dynamic):Void {
    try {
      title.text = d.title != null ? d.title : '';
      text.text = d.text != null ? d.text : '';
    } catch (e:Dynamic) {
      if (py_log != null) py_log('as_setData: ' + e);
    }
  }

  function label(x:Float, y:Float, size:Float, color:Int, bold:Bool):TextField {
    var tf = new TextField();
    tf.embedFonts = true;
    tf.selectable = false;
    tf.mouseEnabled = false;
    tf.defaultTextFormat = new TextFormat(bold ? "$TitleFont" : "$FieldFont", size, color, bold);
    tf.x = x;
    tf.y = y;
    tf.width = 236;
    tf.height = size * 1.6 + 4;
    panel.addChild(tf);
    return tf;
  }

  static function main() {}
}
`;
  const extern = `package net.wg.infrastructure.base;

// Базовый класс экранов игры из battle.swf. Описано только то, что нужно мод-экрану:
// сам класс берётся из игры во время работы и в SWF мода не попадает.
extern class AbstractView extends flash.display.MovieClip {
  function new():Void;
  function updateStage(width:Float, height:Float):Void;
}
`;
  return {
    [`src/res/scripts/client/gui/mods/${n.py}.py`]: py,
    [`flash/src/${ui}.hx`]: hx,
    'flash/src/net/wg/infrastructure/base/AbstractView.hx': extern,
  };
}

// ---------- шаблон «Перехват данных» ----------

function hookFiles(n) {
  const py = `# -*- coding: utf-8 -*-
"""${n.name}: перехват данных игры. Создано в TankAir Studio по шаблону «Перехват данных».

Пример: когда игра заполняет окно результатов боя, мод сохраняет все данные боя
в mods/configs/${n.py}_last.json и показывает сообщение в ангаре.
Какие ещё методы можно перехватить — смотрите в «Справочнике игры» студии.
"""
import json
import logging
import os
import re

LOGGER = logging.getLogger('${n.tag}')
LOGGER.setLevel(logging.INFO)

VERSION = '${n.version}'
DUMP_PATH = os.path.join('mods', 'configs', '${n.py}_last.json')
_TAGS = re.compile(r'<[^>]+>')
_patched = []


def _text(value):
    if not isinstance(value, basestring):
        return value
    if isinstance(value, str):
        value = value.decode('utf-8', 'replace')
    return _TAGS.sub(u'', value).strip()


def _on_results(vo):
    """Все данные боя одним словарём: common, personal, team1, team2…"""
    folder = os.path.dirname(DUMP_PATH)
    if not os.path.isdir(folder):
        os.makedirs(folder)
    with open(DUMP_PATH, 'wb') as f:
        f.write(json.dumps(vo, ensure_ascii=False, indent=1, default=repr).encode('utf-8'))
    common = vo.get('common') or {}
    personal = vo.get('personal') or {}
    message = u'%s · %s · кредиты %s' % (_text(common.get('resultStr')), _text(common.get('arenaStr')), _text(personal.get('creditsStr')))
    LOGGER.info(u'Результаты боя: %s', message)
    try:
        from gui import SystemMessages
        SystemMessages.pushMessage(message, type=SystemMessages.SM_TYPE.Information)
    except Exception:
        LOGGER.exception('Не удалось показать сообщение')
${patchPy}

def _set_data(original, self, data, *args, **kwargs):
    result = original(self, data, *args, **kwargs)
    try:
        if isinstance(data, dict) and data.get('personal') is not None:
            _on_results(data)
    except Exception:
        LOGGER.exception('Не удалось разобрать результаты боя')
    return result


def init():
    try:
        from gui.Scaleform.daapi.view.meta.BattleResultsMeta import BattleResultsMeta
        _patch(BattleResultsMeta, 'as_setDataS', _set_data)
        LOGGER.info('${n.name} %s: перехват результатов боя включён', VERSION)
    except Exception:
        LOGGER.exception('Перехват недоступен')


def fini():
    _unpatch()
`;
  return { [`src/res/scripts/client/gui/mods/${n.py}.py`]: py };
}

// ---------- шаблон «Мод с настройками» ----------

function configFiles(n) {
  const py = `# -*- coding: utf-8 -*-
"""${n.name}: мод с настройками. Создано в TankAir Studio по шаблону «Мод с настройками».

Настройки лежат в mods/configs/${n.tag}.json (создаются при первом запуске).
Ctrl+Shift+${'M'} включает и выключает мод, при входе в ангар показывается приветствие.
"""
import json
import logging
import os

LOGGER = logging.getLogger('${n.tag}')
LOGGER.setLevel(logging.INFO)

VERSION = '${n.version}'
CONFIG_PATH = os.path.join('mods', 'configs', '${n.tag}.json')
CONFIG_VERSION = 1
DEFAULT_CONFIG = {
    'configVersion': CONFIG_VERSION,
    'enabled': True,
    'greeting': u'${n.name} работает',
}

_config = dict(DEFAULT_CONFIG)
_patched = []


def _load_config():
    global _config
    cfg = dict(DEFAULT_CONFIG)
    try:
        if os.path.isfile(CONFIG_PATH):
            with open(CONFIG_PATH, 'rb') as f:
                user = json.loads(f.read().decode('utf-8-sig'))
            for key in DEFAULT_CONFIG:
                if key in user and key != 'configVersion':
                    cfg[key] = user[key]
        _write_config(cfg)
    except Exception:
        LOGGER.exception('Не удалось прочитать %s, беру настройки по умолчанию', CONFIG_PATH)
    _config = cfg


def _write_config(cfg):
    folder = os.path.dirname(CONFIG_PATH)
    if not os.path.isdir(folder):
        os.makedirs(folder)
    with open(CONFIG_PATH, 'wb') as f:
        f.write(json.dumps(cfg, indent=2, ensure_ascii=False, sort_keys=True).encode('utf-8'))


def _message(text):
    try:
        from gui import SystemMessages
        SystemMessages.pushMessage(text, type=SystemMessages.SM_TYPE.Information)
    except Exception:
        LOGGER.exception('Не удалось показать сообщение')
${patchPy}

def _hangar_populate(original, self, *args, **kwargs):
    result = original(self, *args, **kwargs)
    if _config.get('enabled'):
        _message(_config.get('greeting') or u'')
    return result


def _on_key(event):
    try:
        import BigWorld
        import Keys
        if not event.isKeyDown() or event.key != Keys.KEY_M:
            return
        ctrl = BigWorld.isKeyDown(Keys.KEY_LCONTROL) or BigWorld.isKeyDown(Keys.KEY_RCONTROL)
        shift = BigWorld.isKeyDown(Keys.KEY_LSHIFT) or BigWorld.isKeyDown(Keys.KEY_RSHIFT)
        if ctrl and shift:
            _config['enabled'] = not _config.get('enabled')
            _write_config(_config)
            _message(u'${n.name}: %s' % (u'включён' if _config['enabled'] else u'выключен'))
    except Exception:
        LOGGER.exception('Ошибка обработки клавиш')


def init():
    _load_config()
    from gui.Scaleform.daapi.view.lobby.hangar.Hangar import Hangar
    _patch(Hangar, '_populate', _hangar_populate)
    from gui import InputHandler
    InputHandler.g_instance.onKeyDown += _on_key
    LOGGER.info('${n.name} %s: настройки %s', VERSION, CONFIG_PATH)


def fini():
    try:
        from gui import InputHandler
        InputHandler.g_instance.onKeyDown -= _on_key
    except Exception:
        pass
    _unpatch()
`;
  return { [`src/res/scripts/client/gui/mods/${n.py}.py`]: py };
}

// ---------- «Замена файлов» и «Пустой мод» ----------

function filesFiles() {
  return {
    'src/res/README.txt': `Файлы из этой папки попадут в .mtmod и заменят файлы игры с тем же путём.
Повторяйте путь из пакетов игры (res/packages/*.pkg), например:
  gui/maps/icons/vehicle/contour/ussr-R222_Object_120_Taran.png
  audioww/...
  gui/flash/...
Этот файл можно удалить.
`,
  };
}

function blankFiles(n) {
  return {
    [`src/res/scripts/client/gui/mods/${n.py}.py`]: `# -*- coding: utf-8 -*-
"""${n.name}. Создано в TankAir Studio по шаблону «Пустой мод»."""
import logging

LOGGER = logging.getLogger('${n.tag}')
LOGGER.setLevel(logging.INFO)

VERSION = '${n.version}'


def init():
    LOGGER.info('${n.name} %s запущен', VERSION)


def fini():
    pass
`,
  };
}

// Все файлы нового мода: { относительный путь: содержимое }
function render(template, opts) {
  const n = names(opts);
  const t = TEMPLATES.find((x) => x.id === template);
  if (!t) throw new Error(`Нет шаблона «${template}»`);
  const files = { 'src/meta.xml': metaXml(n, opts.description || t.desc) };
  const body = { hangar: hangarFiles, battle: battleFiles, hook: hookFiles, config: configFiles, files: filesFiles, blank: blankFiles }[template](n);
  if (template !== 'files') files[`src/res/scripts/client/gui/mods/mod_${n.py}.py`] = entryPy(n);
  Object.assign(files, body);
  return { names: n, files, flashClass: template === 'battle' ? `${n.tag}UI` : null, flashSwf: template === 'battle' ? `${n.tag}.swf` : null };
}

module.exports = { TEMPLATES, render, slug, camel, names };
