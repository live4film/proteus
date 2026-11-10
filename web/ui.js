import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ABBR = { box: 'Bx', sphere: 'Sp', grid: 'Gr', torus: 'To', tube: 'Tb', circle: 'Ci', line: 'Ln', transform: 'Xf', mountain: 'Mt', twist: 'Tw', smooth: 'Sm', wrangle: '{ }', subdivide: 'Sd', polyextrude: 'Ex', delete: 'Dl', fuse: 'Fu', scatter: 'Sc', copytopoints: 'Cp', color: 'Cd', normal: 'N', merge: 'Mg', null: 'Ø', particles: 'Pt', fire: 'Fi', water: 'Wa', sand: 'Sa', fluidsurface: 'Fs', material: 'Mt', whitewater: 'Ww', paint: 'Pa', fracture: 'Fr', debris: 'Rb', cloth: 'Cl', hair: 'Hr', voxelize: 'Vx' };
const catColor = (type) => CAT_COLORS[NODE_TYPES[type].cat];

// ============================================================
// Scene state
// ============================================================
const DEFAULT_LOOK = { sunAz: 35, sunEl: 52, sunInt: 1.9, ambient: 1.15, shadows: false, softness: 1.5, camKeys: [], camFollow: true };
let S = { nodes: {}, display: null, selected: null, nextId: 1, look: { ...DEFAULT_LOOK } };
// ---------- engine client: cooks in a background Web Worker, falls back to this thread ----------
const localCooker = new Cooker();
const cookState = { errors: new Map(), timing: new Map() };
let worker = null, workerReady = false, sentScene = null, reqSeq = 0;
const pendingReq = new Map(), bakeListeners = new Map();
try {
  const src = document.getElementById('engine-src').textContent;
  worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') { workerReady = true; return; }
    if (m.type === 'bakeFrame' || m.type === 'bakeDone') { const l = bakeListeners.get(m.id); if (l) l(m); return; }
    const p = pendingReq.get(m.id); if (!p) return; pendingReq.delete(m.id);
    if (m.type === 'error') p.rej(new Error(m.message)); else p.res(m);
  };
  worker.onerror = (e) => { console.warn('Worker failed, cooking on the main thread instead', e.message); dropWorker(); };
} catch (e) { worker = null; }
function dropWorker() {
  if (!worker) return; try { worker.terminate(); } catch (_) {} worker = null; workerReady = false; sentScene = null;
  for (const [, p] of pendingReq) p.rej(new Error('worker-lost')); pendingReq.clear();
}
function syncScene() { const s = JSON.stringify(S.nodes); if (s !== sentScene) { sentScene = s; if (worker) worker.postMessage({ type: 'scene', nodes: S.nodes }); } }
function wcall(msg) { return new Promise((res, rej) => { const id = ++reqSeq; msg.id = id; pendingReq.set(id, { res, rej }); worker.postMessage(msg); }); }
const engine = {
  clear() { localCooker.clear(); if (worker) worker.postMessage({ type: 'clear' }); },
  async cook(frame, display, selected, wantSel, haveSig) {
    syncScene();
    if (worker) { try { return await wcall({ type: 'cook', frame, fps, display, selected, wantSel, haveSig }); } catch (e) { if (e.message !== 'worker-lost') throw e; } }
    const t0 = performance.now(), c = { frame, time: (frame - 1) / fps, fps };
    const g = display && S.nodes[display] ? localCooker.cook(S.nodes, display, c) : null;
    const sg = wantSel && selected && S.nodes[selected] ? localCooker.cook(S.nodes, selected, c) : null;
    const same = g && g.__sig === haveSig;
    return { frame, sig: g ? g.__sig : null, same, geo: g && !same ? packGeo(g) : null, sel: sg ? packGeo(sg, true) : null, errors: [...localCooker.errors], timing: [...localCooker.timing], ms: performance.now() - t0 };
  },
  async frameGeo(frame) {
    syncScene();
    if (worker) { try { return unpackGeo((await wcall({ type: 'frame', frame, fps, display: S.display })).geo); } catch (e) { if (e.message !== 'worker-lost') throw e; } }
    return S.display && S.nodes[S.display] ? localCooker.cook(S.nodes, S.display, { frame, time: (frame - 1) / fps, fps }) : new Geo();
  },
  bake(from, to, onFrame) { // resolves {cancelled}
    syncScene();
    if (worker) return new Promise((res) => { const id = ++reqSeq; bakeListeners.set(id, (m) => { if (m.type === 'bakeFrame') onFrame(m.frame, m.geo); else { bakeListeners.delete(id); cookState.errors = new Map(m.errors); res({ cancelled: m.cancelled }); } }); worker.postMessage({ type: 'bake', id, from, to, fps, display: S.display }); });
    return (async () => { for (let f = from; f <= to; f++) { if (bake.cancel) return { cancelled: true }; onFrame(f, packGeo(localCooker.cook(S.nodes, S.display, { frame: f, time: (f - 1) / fps, fps }))); if (f % 3 === 0) await new Promise((r) => setTimeout(r, 0)); } return { cancelled: false }; })();
  },
  cancelBake() { bake.cancel = true; if (worker) worker.postMessage({ type: 'cancel' }); },
  get mode() { return worker ? 'worker' : 'main thread'; },
};
const ctx = { frame: 1, time: 0, fps: 24 };
let fps = 24, endFrame = 240, playing = false;
let view = { x: 40, y: 40, z: 1 };
let selWire = null;

const undoStack = [], redoStack = [];
const snapshot = () => JSON.stringify({ nodes: S.nodes, display: S.display, nextId: S.nextId, look: S.look });
let lastSnap = null;
function commit() {
  const s = snapshot();
  if (s === lastSnap) return;
  if (lastSnap) undoStack.push(lastSnap);
  if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0;
  lastSnap = s;
  try { localStorage.setItem('proteus.scene', s); } catch (e) {}
}
function restore(s) {
  const o = JSON.parse(s);
  S.nodes = o.nodes; S.display = o.display; S.nextId = o.nextId; S.look = { ...DEFAULT_LOOK, ...(o.look || {}) };
  if (S.selected && !S.nodes[S.selected]) S.selected = null;
  applyLook();
  lastSnap = s;
  try { localStorage.setItem('proteus.scene', s); } catch (e) {}
  if (paint && !S.nodes[paint.id]) endPaint();
  renderNet(); renderParams(); requestCook(); syncToggles(); drawCamStrip();
}
function undo() { if (!undoStack.length) return toast('Nothing to undo'); if (paint) paint.stroking = false; redoStack.push(lastSnap); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return toast('Nothing to redo'); undoStack.push(lastSnap); restore(redoStack.pop()); }

function uniqueName(type) {
  const base = type === 'copytopoints' ? 'copy' : type;
  let i = 1; const names = new Set(Object.values(S.nodes).map((n) => n.name));
  while (names.has(base + i)) i++;
  return base + i;
}
function addNode(type, x, y, opts = {}) {
  const T = NODE_TYPES[type];
  const id = 'n' + S.nextId++;
  S.nodes[id] = { id, type, name: opts.name || uniqueName(type), x, y, params: { ...defaultParams(type), ...(opts.params || {}) }, inputs: T.inputs === -1 ? [] : Array(T.inputs).fill(null), bypass: false };
  return id;
}
function connect(from, to, idx) {
  const n = S.nodes[to];
  if (!n || from === to || dependsOn(from, to)) { toast('That connection would create a loop'); return false; }
  if (NODE_TYPES[n.type].inputs === -1) { if (idx >= n.inputs.length) n.inputs.push(from); else n.inputs[idx] = from; }
  else n.inputs[idx] = from;
  return true;
}
function dependsOn(a, b) { // does a (transitively) read from b?
  const seen = new Set(), st = [a];
  while (st.length) { const k = st.pop(); if (k === b) return true; if (seen.has(k) || !S.nodes[k]) continue; seen.add(k); S.nodes[k].inputs.forEach((i) => i && st.push(i)); }
  return false;
}
function disconnect(to, idx) {
  const n = S.nodes[to];
  if (NODE_TYPES[n.type].inputs === -1) n.inputs.splice(idx, 1); else n.inputs[idx] = null;
}
function deleteNode(id) {
  const n = S.nodes[id]; if (!n) return;
  // re-link: downstream nodes reading this node read its first input instead
  const up = n.inputs[0] || null;
  for (const m of Object.values(S.nodes)) {
    m.inputs = m.inputs.map((i) => (i === id ? up : i));
    if (NODE_TYPES[m.type].inputs === -1) m.inputs = m.inputs.filter(Boolean);
  }
  delete S.nodes[id];
  if (S.display === id) S.display = up || Object.keys(S.nodes).pop() || null;
  if (S.selected === id) S.selected = null;
}

