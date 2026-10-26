# -*- coding: utf-8 -*-
# Справочник игры для TankAir Studio: разбирает скрипты клиента (res/packages/scripts.pkg)
# тем же Python 2.7, что у игры, и пишет индекс модулей, классов, методов и функций.
#   python gameindex.py <scripts.pkg> <out.json>
# Код не декомпилируется: из каждого .pyc читаются только имена и аргументы.
import json
import marshal
import sys
import types
import zipfile

CO_VARARGS = 0x04
CO_VARKEYWORDS = 0x08
SKIP = ('<lambda>', '<genexpr>', '<dictcomp>', '<setcomp>', '<listcomp>')


def args_of(co):
    n = co.co_argcount
    names = list(co.co_varnames[:n])
    i = n
    if co.co_flags & CO_VARARGS:
        names.append('*' + co.co_varnames[i])
        i += 1
    if co.co_flags & CO_VARKEYWORDS:
        names.append('**' + co.co_varnames[i])
    return names


def is_class_body(co):
    # тело класса начинается с __module__ = __name__ и не принимает аргументов
    return co.co_argcount == 0 and '__module__' in co.co_names


def doc_of(co):
    if co.co_consts and isinstance(co.co_consts[0], basestring):
        d = co.co_consts[0]
        return d if isinstance(d, unicode) else d.decode('utf-8', 'replace')
    return None


def scan_class(co):
    methods = []
    for c in co.co_consts:
        if isinstance(c, types.CodeType) and c.co_name not in SKIP and not is_class_body(c):
            methods.append([c.co_name, args_of(c)])
    return methods


def scan_module(co):
    classes = []
    funcs = []
    for c in co.co_consts:
        if not isinstance(c, types.CodeType) or c.co_name in SKIP:
            continue
        if is_class_body(c):
            classes.append({'n': c.co_name, 'm': scan_class(c)})
        else:
            funcs.append([c.co_name, args_of(c)])
    return classes, funcs


def main():
    pkg, out = sys.argv[1], sys.argv[2]
    mods = []
    z = zipfile.ZipFile(pkg)
    for name in z.namelist():
        if not name.endswith('.pyc'):
            continue
        try:
            co = marshal.loads(z.read(name)[8:])
        except Exception:
            continue
        classes, funcs = scan_module(co)
        path = name[:-4]
        if path.startswith('scripts/'):
            path = path[len('scripts/'):]
        module = path.split('/', 1)[1] if path.split('/', 1)[0] in ('client', 'common') else path
        module = module.replace('/', '.')
        if module.endswith('.__init__'):
            module = module[:-len('.__init__')]
        mods.append({'mod': module, 'file': name, 'c': classes, 'f': funcs})
    with open(out, 'wb') as f:
        f.write(json.dumps({'modules': mods}, separators=(',', ':')))
    sys.stdout.write(json.dumps({'modules': len(mods)}))


if __name__ == '__main__':
    main()
