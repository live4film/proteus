"""Assembles desktop/app/ (fully offline) from web/dist/index.html and npm packages.
Run web/build.py first, then `npm install` in desktop/, then this script."""
import os, re, shutil
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(D)
NM = os.path.join(D, 'node_modules')
APP = os.path.join(D, 'app')
V = os.path.join(APP, 'vendor')
shutil.rmtree(APP, ignore_errors=True)
for d in ['three/addons/controls', 'three/addons/environments', 'three/addons/loaders', 'three/addons/libs', 'three/addons/curves', 'fonts']:
    os.makedirs(os.path.join(V, d), exist_ok=True)
cp = lambda a, b: shutil.copyfile(os.path.join(NM, a), os.path.join(V, b))
cp('three/build/three.module.js', 'three/three.module.js')
cp('three/examples/jsm/controls/OrbitControls.js', 'three/addons/controls/OrbitControls.js')
cp('three/examples/jsm/environments/RoomEnvironment.js', 'three/addons/environments/RoomEnvironment.js')
cp('three/LICENSE', 'three/LICENSE.txt')
# FBX import: FBXLoader and what it imports
cp('three/examples/jsm/loaders/FBXLoader.js', 'three/addons/loaders/FBXLoader.js')
cp('three/examples/jsm/libs/fflate.module.js', 'three/addons/libs/fflate.module.js')
cp('three/examples/jsm/curves/NURBSCurve.js', 'three/addons/curves/NURBSCurve.js')
cp('three/examples/jsm/curves/NURBSUtils.js', 'three/addons/curves/NURBSUtils.js')
cp('mp4-muxer/build/mp4-muxer.mjs', 'mp4-muxer.mjs')
cp('mp4-muxer/LICENSE', 'mp4-muxer.LICENSE.txt')
for w in ['400', '500', '600']:
    cp(f'@fontsource/inter/files/inter-latin-{w}-normal.woff2', f'fonts/inter-latin-{w}-normal.woff2')
for w in ['400', '500']:
    cp(f'@fontsource/jetbrains-mono/files/jetbrains-mono-latin-{w}-normal.woff2', f'fonts/jetbrains-mono-latin-{w}-normal.woff2')
cp('@fontsource/inter/LICENSE', 'fonts/Inter.LICENSE.txt')
cp('@fontsource/jetbrains-mono/LICENSE', 'fonts/JetBrainsMono.LICENSE.txt')
faces = [('Inter', w, f'inter-latin-{w}-normal.woff2') for w in ['400', '500', '600']] + [("'JetBrains Mono'", w, f'jetbrains-mono-latin-{w}-normal.woff2') for w in ['400', '500']]
open(os.path.join(V, 'fonts.css'), 'w').write(''.join(f"@font-face{{font-family:{f};font-weight:{w};font-style:normal;font-display:swap;src:url(fonts/{fn}) format('woff2')}}\n" for f, w, fn in faces))
shutil.copyfile(os.path.join(D, 'build', 'app-icon.png'), os.path.join(APP, 'icon.png'))
# splash: the desktop app shows its own splash window, so the page overlay is removed
shutil.copyfile(os.path.join(D, 'build', 'splash.jpg'), os.path.join(APP, 'splash.jpg'))
shutil.copyfile(os.path.join(D, 'scripts', 'splash.html'), os.path.join(APP, 'splash.html'))

s = open(os.path.join(ROOT, 'web', 'dist', 'index.html'), encoding='utf-8').read()
s = re.sub(r'<link rel="preconnect"[^>]*>\n?', '', s)
s = re.sub(r'<link href="https://fonts\.googleapis\.com[^>]*>', '<link rel="stylesheet" href="vendor/fonts.css">', s)
s = s.replace('"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"', '"three":"./vendor/three/three.module.js"')
s = s.replace('"three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"', '"three/addons/":"./vendor/three/addons/"')
s = s.replace("import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs')", "import('./vendor/mp4-muxer.mjs')")
assert 'cdn.jsdelivr' not in s and 'googleapis' not in s, 'a remote reference is left in the desktop build'
s = re.sub(r'<!--SPLASH-START-->.*?<!--SPLASH-END-->\n?', '', s, flags=re.S)
shim = open(os.path.join(D, 'scripts', 'desktop-shim.html'), encoding='utf-8').read()
s = s.replace('<script id="engine-src">', shim + '<script id="engine-src">', 1)
s = s.replace('<title>Proteus — Procedural 3D Node Editor</title>', '<title>Proteus</title>')
open(os.path.join(APP, 'index.html'), 'w', encoding='utf-8').write(s)
print('desktop/app ready:', len(s), 'bytes of HTML')