// ============================================================
// Viewport (three.js)
// ============================================================
const vp = $('#vp');
$('#boot').remove();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
vp.appendChild(renderer.domElement);
const scene = new THREE.Scene();
let skyMesh = null;
{
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#3a4048'); gr.addColorStop(1, '#17191c');
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  // a real backdrop sphere (not scene.background) so refractive materials can see it
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, toneMapped: false, fog: false }));
  sky.renderOrder = -1; scene.add(sky); skyMesh = sky;
}
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
camera.position.set(9, 7, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.DOLLY };
const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x302820, 1.15); scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(5, 10, 7); scene.add(key); scene.add(key.target);
key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.38 }));
catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true; catcher.visible = false; catcher.renderOrder = -0.5; scene.add(catcher);
function fitLight(g) {
  const bb = g && g.P.length ? g.bbox() : { min: [-1, 0, -1], max: [1, 1, 1] };
  const c = new THREE.Vector3(...bb.min).add(new THREE.Vector3(...bb.max)).multiplyScalar(0.5);
  const R = Math.max(1, new THREE.Vector3(...bb.max).sub(new THREE.Vector3(...bb.min)).length() * 0.55);
  const az = (S.look.sunAz * Math.PI) / 180, el = (S.look.sunEl * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  key.position.copy(c).addScaledVector(dir, R * 3); key.target.position.copy(c); key.target.updateMatrixWorld();
  const sc = key.shadow.camera; sc.left = -R * 1.3; sc.right = R * 1.3; sc.top = R * 1.3; sc.bottom = -R * 1.3; sc.near = 0.1; sc.far = R * 6; sc.updateProjectionMatrix();
  key.shadow.radius = S.look.softness * 2;
  const gy = Math.min(0, bb.min[1]) - 0.001; catcher.position.set(c.x, gy, c.z); catcher.scale.set(R * 8, R * 8, 1);
}
function applyLook() {
  key.intensity = S.look.sunInt; hemi.intensity = S.look.ambient;
  key.castShadow = !!S.look.shadows; catcher.visible = !!S.look.shadows;
  fitLight(currentGeo);
}
const rim = new THREE.DirectionalLight(0x9fc4ff, 0.7); rim.position.set(-8, 4, -6); scene.add(rim);
const grid = new THREE.GridHelper(40, 40, 0x5b636d, 0x2f353b); grid.material.transparent = true; grid.material.opacity = 0.7; scene.add(grid);
const geoGroup = new THREE.Group(); scene.add(geoGroup);
const envTex = (() => { const pm = new THREE.PMREMGenerator(renderer); const t = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture; pm.dispose(); return t; })();
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
function makeMeshMat(kind) {
  const common = { vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  switch (kind) {
    case 'water': {
      const m = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.5, ior: 1.33, envMap: envTex, envMapIntensity: 0.65, specularIntensity: 0.8, clearcoat: 0.6, clearcoatRoughness: 0.04, side: THREE.FrontSide, depthWrite: true });
      // fresnel: faces seen edge-on become more opaque and brighter, like a real water surface
      m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0);
        gl_FragColor.a = clamp(gl_FragColor.a + fr * 0.4, 0.0, 1.0); gl_FragColor.rgb += fr * vec3(0.05, 0.09, 0.12);`); };
      return m;
    }
    case 'glass': return new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.22, envMap: envTex, envMapIntensity: 1.4, specularIntensity: 1, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
    case 'metal': return new THREE.MeshStandardMaterial({ ...common, roughness: 0.22, metalness: 1, envMap: envTex, envMapIntensity: 1.2, side: THREE.DoubleSide });
    case 'glow': return new THREE.MeshBasicMaterial({ ...common, side: THREE.DoubleSide });
    default: return new THREE.MeshStandardMaterial({ ...common, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide });
  }
}
const disp = { shade: 'shaded', points: false, normals: false };
const spriteUniforms = { uScale: { value: 800 } };
const SPRITE_VS = `attribute float size; attribute float alpha; varying vec3 vC; varying float vA;
void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = max(1.5, size * uScale / -mv.z); gl_Position = projectionMatrix * mv; }`;
function makeSpriteMat(sp) {
  const foam = sp.mode === 'foam', glow = sp.mode === 'glow' || foam;
  const fs = foam
    ? `varying vec3 vC; varying float vA;
       void main(){ vec2 c = gl_PointCoord*2.0-1.0; float r2 = dot(c,c); if(r2>1.0) discard;
         float f = smoothstep(1.0, 0.35, r2); float a = vA*f; if(a < 0.12) discard;
         vec3 n = vec3(c.x, -c.y, sqrt(1.0-r2)); float sh = 0.82 + 0.18*max(dot(n, normalize(vec3(0.4,0.8,0.5))),0.0);
         gl_FragColor = vec4(vC*sh*a, a); }`
    : glow
    ? `uniform float uGain; varying vec3 vC; varying float vA;
       void main(){ vec2 c = gl_PointCoord*2.0-1.0; float r2 = dot(c,c); if(r2>1.0) discard;
         float f = exp(-r2*3.2) - 0.04; if(f<=0.0) discard;
         float a = vA*f; vec3 rgb = vA>0.0005 ? vC*a : vC*f*uGain; gl_FragColor = vec4(rgb, a); }`
    : `uniform float uSpec; varying vec3 vC;
       void main(){ vec2 c = gl_PointCoord*2.0-1.0; float r2 = dot(c,c); if(r2>1.0) discard;
         vec3 n = vec3(c.x, -c.y, sqrt(1.0-r2)); vec3 l = normalize(vec3(0.45,0.75,0.55));
         float d = max(dot(n,l),0.0); float s = pow(max(dot(reflect(-l,n), vec3(0,0,1)),0.0), 36.0)*uSpec;
         float rim = pow(1.0-n.z, 2.0)*0.25*uSpec;
         gl_FragColor = vec4(vC*(0.32+0.78*d) + s + rim, 1.0); }`;
  return new THREE.ShaderMaterial({
    uniforms: { uScale: spriteUniforms.uScale, uGain: { value: sp.gain ?? 1 }, uSpec: { value: sp.spec ?? 0.3 } },
    vertexShader: 'uniform float uScale;\n' + SPRITE_VS, fragmentShader: fs, vertexColors: true,
    transparent: glow, depthWrite: !glow || foam, depthTest: true,
    blending: glow ? THREE.CustomBlending : THREE.NormalBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

function buildThree(g) {
  geoGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  geoGroup.clear();
  const P = g.P;
  if (!P.length) return;
  const hasPrims = g.prims.length > 0;
  if (hasPrims) {
    const fN = g.prims.map((f) => faceNormal(P, f));
    const ptFaces = Array.from({ length: P.length }, () => []);
    g.prims.forEach((f, fi) => f.forEach((v) => ptFaces[v].push(fi)));
    const groups = new Map(); // material -> {pos,nrm,col}
    const cusp = 0.5;
    const cornerN = (v, fi) => {
      let x = 0, y = 0, z = 0; const n0 = fN[fi];
      for (const o of ptFaces[v]) { const n = fN[o]; if (n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] > cusp) { x += n[0]; y += n[1]; z += n[2]; } }
      const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l];
    };
    const def = [0.72, 0.74, 0.77];
    g.prims.forEach((f, fi) => {
      const mk = (g.primMat && g.primMat[fi]) || 'plastic';
      let G = groups.get(mk); if (!G) groups.set(mk, (G = { pos: [], nrm: [], col: [] }));
      const cn = f.map((v) => cornerN(v, fi));
      for (let i = 1; i + 1 < f.length; i++) for (const k of [0, i, i + 1]) {
        const v = f[k], p = P[v], n = cn[k], c = g.Cd ? g.Cd[v] : def;
        G.pos.push(p[0], p[1], p[2]); G.nrm.push(n[0], n[1], n[2]); G.col.push(c[0], c[1], c[2]);
      }
    });
    if (disp.shade !== 'wire') for (const [mk, G] of groups) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
      bg.setAttribute('normal', new THREE.Float32BufferAttribute(G.nrm, 3));
      const ca = new THREE.Float32BufferAttribute(G.col, 3);
      for (let i = 0; i < ca.array.length; i++) ca.array[i] = Math.pow(ca.array[i], 2.2); // sRGB -> linear
      bg.setAttribute('color', ca);
      const mesh = new THREE.Mesh(bg, makeMeshMat(mk)); mesh.castShadow = mk !== 'glow'; mesh.receiveShadow = mk === 'plastic' || mk === 'metal';
      if (mk === 'glass') mesh.renderOrder = 5; else if (mk === 'water') mesh.renderOrder = 4;
      geoGroup.add(mesh);
    }
    if (disp.shade !== 'shaded') {
      const seen = new Set(), ep = [];
      for (const f of g.prims) for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length], k = a < b ? a * 1e7 + b : b * 1e7 + a;
        if (seen.has(k)) continue; seen.add(k);
        ep.push(...P[a], ...P[b]);
      }
      const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
      geoGroup.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: disp.shade === 'wire' ? 0xb8c2cc : 0x101214, transparent: true, opacity: disp.shade === 'wire' ? 0.9 : 0.45 })));
    }
  }
  if (g.lines.length) {
    const lp = [], lc = [];
    for (const l of g.lines) for (let i = 0; i + 1 < l.length; i++) {
      lp.push(...P[l[i]], ...P[l[i + 1]]);
      const c1 = g.Cd ? g.Cd[l[i]] : [0.9, 0.85, 0.6], c2 = g.Cd ? g.Cd[l[i + 1]] : [0.9, 0.85, 0.6];
      lc.push(...c1, ...c2);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    geoGroup.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true })));
  }
  let ptIdx;
  if (disp.points) ptIdx = P.map((_, i) => i);
  else {
    const used = new Uint8Array(P.length);
    g.prims.forEach((f) => f.forEach((v) => (used[v] = 1))); g.lines.forEach((l) => l.forEach((v) => (used[v] = 1)));
    ptIdx = []; for (let i = 0; i < P.length; i++) if (!used[i]) ptIdx.push(i);
  }
  if (ptIdx.length) {
    const pp = new Float32Array(ptIdx.length * 3), pc = new Float32Array(ptIdx.length * 3);
    ptIdx.forEach((i, k) => { pp.set(P[i], k * 3); const c = g.Cd ? g.Cd[i] : (disp.points && hasPrims ? [0.4, 0.75, 1] : [0.95, 0.8, 0.45]); pc.set(c, k * 3); });
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3)); pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    if (g.sprite && !disp.points) {
      const sz = new Float32Array(ptIdx.length), al = new Float32Array(ptIdx.length);
      ptIdx.forEach((i, k) => { sz[k] = g.sprite.size * (g.pscale ? g.pscale[i] : 1); al[k] = g.alpha ? g.alpha[i] : 0; });
      pg.setAttribute('size', new THREE.BufferAttribute(sz, 1)); pg.setAttribute('alpha', new THREE.BufferAttribute(al, 1));
      if (g.sprite.mode === 'glow' || g.sprite.mode === 'foam') { // sort back-to-front so smoke occludes correctly
        const cam = camera.position, order = ptIdx.map((_, k) => k).sort((a, b) => { const da = (pp[a*3]-cam.x)**2+(pp[a*3+1]-cam.y)**2+(pp[a*3+2]-cam.z)**2, db = (pp[b*3]-cam.x)**2+(pp[b*3+1]-cam.y)**2+(pp[b*3+2]-cam.z)**2; return db - da; });
        for (const [name, n] of [['position', 3], ['color', 3], ['size', 1], ['alpha', 1]]) { const a = pg.getAttribute(name).array, c = a.slice(); order.forEach((src, dst) => { for (let q = 0; q < n; q++) a[dst * n + q] = c[src * n + q]; }); }
      }
      const pts = new THREE.Points(pg, makeSpriteMat(g.sprite)); pts.renderOrder = g.sprite.mode === 'glow' ? 10 : g.sprite.mode === 'foam' ? 3 : 0; pts.frustumCulled = false;
      geoGroup.add(pts);
    } else geoGroup.add(new THREE.Points(pg, new THREE.PointsMaterial({ size: hasPrims ? 4 : 5, sizeAttenuation: false, vertexColors: true, depthTest: hasPrims })));
  }
  if (disp.normals) {
    const gg = g.N && g.N.length === P.length ? g : computeNormals(g.clone());
    const bb = g.bbox(), sz = Math.max(...bb.max.map((v, i) => v - bb.min[i])) * 0.04 || 0.1;
    const np = [], step = Math.max(1, Math.floor(P.length / 20000));
    for (let i = 0; i < P.length; i += step) { const p = P[i], n = gg.N[i]; np.push(...p, p[0] + n[0] * sz, p[1] + n[1] * sz, p[2] + n[2] * sz); }
    const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
    geoGroup.add(new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ color: 0x5fd0ff })));
  }
}
function frameGeo() {
  const g = currentGeo; if (!g || !g.P.length) return;
  const bb = g.bbox(), c = new THREE.Vector3(...bb.min).add(new THREE.Vector3(...bb.max)).multiplyScalar(0.5);
  const r = Math.max(0.5, new THREE.Vector3(...bb.max).sub(new THREE.Vector3(...bb.min)).length() * 0.5);
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(c);
  camera.position.copy(c).add(dir.multiplyScalar(r / Math.sin((camera.fov * Math.PI) / 360) * 1.05));
}
const ro = new ResizeObserver(() => { const w = vp.clientWidth, h = vp.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); });
ro.observe(vp);
const axesCtx = $('#axes').getContext('2d');
function drawAxes() {
  const g = axesCtx, W = 140, c = 70; g.clearRect(0, 0, W, W);
  const m = camera.matrixWorldInverse;
  const ax = [['X', [1, 0, 0], '#e5534b'], ['Y', [0, 1, 0], '#6bc46d'], ['Z', [0, 0, 1], '#4fa3e8']].map(([l, v, col]) => {
    const d = new THREE.Vector3(...v).transformDirection(m); return { l, col, x: d.x, y: d.y, z: d.z };
  }).sort((a, b) => a.z - b.z);
  for (const a of ax) {
    const ex = c + a.x * 44, ey = c - a.y * 44;
    g.strokeStyle = a.col; g.lineWidth = 3; g.beginPath(); g.moveTo(c, c); g.lineTo(ex, ey); g.stroke();
    g.fillStyle = a.col; g.beginPath(); g.arc(ex, ey, 11, 0, 7); g.fill();
    g.fillStyle = '#111'; g.font = '600 13px Inter,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(a.l, ex, ey + 1);
  }
}
renderer.setAnimationLoop(() => { if (offline) return; controls.update(); spriteUniforms.uScale.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360)); renderer.render(scene, camera); drawAxes(); });

// ============================================================
// Cooking
// ============================================================
let currentGeo = null, cookQueued = false, lastCookMs = 0, offline = false;
function requestCook() { if (cookQueued) return; cookQueued = true; requestAnimationFrame(doCook); }
let cookInFlight = false, cookAgain = false, shownSig = null, lastSel = null;
async function doCook() {
  cookQueued = false;
  const baked = paint ? null : bakedGeo(ctx.frame);
  if (baked) {
    if (baked !== currentGeo) { currentGeo = baked; shownSig = null; buildThree(baked); fitLight(baked); }
    updateHud(); if (sheetVisible) renderSheet(); return;
  }
  if (cookInFlight) { cookAgain = true; return; }
  cookInFlight = true;
  const display = paint && S.nodes[paint.id] ? paint.id : S.display && S.nodes[S.display] ? S.display : null;
  try {
    const r = await engine.cook(ctx.frame, display, S.selected, sheetVisible || (!!S.selected && S.selected !== display), shownSig);
    lastCookMs = r.ms; cookState.errors = new Map(r.errors); cookState.timing = new Map(r.timing);
    if (!r.same) { const g = r.geo ? unpackGeo(r.geo) : new Geo(); currentGeo = g; shownSig = r.sig; if (paint && display === paint.id) paintGotGeo(g); else buildThree(g); fitLight(g); }
    lastSel = r.sel ? unpackGeo(r.sel) : null;
    updateHud(); updateNodeStates(); if (sheetVisible) renderSheet(); updateParamError();
  } catch (e) { console.error(e); }
  finally { cookInFlight = false; if (cookAgain) { cookAgain = false; doCook(); } }
}
function updateHud() {
  const n = S.nodes[S.display], g = currentGeo || new Geo();
  const bb = g.bbox(), sz = bb.max.map((v, i) => (v - bb.min[i]).toFixed(2)).join(' × ');
  $('#hud').innerHTML = n
    ? `<b>${esc(n.name)}</b>  ${NODE_TYPES[n.type].label}\npoints ${g.P.length.toLocaleString()}   prims ${g.prims.length.toLocaleString()}${g.lines.length ? '   lines ' + g.lines.length : ''}\nsize   ${sz}\ncook   ${lastCookMs.toFixed(1)} ms   frame ${ctx.frame}${bakedGeo(ctx.frame) ? '  ⚡baked' : ''}`
    : 'No display node — press Tab in the network to add one';
}
function rebuildDisplay() { if (currentGeo) buildThree(currentGeo); }

// ============================================================
// Network editor
// ============================================================
const net = $('#net'), inner = $('#netInner'), wires = $('#wires');
const NW = 150, NH = 36;
function applyView() { inner.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`; net.style.backgroundPosition = `${view.x}px ${view.y}px`; net.style.backgroundSize = `${20 * view.z}px ${20 * view.z}px`; }
const inPortX = (n, i) => { const cnt = portCount(n); return cnt === 1 ? NW / 2 : 22 + (i * (NW - 44)) / (cnt - 1); };
const portCount = (n) => (NODE_TYPES[n.type].inputs === -1 ? n.inputs.length + 1 : NODE_TYPES[n.type].inputs);

