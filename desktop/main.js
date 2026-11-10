// Proteus desktop shell (Electron main process)
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Let WebGL fall back to software rendering on PCs/VMs without a usable GPU
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if (!app.requestSingleInstanceLock()) app.quit();
let win = null, splash = null;
const SPLASH_MS = 5000;
let splashTimerStarted = false, onSplashDone = null;
function startSplashTimer() { if (splashTimerStarted) return; splashTimerStarted = true; setTimeout(() => onSplashDone && onSplashDone(), SPLASH_MS); }
const T0 = Date.now(), trace = (what) => { if (process.env.PROTEUS_TRACE) fs.appendFileSync(process.env.PROTEUS_TRACE, `${what} ${Date.now() - T0}\n`); };

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return { width: 1600, height: 980 }; } }
function saveState() { if (!win || win.isDestroyed()) return; try { const b = win.getNormalBounds(); fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch {} }

function createSplash() {
  splash = new BrowserWindow({
    width: 960, height: 540, frame: false, resizable: false, maximizable: false, fullscreenable: false,
    center: true, show: false, backgroundColor: '#000000', title: 'Proteus', icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  splash.once('ready-to-show', () => { if (splash) { splash.show(); trace('splash-shown'); startSplashTimer(); } });
  setTimeout(startSplashTimer, 4000); // never let a stuck splash hold the app back
  splash.on('closed', () => { splash = null; if (win && !win.isDestroyed() && !win.isVisible()) app.quit(); });
  splash.loadFile(path.join(__dirname, 'app', 'splash.html'));
}

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width || 1600, height: st.height || 980, x: st.x, y: st.y, minWidth: 980, minHeight: 620,
    backgroundColor: '#141619', title: 'Proteus', show: false,
    icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // show the main window only after the splash has had its 5 seconds and the app is ready
  let ready = false, timeUp = !splash;
  const reveal = () => { if (!ready || !timeUp || win.isDestroyed()) return; if (st.maximized) win.maximize(); win.show(); win.focus(); trace('main-shown'); if (splash && !splash.isDestroyed()) splash.destroy(); splash = null; };
  win.once('ready-to-show', () => { ready = true; trace('main-ready'); reveal(); });
  if (splash) onSplashDone = () => { timeUp = true; trace('splash-done'); reveal(); };
  win.on('close', saveState);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); } });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

const FILTERS = { png: 'PNG image', mp4: 'MP4 video', webm: 'WebM video', zip: 'ZIP archive', json: 'Proteus scene', obj: 'OBJ model', txt: 'Text' };
ipcMain.handle('proteus:save-file', async (_e, { filename, data }) => {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const res = await dialog.showSaveDialog(win, {
    title: 'Save', defaultPath: path.join(app.getPath('documents'), filename),
    filters: [{ name: FILTERS[ext] || ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }],
  });
  if (res.canceled || !res.filePath) return null;
  await fs.promises.writeFile(res.filePath, Buffer.from(data));
  return res.filePath;
});
ipcMain.handle('proteus:reveal', (_e, p) => { if (p) shell.showItemInFolder(p); });

function buildMenu() {
  const send = (act) => () => win && win.webContents.send('proteus:menu', act);
  const tpl = [
    { label: 'File', submenu: [
      { label: 'New Scene', accelerator: 'CmdOrCtrl+N', click: send('new') },
      { label: 'Open Scene…', accelerator: 'CmdOrCtrl+O', click: send('load') },
      { label: 'Save Scene…', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { type: 'separator' },
      { label: 'Export OBJ…', click: send('obj') },
      { label: 'Render…', accelerator: 'F12', click: send('render') },
      { type: 'separator' },
      { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') }, { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send('redo') }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { label: 'Help', submenu: [
      { label: 'Keyboard Shortcuts', accelerator: 'F1', click: send('help') },
      { label: 'About Proteus', click: () => dialog.showMessageBox(win, { type: 'info', title: 'About Proteus', message: `Proteus ${app.getVersion()}`, detail: 'Procedural 3D node editor with geometry, particles, fire, water, sand, cloth, hair, voxels and fracture.\n\nElectron ' + process.versions.electron }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  buildMenu();
  if (!process.env.PROTEUS_SELFTEST) createSplash();
  createWindow();
  if (process.env.PROTEUS_SELFTEST) { // automated smoke test: load an example, check engine + saving, write result, quit
    const out = process.env.PROTEUS_SELFTEST;
    fs.mkdirSync(out, { recursive: true });
    dialog.showSaveDialog = async (_w, o) => ({ canceled: false, filePath: path.join(out, path.basename(o.defaultPath)) });
    const done = (r) => { try { fs.writeFileSync(path.join(out, 'selftest-result.json'), JSON.stringify(r, null, 2)); } catch {} app.exit(r.ok ? 0 : 1); };
    setTimeout(() => done({ ok: false, error: 'timeout' }), 150000);
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(`(async () => {
          const P = window.__proteus; P.loadExample('dambreak');
          for (let i = 0; i < 240 && !(P.geo && P.geo.P.length); i++) await new Promise(r => setTimeout(r, 250));
          const saved = await (await window.claude.use('downloads')).save({ filename: 'selftest.proteus.json', data: JSON.stringify(P.state.nodes) });
          const gl = !!document.querySelector('#vp canvas').getContext('webgl2');
          let fbx = 'missing'; try { await import('three/addons/loaders/FBXLoader.js'); fbx = 'ok'; } catch (e) { fbx = String(e); }
          return { mode: P.engine.mode, points: P.geo ? P.geo.P.length : 0, errors: [...P.cookState.errors], fonts: document.fonts.check('12px Inter'), webgl2: gl, fbxReader: fbx, importers: typeof IMP, saved };
        })()`);
        const shot = await win.webContents.capturePage();
        fs.writeFileSync(path.join(out, 'screenshot.png'), shot.toPNG());
        r.ok = r.points > 0 && r.errors.length === 0 && r.fbxReader === 'ok' && r.importers === 'object' && r.saved && r.saved.status === 'saved' && fs.existsSync(path.join(out, 'selftest.proteus.json'));
        done(r);
      } catch (e) { done({ ok: false, error: String(e) }); }
    }, 1500));
  }
});
app.on('window-all-closed', () => app.quit());
