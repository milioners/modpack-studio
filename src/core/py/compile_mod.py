# -*- coding: utf-8 -*-
# Проверка и компиляция скриптов мода тем же Python 2.7, что у игры. Запускает TankAir Studio:
#   python compile_mod.py <jobs.json>
# jobs.json: {"check_only": bool, "files": [{"src": путь, "dst": путь .pyc, "rel": путь внутри мода}]}
# Ответ в stdout: {"errors": [{"file", "line", "col", "msg"}], "compiled": n}
import json
import py_compile
import sys


def main():
    with open(sys.argv[1], 'rb') as f:
        jobs = json.loads(f.read().decode('utf-8'))
    errors = []
    compiled = 0
    for job in jobs['files']:
        rel = job['rel']
        try:
            with open(job['src'], 'rb') as f:
                source = f.read().replace('\r\n', '\n')
            compile(source + '\n', rel.encode('utf-8'), 'exec')
            if not jobs.get('check_only'):
                py_compile.compile(job['src'], cfile=job['dst'], dfile=rel.encode('utf-8'), doraise=True)
                compiled += 1
        except SyntaxError as e:
            errors.append({'file': rel, 'line': e.lineno, 'col': e.offset, 'msg': str(e.msg)})
        except py_compile.PyCompileError as e:
            errors.append({'file': rel, 'line': None, 'col': None, 'msg': str(e.msg)})
        except Exception as e:
            errors.append({'file': rel, 'line': None, 'col': None, 'msg': '%s: %s' % (type(e).__name__, e)})
    sys.stdout.write(json.dumps({'errors': errors, 'compiled': compiled}))


if __name__ == '__main__':
    main()