function renderNet() {
  $$('#netInner .node').forEach((e) => e.remove());
  for (const n of Object.values(S.nodes)) {
    const T = NODE_TYPES[n.type];
    const d = el('div', 'node');
    d.dataset.id = n.id;
    d.style.left = n.x + 'px'; d.style.top = n.y + 'px';
    d.innerHTML = `<div class="flag fb" title="Bypass (B)"></div><div class="body"><div class="ico" style="background:${catColor(n.type)}">${ABBR[n.type]}</div><div class="nm">${esc(n.name)}</div></div><div class="flag fd" title="Display (R)"></div><div class="lbl">${T.label}</div>`;
    const pc = portCount(n);
    for (let i = 0; i < pc; i++) {
      const p = el('div', 'port in' + (n.inputs[i] ? ' conn' : ''));
      p.dataset.idx = i; p.style.left = inPortX(n, i) - 6 + 'px';
      p.title = T.inputNames ? T.inputNames[i] : T.inputs === -1 ? 'input ' + (i + 1) : 'input';
      d.appendChild(p);
    }
    const o = el('div', 'port out'); o.title = 'output'; d.appendChild(o);
    inner.appendChild(d);
  }
  updateNodeStates();
  drawWires();
}
function updateNodeStates() {
  $$('#netInner .node').forEach((d) => {
    const n = S.nodes[d.dataset.id]; if (!n) return;
    d.classList.toggle('sel', S.selected === n.id);
    d.classList.toggle('disp', S.display === n.id);
    d.classList.toggle('byp', !!n.bypass);
    const err = cookState.errors.get(n.id);
    d.classList.toggle('err', !!err);
    d.querySelector('.body').title = err ? 'Error: ' + err : `${n.name} (${NODE_TYPES[n.type].label})${cookState.timing.has(n.id) ? ' — ' + cookState.timing.get(n.id).toFixed(1) + ' ms' : ''}`;
  });
}
const wirePath = (x1, y1, x2, y2) => { const dy = Math.max(30, Math.abs(y2 - y1) * 0.5); return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`; };
let tempWire = null;
function drawWires() {
  let h = '';
  for (const n of Object.values(S.nodes)) n.inputs.forEach((src, i) => {
    const s = S.nodes[src]; if (!s) return;
    const d = wirePath(s.x + NW / 2, s.y + NH, n.x + inPortX(n, i), n.y);
    const sel = selWire && selWire.to === n.id && selWire.idx === i;
    h += `<path class="hit" data-to="${n.id}" data-idx="${i}" d="${d}"/><path class="${sel ? 'selw' : ''}" d="${d}"/>`;
  });
  if (tempWire) h += `<path class="temp" d="${tempWire}"/>`;
  wires.innerHTML = h;
}
function moveNodeEl(n) { const d = inner.querySelector(`.node[data-id="${n.id}"]`); if (d) { d.style.left = n.x + 'px'; d.style.top = n.y + 'px'; } }
const toNet = (cx, cy) => { const r = net.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }; };

function select(id) { if (paint && id !== paint.id) endPaint(); S.selected = id; selWire = null; updateNodeStates(); drawWires(); renderParams(); requestCook(); }
function setDisplay(id) { S.display = id; updateNodeStates(); commit(); requestCook(); }
function toggleBypass(id) { const n = S.nodes[id]; n.bypass = !n.bypass; updateNodeStates(); commit(); requestCook(); }

let drag = null;
net.addEventListener('pointerdown', (e) => {
  closeTabMenu();
  const port = e.target.closest('.port'), nodeEl = e.target.closest('.node'), hit = e.target.closest('path.hit');
  if (e.button === 1 || (e.button === 0 && !nodeEl && !hit && !port)) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    net.classList.add('panning');
  } else if (hit) {
    selWire = { to: hit.dataset.to, idx: +hit.dataset.idx }; S.selected = null;
    updateNodeStates(); drawWires(); renderParams();
    return;
  } else if (port) {
    const id = nodeEl.dataset.id, n = S.nodes[id];
    if (port.classList.contains('out')) drag = { kind: 'wire', from: id };
    else {
      const idx = +port.dataset.idx;
      if (n.inputs[idx]) { const from = n.inputs[idx]; disconnect(id, idx); renderNet(); requestCook(); drag = { kind: 'wire', from, detached: true }; }
      else drag = { kind: 'rwire', to: id, idx };
    }
  } else if (nodeEl) {
    const id = nodeEl.dataset.id;
    if (e.target.classList.contains('fd')) { setDisplay(id); return; }
    if (e.target.classList.contains('fb')) { toggleBypass(id); return; }
    if (S.selected !== id) select(id);
    const n = S.nodes[id];
    drag = { kind: 'node', id, ox: n.x, oy: n.y, sx: e.clientX, sy: e.clientY, moved: false };
  }
  if (drag) { net.setPointerCapture(e.pointerId); e.preventDefault(); }
});
net.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    applyView();
  } else if (drag.kind === 'node') {
    const n = S.nodes[drag.id];
    n.x = Math.round(drag.ox + (e.clientX - drag.sx) / view.z); n.y = Math.round(drag.oy + (e.clientY - drag.sy) / view.z);
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 2) drag.moved = true;
    moveNodeEl(n); drawWires();
  } else {
    const p = toNet(e.clientX, e.clientY);
    $$('.port.hot').forEach((x) => x.classList.remove('hot'));
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const tp = under && under.closest('.port'); if (tp) tp.classList.add('hot');
    if (drag.kind === 'wire') { const s = S.nodes[drag.from]; tempWire = wirePath(s.x + NW / 2, s.y + NH, p.x, p.y); }
    else { const n = S.nodes[drag.to]; tempWire = wirePath(p.x, p.y, n.x + inPortX(n, drag.idx), n.y); }
    drawWires();
  }
});
net.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag; drag = null; net.classList.remove('panning');
  if (d.kind === 'pan') { if (!d.moved && e.button === 0) { S.selected = null; selWire = null; updateNodeStates(); drawWires(); renderParams(); } return; }
  if (d.kind === 'node') { if (d.moved) commit(); return; }
  tempWire = null; $$('.port.hot').forEach((x) => x.classList.remove('hot'));
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const port = under && under.closest('.port'), nodeEl = under && under.closest('.node');
  let ok = false;
  if (d.kind === 'wire') {
    if (nodeEl && nodeEl.dataset.id !== d.from) {
      const to = nodeEl.dataset.id, n = S.nodes[to];
      let idx = port && port.classList.contains('in') ? +port.dataset.idx : n.inputs.findIndex((x) => !x);
      if (NODE_TYPES[n.type].inputs === -1 && (idx < 0 || !(port && port.classList.contains('in')))) idx = n.inputs.length;
      if (idx >= 0 && NODE_TYPES[n.type].inputs !== 0) ok = connect(d.from, to, idx);
    } else if (!nodeEl) {
      const p = toNet(e.clientX, e.clientY);
      openTabMenu(e.clientX, e.clientY, { x: p.x - NW / 2, y: p.y, from: d.from });
    }
  } else if (d.kind === 'rwire') {
    if (nodeEl && nodeEl.dataset.id !== d.to) ok = connect(nodeEl.dataset.id, d.to, d.idx);
  }
  renderNet(); requestCook();
  if (ok || d.detached) commit();
});
net.addEventListener('dblclick', (e) => {
  const nodeEl = e.target.closest('.node');
  if (nodeEl && !e.target.closest('.port') && !e.target.classList.contains('flag')) setDisplay(nodeEl.dataset.id);
  else if (!nodeEl) { const p = toNet(e.clientX, e.clientY); openTabMenu(e.clientX, e.clientY, { x: p.x - NW / 2, y: p.y - NH / 2 }); }
});
net.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = net.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const z = Math.min(2.5, Math.max(0.25, view.z * Math.exp(-e.deltaY * 0.0015)));
  view.x = mx - ((mx - view.x) * z) / view.z; view.y = my - ((my - view.y) * z) / view.z; view.z = z;
  applyView();
}, { passive: false });
let netHover = false;
net.addEventListener('pointerenter', () => (netHover = true));
net.addEventListener('pointerleave', () => (netHover = false));

function homeNet() {
  const ns = Object.values(S.nodes); if (!ns.length) { view = { x: 40, y: 40, z: 1 }; return applyView(); }
  const minX = Math.min(...ns.map((n) => n.x)), maxX = Math.max(...ns.map((n) => n.x + NW + 60));
  const minY = Math.min(...ns.map((n) => n.y)), maxY = Math.max(...ns.map((n) => n.y + NH));
  const W = net.clientWidth, H = net.clientHeight;
  const z = Math.min(1.3, Math.max(0.3, Math.min((W - 60) / (maxX - minX || 1), (H - 60) / (maxY - minY || 1))));
  view = { z, x: (W - (maxX - minX) * z) / 2 - minX * z, y: (H - (maxY - minY) * z) / 2 - minY * z };
  applyView();
}
function tidyLayout() {
  const ns = S.nodes, depth = {};
  const dep = (id, seen = new Set()) => { if (depth[id] != null) return depth[id]; if (seen.has(id)) return 0; seen.add(id); const n = ns[id]; let d = 0; n.inputs.forEach((i) => { if (i && ns[i]) d = Math.max(d, dep(i, seen) + 1); }); return (depth[id] = d); };
  Object.keys(ns).forEach((id) => dep(id));
  const rows = {};
  Object.keys(ns).sort((a, b) => ns[a].x - ns[b].x).forEach((id) => (rows[depth[id]] = rows[depth[id]] || []).push(id));
  for (const [d, ids] of Object.entries(rows)) {
    ids.sort((a, b) => {
      const ax = ns[a].inputs.filter((i) => ns[i]).map((i) => ns[i].x), bx = ns[b].inputs.filter((i) => ns[i]).map((i) => ns[i].x);
      return (ax.length ? ax.reduce((s, v) => s + v) / ax.length : ns[a].x) - (bx.length ? bx.reduce((s, v) => s + v) / bx.length : ns[b].x);
    });
    ids.forEach((id, i) => { ns[id].x = i * 200 - ((ids.length - 1) * 200) / 2; ns[id].y = d * 80; });
  }
  renderNet(); homeNet(); commit();
}

// ============================================================
// Tab menu
// ============================================================
const tabMenu = $('#tabMenu'), tabSearch = $('#tabSearch'), tabList = $('#tabList');
let tabCtx = null, tabItems = [], tabAct = 0;
function openTabMenu(cx, cy, c) {
  tabCtx = c;
  tabMenu.style.left = Math.min(cx, innerWidth - 260) + 'px';
  tabMenu.style.top = Math.min(cy, innerHeight - 390) + 'px';
  tabMenu.classList.add('open'); tabSearch.value = ''; fillTab(); setTimeout(() => tabSearch.focus(), 0);
}
function closeTabMenu() { tabMenu.classList.remove('open'); tabCtx = null; }
function fillTab() {
  const q = tabSearch.value.trim().toLowerCase();
  tabItems = Object.entries(NODE_TYPES).filter(([k, T]) => !q || T.label.toLowerCase().includes(q) || k.includes(q) || T.cat.toLowerCase().includes(q)).map(([k]) => k);
  tabAct = 0;
  let h = '', cat = null;
  const ordered = q ? tabItems : Object.keys(CAT_COLORS).flatMap((c) => tabItems.filter((k) => NODE_TYPES[k].cat === c));
  tabItems = ordered;
  ordered.forEach((k, i) => {
    const T = NODE_TYPES[k];
    if (!q && T.cat !== cat) { cat = T.cat; h += `<div class="cat">${cat}</div>`; }
    h += `<div class="it${i === 0 ? ' act' : ''}" data-k="${k}"><div class="ico" style="background:${CAT_COLORS[T.cat]}">${ABBR[k]}</div>${T.label}</div>`;
  });
  tabList.innerHTML = h || '<div class="cat">No matches</div>';
}
function tabSetAct(i) { const its = $$('#tabList .it'); if (!its.length) return; tabAct = (i + its.length) % its.length; its.forEach((x, j) => x.classList.toggle('act', j === tabAct)); its[tabAct].scrollIntoView({ block: 'nearest' }); }
tabSearch.addEventListener('input', fillTab);
tabSearch.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { tabSetAct(tabAct + 1); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { tabSetAct(tabAct - 1); e.preventDefault(); }
  else if (e.key === 'Enter') { if (tabItems[tabAct]) placeNode(tabItems[tabAct]); }
  else if (e.key === 'Escape' || e.key === 'Tab') { closeTabMenu(); e.preventDefault(); }
});
tabList.addEventListener('pointerdown', (e) => { const it = e.target.closest('.it'); if (it) { e.preventDefault(); placeNode(it.dataset.k); } });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#tabMenu') && !e.target.closest('#net') && !e.target.closest('#addBtn')) closeTabMenu(); if (!e.target.closest('.menu-wrap')) $$('.dropdown').forEach((d) => d.classList.remove('open')); });
function placeNode(type) {
  const c = tabCtx || {}; closeTabMenu();
  const T = NODE_TYPES[type];
  let x = c.x, y = c.y, from = c.from;
  if (c.auto && S.selected && S.nodes[S.selected] && T.inputs !== 0) { const s = S.nodes[S.selected]; from = s.id; x = s.x; y = s.y + 80; }
  if (x == null) { const r = net.getBoundingClientRect(); const p = toNet(r.left + r.width / 2, r.top + r.height / 2); x = p.x - NW / 2; y = p.y; }
  const id = addNode(type, Math.round(x), Math.round(y));
  if (from && T.inputs !== 0) connect(from, id, 0);
  S.selected = id;
  if (!S.display || from === S.display || T.inputs === 0 && !S.display) S.display = id;
  if (from) S.display = id;
  renderNet(); renderParams(); commit(); requestCook();
}

// ============================================================
// Parameter panel
// ============================================================
const paramsEl = $('#params');
let paramTimer = null;
function paramChanged(final) {
  if (paint && S.selected === paint.id && paint.attr && paint.attr !== paintAttrOf(paint.id)) { paint.vals = paint.rgba = null; shownSig = null; renderParams(); paintBadge(); }
  requestCook();
  clearTimeout(paramTimer);
  if (final) commit(); else paramTimer = setTimeout(commit, 600);
}
function fmt(v) { if (typeof v !== 'number') return String(v); return String(Math.round(v * 1e5) / 1e5); }
function numField(get, set, def, slider) {
  const inp = el('input', 'num'); inp.spellcheck = false;
  const refresh = () => { const v = get(); inp.value = fmt(v); inp.classList.toggle('expr', isExpr(v)); inp.classList.remove('bad'); };
  refresh();
  const apply = (final) => {
    const s = inp.value.trim(); const n = Number(s);
    const v = s !== '' && !Number.isNaN(n) ? (def.t === 'int' ? Math.round(n) : n) : s;
    inp.classList.toggle('expr', isExpr(v));
    inp.classList.toggle('bad', isExpr(v) && Number.isNaN(evalNum(v, ctx)));
    set(v); if (slider && !isExpr(v)) slider.value = v; paramChanged(final);
  };
  inp.addEventListener('change', () => apply(true));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); } e.stopPropagation(); });
  inp.addEventListener('wheel', (e) => { if (document.activeElement !== inp) return; e.preventDefault(); const v = get(); if (isExpr(v)) return; const step = def.t === 'int' ? 1 : (Math.abs(v) > 10 ? 1 : 0.1) * (e.shiftKey ? 10 : 1); const nv = +(v - Math.sign(e.deltaY) * step).toFixed(5); set(nv); refresh(); if (slider) slider.value = nv; paramChanged(false); }, { passive: false });
  inp._refresh = refresh;
  return inp;
}
function scrubLabel(lab, get, set, def, refresh) {
  lab.addEventListener('pointerdown', (e) => {
    const v0 = get(); if (isExpr(v0) || (typeof v0 !== 'number' && Number.isNaN(Number(v0)))) return;
    const start = e.clientX, base = +v0;
    const range = def.max != null ? def.max - (def.min ?? 0) : 10;
    lab.setPointerCapture(e.pointerId);
    const mv = (ev) => { let nv = base + ((ev.clientX - start) / 250) * range * (ev.shiftKey ? 0.1 : 1); nv = def.t === 'int' ? Math.round(nv) : +nv.toFixed(4); set(nv); refresh(); paramChanged(false); };
    const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); commit(); };
    lab.addEventListener('pointermove', mv); lab.addEventListener('pointerup', up);
  });
}
function renderParams() {
  paramsEl.innerHTML = '';
  const n = S.nodes[S.selected];
  $('#ppath').textContent = n ? '/scene/' + n.name : '';
  if (!n) {
    paramsEl.innerHTML = `<div class="pempty">Select a node to edit its parameters.<br><kbd>Tab</kbd> over the network to add nodes · double-click a node to display it<br>Numeric fields accept expressions like <code style="color:#8fd18f">sin($F*0.1)</code> or <code style="color:#8fd18f">$T*2</code><br>Drag a parameter's label sideways to scrub its value</div>`;
    if (selWire) paramsEl.innerHTML += `<div class="pinfo" style="text-align:center">Wire selected — press <kbd>Delete</kbd> to remove it</div>`;
    return;
  }
  const T = NODE_TYPES[n.type];
  const head = el('div', 'phead');
  head.innerHTML = `<div class="ico" style="background:${catColor(n.type)}">${ABBR[n.type]}</div><span class="ptype">${T.label}</span>`;
  const nameIn = el('input'); nameIn.value = n.name; nameIn.spellcheck = false;
  nameIn.addEventListener('change', () => { n.name = nameIn.value.trim().replace(/\s+/g, '_') || n.name; nameIn.value = n.name; renderNet(); updateHud(); commit(); $('#ppath').textContent = '/scene/' + n.name; });
  nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nameIn.blur(); });
  head.appendChild(nameIn);
  paramsEl.appendChild(head);
  if (!T.params.length) paramsEl.appendChild(el('div', 'pinfo', T.inputs === -1 ? 'Merge combines every connected input. Drag more wires onto its free input port.' : 'Pass-through node — handy as a named output marker.'));
  for (const d of T.params) {
    if (d.showIf && !d.showIf(n.params)) continue;
    if (d.t === 'paint') { paramsEl.appendChild(paintPanel(n, d)); continue; }
    if (d.t === 'code') {
      const lab = el('div', 'pinfo', d.l + ' <span style="float:right">per-point script: <code>@P.y += …</code></span>');
      const w = el('div', 'codewrap'); const ta = el('textarea'); ta.value = n.params[d.n]; ta.spellcheck = false;
      ta.addEventListener('input', () => { n.params[d.n] = ta.value; paramChanged(false); });
      ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
      w.appendChild(ta); paramsEl.append(lab, w); continue;
    }
    const row = el('div', 'prow'), lab = el('div', 'plabel', esc(d.l)), ctl = el('div', 'pctl');
    row.append(lab, ctl);
    if (d.t === 'float' || d.t === 'int') {
      const get = () => n.params[d.n], set = (v) => (n.params[d.n] = v);
      let sl = null;
      if (d.min != null) { sl = el('input'); sl.type = 'range'; sl.min = d.min; sl.max = d.max; sl.step = d.t === 'int' ? 1 : (d.max - d.min) / 500; sl.value = isExpr(get()) ? d.d : get(); }
      const f = numField(get, set, d, sl);
      ctl.appendChild(f);
      if (sl) { sl.addEventListener('input', () => { set(d.t === 'int' ? Math.round(+sl.value) : +(+sl.value).toFixed(4)); f._refresh(); paramChanged(false); }); sl.addEventListener('change', () => commit()); ctl.appendChild(sl); }
      scrubLabel(lab, get, set, d, () => { f._refresh(); if (sl) sl.value = get(); });
    } else if (d.t === 'vec3') {
      ctl.classList.add('vec'); lab.classList.add('static');
      for (let k = 0; k < 3; k++) { const f = numField(() => n.params[d.n][k], (v) => (n.params[d.n][k] = v), { t: 'float' }); f.title = 'XYZ'[k]; ctl.appendChild(f); }
    } else if (d.t === 'toggle') {
      lab.classList.add('static');
      const c = el('input'); c.type = 'checkbox'; c.checked = !!n.params[d.n];
      c.addEventListener('change', () => { n.params[d.n] = c.checked; paramChanged(true); }); ctl.appendChild(c);
    } else if (d.t === 'menu') {
      lab.classList.add('static');
      const s = el('select', 'txt'); d.options.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; s.appendChild(o); }); s.value = n.params[d.n];
      s.addEventListener('change', () => { n.params[d.n] = s.value; paramChanged(true); if (n.type === 'paint') renderParams(); }); ctl.appendChild(s);
    } else if (d.t === 'color') {
      lab.classList.add('static');
      const c = el('input'); c.type = 'color'; c.value = n.params[d.n];
      const tx = el('span', null, n.params[d.n]); tx.style.cssText = 'font:11px var(--mono);color:var(--fg3)';
      c.addEventListener('input', () => { n.params[d.n] = c.value; tx.textContent = c.value; paramChanged(false); }); ctl.append(c, tx);
    } else if (d.t === 'string') {
      lab.classList.add('static');
      const t = el('input', 'txt'); t.value = n.params[d.n]; t.spellcheck = false;
      t.addEventListener('input', () => { n.params[d.n] = t.value; paramChanged(false); });
      t.addEventListener('keydown', (e) => e.stopPropagation()); ctl.appendChild(t);
    }
    paramsEl.appendChild(row);
  }
  const er = el('div', 'perr'); er.id = 'perr'; er.style.display = 'none'; paramsEl.appendChild(er);
  if (n.type === 'delete') paramsEl.appendChild(el('div', 'pinfo', 'Expression is evaluated per primitive. Available: <code>@P</code> (centroid), <code>@N</code>, <code>@primnum</code>, <code>@numprim</code>, <code>@Time</code>. Example: <code>@P.y &lt; 0 || rand(@primnum) &gt; 0.8</code>'));
  if (n.type === 'fluidsurface') paramsEl.appendChild(el('div', 'pinfo', 'Builds one smooth, watertight mesh around a particle cloud (density splat → surface nets → Taubin smoothing). Wire a Water node in. <b>Particle Radius</b> ≈ 0.7× the water\'s separation; lower <b>Voxel Size</b> for detail, raise it for speed. Raise <b>Surface Threshold</b> to thin the surface, lower it to blob droplets together.'));
  if (n.type === 'whitewater') paramsEl.appendChild(el('div', 'pinfo', 'Spawns secondary particles from a Water sim wherever the water <b>traps air</b> (neighbours colliding at speed), forms <b>wave crests</b> (surface moving outward) and carries enough <b>energy</b>. Each one is then classified every frame by how much water surrounds it: <b>spray</b> flies ballistically, <b>foam</b> rides the surface and fades, <b>bubbles</b> are carried along and float up. Connect the Water node directly (it needs the particles\' velocities), not the Fluid Surface.'));
  const newInfo = {
    cloth: 'Position-based cloth. Pin points with an expression — <code>@P</code>, <code>@ptnum</code>, <code>@bbmin</code>/<code>@bbmax</code> (rest bounding box) are available, e.g. <code>@P.y > @bbmax.y - 0.01</code> pins the top edge. Pinned points follow the input every frame, so you can animate them with a Transform. Second input is a collider.',
    hair: 'Grows strands over the input surface and simulates them. Roots stay glued to the surface even when it animates. <b>Grow Only Where</b> takes an expression such as <code>@P.y > 0</code>. <b>Shape Stiffness</b> holds the groom; lower it for floppier hair. Turn <b>Simulate</b> off for a static groom.',
    voxelize: '<b>Solid</b> fills closed meshes, <b>Shell</b> voxelizes surfaces, <b>Heightfield</b> fills columns under a terrain down to the floor, <b>From points</b> works on particles (try it on a Water sim). Only exposed faces are built, so big volumes stay light. Output points to instance your own blocks with Copy to Points.',
    fracture: 'Splits closed geometry into Voronoi pieces with capped interiors (non-convex shapes and holes are handled). Pieces get a <code>piece</code> id that Rigid Debris uses. <b>Cluster Toward Impact</b> concentrates small pieces near the impact point.',
    debris: 'Simulates each fractured piece as a rigid body: explosion impulse, spin, gravity, tumbling ground contact with friction, and approximate piece-to-piece collisions. <b>Shockwave</b> activation releases pieces as an expanding sphere reaches them.',
  };
  if (newInfo[n.type]) paramsEl.appendChild(el('div', 'pinfo', newInfo[n.type]));
  if (n.type === 'material') paramsEl.appendChild(el('div', 'pinfo', 'Assigns a viewport material to every polygon of the input. Materials survive merges, so one network can mix water, glass and metal.'));
  const simInfo = { fire: 'Buoyant flame particles that cool through a blackbody colour ramp, swirl in curl-noise turbulence, then turn into smoke. Feed it any surface as fuel (logs, a torch head, text…).', water: 'Position-based fluid solver: particles push apart to keep a constant density, so water sloshes, splashes and settles to a level surface. <b>Fill Volume</b> fills a closed mesh (or its bounding box) on frame 1 — try a Box for a dam break.', sand: 'Granular solver: grains collide with each other and stick by static/kinetic friction, so they pile up with a slope. Raise <b>Friction</b> for steeper piles, lower it for flowing sand.' };
  if (simInfo[n.type]) paramsEl.appendChild(el('div', 'pinfo', simInfo[n.type] + ' Second input is an optional <b>collider</b> — any polygon geometry. Simulates from frame 1; press <kbd>Space</kbd> to play. Larger sims cook slower than real-time on the first pass; scrubbing back is instant.'));
  if (n.type === 'particles') paramsEl.appendChild(el('div', 'pinfo', 'Simulates frame by frame from frame 1 — press <kbd>Space</kbd> to play. Particles are born on the input\'s surface (or its points) and carry <code>@N</code> = velocity direction, <code>@pscale</code> and <code>@Cd</code>, so you can feed them into Copy to Points. Numeric fields can be animated with <code>$F</code>/<code>$T</code>.'));
  if (n.type === 'copytopoints') paramsEl.appendChild(el('div', 'pinfo', 'Left input: geometry to copy. Right input: target points (e.g. from Scatter). Uses the points\' <code>@N</code>, <code>@pscale</code> and <code>@Cd</code>.'));
  updateParamError();
}
function updateParamError() {
  const er = $('#perr'); if (!er) return;
  const m = S.selected && cookState.errors.get(S.selected);
  er.style.display = m ? 'block' : 'none'; er.textContent = m ? '⚠ ' + m : '';
}

