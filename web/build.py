"""Builds web/dist/index.html (single-file web app) from engine.js, ui.js and shell.html."""
import os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda f: open(os.path.join(here, f), encoding='utf-8').read()
s = rd('shell.html')
s = s.replace('<!--ENGINE-->', '<script id="engine-src">\n' + rd('engine.js') + '\n</script>')
s = s.replace('<!--IMPORTERS-->', '<script>\n' + rd('importers.js') + '\n</script>')
s = s.replace('<!--UI-->', '<script type="module">\n' + rd('ui.js') + '\n</script>')
os.makedirs(os.path.join(here, 'dist'), exist_ok=True)
open(os.path.join(here, 'dist', 'index.html'), 'w', encoding='utf-8').write(s)
print('web/dist/index.html', len(s), 'bytes')