// ---------- spreadsheet ----------
let sheetVisible = false;
$$('[data-ptab]').forEach((t) => t.addEventListener('click', () => {
  $$('[data-ptab]').forEach((x) => x.classList.toggle('on', x === t));
  sheetVisible = t.dataset.ptab === 'sheet';
  paramsEl.style.display = sheetVisible ? 'none' : ''; $('#sheet').style.display = sheetVisible ? 'block' : 'none';
  if (sheetVisible) renderSheet();
}));
function renderSheet() {
  const id = S.selected || S.display, n = S.nodes[id];
  const g = !n ? null : S.selected && S.selected !== S.display ? lastSel : lastSel || currentGeo;
  if (n && !g) { requestCook(); }
  const sh = $('#sheet');
  if (!g) { sh.innerHTML = `<div class="pempty">${n ? 'Cooking…' : 'No node selected.'}</div>`; return; }
  const max = 1500, f3 = (v) => v.map((x) => x.toFixed(3)).join('</td><td>');
  let h = `<div class="sheetinfo">${esc(n.name)} · ${g.P.length} points · ${g.prims.length} prims · ${g.lines.length} lines${g.P.length > max ? ` · showing first ${max}` : ''}</div><table><tr><th>#</th><th>P[x]</th><th>P[y]</th><th>P[z]</th>`;
  if (g.N) h += '<th>N[x]</th><th>N[y]</th><th>N[z]</th>';
  if (g.Cd) h += '<th>Cd</th>';
  if (g.pscale) h += '<th>pscale</th>';
  if (g.mask) h += '<th>mask</th>';
  const extra = Object.keys(g.attrs || {}).filter((k) => !k.startsWith('__'));
  for (const k of extra) h += `<th>${esc(k)}</th>`;
  h += '</tr>';
  for (let i = 0; i < Math.min(max, g.P.length); i++) {
    h += `<tr><td class="i">${i}</td><td>${f3(g.P[i])}</td>`;
    if (g.N) h += `<td>${f3(g.N[i])}</td>`;
    if (g.Cd) { const c = g.Cd[i]; h += `<td><span class="sw" style="background:rgb(${c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255)).join(',')})"></span>${c.map((x) => x.toFixed(2)).join(' ')}</td>`; }
    if (g.pscale) h += `<td>${(+g.pscale[i]).toFixed(3)}</td>`;
    if (g.mask) h += `<td>${(+g.mask[i]).toFixed(3)}</td>`;
    for (const k of extra) h += `<td>${(+g.attrs[k][i]).toFixed(3)}</td>`;
    h += '</tr>';
  }
  sh.innerHTML = h + '</table>';
}

// ============================================================
// Timeline
// ============================================================
const frameSlider = $('#frameSlider'), frameNum = $('#frameNum');
function setFrame(f) {
  ctx.fps = fps; applyCamAt(Math.max(1, Math.min(endFrame, Math.round(f)))); ctx.frame = Math.max(1, Math.min(endFrame, Math.round(f))); ctx.time = (ctx.frame - 1) / fps;
  frameSlider.value = ctx.frame; frameNum.value = ctx.frame; requestCook();
}
frameSlider.addEventListener('input', () => setFrame(+frameSlider.value));
frameNum.addEventListener('change', () => setFrame(+frameNum.value || 1));
$('#endNum').addEventListener('change', (e) => { endFrame = Math.max(2, +e.target.value || 240); frameSlider.max = endFrame; setFrame(ctx.frame); drawBakeStrip(); drawCamStrip(); });
$('#fpsNum').addEventListener('change', (e) => { fps = Math.max(1, +e.target.value || 24); setFrame(ctx.frame); });
[frameNum, $('#endNum'), $('#fpsNum')].forEach((i) => i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { i.dispatchEvent(new Event('change')); i.blur(); } }));
let playT = 0;
function togglePlay() { playing = !playing; $('#playBtn').textContent = playing ? '❚❚' : '▶'; if (playing) { playT = performance.now(); requestAnimationFrame(tick); } }
function tick(t) {
  if (!playing) return;
  if (t - playT >= 1000 / fps && (!cookInFlight || bakedGeo(ctx.frame + 1))) { playT = t; setFrame(ctx.frame >= endFrame ? 1 : ctx.frame + 1); }
  requestAnimationFrame(tick);
}
$('#playBtn').addEventListener('click', togglePlay);
$('#startBtn').addEventListener('click', () => setFrame(1));

// ============================================================
// Toolbar, menus, modal
// ============================================================
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1600); }
$$('[data-menu]').forEach((b) => b.addEventListener('click', () => { const d = $('#' + b.dataset.menu), o = d.classList.contains('open'); $$('.dropdown').forEach((x) => x.classList.remove('open')); if (!o) d.classList.add('open'); }));
$$('#shadeSeg button').forEach((b) => b.addEventListener('click', () => { $$('#shadeSeg button').forEach((x) => x.classList.toggle('on', x === b)); disp.shade = b.dataset.shade; rebuildDisplay(); }));
$('#tPoints').addEventListener('click', (e) => { disp.points = !disp.points; e.target.classList.toggle('on', disp.points); rebuildDisplay(); });
$('#tNormals').addEventListener('click', (e) => { disp.normals = !disp.normals; e.target.classList.toggle('on', disp.normals); rebuildDisplay(); });
$('#tGrid').addEventListener('click', (e) => { grid.visible = !grid.visible; e.target.classList.toggle('on', grid.visible); });
$('#frameBtn').addEventListener('click', frameGeo);
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);
$('#homeBtn').addEventListener('click', homeNet);
$('#layoutBtn').addEventListener('click', tidyLayout);
$('#addBtn').addEventListener('click', (e) => { const r = e.target.getBoundingClientRect(); openTabMenu(r.left - 260, r.top, { auto: true }); });

function modal(title, bodyHTML, buttons) {
  $('.mbox').classList.remove('wide');
  $('#mTitle').textContent = title; $('#mBody').innerHTML = bodyHTML;
  const f = $('#mFoot'); f.innerHTML = '';
  buttons.forEach(([label, fn, pri]) => { const b = el('button', 'btn' + (pri ? ' pri' : ''), label); b.addEventListener('click', () => { if (fn() !== false) closeModal(); }); f.appendChild(b); });
  $('#modal').classList.add('open');
}
function closeModal() { $('#modal').classList.remove('open'); }
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });
$('#modal').addEventListener('keydown', (e) => e.stopPropagation());
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copied to clipboard'); } catch (e) { const ta = $('#mBody textarea'); if (ta) { ta.select(); } toast('Select the text and copy it manually'); } return false; }

$('#fileMenu').addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
  $$('.dropdown').forEach((d) => d.classList.remove('open'));
  if (a === 'new') { S = { nodes: {}, display: null, selected: null, nextId: 1, look: { ...DEFAULT_LOOK } }; engine.clear(); clearBake(); applyLook(); syncToggles(); renderNet(); renderParams(); commit(); requestCook(); }
  if (a === 'save') {
    const s = JSON.stringify({ proteus: 1, nodes: S.nodes, display: S.display, nextId: S.nextId, look: S.look }, null, 1);
    if (downloadsNS) saveFile(`${sceneName()}.proteus.json`, s);
    else modal('Save scene', `<p style="margin:0 0 8px;color:var(--fg2)">Copy this JSON and keep it somewhere safe. Paste it into <b>File → Open scene</b> to restore.</p><textarea readonly>${esc(s)}</textarea>`, [['Close', () => {}], ['Copy', () => copyText(s), true]]);
  }
  if (a === 'load') {
    const openText = (txt) => {
      try { const o = JSON.parse(txt); if (!o.nodes) throw 0; for (const n of Object.values(o.nodes)) if (!NODE_TYPES[n.type]) throw 0; S = { nodes: o.nodes, display: o.display, selected: null, nextId: o.nextId || 999, look: { ...DEFAULT_LOOK, ...(o.look || {}) } }; engine.clear(); clearBake(); applyLook(); syncToggles(); renderNet(); renderParams(); homeNet(); commit(); requestCook(); setTimeout(frameGeo, 50); return true; }
      catch (err) { toast('That doesn\'t look like a Proteus scene'); return false; }
    };
    modal('Open scene', `<p style="margin:0 0 8px;color:var(--fg2)">Choose a <code>.proteus.json</code> file, or paste a scene's JSON below.</p><input type="file" id="loadFile" accept=".json,application/json" style="margin-bottom:10px;color:var(--fg2)"><textarea id="loadTa" placeholder='{"proteus":1, ...}'></textarea>`, [['Cancel', () => {}], ['Open', () => openText($('#loadTa').value), true]]);
    $('#loadFile').addEventListener('change', async (ev) => { const f = ev.target.files[0]; if (f && openText(await f.text())) closeModal(); });
  }
  if (a === 'obj' && downloadsNS) { const g = currentGeo || new Geo(); const data = new TextEncoder().encode(toOBJ(g)); saveFile(`${sceneName()}_obj.zip`, makeZip([{ name: `${sceneName()}.obj`, data }])); return; }
  if (a === 'obj') { const g = currentGeo || new Geo(); const s = toOBJ(g); modal('Export OBJ', `<p style="margin:0 0 8px;color:var(--fg2)">${g.P.length.toLocaleString()} points · ${g.prims.length.toLocaleString()} polygons. Copy and save as a <code>.obj</code> file.</p><textarea readonly>${esc(s.length > 3e6 ? s.slice(0, 3e6) + '\n# …truncated' : s)}</textarea>`, [['Close', () => {}], ['Copy', () => copyText(s), true]]); }
});
$('#helpBtn').addEventListener('click', showHelp);
function showHelp() {
  modal('Shortcuts & tips', `<div class="help">
  <div><h4>Network</h4><kbd>Tab</kbd> add node (wires to the selected one)<br><kbd>Double-click</kbd> node → display it<br><kbd>R</kbd> display flag · <kbd>B</kbd> bypass<br><kbd>Del</kbd> delete node / selected wire<br><kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate node<br><kbd>H</kbd> fit network · <kbd>L</kbd> tidy layout<br>Drag from an output into empty space to add &amp; wire a new node<br>Drag a connected input away to unplug it</div>
  <div><h4>Viewport</h4>Left-drag orbit · right-drag zoom · middle-drag pan<br><kbd>F</kbd> frame geometry<br><kbd>W</kbd> cycle shading</div>
  <div><h4>Timeline</h4><kbd>Space</kbd> play / pause<br><kbd>←</kbd> <kbd>→</kbd> step a frame<br><kbd>K</kbd> key the camera at this frame<br>⚡ Bake caches every frame for real-time playback</div>
  <div><h4>General</h4><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo</div>
  <div><h4>Expressions</h4>Any number field takes an expression: <code>$F</code> frame, <code>$T</code> seconds, plus <code>sin cos abs noise(x,y,z) rand(n) fit()</code>…</div>
  <div><h4>Point Wrangle</h4>JavaScript run per point with <code>@attribute</code> access: <code>@P @N @Cd @pscale @ptnum @numpt @Time @Frame</code>. Use <code>vec(x,y,z)</code> to build vectors.</div>
  </div>`, [['Got it', () => {}, true]]);
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ($('#modal').classList.contains('open')) { if (e.key === 'Escape') closeModal(); return; }
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (paint) {
    if (e.key === 'Escape') { endPaint(); return; }
    if (e.key === '[' || e.key === ']') { brush.radius = Math.max(0.005, +(brush.radius * (e.key === ']' ? 1.15 : 1 / 1.15)).toFixed(4)); if (ring.visible) ring.scale.setScalar(brush.radius); renderParams(); return; }
  }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); const n = S.nodes[S.selected]; if (n) { const id = addNode(n.type, n.x + 30, n.y + 50, { params: JSON.parse(JSON.stringify(n.params)) }); S.nodes[id].inputs = n.inputs.slice(); S.selected = id; renderNet(); renderParams(); commit(); } return; }
  if (mod) return;
  if (e.key === 'Tab') { e.preventDefault(); const r = net.getBoundingClientRect(); const mx = lastMouse.x, my = lastMouse.y; const inside = netHover; const p = toNet(inside ? mx : r.left + r.width / 2, inside ? my : r.top + r.height / 2); openTabMenu(inside ? mx : r.left + 40, inside ? my : r.top + 40, { x: p.x - NW / 2, y: p.y - NH / 2, auto: true }); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selWire) { disconnect(selWire.to, selWire.idx); selWire = null; renderNet(); commit(); requestCook(); renderParams(); }
    else if (S.selected) { deleteNode(S.selected); renderNet(); renderParams(); commit(); requestCook(); }
    e.preventDefault(); return;
  }
  if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
  if (e.key === 'ArrowRight') return setFrame(ctx.frame + 1);
  if (e.key === 'ArrowLeft') return setFrame(ctx.frame - 1);
  if (k === 'k') return keyCamera();
  if (k === 'f') return frameGeo();
  if (k === 'h') return homeNet();
  if (k === 'l') return tidyLayout();
  if (k === 'r' && S.selected) return setDisplay(S.selected);
  if (k === 'b' && S.selected) return toggleBypass(S.selected);
  if (k === 'w') { const order = ['shaded', 'wireshaded', 'wire']; const nx = order[(order.indexOf(disp.shade) + 1) % 3]; $(`[data-shade="${nx}"]`).click(); return; }
  if (e.key === '?') return showHelp();
  if (e.key === 'Escape') { closeTabMenu(); }
});
const lastMouse = { x: 0, y: 0 };
document.addEventListener('pointermove', (e) => { lastMouse.x = e.clientX; lastMouse.y = e.clientY; });

// ---------- splitters ----------
function splitter(elm, onMove) {
  elm.addEventListener('pointerdown', (e) => { elm.setPointerCapture(e.pointerId); const mv = (ev) => onMove(ev); const up = () => { elm.removeEventListener('pointermove', mv); elm.removeEventListener('pointerup', up); }; elm.addEventListener('pointermove', mv); elm.addEventListener('pointerup', up); });
}
splitter($('#splitV'), (e) => { const w = Math.min(innerWidth - 300, Math.max(300, innerWidth - e.clientX)); document.documentElement.style.setProperty('--rightW', w + 'px'); });
splitter($('#splitH'), (e) => { const r = $('#right').getBoundingClientRect(); const h = Math.min(r.height - 120, Math.max(100, e.clientY - r.top)); document.documentElement.style.setProperty('--paramH', h + 'px'); });

// ============================================================
// Examples
// ============================================================
const EXAMPLES = {
  terrain: {
    label: 'Terrain with scattered rocks', hint: 'grid → mountain → color, scatter + copy to points',
    build() {
      const g = addNode('grid', 0, 0, { params: { sizex: 14, sizez: 14, rows: 90, cols: 90 } });
      const m = addNode('mountain', 0, 80, { params: { height: 1.6, freq: 3, octaves: 6 } }); connect(g, m, 0);
      const c = addNode('color', 0, 160, { params: { mode: 'ramp', c1: '#2f4f3a', c2: '#e8dcc2' } }); connect(m, c, 0);
      const sc = addNode('scatter', 220, 160, { params: { count: 140, seed: 4 } }); connect(m, sc, 0);
      const rock = addNode('sphere', 420, 80, { name: 'rock', params: { radius: 0.18, rows: 6, cols: 8 } });
      const rm = addNode('mountain', 420, 160, { name: 'rock_noise', params: { height: 0.06, freq: 0.15, octaves: 2 } }); connect(rock, rm, 0);
      const rc = addNode('color', 420, 240, { name: 'rock_color', params: { mode: 'constant', c1: '#8a7f74' } }); connect(rm, rc, 0);
      const cp = addNode('copytopoints', 300, 320, { params: { randScale: 0.7, randRot: 1, align: true } }); connect(rc, cp, 0); connect(sc, cp, 1);
      const mg = addNode('merge', 100, 400); connect(c, mg, 0); connect(cp, mg, 1);
      const out = addNode('null', 100, 480, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
  tower: {
    label: 'Twisted tower', hint: 'box → twist → subdivide → color',
    build() {
      const b = addNode('box', 0, 0, { params: { size: [1.6, 6, 1.6], center: [0, 3, 0], divs: 10 } });
      const t = addNode('twist', 0, 80, { params: { strength: 30, taper: -0.08 } }); connect(b, t, 0);
      const ex = addNode('polyextrude', 0, 160, { params: { dist: 0.06, inset: 0.18 } }); connect(t, ex, 0);
      const c = addNode('color', 0, 240, { params: { mode: 'ramp', c1: '#1f3a5f', c2: '#f0b35a' } }); connect(ex, c, 0);
      const out = addNode('null', 0, 320, { name: 'OUT' }); connect(c, out, 0);
      return out;
    },
  },
  wave: {
    label: 'Animated wrangle wave', hint: 'grid → point wrangle using @Time — press Play',
    build() {
      const g = addNode('grid', 0, 0, { params: { sizex: 12, sizez: 12, rows: 70, cols: 70 } });
      const w = addNode('wrangle', 0, 80, { params: { code: '// ripples radiating from the origin\nlet d = Math.hypot(@P.x, @P.z);\n@P.y = sin(d * 2.2 - @Time * 4) * 0.5 * exp(-d * 0.15);\n@Cd = vec(fit(@P.y, -0.5, 0.5, 0.05, 0.95), 0.35 + 0.3 * fit(@P.y, -0.5, 0.5, 0, 1), 0.85);' } }); connect(g, w, 0);
      const out = addNode('null', 0, 160, { name: 'OUT' }); connect(w, out, 0);
      return out;
    },
  },
  blob: {
    label: 'Spiky blob', hint: 'sphere → subdivide → polyextrude → random colors',
    build() {
      const s = addNode('sphere', 0, 0, { params: { radius: 1.5, rows: 10, cols: 14 } });
      const m = addNode('mountain', 0, 80, { params: { height: 0.5, freq: 1.2, offset: [0, '$T*0.4', 0] } }); connect(s, m, 0);
      const sd = addNode('subdivide', 0, 160, { params: { depth: 1 } }); connect(m, sd, 0);
      const ex = addNode('polyextrude', 0, 240, { params: { dist: 0.12, inset: 0.3 } }); connect(sd, ex, 0);
      const c = addNode('color', 0, 320, { params: { mode: 'randprim', c1: '#c94f7c', c2: '#ffd27a', seed: 3 } }); connect(ex, c, 0);
      const out = addNode('null', 0, 400, { name: 'OUT' }); connect(c, out, 0);
      return out;
    },
  },
  donuts: {
    label: 'Donuts on a torus', hint: 'torus → scatter → copy small tori, color from noise',
    build() {
      const t = addNode('torus', 0, 0, { params: { R: 2, r: 0.8, cols: 48, rows: 24 } });
      const c = addNode('color', 0, 80, { params: { mode: 'noise', c1: '#203a6b', c2: '#7fd1c7', freq: 0.8 } }); connect(t, c, 0);
      const sc = addNode('scatter', 220, 80, { params: { count: 260, seed: 2 } }); connect(c, sc, 0);
      const small = addNode('torus', 440, 0, { name: 'small_torus', params: { R: 0.12, r: 0.04, cols: 16, rows: 8 } });
      const cp = addNode('copytopoints', 330, 160, { params: { randScale: 0.5, useColor: true } }); connect(small, cp, 0); connect(sc, cp, 1);
      const mg = addNode('merge', 100, 240); connect(c, mg, 0); connect(cp, mg, 1);
      const out = addNode('null', 100, 320, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
};
Object.assign(EXAMPLES, {
  fountain: {
    label: 'Particle fountain', hint: 'circle emitter → particles with gravity + bounce — press Play',
    build() {
      const c = addNode('circle', 0, 0, { params: { radius: 0.25, divs: 16, center: [0, 0.4, 0] } });
      const pt = addNode('particles', 0, 80, { params: { rate: 900, speed: 7, spread: 1.2, life: 3, gravity: [0, -9.8, 0], bounce: 0.45, friction: 0.15, look: 'streaks', streak: 0.05, c1: '#bfe6ff', c2: '#2f6fd6' } }); connect(c, pt, 0);
      const bowl = addNode('tube', 220, 0, { name: 'basin', params: { r1: 1.6, r2: 1.9, h: 0.4, rows: 2, cols: 48, caps: false, center: [0, 0.2, 0] } });
      const bc = addNode('color', 220, 80, { name: 'basin_color', params: { mode: 'constant', c1: '#6d6a66' } }); connect(bowl, bc, 0);
      const mg = addNode('merge', 100, 160); connect(pt, mg, 0); connect(bc, mg, 1);
      const out = addNode('null', 100, 240, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
  swirl: {
    label: 'Turbulent swirl', hint: 'torus emitter → rising particles + turbulence — press Play',
    build() {
      const t = addNode('torus', 0, 0, { params: { R: 1.2, r: 0.15, cols: 40, rows: 8, center: [0, 0.3, 0] } });
      const tx = addNode('transform', 0, 80, { name: 'spin', params: { r: [0, '$F*2', 0] } }); connect(t, tx, 0);
      const pt = addNode('particles', 0, 160, { params: { rate: 1500, speed: 0.6, spread: 0.3, life: 4, lifeVar: 0.4, gravity: [0, 1.4, 0], wind: [0.6, 0, 0], drag: 0.6, turb: 9, turbSize: 1.4, ground: false, c1: '#ffe9a8', c2: '#7a2fd6' } }); connect(tx, pt, 0);
      const sp = addNode('sphere', 220, 80, { name: 'droplet', params: { radius: 0.035, rows: 4, cols: 6 } });
      const cp = addNode('copytopoints', 120, 240, { params: { useColor: true } }); connect(sp, cp, 0); connect(pt, cp, 1);
      const out = addNode('null', 120, 320, { name: 'OUT' }); connect(cp, out, 0);
      return out;
    },
  },
});
Object.assign(EXAMPLES, {
  campfire: {
    label: '🔥 Campfire', hint: 'Fire node on a fuel bed, crossed logs and a stone ring', frame: 60, cam: [[3.2, 2.4, 4.2], [0, 1.1, 0]],
    build() {
      const bed = addNode('circle', 0, 0, { name: 'fuel_bed', params: { radius: 0.45, divs: 24, center: [0, 0.22, 0] } });
      const fire = addNode('fire', 0, 80, { params: { rate: 1600 } }); connect(bed, fire, 0);
      const log = addNode('tube', 220, 0, { name: 'log', params: { r1: 0.11, r2: 0.09, h: 1.5, rows: 3, cols: 10 } });
      const lm = addNode('mountain', 220, 70, { name: 'bark', params: { height: 0.02, freq: 0.1, octaves: 2 } }); connect(log, lm, 0);
      const lc = addNode('color', 220, 140, { name: 'log_color', params: { mode: 'noise', c1: '#2a1a10', c2: '#5a3a22', freq: 0.2 } }); connect(lm, lc, 0);
      const lines = addNode('line', 430, 70, { name: 'log_dirs', params: { origin: [0, 0.16, 0], dir: [1, 0, 0], length: 0.001, points: 3 } });
      const wr = addNode('wrangle', 430, 140, { name: 'aim_logs', params: { code: '// point each log in a different direction, crossing at the centre\nlet a = @ptnum * 2.094 + 0.4;\n@N = vec(cos(a), 0.32, sin(a));' } }); connect(lines, wr, 0);
      const logs = addNode('copytopoints', 300, 220, { name: 'logs', params: { align: true } }); connect(lc, logs, 0); connect(wr, logs, 1);
      const rot = addNode('transform', 300, 290, { name: 'lay_logs', params: { r: [0, 0, 0] } }); connect(logs, rot, 0);
      const stones0 = addNode('circle', 560, 0, { name: 'stone_ring', params: { radius: 1.05, divs: 14, filled: false } });
      const st = addNode('sphere', 680, 70, { name: 'stone', params: { radius: 0.17, rows: 6, cols: 8 } });
      const sm = addNode('mountain', 680, 140, { name: 'stone_shape', params: { height: 0.07, freq: 0.12, octaves: 2 } }); connect(st, sm, 0);
      const sc = addNode('color', 680, 210, { name: 'stone_color', params: { mode: 'noise', c1: '#4b4744', c2: '#8d8780', freq: 0.15 } }); connect(sm, sc, 0);
      const stones = addNode('copytopoints', 560, 290, { name: 'stones', params: { align: false, randScale: 0.35, randRot: 1, seed: 3 } }); connect(sc, stones, 0); connect(stones0, stones, 1);
      const mg = addNode('merge', 200, 380); connect(fire, mg, 0); connect(rot, mg, 1); connect(stones, mg, 2);
      const out = addNode('null', 200, 460, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
  dambreak: {
    label: '🌊 Dam break', hint: 'Water + Fluid Surface + Whitewater: a column of water collapses around an obstacle', frame: 30, cam: [[2.6, 3.4, 5.2], [0, 0.5, 0]],
    build() {
      const col = addNode('box', 0, 0, { name: 'water_column', params: { size: [1.1, 1.8, 1.8], center: [-1.4, 0.95, 0] } });
      const obs = addNode('box', 220, 0, { name: 'obstacle', params: { size: [0.5, 0.7, 0.6], center: [0.6, 0.35, 0] } });
      const water = addNode('water', 0, 100, { params: { mode: 'fill', sep: 0.1, bounds: true, bsize: [4, 4, 2], bcenter: [0, 2, 0] } }); connect(col, water, 0); connect(obs, water, 1);
      const oc = addNode('color', 220, 100, { name: 'obstacle_color', params: { mode: 'constant', c1: '#b8743a' } }); connect(obs, oc, 0);
      const tank = addNode('box', 440, 0, { name: 'tank', params: { size: [4.04, 1.2, 2.04], center: [0, 0.6, 0] } });
      const open = addNode('delete', 440, 80, { name: 'open_front', params: { expr: '@N.y > 0.5 || @N.z > 0.5' } }); connect(tank, open, 0);
      const tc = addNode('color', 440, 160, { name: 'tank_color', params: { mode: 'constant', c1: '#5d6670' } }); connect(open, tc, 0);
      const surf = addNode('fluidsurface', 0, 180, { name: 'water_surface', params: { radius: 0.07, voxel: 0.05 } }); connect(water, surf, 0);
      const ww = addNode('whitewater', -220, 180, { params: { bounds: true, bsize: [4, 6, 2], bcenter: [0, 3, 0] } }); connect(water, ww, 0); connect(obs, ww, 1);
      const mg = addNode('merge', 200, 260); connect(surf, mg, 0); connect(oc, mg, 1); connect(tc, mg, 2); connect(ww, mg, 3);
      const out = addNode('null', 200, 340, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
  glasspour: {
    label: '🥛 Pouring a glass of water', hint: 'Water poured into a glass collider, meshed with Fluid Surface', frame: 84, cam: [[2.2, 2.3, 3.4], [0, 0.85, 0]],
    build() {
      const tube = addNode('tube', 220, 0, { name: 'glass_shape', params: { r1: 0.5, r2: 0.58, h: 1.4, rows: 2, cols: 48, caps: true, center: [0, 0.7, 0] } });
      const open = addNode('delete', 220, 80, { name: 'open_top', params: { expr: '@N.y > 0.9 && @P.y > 1.3' } }); connect(tube, open, 0);
      const glass = addNode('material', 220, 160, { name: 'glass', params: { type: 'glass' } }); connect(open, glass, 0);
      const spout = addNode('circle', 0, 0, { name: 'spout', params: { radius: 0.15, divs: 16, center: [0.08, 2.3, 0] } });
      const water = addNode('water', 0, 160, { params: { mode: 'emit', rate: 480, speed: 0, vel: [0, -3, 0], spread: 0.05, sep: 0.075, viscosity: 0.08, maxCount: 4000 } }); connect(spout, water, 0); connect(open, water, 1);
      const surf = addNode('fluidsurface', 0, 240, { name: 'water_surface', params: { radius: 0.052, voxel: 0.035, iso: 0.5 } }); connect(water, surf, 0);
      const ww = addNode('whitewater', -220, 240, { params: { rate: 14, size: 0.035, bubbleN: 16 } }); connect(water, ww, 0); connect(open, ww, 1);
      const mg = addNode('merge', 100, 320); connect(surf, mg, 0); connect(glass, mg, 1); connect(ww, mg, 2);
      const out = addNode('null', 100, 400, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
  sandpour: {
    label: '⏳ Sand pour', hint: 'Sand node: grains slide down a ramp collider and pile up', frame: 120, cam: [[2.4, 2.6, 4.6], [-0.3, 1.1, 0]],
    build() {
      const spout = addNode('circle', 0, 0, { name: 'spout', params: { radius: 0.18, divs: 16, center: [-1.2, 3, 0] } });
      const ramp0 = addNode('grid', 220, 0, { name: 'ramp', params: { sizex: 2.4, sizez: 1.2, rows: 4, cols: 6 } });
      const ramp = addNode('transform', 220, 80, { name: 'tilt_ramp', params: { r: [0, 0, -28], t: [-0.6, 1.4, 0] } }); connect(ramp0, ramp, 0);
      const sand = addNode('sand', 0, 160, { params: { rate: 700, grain: 0.035, vel: [0, -3, 0] } }); connect(spout, sand, 0); connect(ramp, sand, 1);
      const rc = addNode('color', 220, 160, { name: 'ramp_color', params: { mode: 'constant', c1: '#6f5a46' } }); connect(ramp, rc, 0);
      const mg = addNode('merge', 100, 240); connect(sand, mg, 0); connect(rc, mg, 1);
      const out = addNode('null', 100, 320, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
});
Object.assign(EXAMPLES, {
  flag: {
    label: '🏳 Flag in the wind', hint: 'Cloth: a striped flag pinned to a pole, gusting wind', frame: 72, cam: [[3.4, 3.2, 6.2], [0.2, 2.6, 0]], look: { shadows: true, sunAz: 60, sunEl: 40 },
    build() {
      const gr = addNode('grid', 0, 0, { name: 'flag_shape', params: { sizex: 3, sizez: 1.9, rows: 22, cols: 34 } });
      const up = addNode('transform', 0, 80, { name: 'stand_up', params: { r: [90, 0, 0], t: [0, 3.2, 0] } }); connect(gr, up, 0);
      const st = addNode('wrangle', 0, 160, { name: 'stripes', params: { code: '// horizontal stripes\nlet band = floor((@P.y - 2.25) * 5) % 3;\n@Cd = band == 0 ? vec(0.95, 0.55, 0.15) : band == 1 ? vec(0.96, 0.94, 0.9) : vec(0.1, 0.45, 0.55);' } }); connect(up, st, 0);
      const cl = addNode('cloth', 0, 240, { params: { wind: [7, 0, 1.5], gust: 6, gustSize: 1.2, bend: 0.08 } }); connect(st, cl, 0);
      const pole = addNode('tube', 240, 160, { name: 'pole', params: { r1: 0.05, r2: 0.04, h: 4.4, rows: 2, cols: 16, center: [-1.56, 2.2, 0] } });
      const pm = addNode('material', 240, 240, { name: 'metal_pole', params: { type: 'metal' } }); connect(pole, pm, 0);
      const mg = addNode('merge', 100, 320); connect(cl, mg, 0); connect(pm, mg, 1);
      const out = addNode('null', 100, 400, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
  furball: {
    label: '🧶 Bouncing furry ball', hint: 'Hair: strands grown on an animated sphere follow and swing', frame: 40, cam: [[3.6, 2.6, 4.4], [0, 1.4, 0]], look: { shadows: true },
    build() {
      const sp = addNode('sphere', 0, 0, { name: 'skin', params: { radius: 0.8, rows: 18, cols: 24 } });
      const mv = addNode('transform', 0, 80, { name: 'bounce', params: { t: [0, 'abs(sin($T*3.2))*1.1 + 0.85', 0], r: [0, '$F*4', 0] } }); connect(sp, mv, 0);
      const sc = addNode('color', 220, 80, { name: 'skin_color', params: { mode: 'constant', c1: '#3a2a4a' } }); connect(mv, sc, 0);
      const hr = addNode('hair', 0, 160, { params: { count: 2200, length: 0.42, curl: 0.5, curlFreq: 2.5, clump: 0.45, frizz: 0.3, look: 'ribbons', width: 0.016, rootColor: '#2b1d3d', tipColor: '#d38fe0', stiffness: 0.1 } }); connect(mv, hr, 0);
      const mg = addNode('merge', 100, 240); connect(hr, mg, 0); connect(sc, mg, 1);
      const out = addNode('null', 100, 320, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
  voxelworld: {
    label: '🧊 Voxel landscape', hint: 'Voxelize: a noise terrain turned into blocks, with a voxel lake', frame: 1, cam: [[9, 7.5, 10], [0, 0.5, 0]], look: { shadows: true, sunAz: 20, sunEl: 48 },
    build() {
      const g = addNode('grid', 0, 0, { params: { sizex: 14, sizez: 14, rows: 90, cols: 90 } });
      const m = addNode('mountain', 0, 80, { params: { height: 3.2, freq: 4.5, octaves: 4 } }); connect(g, m, 0);
      const c = addNode('color', 220, 80, { name: 'biomes', params: { mode: 'ramp', c1: '#4f7a3a', c2: '#e9e4d8' } }); connect(m, c, 0);
      const v = addNode('voxelize', 0, 160, { name: 'blocks', params: { size: 0.35, mode: 'heightfield', floor: -1.8, colorMode: 'source', jitter: 0.2 } }); connect(c, v, 0);
      const lake = addNode('box', 240, 160, { name: 'lake', params: { size: [14, 1.3, 14], center: [0, -0.75, 0] } });
      const lv = addNode('voxelize', 240, 240, { name: 'lake_blocks', params: { size: 0.35, mode: 'solid', colorMode: 'constant', c1: '#3f86c9', jitter: 0.05 } }); connect(lake, lv, 0);
      const lw = addNode('material', 240, 320, { name: 'water_mat', params: { type: 'water' } }); connect(lv, lw, 0);
      const mg = addNode('merge', 100, 400); connect(v, mg, 0); connect(lw, mg, 1);
      const out = addNode('null', 100, 480, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
  shatter: {
    label: '💥 Shattering wall', hint: 'Voronoi Fracture + Rigid Debris: a wall is blasted apart', frame: 36, cam: [[4.8, 3.2, 6.4], [0, 0.9, 0]], look: { shadows: true, sunAz: 50, sunEl: 45 },
    build() {
      const w = addNode('box', 0, 0, { name: 'wall', params: { size: [3, 2, 0.35], center: [0, 1, 0] } });
      const wc = addNode('color', 0, 80, { name: 'brick', params: { mode: 'noise', c1: '#9c5a44', c2: '#c98a6a', freq: 0.6 } }); connect(w, wc, 0);
      const fr = addNode('fracture', 0, 160, { params: { pieces: 60, bias: 0.55, impact: [0.2, 1.1, 0], innerColor: '#e8c9a8', seed: 4 } }); connect(wc, fr, 0);
      const rb = addNode('debris', 0, 240, { params: { start: 10, center: [0.2, 1.1, -0.7], strength: 7, falloff: 1.2, waveSpeed: 12, spin: 7 } }); connect(fr, rb, 0);
      const out = addNode('null', 0, 320, { name: 'OUT' }); connect(rb, out, 0);
      return out;
    },
  },
});
Object.assign(EXAMPLES, {
  mohawk: {
    label: '🖌 Painted mohawk', hint: 'Paint + Hair: a painted stripe controls where hair grows and how long', frame: 40, cam: [[3.2, 2.2, 3.6], [0, 1.3, 0]], look: { shadows: true, sunAz: 40, sunEl: 55 },
    build() {
      const R = 0.9, sp = addNode('sphere', 0, 0, { name: 'head', params: { radius: R, rows: 28, cols: 36 } });
      // pre-paint a stripe over the top (you can repaint it with the brush)
      const g = sphereGeo(R, 28, 36, [0, 0, 0]);
      const m = g.P.map((p) => { const across = Math.max(0, 1 - Math.abs(p[0]) / (R * 0.32)); const up = clamp((p[1] / R + 0.35) * 2.2, 0, 1); return clamp(across * 1.6, 0, 1) * up; });
      const pa = addNode('paint', 0, 80, { name: 'stripe', params: { data: encodeMask(m) } }); connect(sp, pa, 0);
      const mv = addNode('transform', 0, 160, { name: 'head_shake', params: { t: [0, 1.3, 0], r: ['sin($T*2.6)*10', 'sin($T*2.2)*38', 0] } }); connect(pa, mv, 0);
      const hr = addNode('hair', 0, 240, { params: { count: 2600, length: 0.8, lengthVar: 0.2, droop: 0, curl: 0, frizz: 0.15, clump: 0.55, stiffness: 0.32, tipLimp: 0.85, look: 'ribbons', width: 0.02, rootColor: '#1e3a8a', tipColor: '#ff5ca8' } }); connect(mv, hr, 0);
      const sk = addNode('color', 230, 240, { name: 'skin_tone', params: { mode: 'constant', c1: '#c99a7a' } }); connect(mv, sk, 0);
      const mg = addNode('merge', 100, 320); connect(hr, mg, 0); connect(sk, mg, 1);
      const out = addNode('null', 100, 400, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
  towel: {
    label: '🧺 Painted pins: hanging towel', hint: 'Paint + Cloth: two painted corners hold a towel in a breeze', frame: 60, cam: [[2.6, 2.4, 4.6], [0, 1.9, 0]], look: { shadows: true, sunAz: 70, sunEl: 40 },
    build() {
      const rows = 26, cols = 22, sx = 1.6, sz = 2.0;
      const gr = addNode('grid', 0, 0, { name: 'towel_shape', params: { sizex: sx, sizez: sz, rows, cols } });
      const up = addNode('transform', 0, 80, { name: 'hang', params: { r: [90, 0, 0], t: [0, 2.2, 0] } }); connect(gr, up, 0);
      const g = gridGeo(sx, sz, rows, cols, [0, 0, 0]);
      const m = g.P.map((p) => (p[2] < -sz / 2 + 0.05 && Math.abs(p[0]) > sx / 2 - 0.12 ? 1 : 0)); // two top corners
      const pa = addNode('paint', 0, 160, { name: 'pins', params: { data: encodeMask(m) } }); connect(up, pa, 0);
      const st = addNode('wrangle', 0, 240, { name: 'stripes', params: { code: '// woven stripes\nlet s = floor((@P.x + 2) * 6) % 2;\n@Cd = s ? vec(0.93, 0.92, 0.88) : vec(0.85, 0.32, 0.28);' } }); connect(pa, st, 0);
      const cl = addNode('cloth', 0, 320, { params: { pin: 'false', wind: [0.6, 0, -2.2], gust: 3, gustSize: 0.8, bend: 0.25, damping: 0.6 } }); connect(st, cl, 0);
      const line = addNode('tube', 240, 240, { name: 'washing_line', params: { r1: 0.012, r2: 0.012, h: 4, rows: 2, cols: 8, caps: false, center: [0, 0, 0] } });
      const ln = addNode('transform', 240, 320, { name: 'line_pose', params: { r: [0, 0, 90], t: [0, 3.21, 0] } }); connect(line, ln, 0);
      const mg = addNode('merge', 100, 400); connect(cl, mg, 0); connect(ln, mg, 1);
      const out = addNode('null', 100, 480, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
});
Object.assign(EXAMPLES, {
  paintedfur: {
    label: '🎨 Painted fur: colour + length', hint: 'Paint colour and hair length on a body; hair inherits both', frame: 30, cam: [[3.4, 2.3, 3.9], [0, 1.0, 0]], look: { shadows: true, sunAz: 30, sunEl: 50 },
    build() {
      const sp = addNode('sphere', 0, 0, { name: 'body', params: { radius: 1, rows: 30, cols: 40 } });
      const sh = addNode('transform', 0, 80, { name: 'shape', params: { s: [1.45, 0.82, 0.9], t: [0, 1.05, 0] } }); connect(sp, sh, 0);
      const P = sphereGeo(1, 30, 40, [0, 0, 0]).P.map((p) => [p[0] * 1.45, p[1] * 0.82 + 1.05, p[2] * 0.9]);
      // colour layer: warm coat, pale belly, dark stripes over the back
      const rgba = new Float32Array(P.length * 4);
      P.forEach((p, i) => {
        const belly = clamp((1.0 - p[1]) * 2.2, 0, 1), stripe = Math.sin(p[0] * 7.5 + Math.sin(p[2] * 3) * 0.8) > 0.55 && p[1] > 0.95 ? 1 : 0;
        let c = [0.86, 0.5, 0.2]; c = V.lerp(c, [0.96, 0.9, 0.8], belly); if (stripe) c = [0.12, 0.08, 0.07];
        rgba.set([...c, 1], i * 4);
      });
      const pc = addNode('paint', 0, 160, { name: 'coat_colour', params: { attr: 'Cd', data: encodeRGBA(rgba) } }); connect(sh, pc, 0);
      // length layer: long ridge along the back, short belly
      const len = P.map((p) => clamp(0.18 + (p[1] - 0.6) * 0.9, 0.12, 1) * (1 + 0.6 * Math.exp(-((p[2] / 0.25) ** 2)) * (p[1] > 1.4 ? 1 : 0)));
      const pl = addNode('paint', 0, 240, { name: 'fur_length', params: { attr: 'length', data: encodeMask(len.map((v) => clamp(v, 0, 1))) } }); connect(pc, pl, 0);
      const hr = addNode('hair', 0, 320, { params: { count: 4200, length: 0.5, lengthVar: 0.25, droop: 0.35, comb: [-0.6, 0, 0], curl: 0, frizz: 0.12, clump: 0.35, stiffness: 0.25, look: 'ribbons', width: 0.017, inheritColor: true, tipBlend: 0.15, tipColor: '#f6e7cf' } }); connect(pl, hr, 0);
      const mg = addNode('merge', 100, 400); connect(hr, mg, 0); connect(pl, mg, 1);
      const out = addNode('null', 100, 480, { name: 'OUT' }); connect(mg, out, 0);
      return out;
    },
  },
});
const exMenu = $('#exMenu');
for (const [k, ex] of Object.entries(EXAMPLES)) { const b = el('button', null, `${ex.label}<span class="hint">${ex.hint}</span>`); b.dataset.ex = k; exMenu.appendChild(b); }
exMenu.addEventListener('click', (e) => { const k = e.target.closest('[data-ex]')?.dataset.ex; if (!k) return; $$('.dropdown').forEach((d) => d.classList.remove('open')); loadExample(k); });
function loadExample(k) {
  S = { nodes: {}, display: null, selected: null, nextId: 1, look: { ...DEFAULT_LOOK, ...(EXAMPLES[k].look || {}) } }; engine.clear(); clearBake(); applyLook(); syncToggles();
  const out = EXAMPLES[k].build(); S.display = out; S.selected = out; shownSig = null;
  const sim = Object.values(S.nodes).some((n) => NODE_TYPES[n.type].timeDep);
  renderNet(); renderParams(); homeNet(); commit();
  setFrame(EXAMPLES[k].frame || (sim ? 48 : 1)); doCook();
  if (EXAMPLES[k].cam) { camera.position.set(...EXAMPLES[k].cam[0]); controls.target.set(...EXAMPLES[k].cam[1]); } else frameGeo();
}

// ============================================================
// File saving (downloads capability), zip writer
// ============================================================
let downloadsNS = null;
(async () => {
  for (let i = 0; i < 30 && !(window.claude && window.claude.use); i++) await new Promise((r) => setTimeout(r, 200));
  try { if (window.claude && window.claude.use) downloadsNS = await window.claude.use('downloads'); } catch (e) { downloadsNS = null; }
})();
async function saveFile(filename, data) {
  if (!downloadsNS) { toast('Saving files isn’t available in this view'); return false; }
  try { await downloadsNS.save({ filename, data }); toast('Saved ' + filename); return true; }
  catch (e) {
    const c = e && e.code;
    toast(c === 'declined' ? 'Save cancelled' : c === 'rate_limited' ? 'Another save is still open — try again in a moment' : 'Couldn’t save: ' + ((e && e.message) || c || e));
    return false;
  }
}
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function makeZip(files) { // files: [{name, data: Uint8Array}] — stored (no compression), fine for PNG/OBJ
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const csize = central.reduce((s, a) => s + a.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
const canvasPNG = (cv) => new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
const sceneName = () => (S.nodes[S.display]?.name || 'proteus').replace(/[^\w-]+/g, '_');

// ============================================================
// Bake / flipbook cache
// ============================================================
const bake = { key: null, frames: new Map(), bytes: 0, running: false, cancel: false };
const BAKE_BUDGET = 700 * 1024 * 1024;
const bakeKeyNow = () => JSON.stringify([S.nodes, S.display, fps]);
let unpackMemo = { frame: -1, g: null };
function bakedGeo(f) {
  if (bake.running || !bake.frames.size || !bake.frames.has(f)) return null;
  if (bake.key !== bakeKeyNow()) { clearBake(); return null; }
  if (unpackMemo.frame !== f || unpackMemo.key !== bake.key) unpackMemo = { frame: f, key: bake.key, g: unpackGeo(bake.frames.get(f)) };
  return unpackMemo.g;
}
function clearBake() { bake.frames.clear(); bake.bytes = 0; bake.key = null; unpackMemo = { frame: -1 }; drawBakeStrip(); }
function drawBakeStrip() {
  const cv = $('#bakeStrip'), g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  if (!bake.frames.size) return;
  g.fillStyle = bake.running ? '#e8a33d' : '#4fa3e8';
  for (const f of bake.frames.keys()) { const x0 = ((f - 1) / endFrame) * cv.width, x1 = (f / endFrame) * cv.width; g.fillRect(x0, 0, Math.max(1, x1 - x0 + 0.5), cv.height); }
}
async function runBake() {
  if (bake.running) { engine.cancelBake(); return; }
  if (!S.display) return toast('Nothing to bake — set a display node first');
  if (playing) togglePlay();
  clearBake();
  bake.key = bakeKeyNow(); bake.running = true; bake.cancel = false;
  const btn = $('#bakeBtn'); btn.classList.add('busy');
  const saveFrame = ctx.frame; let lastShow = 0, over = false;
  const res = await engine.bake(1, endFrame, (f, pk) => {
    if (over) return;
    bake.frames.set(f, pk); bake.bytes += pk.bytes;
    btn.textContent = `■ ${f}/${endFrame}`;
    if (bake.bytes > BAKE_BUDGET) { over = true; engine.cancelBake(); toast(`Stopped at frame ${f}: the bake reached its ${(BAKE_BUDGET / 1048576) | 0} MB memory budget`); }
    const now = performance.now();
    if (now - lastShow > 120) { lastShow = now; const g = unpackGeo(pk); currentGeo = g; shownSig = null; buildThree(g); ctx.frame = f; frameSlider.value = f; frameNum.value = f; updateHud(); drawBakeStrip(); }
  });
  bake.running = false; btn.classList.remove('busy'); btn.textContent = '⚡ Bake';
  if (bake.key !== bakeKeyNow()) clearBake();
  drawBakeStrip();
  toast(res.cancelled && !over ? `Bake stopped — ${bake.frames.size} frames cached` : `Baked ${bake.frames.size} frames (${(bake.bytes / 1048576).toFixed(0)} MB) — playback now reads the cache`);
  currentGeo = null; shownSig = null; setFrame(saveFrame);
}
$('#bakeBtn').addEventListener('click', runBake);

// ============================================================
// Lighting popover + viewport toggles
// ============================================================
function syncToggles() {
  if (typeof drawCamStrip === 'function') setTimeout(drawCamStrip, 0);
  $('#tShadows').classList.toggle('on', !!S.look.shadows);
  renderLightPop();
}
function lookSlider(label, k, min, max, step) {
  const row = el('div', 'prow'), lab = el('div', 'plabel static', label), ctl = el('div', 'pctl');
  const sl = el('input'); sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step; sl.value = S.look[k];
  const val = el('span', null, String(S.look[k])); val.style.cssText = 'font:11px var(--mono);color:var(--fg3);width:34px;text-align:right';
  sl.addEventListener('input', () => { S.look[k] = +sl.value; val.textContent = sl.value; applyLook(); });
  sl.addEventListener('change', () => commit());
  ctl.append(sl, val); row.append(lab, ctl); return row;
}
function renderLightPop() {
  const p = $('#lightPop'); p.innerHTML = '';
  p.append(lookSlider('Sun direction', 'sunAz', -180, 180, 1), lookSlider('Sun height', 'sunEl', 3, 89, 1), lookSlider('Sun strength', 'sunInt', 0, 5, 0.05), lookSlider('Ambient', 'ambient', 0, 3, 0.05), lookSlider('Shadow blur', 'softness', 0, 6, 0.1));
}
$('#tShadows').addEventListener('click', () => { S.look.shadows = !S.look.shadows; applyLook(); syncToggles(); commit(); });
$('#tLight').addEventListener('click', (e) => { e.target.classList.toggle('on'); $('#lightPop').classList.toggle('open'); renderLightPop(); });

// ============================================================
// Offline renderer
// ============================================================
const R = { w: 1920, h: 1080, quality: 2, bg: 'studio', bgColor: '#202327', grid: false, shadows: true, start: 1, end: 120, busy: false, cancel: false, last: null };
function renderFrame(w, h, ss, opts) {
  const prev = { pr: renderer.getPixelRatio(), size: renderer.getSize(new THREE.Vector2()), aspect: camera.aspect, grid: grid.visible, sky: skyMesh.visible, cast: key.castShadow, cat: catcher.visible, clear: renderer.getClearAlpha() };
  offline = true;
  try {
    grid.visible = opts.grid;
    skyMesh.visible = opts.bg === 'studio';
    scene.background = opts.bg === 'color' ? new THREE.Color(opts.bgColor) : null;
    renderer.setClearColor(0x000000, 0);
    key.castShadow = opts.shadows; catcher.visible = opts.shadows;
    renderer.setPixelRatio(1); renderer.setSize(w * ss, h * ss, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    spriteUniforms.uScale.value = (h * ss) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    renderer.render(scene, camera);
    // high-quality downsample in halving steps
    let src = renderer.domElement, sw = w * ss, sh = h * ss;
    while (sw / 2 >= w * 1.0001 || sh / 2 >= h * 1.0001) {
      const t = document.createElement('canvas'); t.width = Math.ceil(sw / 2); t.height = Math.ceil(sh / 2);
      const g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, sw, sh, 0, 0, t.width, t.height);
      src = t; sw = t.width; sh = t.height;
    }
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const g = out.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
    return out;
  } finally {
    grid.visible = prev.grid; skyMesh.visible = prev.sky; scene.background = null; key.castShadow = prev.cast; catcher.visible = prev.cat;
    renderer.setPixelRatio(prev.pr); renderer.setSize(prev.size.x, prev.size.y, false);
    camera.aspect = prev.aspect; camera.updateProjectionMatrix();
    offline = false;
  }
}
async function geoAtFrame(f) {
  if (bake.key === bakeKeyNow() && bake.frames.has(f)) return unpackGeo(bake.frames.get(f));
  return S.display ? engine.frameGeo(f) : new Geo();
}
function showFrameGeo(g) { currentGeo = g; buildThree(g); fitLight(g); }
const evenDims = () => ({ w: Math.max(16, Math.round(R.w / 2) * 2), h: Math.max(16, Math.round(R.h / 2) * 2) });

function openRender() {
  if (playing) togglePlay();
  R.end = Math.max(R.start, Math.min(R.end, endFrame));
  const body = `<div class="rgrid"><div>
    <div class="prow"><div class="plabel static">Resolution</div><div class="pctl"><select class="txt" id="rPreset"><option value="">Custom</option><option value="1280x720">1280 × 720 (HD)</option><option value="1920x1080">1920 × 1080 (Full HD)</option><option value="2560x1440">2560 × 1440 (QHD)</option><option value="1080x1080">1080 × 1080 (square)</option><option value="1080x1920">1080 × 1920 (vertical)</option></select></div></div>
    <div class="prow"><div class="plabel static">Size (px)</div><div class="pctl vec"><input class="num" id="rW" value="${R.w}"><input class="num" id="rH" value="${R.h}"></div></div>
    <div class="prow"><div class="plabel static">Anti-aliasing</div><div class="pctl"><select class="txt" id="rQ"><option value="1">Draft (1×)</option><option value="2">Good (2× supersample)</option><option value="3">Best (3× supersample)</option></select></div></div>
    <div class="prow"><div class="plabel static">Background</div><div class="pctl"><select class="txt" id="rBg"><option value="studio">Studio gradient</option><option value="color">Solid colour</option><option value="transparent">Transparent (PNG)</option></select><input type="color" id="rBgC" value="${R.bgColor}"></div></div>
    <div class="prow"><div class="plabel static">Shadows</div><div class="pctl"><input type="checkbox" id="rSh" ${R.shadows ? 'checked' : ''}><span style="color:var(--fg3);font-size:11px">sun direction in ☀ Light</span></div></div>
    <div class="prow"><div class="plabel static">Show grid</div><div class="pctl"><input type="checkbox" id="rGrid" ${R.grid ? 'checked' : ''}></div></div>
    <div class="prow"><div class="plabel static">Frame range</div><div class="pctl vec"><input class="num" id="rS" value="${R.start}"><input class="num" id="rE" value="${R.end}"></div></div>
    <div class="pinfo" style="padding:6px 0">Renders from the current viewport camera at ${fps} fps.${bake.frames.size ? ' Uses the ⚡ baked frames where available.' : ' Tip: ⚡ Bake heavy sims first.'}</div>
  </div><div>
    <div class="rprev" id="rPrev"><span style="color:var(--fg3)">Preview appears here</span></div>
    <div class="rprog" id="rProg"><div></div></div><div class="rstatus" id="rStatus"></div>
  </div></div>`;
  modal('Render', body, [['Close', () => { if (R.busy) { R.cancel = true; return false; } }], ['PNG sequence (.zip)', () => (doSequence(), false)], ['Animation (.mp4)', () => (doVideo(), false)], ['Render still', () => (doStill(), false), true]]);
  $('.mbox').classList.add('wide');
  $('#rQ').value = R.quality; $('#rBg').value = R.bg;
  const pre = $('#rPreset'); pre.value = `${R.w}x${R.h}`; if (!pre.value) pre.value = '';
  pre.addEventListener('change', () => { if (!pre.value) return; const [w, h] = pre.value.split('x').map(Number); $('#rW').value = w; $('#rH').value = h; readR(); });
  ['#rW', '#rH', '#rQ', '#rBg', '#rBgC', '#rSh', '#rGrid', '#rS', '#rE'].forEach((s) => $(s).addEventListener('change', readR));
  if (R.last) showPreview(R.last);
}
function readR() {
  R.w = Math.min(4096, Math.max(16, +$('#rW').value || 1920)); R.h = Math.min(4096, Math.max(16, +$('#rH').value || 1080));
  R.quality = +$('#rQ').value; R.bg = $('#rBg').value; R.bgColor = $('#rBgC').value; R.shadows = $('#rSh').checked; R.grid = $('#rGrid').checked;
  R.start = Math.max(1, Math.round(+$('#rS').value || 1)); R.end = Math.max(R.start, Math.round(+$('#rE').value || endFrame));
  // keep the supersampled buffer inside typical GPU limits
  const maxSide = renderer.capabilities.maxTextureSize || 8192;
  while (R.quality > 1 && Math.max(R.w, R.h) * R.quality > maxSide) R.quality--;
}
function showPreview(cv) { const p = $('#rPrev'); if (!p) return; p.innerHTML = ''; const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0); p.appendChild(c); }
function rStatus(t, frac) { const s = $('#rStatus'); if (s) s.textContent = t; const pr = $('#rProg'); if (pr) { pr.style.display = frac == null ? 'none' : 'block'; pr.firstChild.style.width = ((frac || 0) * 100).toFixed(1) + '%'; } }
async function doStill() {
  if (R.busy) return; readR();
  const opts = { ...R }, t0 = performance.now();
  rStatus('Rendering…', 0.3); await new Promise((r) => setTimeout(r, 20));
  const cv = renderFrame(R.w, R.h, R.quality, opts); R.last = cv; showPreview(cv);
  rStatus(`Rendered ${R.w}×${R.h} in ${((performance.now() - t0) / 1000).toFixed(2)} s — saving…`, null);
  const blob = await canvasPNG(cv);
  const ok = await saveFile(`${sceneName()}_f${String(ctx.frame).padStart(4, '0')}.png`, blob);
  rStatus(ok ? `Saved ${R.w}×${R.h} PNG (${(blob.size / 1024).toFixed(0)} KB)` : `Rendered ${R.w}×${R.h} — not saved`, null);
}
async function forFrames(perFrame) {
  R.busy = true; R.cancel = false; const keepFrame = ctx.frame, n = R.end - R.start + 1;
  try {
    for (let f = R.start; f <= R.end; f++) {
      if (R.cancel) throw new Error('cancelled');
      ctx.frame = f; ctx.time = (f - 1) / fps;
      showFrameGeo(await geoAtFrame(f)); applyCamAt(f);
      const cv = renderFrame(evenDims().w, evenDims().h, R.quality, R);
      await perFrame(cv, f, f - R.start);
      if ((f - R.start) % 3 === 0 || f === R.end) { showPreview(cv); rStatus(`Frame ${f} of ${R.start}–${R.end}`, (f - R.start + 1) / n); await new Promise((r) => setTimeout(r, 0)); }
    }
  } finally { R.busy = false; currentGeo = null; shownSig = null; setFrame(keepFrame); }
}
async function doSequence() {
  if (R.busy) return; readR();
  const files = [];
  try {
    await forFrames(async (cv, f) => { const b = await canvasPNG(cv); files.push({ name: `${sceneName()}.${String(f).padStart(4, '0')}.png`, data: new Uint8Array(await b.arrayBuffer()) }); });
  } catch (e) { rStatus(e.message === 'cancelled' ? 'Cancelled' : 'Failed: ' + e.message, null); return; }
  rStatus(`Packing ${files.length} PNGs…`, 1);
  const zip = makeZip(files);
  const ok = await saveFile(`${sceneName()}_${R.start}-${R.end}_png.zip`, zip);
  rStatus(ok ? `Saved ${files.length} frames (${(zip.size / 1048576).toFixed(1)} MB zip)` : 'Sequence rendered — not saved', null);
}
async function doVideo() {
  if (R.busy) return; readR();
  if (typeof VideoEncoder === 'undefined') { rStatus('This browser can’t encode video (needs WebCodecs: Chrome, Edge or Safari 16.4+). Use PNG sequence instead.', null); return; }
  const { w, h } = evenDims();
  let mod;
  try { mod = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs'); }
  catch (e) { rStatus('Couldn’t load the MP4 muxer: ' + e.message, null); return; }
  const codecs = ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42001f'];
  let cfg = null;
  for (const c of codecs) {
    const test = { codec: c, width: w, height: h, bitrate: Math.round(w * h * fps * 0.18), framerate: fps };
    try { const s = await VideoEncoder.isConfigSupported(test); if (s.supported) { cfg = test; break; } } catch (e) {}
  }
  if (!cfg) { rStatus(`H.264 at ${w}×${h} isn’t supported by this browser — try a smaller size or PNG sequence.`, null); return; }
  const target = new mod.ArrayBufferTarget();
  const muxer = new mod.Muxer({ target, video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
  let encErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (encErr = e) });
  enc.configure(cfg);
  try {
    await forFrames(async (cv, f, i) => {
      if (encErr) throw encErr;
      const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: i % (fps * 2) === 0 }); vf.close();
      while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
    });
    rStatus('Finishing video…', 1);
    await enc.flush(); muxer.finalize();
  } catch (e) { try { enc.close(); } catch (_) {} rStatus(e.message === 'cancelled' ? 'Cancelled' : 'Video failed: ' + (e.message || e), null); return; }
  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  const ok = await saveFile(`${sceneName()}_${R.start}-${R.end}.mp4`, blob);
  rStatus(ok ? `Saved ${R.end - R.start + 1} frames, ${w}×${h} @ ${fps} fps (${(blob.size / 1048576).toFixed(1)} MB MP4)` : 'Video encoded — not saved', null);
}
$('#renderBtn').addEventListener('click', openRender);


// ============================================================
// Animated camera: keyframes + turntable
// ============================================================
const camKeys = () => (S.look.camKeys = S.look.camKeys || []);
const crom = (a, b, c, d, t) => a.map((_, i) => { const p0 = a[i], p1 = b[i], p2 = c[i], p3 = d[i], t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); });
function setCam(pos, target, fov) { camera.position.set(...pos); controls.target.set(...target); if (fov && Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); } }
function applyCamAt(f) {
  const K = camKeys(); if (!K.length || S.look.camFollow === false) return;
  const i = K.findIndex((k) => k.f > f);
  if (i === -1) { const k = K[K.length - 1]; return setCam(k.pos, k.target, k.fov); }
  if (i === 0) return setCam(K[0].pos, K[0].target, K[0].fov);
  const k1 = K[i - 1], k2 = K[i], k0 = K[i - 2] || k1, k3 = K[i + 1] || k2, t = (f - k1.f) / (k2.f - k1.f);
  setCam(crom(k0.pos, k1.pos, k2.pos, k3.pos, t), crom(k0.target, k1.target, k2.target, k3.target, t), k1.fov + (k2.fov - k1.fov) * t);
}
function keyCamera(f = ctx.frame) {
  const K = camKeys().filter((k) => k.f !== f);
  K.push({ f, pos: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov });
  K.sort((a, b) => a.f - b.f); S.look.camKeys = K; S.look.camFollow = true; commit(); drawCamStrip(); toast(`Camera key at frame ${f} (${K.length} key${K.length > 1 ? 's' : ''})`);
}
function drawCamStrip() {
  const cv = $('#camStrip'), g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  const on = S.look.camFollow !== false;
  g.fillStyle = on ? '#f0c25a' : '#6c747d';
  for (const k of camKeys()) { const x = ((k.f - 1) / Math.max(1, endFrame - 1)) * (cv.width - 8) + 4; g.beginPath(); g.moveTo(x, 1); g.lineTo(x + 4, 5); g.lineTo(x, 9); g.lineTo(x - 4, 5); g.closePath(); g.fill(); }
  const hint = $('#camFollowHint'); if (hint) hint.textContent = (on ? 'On' : 'Off') + ' — when off you can look around freely';
  $('#camBtn').classList.toggle('on', camKeys().length > 0 && on);
}
$('#camMenu').addEventListener('click', (e) => {
  const a = e.target.closest('[data-cam]')?.dataset.cam; if (!a) return;
  $$('.dropdown').forEach((d) => d.classList.remove('open'));
  if (a === 'key') keyCamera();
  if (a === 'del') { S.look.camKeys = camKeys().filter((k) => k.f !== ctx.frame); commit(); drawCamStrip(); toast('Deleted key at frame ' + ctx.frame); }
  if (a === 'clear') { S.look.camKeys = []; commit(); drawCamStrip(); toast('Camera keys cleared'); }
  if (a === 'toggle') { S.look.camFollow = S.look.camFollow === false; commit(); drawCamStrip(); applyCamAt(ctx.frame); toast('Follow camera keys: ' + (S.look.camFollow ? 'on' : 'off')); }
  if (a === 'turn') {
    const tgt = controls.target.clone(), off = camera.position.clone().sub(tgt), r = Math.hypot(off.x, off.z), a0 = Math.atan2(off.z, off.x), N = 24, K = [];
    for (let i = 0; i <= N; i++) { const ang = a0 + (i / N) * Math.PI * 2; K.push({ f: Math.round(1 + (i / N) * (endFrame - 1)), pos: [tgt.x + Math.cos(ang) * r, tgt.y + off.y, tgt.z + Math.sin(ang) * r], target: tgt.toArray(), fov: camera.fov }); }
    S.look.camKeys = K.filter((k, i) => i === 0 || k.f !== K[i - 1].f); S.look.camFollow = true; commit(); drawCamStrip(); applyCamAt(ctx.frame);
    toast(`Turntable: one orbit over frames 1–${endFrame}`);
  }
});

// ============================================================
// Viewport painting (Paint node)
// ============================================================
let paint = null; // { id, geo, attr, vals: Float32Array | null, rgba: Float32Array | null, base: [[r,g,b]], nb }
const brush = { radius: 0.3, strength: 0.6, mode: 'add', mirror: false, value: 1, color: '#e0552b' };
const raycaster = new THREE.Raycaster();
const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffb54a, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
ring.renderOrder = 50; ring.visible = false; scene.add(ring);
const ringDot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), new THREE.MeshBasicMaterial({ color: 0xffb54a, depthTest: false })); ringDot.renderOrder = 51; ring.add(ringDot);
const paintAttrOf = (id) => (S.nodes[id] ? paintAttrName(S.nodes[id].params) : 'mask');
const ATTR_LABEL = { mask: 'mask', length: 'hair length', stiffness: 'stiffness', Cd: 'colour' };
function paintBadge() {
  const b = $('#paintBadge');
  if (!paint) { b.classList.remove('on'); return; }
  const name = S.nodes[paint.id]?.name || '', at = paintAttrOf(paint.id);
  b.innerHTML = `🖌 Painting <b>${esc(ATTR_LABEL[at] || at)}</b> on <b>${esc(name)}</b> · <b>${brush.mode === 'add' ? 'Add' : brush.mode === 'erase' ? 'Erase' : 'Smooth'}</b> · <kbd>Shift</kbd> erase · <kbd>Ctrl</kbd> smooth · <kbd>[</kbd> <kbd>]</kbd> size · right-drag orbit · <kbd>Esc</kbd> done`;
  b.classList.add('on');
}
function startPaint(id) {
  if (paint && paint.id === id) return;
  if (playing) togglePlay();
  paint = { id, geo: null, vals: null, rgba: null, nb: null };
  controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  vp.classList.add('painting'); paintBadge(); shownSig = null; requestCook(); renderParams();
}
function endPaint() {
  if (!paint) return;
  paint = null; ring.visible = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.DOLLY };
  vp.classList.remove('painting'); paintBadge(); shownSig = null; currentGeo = null; requestCook(); renderParams();
}
function paintLoad() { // (re)read the stored layer from the node's params
  const n = S.nodes[paint.id], g = paint.geo, N = g.P.length, at = paintAttrOf(paint.id);
  paint.attr = at;
  if (at === 'Cd') {
    const d = decodeRGBA(n.params.data);
    paint.rgba = d && d.n === N ? d.rgba : new Float32Array(N * 4);
    const A = g.attrs || {};
    paint.base = A.__base_r ? g.P.map((_, i) => [A.__base_r[i], A.__base_g[i], A.__base_b[i]]) : g.P.map(() => [0.8, 0.8, 0.8]);
    paint.vals = null;
  } else {
    const m = decodeMask(n.params.data);
    paint.vals = Float32Array.from(m && m.length === N ? m : g.P.map(() => paintDefault(at)));
    paint.rgba = null;
  }
}
function paintGotGeo(g) {
  if (!paint) return;
  const same = paint.geo && paint.geo.P.length === g.P.length;
  paint.geo = g;
  if (!paint.stroking) paintLoad();
  if (!same || !paint.nb) {
    const nb = Array.from({ length: g.P.length }, () => new Set());
    for (const f of g.prims) for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; nb[a].add(b); nb[b].add(a); }
    paint.nb = nb.map((s) => [...s]);
    const bb = g.bbox(), diag = Math.hypot(...bb.max.map((v, i) => v - bb.min[i]));
    if (!paint.sizedFor || Math.abs(paint.sizedFor - diag) / diag > 0.5) { brush.radius = Math.max(0.01, +(diag * 0.08).toFixed(3)); paint.sizedFor = diag; renderParams(); }
  }
  drawPaintView();
}
const heat = (t) => { t = clamp(t, 0, 1); const stops = [[0, [0.08, 0.12, 0.45]], [0.35, [0.1, 0.55, 0.75]], [0.65, [0.95, 0.85, 0.25]], [1, [0.9, 0.2, 0.12]]]; for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i]; const k = (t - a) / (b - a); return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k]; } return stops[3][1]; };
let paintViewQueued = false;
function drawPaintView() {
  if (!paint || !paint.geo || paintViewQueued) return;
  paintViewQueued = true;
  requestAnimationFrame(() => {
    paintViewQueued = false; if (!paint || !paint.geo || (!paint.vals && !paint.rgba)) return;
    const g = paint.geo, hot = [1, 0.32, 0.12], at = paint.attr;
    const view = new Geo(); view.P = g.P; view.prims = g.prims; view.lines = g.lines; view.primMat = null;
    let stat = '';
    if (at === 'Cd') {
      const R = paint.rgba; let c = 0;
      view.Cd = paint.base.map((b, i) => { const a = R[i * 4 + 3]; if (a > 0.5) c++; return [b[0] + (R[i * 4] - b[0]) * a, b[1] + (R[i * 4 + 1] - b[1]) * a, b[2] + (R[i * 4 + 2] - b[2]) * a]; });
      stat = `${((c / Math.max(1, g.P.length)) * 100).toFixed(0)}% of ${g.P.length.toLocaleString()} points coloured`;
    } else if (at === 'mask') {
      const m = paint.vals; let c = 0;
      view.Cd = g.P.map((_, i) => { if (m[i] > 0.5) c++; const base = g.Cd ? g.Cd[i] : [0.62, 0.64, 0.68], t = Math.min(1, m[i]) * 0.85; return [base[0] + (hot[0] - base[0]) * t, base[1] + (hot[1] - base[1]) * t, base[2] + (hot[2] - base[2]) * t]; });
      stat = `${c.toLocaleString()} of ${m.length.toLocaleString()} points painted (${((c / Math.max(1, m.length)) * 100).toFixed(0)}%)`;
    } else {
      const m = paint.vals; let s = 0, lo = Infinity, hi = -Infinity;
      view.Cd = g.P.map((_, i) => { s += m[i]; lo = Math.min(lo, m[i]); hi = Math.max(hi, m[i]); return heat(m[i]); });
      stat = `${ATTR_LABEL[at] || at}: avg ${(s / Math.max(1, m.length)).toFixed(2)} · range ${lo.toFixed(2)}–${hi.toFixed(2)}`;
    }
    buildThree(view);
    const st = $('#paintStats'); if (st) st.textContent = stat;
  });
}
function hitAt(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
  const meshes = geoGroup.children.filter((o) => o.isMesh);
  const h = raycaster.intersectObjects(meshes, false)[0];
  return h || null;
}
function dab(pt, mode, f0 = 1) {
  const g = paint.geo, r = brush.radius, r2 = r * r, P = g.P, at = paint.attr;
  const centers = [pt]; if (brush.mirror) centers.push([-pt[0], pt[1], pt[2]]);
  const bc = hex2rgb(brush.color), k = brush.strength * f0 * 0.5;
  for (const c of centers) {
    const hits = [];
    for (let i = 0; i < P.length; i++) { const dx = P[i][0] - c[0], dy = P[i][1] - c[1], dz = P[i][2] - c[2], d2 = dx * dx + dy * dy + dz * dz; if (d2 < r2) hits.push([i, (1 - d2 / r2) ** 2]); }
    if (at === 'Cd') {
      const R = paint.rgba;
      if (mode === 'smooth') { const old = Float32Array.from(R); for (const [i, w] of hits) { const n = paint.nb[i]; if (!n.length) continue; for (let ch = 0; ch < 4; ch++) { let s = 0; for (const j of n) s += old[j * 4 + ch]; R[i * 4 + ch] = old[i * 4 + ch] + (s / n.length - old[i * 4 + ch]) * Math.min(1, w * k * 3); } } }
      else if (mode === 'erase') for (const [i, w] of hits) R[i * 4 + 3] = Math.max(0, R[i * 4 + 3] - w * k);
      else for (const [i, w] of hits) { const t = Math.min(1, w * k * 1.5), a = R[i * 4 + 3]; for (let ch = 0; ch < 3; ch++) R[i * 4 + ch] = a < 0.01 ? bc[ch] : R[i * 4 + ch] + (bc[ch] - R[i * 4 + ch]) * t; R[i * 4 + 3] = Math.min(1, a + w * k); }
    } else {
      const m = paint.vals;
      if (mode === 'smooth') { const old = Float32Array.from(m); for (const [i, w] of hits) { const n = paint.nb[i]; if (!n.length) continue; let s = 0; for (const j of n) s += old[j]; m[i] = old[i] + (s / n.length - old[i]) * Math.min(1, w * k * 3); } }
      else { const target = mode === 'erase' ? paintDefault(at) : brush.value; for (const [i, w] of hits) m[i] += (target - m[i]) * Math.min(1, w * k * 1.6); }
    }
  }
  drawPaintView();
}
function brushModeFor(ev) { return ev.shiftKey ? 'erase' : ev.ctrlKey || ev.metaKey ? 'smooth' : brush.mode; }
function placeRing(h) {
  if (!h) { ring.visible = false; return; }
  ring.visible = true; ring.position.copy(h.point);
  const n = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0);
  ring.lookAt(h.point.clone().add(n)); ring.scale.setScalar(brush.radius); ring.position.addScaledVector(n, brush.radius * 0.02);
}
const cvs = renderer.domElement;
let lastDab = 0, lastPt = null;
cvs.addEventListener('pointerdown', (ev) => {
  if (!paint || ev.button !== 0 || (!paint.vals && !paint.rgba)) return;
  cvs.setPointerCapture(ev.pointerId); paint.stroking = true; lastPt = null;
  const h = hitAt(ev);
  if (h) { const pt = h.point.toArray(); dab(pt, brushModeFor(ev)); lastPt = pt; lastDab = performance.now(); }
  ev.preventDefault();
});
cvs.addEventListener('pointermove', (ev) => {
  if (!paint) return;
  const h = hitAt(ev); placeRing(h);
  if (!paint.stroking || !h) return;
  const pt = h.point.toArray(), now = performance.now();
  const dist = lastPt ? Math.hypot(pt[0] - lastPt[0], pt[1] - lastPt[1], pt[2] - lastPt[2]) : Infinity;
  if (dist < brush.radius * 0.18 && now - lastDab < 60) return; // spacing
  dab(pt, brushModeFor(ev), Math.min(1, 0.35 + dist / brush.radius)); lastPt = pt; lastDab = now;
});
function endStroke() {
  if (!paint || !paint.stroking) return;
  paint.stroking = false; lastPt = null;
  const n = S.nodes[paint.id]; if (!n) return;
  n.params.data = paint.attr === 'Cd' ? encodeRGBA(paint.rgba) : encodeMask(paint.vals); commit(); requestCook();
}
cvs.addEventListener('pointerup', endStroke);
cvs.addEventListener('pointercancel', endStroke);
cvs.addEventListener('pointerleave', () => { ring.visible = false; });
function paintPanel(n, d) {
  const box = el('div', 'ptools'), active = paint && paint.id === n.id, at = paintAttrName(n.params);
  const row1 = el('div', 'row');
  const go = el('button', 'pbtn big' + (active ? ' on' : ''), active ? '✓ Done painting' : `🖌 Paint ${ATTR_LABEL[at] || at}`);
  go.addEventListener('click', () => (active ? endPaint() : startPaint(n.id)));
  row1.appendChild(go);
  const stats = el('span', null, ''); stats.id = 'paintStats'; stats.style.cssText = 'color:var(--fg3);font-size:11px';
  row1.appendChild(stats); box.appendChild(row1);
  const modeRow = el('div', 'row'); modeRow.appendChild(el('span', null, '<span style="color:var(--fg2);width:62px;display:inline-block">Brush</span>'));
  for (const [m, l] of [['add', at === 'Cd' ? 'Paint' : 'Add'], ['erase', 'Erase'], ['smooth', 'Smooth']]) { const b = el('button', 'pbtn' + (brush.mode === m ? ' on' : ''), l); b.addEventListener('click', () => { brush.mode = m; paintBadge(); renderParams(); }); modeRow.appendChild(b); }
  const mir = el('button', 'pbtn' + (brush.mirror ? ' on' : ''), '⇋ Mirror X'); mir.title = 'Paint both sides of x = 0'; mir.addEventListener('click', () => { brush.mirror = !brush.mirror; renderParams(); });
  modeRow.appendChild(mir); box.appendChild(modeRow);
  const sl = (label, key, min, max, step, tip) => { const r = el('div', 'row'); r.innerHTML = `<span style="color:var(--fg2);width:62px;display:inline-block" title="${tip || ''}">${label}</span>`; const s = el('input'); s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = brush[key]; s.style.flex = '1'; const v = el('span', null, String(brush[key])); v.style.cssText = 'font:11px var(--mono);color:var(--fg3);width:40px;text-align:right'; s.addEventListener('input', () => { brush[key] = +s.value; v.textContent = s.value; }); r.append(s, v); return r; };
  box.append(sl('Radius', 'radius', 0.01, 3, 0.005), sl('Strength', 'strength', 0.05, 1, 0.05));
  if (at === 'Cd') {
    const r = el('div', 'row'); r.innerHTML = '<span style="color:var(--fg2);width:62px;display:inline-block">Colour</span>';
    const c = el('input'); c.type = 'color'; c.value = brush.color; c.addEventListener('input', () => (brush.color = c.value));
    r.appendChild(c);
    for (const sw of ['#e0552b', '#f2c14e', '#3d8f5f', '#2f6db5', '#1b1b1f', '#f4efe6']) { const b = el('button', 'pbtn'); b.style.cssText = `width:22px;height:22px;padding:0;background:${sw}`; b.title = sw; b.addEventListener('click', () => { brush.color = sw; c.value = sw; }); r.appendChild(b); }
    box.appendChild(r);
  } else if (at !== 'mask') box.appendChild(sl('Value', 'value', 0, 1, 0.01, 'The value Add paints toward; Erase goes back to the default'));
  const ops = el('div', 'row');
  const op = (label, fn, title) => { const b = el('button', 'pbtn', label); if (title) b.title = title; b.addEventListener('click', () => { if (!paint || paint.id !== n.id || (!paint.vals && !paint.rgba)) { startPaint(n.id); toast('Painting started — click again once the mesh shows'); return; } fn(); n.params.data = paint.attr === 'Cd' ? encodeRGBA(paint.rgba) : encodeMask(paint.vals); commit(); drawPaintView(); requestCook(); }); ops.appendChild(b); };
  op('Fill', () => { if (paint.rgba) { const c = hex2rgb(brush.color); for (let i = 0; i < paint.rgba.length; i += 4) { paint.rgba.set(c, i); paint.rgba[i + 3] = 1; } } else paint.vals.fill(at === 'mask' ? 1 : brush.value); }, at === 'Cd' ? 'Colour everything with the brush colour' : 'Set every point to the brush value');
  op('Clear', () => { if (paint.rgba) paint.rgba.fill(0); else paint.vals.fill(paintDefault(at)); }, 'Back to the default');
  op('Invert', () => { if (paint.rgba) { for (let i = 3; i < paint.rgba.length; i += 4) paint.rgba[i] = 1 - paint.rgba[i]; } else for (let i = 0; i < paint.vals.length; i++) paint.vals[i] = 1 - paint.vals[i]; });
  op('Grow', () => { const A = paint.rgba, m = paint.vals; if (A) { const o = Float32Array.from(A); paint.nb.forEach((ns, i) => { let best = i; for (const j of ns) if (o[j * 4 + 3] > o[best * 4 + 3]) best = j; if (best !== i) for (let ch = 0; ch < 4; ch++) A[i * 4 + ch] = o[best * 4 + ch]; }); } else { const o = Float32Array.from(m); paint.nb.forEach((ns, i) => { let mx = o[i]; for (const j of ns) mx = Math.max(mx, o[j]); m[i] = mx; }); } }, 'Expand the painted area by one ring of points');
  box.appendChild(ops);
  const help = {
    mask: '<b>Hair</b> grows only where painted (longer where stronger), <b>Cloth</b> pins painted points, <b>Scatter</b> and every particle emitter use it as density.',
    length: 'Multiplies <b>Hair</b> length at each root: 1 = full length, 0 = no hair. Paint with a low <b>Value</b> for short areas.',
    stiffness: 'Multiplies <b>Hair</b> shape stiffness and <b>Cloth</b> stretch/shear/bend per area (1 = node setting). Low values make floppier hair and stretchier, more wrinkly cloth.',
    Cd: 'Paints colour over the input. <b>Hair</b> with “Colour From Skin” picks it up at each root.',
  };
  box.appendChild(el('div', 'pinfo', (help[at] || `Writes a float point attribute <code>@${esc(at)}</code> that Point Wrangle can read.`) + ' Each stroke is one undo step.'));
  if (active) setTimeout(drawPaintView, 0);
  return box;
}

// ============================================================
// Boot
// ============================================================
applyView();
applyLook(); syncToggles();
let saved = null;
setTimeout(drawCamStrip, 0);
try { saved = localStorage.getItem('proteus.scene'); } catch (e) {}
let restored = false;
if (saved) { try { const o = JSON.parse(saved); if (o.nodes && Object.values(o.nodes).every((n) => NODE_TYPES[n.type])) { S.nodes = o.nodes; S.display = o.display; S.nextId = o.nextId; S.look = { ...DEFAULT_LOOK, ...(o.look || {}) }; restored = Object.keys(o.nodes).length > 0; } } catch (e) {} }
if (restored) { lastSnap = snapshot(); renderNet(); renderParams(); requestAnimationFrame(() => { homeNet(); doCook(); frameGeo(); }); }
else requestAnimationFrame(() => loadExample('terrain'));
window.__proteus = { get paint() { return paint; }, get brush() { return brush; }, get state() { return S; }, cookState, engine, loadExample, ctx, get geo() { return currentGeo; } };
