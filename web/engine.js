// ============================================================
// Proteus geometry engine — pure JS, no dependencies
// ============================================================

// ---------- vector helpers ----------
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

// ---------- random + noise ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rand(x, y = 0, z = 0) {
  if (x && typeof x === 'object') { y = x.y ?? x[1] ?? 0; z = x.z ?? x[2] ?? 0; x = x.x ?? x[0] ?? 0; }
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
}
const PERM = (() => {
  const r = mulberry32(1337), p = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const out = new Uint8Array(512);
  for (let i = 0; i < 512; i++) out[i] = p[i & 255];
  return out;
})();
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
function noise3(x, y, z) {
  if (x && typeof x === 'object') { y = x.y ?? x[1]; z = x.z ?? x[2]; x = x.x ?? x[0]; }
  y = y || 0; z = z || 0;
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z), p = PERM;
  const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
  const l = (a, b, t) => a + t * (b - a);
  return l(
    l(l(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), l(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
    l(l(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), l(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
    w);
}
function fbm(x, y, z, oct = 4, rough = 0.5) {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); norm += a; a *= rough; f *= 2.03; }
  return s / norm;
}
const fit = (v, a, b, c, d) => { const t = Math.min(1, Math.max(0, (v - a) / ((b - a) || 1e-9))); return c + (d - c) * t; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;

// ---------- geometry container ----------
const ATTR_DEFAULTS = { length: 1, stiffness: 1 };
const attrDef = (k) => ATTR_DEFAULTS[k] ?? 0;
const mapAttrs = (attrs, fn) => (attrs ? Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, fn(v, k)])) : null);
class Geo {
  constructor() { this.P = []; this.prims = []; this.lines = []; this.Cd = null; this.N = null; this.pscale = null; this.mask = null; this.attrs = null; this.alpha = null; this.sprite = null; this.primMat = null; this.piece = null; this.v = null; }
  clone() {
    const g = new Geo();
    g.P = this.P.map((p) => p.slice());
    g.prims = this.prims.map((p) => p.slice());
    g.lines = this.lines.map((l) => l.slice());
    g.Cd = this.Cd && this.Cd.map((c) => c.slice());
    g.N = this.N && this.N.map((n) => n.slice());
    g.pscale = this.pscale && this.pscale.slice();
    g.mask = this.mask && this.mask.slice();
    g.attrs = mapAttrs(this.attrs, (v) => v.slice());
    g.alpha = this.alpha && this.alpha.slice();
    g.sprite = this.sprite && { ...this.sprite };
    g.primMat = this.primMat && this.primMat.slice();
    g.piece = this.piece && this.piece.slice();
    g.v = this.v && this.v.map((x) => x.slice());
    return g;
  }
  append(o) {
    const off = this.P.length, n0 = this.P.length, n1 = o.P.length;
    const fill = (mine, theirs, def) => {
      if (!mine && !theirs) return null;
      const a = mine ? mine : Array.from({ length: n0 }, () => (Array.isArray(def) ? def.slice() : def));
      const b = theirs ? theirs.map((x) => (Array.isArray(x) ? x.slice() : x)) : Array.from({ length: n1 }, () => (Array.isArray(def) ? def.slice() : def));
      return a.concat(b);
    };
    this.Cd = fill(this.Cd, o.Cd, [0.8, 0.8, 0.8]);
    this.N = fill(this.N, o.N, [0, 1, 0]);
    this.pscale = fill(this.pscale, o.pscale, 1);
    this.mask = fill(this.mask, o.mask, 0);
    if (this.attrs || o.attrs) { const names = new Set([...Object.keys(this.attrs || {}), ...Object.keys(o.attrs || {})]); const A = {}; for (const k of names) A[k] = fill(this.attrs && this.attrs[k], o.attrs && o.attrs[k], attrDef(k)); this.attrs = A; }
    this.alpha = fill(this.alpha, o.alpha, 0);
    this.v = fill(this.v, o.v, [0, 0, 0]);
    this.sprite = this.sprite || (o.sprite && { ...o.sprite });
    if (this.piece || o.piece) { const base = this.piece && this.piece.length ? Math.max(...this.piece) + 1 : this.piece ? 0 : 1; this.piece = (this.piece || this.prims.map(() => 0)).concat(o.piece ? o.piece.map((x) => x + base) : o.prims.map(() => base)); }
    if (this.primMat || o.primMat) this.primMat = (this.primMat || this.prims.map(() => null)).concat(o.primMat ? o.primMat.slice() : o.prims.map(() => null));
    for (const p of o.P) this.P.push(p.slice());
    for (const f of o.prims) this.prims.push(f.map((i) => i + off));
    for (const l of o.lines) this.lines.push(l.map((i) => i + off));
    return this;
  }
  bbox() {
    if (!this.P.length) return { min: [0, 0, 0], max: [0, 0, 0] };
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of this.P) for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
    return { min, max };
  }
}

function faceNormal(P, f) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < f.length; i++) {
    const a = P[f[i]], b = P[f[(i + 1) % f.length]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return V.norm([nx, ny, nz]);
}
function centroid(P, f) {
  const c = [0, 0, 0];
  for (const i of f) { c[0] += P[i][0]; c[1] += P[i][1]; c[2] += P[i][2]; }
  return V.mul(c, 1 / f.length);
}
function computeNormals(g) {
  const N = g.P.map(() => [0, 0, 0]), hit = new Uint8Array(g.P.length);
  for (const f of g.prims) {
    const n = faceNormal(g.P, f);
    for (const i of f) { N[i][0] += n[0]; N[i][1] += n[1]; N[i][2] += n[2]; hit[i] = 1; }
  }
  g.N = N.map((n, i) => (hit[i] ? V.norm(n) : (g.N && g.N[i] ? g.N[i] : [0, 1, 0])));
  return g;
}
// flip prims whose normal disagrees with an outward direction function
function orient(g, outward) {
  g.prims = g.prims.map((f) => {
    const n = faceNormal(g.P, f), c = centroid(g.P, f);
    return V.dot(n, outward(c)) < 0 ? f.slice().reverse() : f;
  });
  return g;
}
// remove points no prim/line references
function compact(g) {
  const used = new Int32Array(g.P.length).fill(-1);
  let k = 0;
  const mark = (i) => { if (used[i] < 0) used[i] = k++; };
  g.prims.forEach((f) => f.forEach(mark));
  g.lines.forEach((l) => l.forEach(mark));
  const out = new Geo();
  out.P = new Array(k); if (g.Cd) out.Cd = new Array(k); if (g.N) out.N = new Array(k); if (g.pscale) out.pscale = new Array(k); if (g.mask) out.mask = new Array(k); out.attrs = mapAttrs(g.attrs, () => new Array(k));
  for (let i = 0; i < g.P.length; i++) if (used[i] >= 0) {
    const j = used[i]; out.P[j] = g.P[i];
    if (g.Cd) out.Cd[j] = g.Cd[i]; if (g.N) out.N[j] = g.N[i]; if (g.pscale) out.pscale[j] = g.pscale[i]; if (g.mask) out.mask[j] = g.mask[i]; if (g.attrs) for (const a in g.attrs) out.attrs[a][j] = g.attrs[a][i];
  }
  out.prims = g.prims.map((f) => f.map((i) => used[i]));
  out.lines = g.lines.map((l) => l.map((i) => used[i]));
  out.primMat = g.primMat && g.primMat.slice(); out.piece = g.piece && g.piece.slice(); out.sprite = g.sprite; if (g.v) { out.v = new Array(k); for (let i = 0; i < g.P.length; i++) if (used[i] >= 0) out.v[used[i]] = g.v[i]; }
  if (g.alpha) { out.alpha = new Array(k); for (let i = 0; i < g.P.length; i++) if (used[i] >= 0) out.alpha[used[i]] = g.alpha[i]; }
  return out;
}
// give every prim its own points (for per-prim attributes)
function unshare(g) {
  const out = new Geo();
  if (g.Cd) out.Cd = []; if (g.N) out.N = []; if (g.pscale) out.pscale = []; if (g.mask) out.mask = []; out.attrs = mapAttrs(g.attrs, () => []);
  const push = (i) => {
    out.P.push(g.P[i].slice());
    if (g.Cd) out.Cd.push(g.Cd[i].slice()); if (g.N) out.N.push(g.N[i].slice()); if (g.pscale) out.pscale.push(g.pscale[i]); if (g.mask) out.mask.push(g.mask[i]); if (g.attrs) for (const a in g.attrs) out.attrs[a].push(g.attrs[a][i]);
    return out.P.length - 1;
  };
  out.prims = g.prims.map((f) => f.map(push));
  out.lines = g.lines.map((l) => l.map(push));
  out.primMat = g.primMat && g.primMat.slice();
  out.piece = g.piece && g.piece.slice();
  return out;
}
function fuse(g, tol = 1e-5) {
  const map = new Map(), remap = new Int32Array(g.P.length), keep = [];
  const q = (v) => Math.round(v / tol);
  g.P.forEach((p, i) => {
    const key = q(p[0]) + ',' + q(p[1]) + ',' + q(p[2]);
    if (map.has(key)) remap[i] = map.get(key); else { map.set(key, keep.length); remap[i] = keep.length; keep.push(i); }
  });
  const out = new Geo();
  out.P = keep.map((i) => g.P[i].slice());
  if (g.Cd) out.Cd = keep.map((i) => g.Cd[i].slice());
  if (g.pscale) out.pscale = keep.map((i) => g.pscale[i]);
  if (g.mask) out.mask = keep.map((i) => g.mask[i]);
  out.attrs = mapAttrs(g.attrs, (v) => keep.map((i) => v[i]));
  const fp = g.prims.map((f) => {
    const r = []; for (const i of f) { const j = remap[i]; if (r[r.length - 1] !== j) r.push(j); }
    if (r.length > 1 && r[0] === r[r.length - 1]) r.pop();
    return r;
  });
  out.prims = fp.filter((f) => f.length >= 3);
  if (g.primMat) out.primMat = g.primMat.filter((_, i) => fp[i].length >= 3);
  if (g.piece) out.piece = g.piece.filter((_, i) => fp[i].length >= 3);
  out.lines = g.lines.map((l) => l.map((i) => remap[i]));
  return out;
}

// ---------- generators ----------
function gridGeo(sx, sz, rows, cols, center = [0, 0, 0]) {
  const g = new Geo();
  rows = Math.max(2, rows | 0); cols = Math.max(2, cols | 0);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++)
    g.P.push([center[0] + (j / (cols - 1) - 0.5) * sx, center[1], center[2] + (i / (rows - 1) - 0.5) * sz]);
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols + 1, d = a + cols;
    g.prims.push([a, d, c, b]);
  }
  return g;
}
function boxGeo(size, center, divs) {
  const n = Math.max(1, divs | 0), g = new Geo();
  const faces = [
    { o: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] }, { o: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { o: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] }, { o: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { o: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] },
  ];
  for (const F of faces) {
    const base = g.P.length;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const a = j / n - 0.5, b = i / n - 0.5;
      const p = [0, 1, 2].map((k) => (F.o[k] * 0.5 + F.u[k] * a + F.v[k] * b) * size[k] + center[k]);
      g.P.push(p);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a = base + i * (n + 1) + j;
      g.prims.push([a, a + 1, a + n + 2, a + n + 1]);
    }
  }
  const out = fuse(g, 1e-6);
  return orient(out, (c) => V.sub(c, center));
}
function sphereGeo(r, rows, cols, center) {
  rows = Math.max(3, rows | 0); cols = Math.max(3, cols | 0);
  const g = new Geo();
  g.P.push([0, r, 0]);
  for (let k = 1; k < rows; k++) {
    const th = (k * Math.PI) / rows, y = Math.cos(th) * r, rad = Math.sin(th) * r;
    for (let j = 0; j < cols; j++) { const ph = (j * 2 * Math.PI) / cols; g.P.push([rad * Math.cos(ph), y, rad * Math.sin(ph)]); }
  }
  g.P.push([0, -r, 0]);
  const bot = g.P.length - 1, ring = (k, j) => 1 + (k - 1) * cols + (((j % cols) + cols) % cols);
  for (let j = 0; j < cols; j++) g.prims.push([0, ring(1, j + 1), ring(1, j)]);
  for (let k = 1; k < rows - 1; k++) for (let j = 0; j < cols; j++)
    g.prims.push([ring(k, j), ring(k, j + 1), ring(k + 1, j + 1), ring(k + 1, j)]);
  for (let j = 0; j < cols; j++) g.prims.push([bot, ring(rows - 1, j), ring(rows - 1, j + 1)]);
  orient(g, (c) => c);
  g.P = g.P.map((p) => V.add(p, center));
  return g;
}
function torusGeo(R, r, rows, cols, center) {
  rows = Math.max(3, rows | 0); cols = Math.max(3, cols | 0);
  const g = new Geo();
  for (let i = 0; i < cols; i++) {
    const u = (i / cols) * Math.PI * 2;
    for (let j = 0; j < rows; j++) {
      const v = (j / rows) * Math.PI * 2;
      g.P.push([(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)]);
    }
  }
  const id = (i, j) => (((i % cols) + cols) % cols) * rows + (((j % rows) + rows) % rows);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) g.prims.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
  orient(g, (c) => { const a = Math.atan2(c[2], c[0]); return V.sub(c, [R * Math.cos(a), 0, R * Math.sin(a)]); });
  g.P = g.P.map((p) => V.add(p, center));
  return g;
}
function tubeGeo(r1, r2, h, rows, cols, caps, center) {
  rows = Math.max(2, rows | 0); cols = Math.max(3, cols | 0);
  const g = new Geo();
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1), y = (t - 0.5) * h, r = mix(r1, r2, t);
    for (let j = 0; j < cols; j++) { const a = (j / cols) * Math.PI * 2; g.P.push([r * Math.cos(a), y, r * Math.sin(a)]); }
  }
  const id = (i, j) => i * cols + (j % cols);
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) g.prims.push([id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)]);
  if (caps) {
    g.prims.push(Array.from({ length: cols }, (_, j) => id(0, j)));
    g.prims.push(Array.from({ length: cols }, (_, j) => id(rows - 1, j)));
  }
  orient(g, (c) => c);
  g.P = g.P.map((p) => V.add(p, center));
  return g;
}
function circleGeo(r, divs, filled, center) {
  divs = Math.max(3, divs | 0);
  const g = new Geo();
  for (let j = 0; j < divs; j++) { const a = (j / divs) * Math.PI * 2; g.P.push([center[0] + r * Math.cos(a), center[1], center[2] + r * Math.sin(a)]); }
  const loop = Array.from({ length: divs }, (_, i) => i);
  if (filled) { g.prims.push(loop); orient(g, () => [0, 1, 0]); }
  else g.lines.push(loop.concat([0]));
  return g;
}

// ---------- operations ----------
function rotMatrix(rx, ry, rz) {
  const [a, b, c] = [rx, ry, rz].map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(a), sx = Math.sin(a), cy = Math.cos(b), sy = Math.sin(b), cz = Math.cos(c), sz = Math.sin(c);
  // R = Rz * Ry * Rx  (rotate X first, then Y, then Z)
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}
const mulM = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
// rotation that maps +Y onto unit vector n
function alignY(n) {
  const y = [0, 1, 0], c = V.dot(y, n);
  if (c > 0.99999) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (c < -0.99999) return [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const ax = V.norm(V.cross(y, n)), s = Math.sqrt(1 - c * c);
  return axisAngle(ax, Math.atan2(s, c));
}
function axisAngle(a, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c, [x, y, z] = a;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}
const mulMM = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));

function subdivide(g, smooth) {
  const P = g.P, prims = g.prims, nP = P.length;
  const facePts = prims.map((f) => centroid(P, f));
  const edges = new Map();
  const ekey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  prims.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length], k = ekey(a, b);
      if (!edges.has(k)) edges.set(k, { a, b, faces: [] });
      edges.get(k).faces.push(fi);
    }
  });
  const vFaces = Array.from({ length: nP }, () => []), vEdges = Array.from({ length: nP }, () => []);
  prims.forEach((f, fi) => f.forEach((v) => vFaces[v].push(fi)));
  for (const e of edges.values()) { vEdges[e.a].push(e); vEdges[e.b].push(e); }

  const out = new Geo();
  const hasCd = !!g.Cd;
  if (hasCd) out.Cd = [];
  // original verts
  for (let v = 0; v < nP; v++) {
    let p = P[v];
    if (smooth && vFaces[v].length) {
      const bEdges = vEdges[v].filter((e) => e.faces.length === 1);
      if (bEdges.length) {
        if (bEdges.length === 2) {
          const o1 = bEdges[0].a === v ? bEdges[0].b : bEdges[0].a, o2 = bEdges[1].a === v ? bEdges[1].b : bEdges[1].a;
          p = V.mul(V.add(V.mul(P[v], 6), V.add(P[o1], P[o2])), 1 / 8);
        }
      } else {
        const n = vFaces[v].length;
        let F = [0, 0, 0], R = [0, 0, 0];
        vFaces[v].forEach((fi) => (F = V.add(F, facePts[fi])));
        F = V.mul(F, 1 / n);
        vEdges[v].forEach((e) => (R = V.add(R, V.mul(V.add(P[e.a], P[e.b]), 0.5))));
        R = V.mul(R, 1 / vEdges[v].length);
        p = V.mul(V.add(V.add(F, V.mul(R, 2)), V.mul(P[v], n - 3)), 1 / n);
      }
    }
    out.P.push(p.slice());
    if (hasCd) out.Cd.push(g.Cd[v].slice());
  }
  for (const e of edges.values()) {
    let p = V.mul(V.add(P[e.a], P[e.b]), 0.5);
    if (smooth && e.faces.length === 2) p = V.mul(V.add(V.add(P[e.a], P[e.b]), V.add(facePts[e.faces[0]], facePts[e.faces[1]])), 0.25);
    e.id = out.P.length; out.P.push(p);
    if (hasCd) out.Cd.push(V.lerp(g.Cd[e.a], g.Cd[e.b], 0.5));
  }
  const fIds = facePts.map((p, fi) => {
    out.P.push(p);
    if (hasCd) { let c = [0, 0, 0]; prims[fi].forEach((v) => (c = V.add(c, g.Cd[v]))); out.Cd.push(V.mul(c, 1 / prims[fi].length)); }
    return out.P.length - 1;
  });
  if (g.primMat) out.primMat = [];
  if (g.piece) out.piece = [];
  prims.forEach((f, fi) => {
    const n = f.length;
    for (let i = 0; i < n; i++) {
      const v = f[i], next = f[(i + 1) % n], prev = f[(i - 1 + n) % n];
      out.prims.push([v, edges.get(ekey(v, next)).id, fIds[fi], edges.get(ekey(prev, v)).id]);
      if (g.primMat) out.primMat.push(g.primMat[fi]);
      if (g.piece) out.piece.push(g.piece[fi]);
    }
  });
  out.lines = g.lines.map((l) => l.slice());
  if (g.pscale) out.pscale = out.P.map((_, i) => (i < nP ? g.pscale[i] : 1));
  out.attrs = mapAttrs(g.attrs, (src) => { const a = src.slice(0, nP); for (const e of edges.values()) a[e.id] = (src[e.a] + src[e.b]) / 2; fIds.forEach((id, fi) => { a[id] = prims[fi].reduce((t, v) => t + src[v], 0) / prims[fi].length; }); return a; });
  if (g.mask) { out.mask = g.mask.slice(0, nP); for (const e of edges.values()) out.mask[e.id] = (g.mask[e.a] + g.mask[e.b]) / 2; fIds.forEach((id, fi) => { out.mask[id] = prims[fi].reduce((a, v) => a + g.mask[v], 0) / prims[fi].length; }); }
  return out;
}

function smoothGeo(g, iters, strength) {
  const nb = Array.from({ length: g.P.length }, () => new Set());
  for (const f of g.prims) for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; nb[a].add(b); nb[b].add(a); }
  for (const l of g.lines) for (let i = 0; i + 1 < l.length; i++) { nb[l[i]].add(l[i + 1]); nb[l[i + 1]].add(l[i]); }
  let P = g.P;
  for (let it = 0; it < iters; it++) {
    P = P.map((p, i) => {
      if (!nb[i].size) return p;
      let s = [0, 0, 0]; nb[i].forEach((j) => (s = V.add(s, P[j])));
      return V.lerp(p, V.mul(s, 1 / nb[i].size), strength);
    });
  }
  g.P = P;
  return g;
}

function polyExtrude(g, dist, inset, keepBase) {
  const out = new Geo();
  out.P = g.P.map((p) => p.slice());
  if (g.Cd) out.Cd = g.Cd.map((c) => c.slice());
  if (g.mask) out.mask = g.mask.slice();
  out.attrs = mapAttrs(g.attrs, (v) => v.slice());
  const hasCd = !!g.Cd;
  if (g.primMat) out.primMat = [];
  if (g.piece) out.piece = [];
  for (let fi = 0; fi < g.prims.length; fi++) {
    const f = g.prims[fi], before = out.prims.length;
    const n = faceNormal(g.P, f), c = centroid(g.P, f);
    const top = f.map((i) => {
      const p = V.add(V.add(g.P[i], V.mul(n, dist)), V.mul(V.sub(c, g.P[i]), inset));
      out.P.push(p); if (hasCd) out.Cd.push(g.Cd[i].slice()); if (out.mask) out.mask.push(g.mask[i]); if (out.attrs) for (const a in out.attrs) out.attrs[a].push(g.attrs[a][i]);
      return out.P.length - 1;
    });
    for (let i = 0; i < f.length; i++) {
      const j = (i + 1) % f.length;
      out.prims.push([f[i], f[j], top[j], top[i]]);
    }
    out.prims.push(top);
    if (keepBase) out.prims.push(f.slice().reverse());
    if (g.primMat) for (let k = before; k < out.prims.length; k++) out.primMat.push(g.primMat[fi]);
    if (g.piece) for (let k = before; k < out.prims.length; k++) out.piece.push(g.piece[fi]);
  }
  out.lines = g.lines.map((l) => l.slice());
  return compact(out);
}

function scatter(g, count, seed, useMask = true) {
  const out = new Geo();
  out.N = []; if (g.Cd) out.Cd = [];
  const M = useMask && g.mask ? g.mask : null; if (M) out.mask = [];
  out.attrs = mapAttrs(g.attrs, () => []);
  const tris = [];
  let total = 0;
  for (const f of g.prims) {
    const n = faceNormal(g.P, f);
    for (let i = 1; i + 1 < f.length; i++) {
      const a = g.P[f[0]], b = g.P[f[i]], c = g.P[f[i + 1]];
      let area = V.len(V.cross(V.sub(b, a), V.sub(c, a))) * 0.5;
      if (M) area *= Math.max(0, (M[f[0]] + M[f[i]] + M[f[i + 1]]) / 3);
      total += area; tris.push({ i0: f[0], i1: f[i], i2: f[i + 1], cum: total, n });
    }
  }
  if (!tris.length || total <= 0) return out;
  const r = mulberry32(seed * 9973 + 17);
  for (let k = 0; k < count; k++) {
    const t = r() * total;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m].cum < t) lo = m + 1; else hi = m; }
    const T = tris[lo];
    let u = r(), v = r(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    const A = g.P[T.i0], B = g.P[T.i1], C = g.P[T.i2];
    out.P.push([A[0] * w + B[0] * u + C[0] * v, A[1] * w + B[1] * u + C[1] * v, A[2] * w + B[2] * u + C[2] * v]);
    out.N.push(T.n.slice());
    if (g.Cd) { const a = g.Cd[T.i0], b = g.Cd[T.i1], c = g.Cd[T.i2]; out.Cd.push([0, 1, 2].map((q) => a[q] * w + b[q] * u + c[q] * v)); }
    if (M) out.mask.push(M[T.i0] * w + M[T.i1] * u + M[T.i2] * v);
    if (out.attrs) for (const a in out.attrs) { const A = g.attrs[a]; out.attrs[a].push(A[T.i0] * w + A[T.i1] * u + A[T.i2] * v); }
  }
  return out;
}

function copyToPoints(src, tpl, o) {
  const out = new Geo();
  if (!src || !tpl) return out;
  const r = mulberry32((o.seed | 0) * 7919 + 3);
  for (let i = 0; i < tpl.P.length; i++) {
    let M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const up = o.align && tpl.N && tpl.N[i] ? V.norm(tpl.N[i]) : [0, 1, 0];
    if (o.align && tpl.N && tpl.N[i]) M = alignY(up);
    const yaw = (r() * 2 - 1) * Math.PI * o.randRot;
    if (yaw) M = mulMM(axisAngle(up, yaw), M);
    const s = o.scale * (tpl.pscale ? tpl.pscale[i] : 1) * (1 + (r() * 2 - 1) * o.randScale);
    const c = src.clone();
    c.P = c.P.map((p) => V.add(mulM(M, V.mul(p, s)), tpl.P[i]));
    if (o.useColor && tpl.Cd) c.Cd = c.P.map(() => tpl.Cd[i].slice());
    c.N = null;
    out.append(c);
  }
  return out;
}

// ---------- wrangle compile ----------
const HELPERS = {
  noise: noise3, fbm, rand, fit, clamp, mix, lerp: mix,
  vec: (x, y, z) => ({ x, y: y ?? x, z: z ?? x }),
  length: (v) => Math.hypot(v.x, v.y, v.z),
  normalize: (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; },
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  smooth: (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); },
};
const HELPER_NAMES = Object.keys(HELPERS);
const MATH_NAMES = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'abs', 'sqrt', 'pow', 'floor', 'ceil', 'round', 'min', 'max', 'exp', 'log', 'sign', 'PI'];
const compileCache = new Map();
function compileSnippet(code) {
  if (compileCache.has(code)) return compileCache.get(code);
  const body = code.replace(/@(\w+)/g, '$$.$1');
  const fn = new Function('$', ...HELPER_NAMES, ...MATH_NAMES, body);
  const run = ($) => fn($, ...HELPER_NAMES.map((k) => HELPERS[k]), ...MATH_NAMES.map((k) => Math[k]));
  compileCache.set(code, run);
  return run;
}
const toVec = (a) => ({ x: a[0], y: a[1], z: a[2] });
const fromVec = (v) => (Array.isArray(v) ? [+v[0] || 0, +(v[1] ?? v[0]) || 0, +(v[2] ?? v[0]) || 0] : typeof v === 'number' ? [v, v, v] : [+v.x || 0, +v.y || 0, +v.z || 0]);

function pointWrangle(g, code, ctx) {
  const run = compileSnippet(code);
  computeNormals(g);
  const wantsCd = /@Cd\b/.test(code), wantsPs = /@pscale\b/.test(code), wantsM = /@mask\b/.test(code);
  const BUILTIN = new Set(['P', 'N', 'Cd', 'pscale', 'mask', 'ptnum', 'numpt', 'Time', 'Frame', 'dead']);
  const custom = [...new Set([...code.matchAll(/@(\w+)/g)].map((m) => m[1]))].filter((k) => !BUILTIN.has(k));
  if (custom.length) { g.attrs = g.attrs || {}; for (const k of custom) if (!g.attrs[k]) g.attrs[k] = g.P.map(() => attrDef(k)); }
  if (wantsM && !g.mask) g.mask = g.P.map(() => 0);
  if (wantsCd && !g.Cd) g.Cd = g.P.map(() => [0.8, 0.8, 0.8]);
  if (wantsPs && !g.pscale) g.pscale = g.P.map(() => 1);
  const n = g.P.length, kill = [];
  for (let i = 0; i < n; i++) {
    const $ = { P: toVec(g.P[i]), N: toVec(g.N[i]), ptnum: i, numpt: n, Time: ctx.time, Frame: ctx.frame };
    if (g.Cd) $.Cd = toVec(g.Cd[i]);
    if (g.pscale) $.pscale = g.pscale[i];
    if (g.mask) $.mask = g.mask[i];
    for (const k of custom) $[k] = g.attrs[k][i];
    run($);
    g.P[i] = fromVec($.P);
    g.N[i] = fromVec($.N);
    if (g.Cd) g.Cd[i] = fromVec($.Cd);
    if (g.pscale) g.pscale[i] = +$.pscale;
    if (g.mask) g.mask[i] = clamp(+$.mask || 0, 0, 1);
    for (const k of custom) g.attrs[k][i] = +$[k] || 0;
    if ($.dead) kill.push(i);
  }
  return g;
}

function deletePrims(g, expr, invert, ctx) {
  const run = compileSnippet('return (' + expr + ');');
  const n = g.prims.length;
  const keep = g.prims.map((f, i) => {
    const c = centroid(g.P, f), nn = faceNormal(g.P, f);
    const $ = { P: toVec(c), N: toVec(nn), primnum: i, numprim: n, Time: ctx.time, Frame: ctx.frame };
    const hit = !!run($);
    return invert ? hit : !hit;
  });
  g.prims = g.prims.filter((_, i) => keep[i]);
  if (g.primMat) g.primMat = g.primMat.filter((_, i) => keep[i]);
  if (g.piece) g.piece = g.piece.filter((_, i) => keep[i]);
  return compact(g);
}

// ---------- particle simulation ----------
// ---------- generic cached simulation driver ----------
function cloneGeneric(st) {
  const o = { ...st };
  o.parts = st.parts.map((q) => { const c = {}; for (const k in q) { const v = q[k]; c[k] = Array.isArray(v) ? v.map((x) => (Array.isArray(x) ? x.slice() : x)) : ArrayBuffer.isView(v) ? v.slice() : v; } return c; });
  return o;
}
function simCook(p, ctx, step, out) {
  const C = ctx.cooker, fps = ctx.fps || 24, f = Math.max(0, ctx.frame | 0);
  const src1 = ctx.inputAt(0, 1);
  if (!src1) throw new Error('Missing input — connect an emitter / source geometry');
  const col1 = ctx.inputAt(1, 1);
  const key = hashStr(ctx.node.type + JSON.stringify(ctx.node.params) + '|' + src1.__sig + '|' + (col1 ? col1.__sig : '-') + '|' + fps);
  let sim = C.sims.get(ctx.nodeId);
  const fresh = () => ({ next: 0, parts: [] });
  if (!sim || sim.key !== key) { sim = { key, last: { frame: 0, state: fresh() }, cps: new Map([[0, fresh()]]) }; C.sims.set(ctx.nodeId, sim); }
  let from, st;
  if (sim.last.frame <= f) { from = sim.last.frame; st = sim.last.state; }
  else { from = 0; for (const k of sim.cps.keys()) if (k <= f && k > from) from = k; st = cloneGeneric(sim.cps.get(from)); }
  for (let fr = from + 1; fr <= f; fr++) {
    const pf = evalParams(ctx.node, { frame: fr, time: (fr - 1) / fps });
    const col = ctx.node.inputs[1] ? buildCollider(ctx.inputAt(1, fr)) : null;
    step(st, fr, pf, ctx.inputAt(0, fr), col, fps);
    if (fr % 10 === 0 && !sim.cps.has(fr)) sim.cps.set(fr, cloneGeneric(st));
  }
  sim.last = { frame: f, state: st };
  return out(st, p, fps);
}

// ---------- triangle collider with spatial hash ----------
const colliderCache = new WeakMap();
const hkey = (i, j, k) => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);
function buildCollider(g) {
  if (!g || !g.prims.length) return null;
  if (colliderCache.has(g)) return colliderCache.get(g);
  const tris = [];
  let edge = 0;
  for (const f of g.prims) for (let i = 1; i + 1 < f.length; i++) {
    const a = g.P[f[0]], b = g.P[f[i]], c = g.P[f[i + 1]];
    const n = V.cross(V.sub(b, a), V.sub(c, a)); const l = V.len(n); if (l < 1e-12) continue;
    tris.push({ a, b, c, n: V.mul(n, 1 / l) });
    edge += V.len(V.sub(b, a)) + V.len(V.sub(c, a));
  }
  const cs = Math.max(0.02, (edge / Math.max(1, tris.length * 2)) * 1.5);
  const grid = new Map();
  tris.forEach((t, ti) => {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(t.a[k], t.b[k], t.c[k]) / cs)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(t.a[k], t.b[k], t.c[k]) / cs));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      const key = hkey(i, j, k); let arr = grid.get(key); if (!arr) grid.set(key, (arr = [])); arr.push(ti);
    }
  });
  const col = { tris, grid, cs, stamp: new Uint32Array(tris.length), tick: 1 };
  colliderCache.set(g, col);
  return col;
}
function pointInTri(p, t) {
  const v0 = V.sub(t.c, t.a), v1 = V.sub(t.b, t.a), v2 = V.sub(p, t.a);
  const d00 = V.dot(v0, v0), d01 = V.dot(v0, v1), d02 = V.dot(v0, v2), d11 = V.dot(v1, v1), d12 = V.dot(v1, v2);
  const inv = 1 / (d00 * d11 - d01 * d01 || 1e-12), u = (d11 * d02 - d01 * d12) * inv, v = (d00 * d12 - d01 * d02) * inv;
  return u >= -1e-4 && v >= -1e-4 && u + v <= 1.0001;
}
// moves particle from p0 to p1 (both arrays); returns corrected p1 and modifies v. r = particle radius
function collide(col, p0, p1, v, r, bounce, friction) {
  if (!col) return p1;
  // resolve repeatedly so corners (floor meets wall) can't push a particle through the second surface
  for (let pass = 0; pass < 4; pass++) { const q = collideOnce(col, p0, p1, v, r, bounce, friction); if (q === p1) return p1; p1 = q; }
  return p1;
}
function collideOnce(col, p0, p1, v, r, bounce, friction) {
  const cs = col.cs, tick = ++col.tick;
  const lo = [0, 1, 2].map((k) => Math.floor((Math.min(p0[k], p1[k]) - r) / cs)), hi = [0, 1, 2].map((k) => Math.floor((Math.max(p0[k], p1[k]) + r) / cs));
  if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 64) return p1; // runaway particle; skip
  let best = null, bestT = Infinity;
  for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
    const arr = col.grid.get(hkey(i, j, k)); if (!arr) continue;
    for (const ti of arr) {
      if (col.stamp[ti] === tick) continue; col.stamp[ti] = tick;
      const t = col.tris[ti];
      const d0 = V.dot(t.n, V.sub(p0, t.a)), d1 = V.dot(t.n, V.sub(p1, t.a));
      const s = d0 >= 0 ? 1 : -1, a0 = d0 * s - r, a1 = d1 * s - r;
      if (a1 >= 0) continue;
      const tt = a0 > 0 ? a0 / (a0 - a1) : 0;
      const h = V.lerp(p0, p1, tt), hp = V.sub(h, V.mul(t.n, V.dot(t.n, V.sub(h, t.a))));
      if (!pointInTri(hp, t)) continue;
      if (tt < bestT) { bestT = tt; best = { ns: V.mul(t.n, s), a1 }; }
    }
  }
  if (!best) return p1;
  const ns = best.ns, out = V.sub(p1, V.mul(ns, best.a1));
  const vn = V.dot(v, ns);
  if (vn < 0) {
    const vt = V.sub(v, V.mul(ns, vn));
    const nv = V.add(V.mul(vt, 1 - friction), V.mul(ns, -vn * bounce));
    v[0] = nv[0]; v[1] = nv[1]; v[2] = nv[2];
  }
  return out;
}
function insideMesh(tris, p) {
  // parity test along a slightly skewed +X ray
  const d = V.norm([1, 0.01237, 0.00731]);
  let hits = 0;
  for (const t of tris) {
    const e1 = V.sub(t.b, t.a), e2 = V.sub(t.c, t.a), h = V.cross(d, e2), a = V.dot(e1, h);
    if (Math.abs(a) < 1e-12) continue;
    const f = 1 / a, s = V.sub(p, t.a), u = f * V.dot(s, h); if (u < 0 || u > 1) continue;
    const q = V.cross(s, e1), v = f * V.dot(d, q); if (v < 0 || u + v > 1) continue;
    if (f * V.dot(e2, q) > 1e-9) hits++;
  }
  return hits % 2 === 1;
}
function fillVolume(src, sep, max, seed) {
  const bb = src.bbox(), out = [], r = mulberry32(seed * 313 + 5);
  const col = src.prims.length ? buildCollider(src) : null;
  const closed = col && (() => { const e = new Map(); for (const f of src.prims) for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length], k = a < b ? a + '_' + b : b + '_' + a; e.set(k, (e.get(k) || 0) + 1); } for (const c of e.values()) if (c !== 2) return false; return true; })();
  for (let x = bb.min[0] + sep / 2; x < bb.max[0]; x += sep) for (let y = bb.min[1] + sep / 2; y < bb.max[1]; y += sep) for (let z = bb.min[2] + sep / 2; z < bb.max[2]; z += sep) {
    if (out.length >= max) return out;
    const p = [x + (r() - 0.5) * sep * 0.1, y + (r() - 0.5) * sep * 0.1, z + (r() - 0.5) * sep * 0.1];
    if (closed && !insideMesh(col.tris, p)) continue;
    out.push(p);
  }
  return out;
}
// shared emission: returns [{p, n}] born this frame
function emitFrom(src, n, seed, fr) {
  if (!src || !src.P.length || n <= 0) return [];
  if (src.prims.length) { const s = scatter(src, n, seed * 100003 + fr); return s.P.map((p, i) => ({ p, n: s.N[i] })); }
  const r = mulberry32(seed * 7777 + fr * 31), out = [];
  for (let k = 0; k < n; k++) { const i = Math.floor(r() * src.P.length); out.push({ p: src.P[i].slice(), n: src.N && src.N[i] ? src.N[i].slice() : [0, 1, 0] }); }
  return out;
}
function birthCount(p, fr, fps) {
  let n = Math.floor(fr * p.rate / fps) - Math.floor((fr - 1) * p.rate / fps);
  if (fr === 1 && p.burst) n += Math.max(0, p.burst | 0);
  return n;
}
function curlNoise(x, y, z, t) {
  const e = 0.1;
  const P1 = (a, b, c) => noise3(a, b, c + t), P2 = (a, b, c) => noise3(a + 31.4, b - 7.1, c + t), P3 = (a, b, c) => noise3(a - 12.3, b + 17.7, c + t);
  const dP3dy = (P3(x, y + e, z) - P3(x, y - e, z)), dP2dz = (P2(x, y, z + e) - P2(x, y, z - e));
  const dP1dz = (P1(x, y, z + e) - P1(x, y, z - e)), dP3dx = (P3(x + e, y, z) - P3(x - e, y, z));
  const dP2dx = (P2(x + e, y, z) - P2(x - e, y, z)), dP1dy = (P1(x, y + e, z) - P1(x, y - e, z));
  const k = 1 / (2 * e);
  return [(dP3dy - dP2dz) * k, (dP1dz - dP3dx) * k, (dP2dx - dP1dy) * k];
}
function confine(q, x, r, p) {
  if (p.ground && x[1] < p.groundY + r) { x[1] = p.groundY + r; if (q.v[1] < 0) q.v[1] *= -(p.bounce ?? 0); }
  if (p.bounds) {
    for (let k = 0; k < 3; k++) {
      const lo = p.bcenter[k] - p.bsize[k] / 2 + r, hi = p.bcenter[k] + p.bsize[k] / 2 - r;
      if (x[k] < lo) { x[k] = lo; if (q.v[k] < 0) q.v[k] = 0; } else if (x[k] > hi) { x[k] = hi; if (q.v[k] > 0) q.v[k] = 0; }
    }
  }
}
// neighbour lists via spatial hash
function neighbourLists(X, h) {
  const grid = new Map(), cell = X.map((x) => [Math.floor(x[0] / h), Math.floor(x[1] / h), Math.floor(x[2] / h)]);
  cell.forEach((c, i) => { const k = hkey(c[0], c[1], c[2]); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i); });
  const h2 = h * h, nb = new Array(X.length);
  for (let i = 0; i < X.length; i++) {
    const c = cell[i], xi = X[i], list = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
      const arr = grid.get(hkey(c[0] + a, c[1] + b, c[2] + d)); if (!arr) continue;
      for (const j of arr) { if (j === i) continue; const dx = xi[0] - X[j][0], dy = xi[1] - X[j][1], dz = xi[2] - X[j][2]; if (dx * dx + dy * dy + dz * dz < h2) list.push(j); }
    }
    nb[i] = list;
  }
  return nb;
}

// ---------- generic particles ----------
function stepParticles(st, fr, p, src, col, fps) {
  const dt = 1 / fps, t = (fr - 1) / fps;
  const n = Math.max(0, Math.min(birthCount(p, fr, fps), (p.maxCount | 0) - st.parts.length));
  for (const e of emitFrom(src, n, p.seed | 0, fr)) {
    const id = st.next++, r = mulberry32(id * 7 + (p.seed | 0) * 131 + 1);
    const life = Math.max(0.02, p.life * (1 + (r() * 2 - 1) * p.lifeVar));
    const v = V.add(V.add(V.mul(e.n, p.speed), p.vel), V.mul(V.norm([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]), p.spread * r()));
    const sub = r() * dt;
    st.parts.push({ id, p: V.add(e.p, V.mul(v, sub)), v, age: sub, life });
  }
  const ts = 1 / Math.max(0.01, p.turbSize), drag = Math.max(0, 1 - p.drag * dt), out = [];
  for (const q of st.parts) {
    let a = V.add(p.gravity, V.mul(V.sub(p.wind, q.v), Math.min(1, p.drag)));
    if (p.turb) a = V.add(a, V.mul([noise3(q.p[0] * ts, q.p[1] * ts, q.p[2] * ts + t * 0.6), noise3(q.p[0] * ts + 31.4, q.p[1] * ts - 7.1, q.p[2] * ts + t * 0.6), noise3(q.p[0] * ts - 12.3, q.p[1] * ts + 17.7, q.p[2] * ts + t * 0.6)], p.turb));
    q.v = V.mul(V.add(q.v, V.mul(a, dt)), drag);
    let np = V.add(q.p, V.mul(q.v, dt));
    np = collide(col, q.p, np, q.v, 0.01, p.bounce, p.friction);
    if (p.ground && np[1] < p.groundY) { np[1] = p.groundY; if (q.v[1] < 0) q.v[1] = -q.v[1] * p.bounce; q.v[0] *= 1 - p.friction; q.v[2] *= 1 - p.friction; }
    q.p = np; q.age += dt;
    if (q.age < q.life) out.push(q);
  }
  st.parts = out;
}
function particlesToGeo(st, p) {
  const g = new Geo(), A = hex2rgb(p.c1), B = hex2rgb(p.c2);
  g.Cd = []; g.N = []; g.pscale = [];
  for (const q of st.parts) {
    const t = clamp(q.age / q.life, 0, 1), c = V.lerp(A, B, t), sc = p.size * (p.shrink ? 1 - t * 0.85 : 1);
    const dir = V.len(q.v) > 1e-6 ? V.norm(q.v) : [0, 1, 0];
    if (p.look === 'streaks') {
      const i = g.P.length;
      g.P.push(V.sub(q.p, V.mul(q.v, p.streak)), q.p.slice()); g.Cd.push(V.lerp(c, [0, 0, 0], 0.6), c); g.N.push(dir, dir.slice()); g.pscale.push(sc, sc);
      g.lines.push([i, i + 1]);
    } else { g.P.push(q.p.slice()); g.Cd.push(c); g.N.push(dir); g.pscale.push(sc); }
  }
  return g;
}

// ---------- FIRE: buoyant, cooling flame particles that turn into smoke ----------
const FIRE_RAMP = [[0, [0.08, 0.03, 0.02]], [0.18, [0.5, 0.08, 0.02]], [0.45, [0.95, 0.33, 0.05]], [0.75, [1, 0.7, 0.22]], [1, [1, 0.95, 0.78]]];
function fireRamp(t) {
  for (let i = 1; i < FIRE_RAMP.length; i++) if (t <= FIRE_RAMP[i][0]) { const [a, ca] = FIRE_RAMP[i - 1], [b, cb] = FIRE_RAMP[i]; return V.lerp(ca, cb, (t - a) / (b - a)); }
  return FIRE_RAMP[FIRE_RAMP.length - 1][1].slice();
}
function stepFire(st, fr, p, src, col, fps) {
  const dt = 1 / fps, t = (fr - 1) / fps;
  const n = Math.max(0, Math.min(birthCount(p, fr, fps), (p.maxCount | 0) - st.parts.length));
  for (const e of emitFrom(src, n, p.seed | 0, fr)) {
    const id = st.next++, r = mulberry32(id * 13 + (p.seed | 0) * 977 + 3);
    const life = Math.max(0.05, p.life * (1 + (r() * 2 - 1) * p.lifeVar));
    const v = V.add(V.add(V.mul(e.n, p.speed), p.vel), V.mul(V.norm([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]), p.spread * r()));
    st.parts.push({ id, p: e.p, v, age: r() * dt, life, slife: p.smoke ? p.smokeLife * (0.6 + 0.8 * r()) : 0, seedv: r() });
  }
  const ts = 1 / Math.max(0.02, p.turbSize), out = [];
  for (const q of st.parts) {
    const flame = q.age < q.life, temp = flame ? 1 - q.age / q.life : 0;
    const lift = flame ? p.buoyancy * (0.35 + 0.65 * temp) : p.buoyancy * p.smokeBuoy;
    let a = V.add([0, lift, 0], V.mul(V.sub(p.wind, q.v), p.drag));
    const cn = curlNoise(q.p[0] * ts, q.p[1] * ts, q.p[2] * ts, t * p.turbSpeed);
    a = V.add(a, V.mul(cn, p.turb * (flame ? 0.6 + 0.8 * (1 - temp) : 0.7)));
    q.v = V.add(q.v, V.mul(a, dt));
    let np = V.add(q.p, V.mul(q.v, dt));
    np = collide(col, q.p, np, q.v, 0.02, 0.1, 0.3);
    if (p.ground && np[1] < p.groundY) { np[1] = p.groundY; if (q.v[1] < 0) q.v[1] = 0; }
    q.p = np; q.age += dt;
    if (q.age < q.life + q.slife) out.push(q);
  }
  st.parts = out;
}
function fireToGeo(st, p) {
  const g = new Geo(), smokeC = hex2rgb(p.smokeColor), tint = hex2rgb(p.tint);
  g.Cd = []; g.N = []; g.pscale = []; g.alpha = [];
  for (const q of st.parts) {
    g.P.push(q.p.slice()); g.N.push(V.len(q.v) > 1e-6 ? V.norm(q.v) : [0, 1, 0]);
    if (q.age < q.life) {
      const temp = 1 - q.age / q.life, c = fireRamp(temp);
      g.Cd.push([c[0] * tint[0], c[1] * tint[1], c[2] * tint[2]]);
      g.pscale.push((0.55 + 0.9 * Math.sin(Math.PI * Math.min(1, (1 - temp) * 1.2 + 0.15))) * (0.8 + 0.4 * q.seedv));
      g.alpha.push(0);
    } else {
      const s = (q.age - q.life) / q.slife, fadeIn = Math.min(1, s * 6);
      g.Cd.push(smokeC.slice());
      g.pscale.push((1.2 + 2.2 * s) * (0.8 + 0.4 * q.seedv));
      g.alpha.push(p.smokeDensity * fadeIn * (1 - s) * (1 - s));
    }
  }
  g.sprite = { mode: 'glow', size: p.flameSize, gain: p.intensity };
  return g;
}

// ---------- WATER: position-based fluid (density-constraint) solver ----------
function waterRest(sep, h) {
  const K = 315 / (64 * Math.PI * Math.pow(h, 9)); let rho = 0; const n = Math.ceil(h / sep);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) { const r2 = (i * i + j * j + k * k) * sep * sep; if (r2 < h * h) rho += K * Math.pow(h * h - r2, 3); }
  return rho;
}
function seedParticles(st, p, src, fr, fps, mkVel) {
  const out = [];
  if ((p.mode === 'fill' || p.mode === 'both') && fr === 1) for (const x of fillVolume(src, p.sep, p.maxCount | 0, p.seed | 0)) out.push({ p: x, v: p.vel.slice() });
  if (p.mode === 'emit' || p.mode === 'both') {
    const n = Math.max(0, Math.min(birthCount(p, fr, fps), (p.maxCount | 0) - st.parts.length - out.length));
    const recent = st.parts.filter((q) => q.age < 0.6).map((q) => q.p), md2 = p.sep * p.sep;
    for (const e of emitFrom(src, n * 3, p.seed | 0, fr)) {
      if (out.length >= n) break;
      let ok = true;
      for (const q of recent) { const dx = q[0] - e.p[0], dy = q[1] - e.p[1], dz = q[2] - e.p[2]; if (dx * dx + dy * dy + dz * dz < md2) { ok = false; break; } }
      if (!ok) continue;
      const v = mkVel(e), vl = V.len(v), jr = rand(st.next * 0.731 + fr * 1.913 + out.length * 0.37);
      const pos = vl > 1e-6 ? V.add(e.p, V.mul(v, (jr * Math.max(vl / fps, p.sep * 2.5)) / vl)) : e.p;
      recent.push(pos); out.push({ p: pos, v });
    }
  }
  for (const o of out) { if (st.parts.length >= (p.maxCount | 0)) break; const id = st.next++; st.parts.push({ id, p: o.p, v: o.v, age: 0, shade: rand(id * 1.37 + 0.5) }); }
}
function stepWater(st, fr, p, src, col, fps) {
  const sep = Math.max(0.01, p.sep);
  seedParticles(st, p, src, fr, fps, (e) => { const r = mulberry32(st.next * 31 + 7); return V.add(V.add(V.mul(e.n, p.speed), p.vel), V.mul([r() - 0.5, r() - 0.5, r() - 0.5], 2 * p.spread)); });
  const P = st.parts, N = P.length; if (!N) return;
  const h = sep * 2.1, h2 = h * h, sub = Math.max(1, p.substeps | 0), dt = 1 / fps / sub;
  const K6 = 315 / (64 * Math.PI * Math.pow(h, 9)), KS = -45 / (Math.PI * Math.pow(h, 6));
  const rho0 = st.rho0 && st.rhoSep === sep ? st.rho0 : (st.rho0 = waterRest(sep, h), st.rhoSep = sep, st.rho0);
  const r = sep * 0.5, relax = Math.max(1e-6, p.relax ?? 1e-3);
  const lam = new Float64Array(N), maxV = 25;
  for (let s = 0; s < sub; s++) {
    const X = P.map((q) => { q.v = V.add(q.v, V.mul(p.gravity, dt)); return V.add(q.p, V.mul(q.v, dt)); });
    const nb = neighbourLists(X, h);
    for (let it = 0; it < Math.max(1, p.iterations | 0); it++) {
      for (let i = 0; i < N; i++) {
        let rho = K6 * h2 * h2 * h2, gx = 0, gy = 0, gz = 0, gs = 0;
        const xi = X[i];
        for (const j of nb[i]) {
          const dx = xi[0] - X[j][0], dy = xi[1] - X[j][1], dz = xi[2] - X[j][2], r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= h2) continue;
          const d = h2 - r2; rho += K6 * d * d * d;
          const rr = Math.sqrt(r2) || 1e-9, w = (KS * (h - rr) * (h - rr)) / rr / rho0;
          gx += w * dx; gy += w * dy; gz += w * dz; gs += w * w * r2;
        }
        const C = Math.max(0, rho / rho0 - 1);
        lam[i] = -C / (gs + gx * gx + gy * gy + gz * gz + relax);
      }
      for (let i = 0; i < N; i++) {
        let mx = 0, my = 0, mz = 0; const xi = X[i];
        for (const j of nb[i]) {
          const dx = xi[0] - X[j][0], dy = xi[1] - X[j][1], dz = xi[2] - X[j][2], r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= h2) continue;
          const rr = Math.sqrt(r2) || 1e-9, w = ((lam[i] + lam[j]) * KS * (h - rr) * (h - rr)) / rr / rho0;
          mx += w * dx; my += w * dy; mz += w * dz;
        }
        xi[0] += mx; xi[1] += my; xi[2] += mz;
      }
      for (let i = 0; i < N; i++) { if (col) X[i] = collide(col, P[i].p, X[i], [0, 0, 0], r, 0, 0); confine(P[i], X[i], r, p); }
    }
    for (let i = 0; i < N; i++) {
      const q = P[i];
      let x = collide(col, q.p, X[i], q.v, r, 0, 0.02);
      confine(q, x, r, p);
      let v = V.mul(V.sub(x, q.p), 1 / dt);
      const sp = V.len(v); if (sp > maxV) v = V.mul(v, maxV / sp);
      q.nv = v; q.p = x;
    }
    // XSPH viscosity
    for (let i = 0; i < N; i++) {
      const q = P[i]; let ax = 0, ay = 0, az = 0, ws = 0;
      for (const j of nb[i]) {
        const dx = q.p[0] - P[j].p[0], dy = q.p[1] - P[j].p[1], dz = q.p[2] - P[j].p[2], r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= h2) continue;
        const d = h2 - r2, w = d * d * d; ws += w;
        ax += (P[j].nv[0] - q.nv[0]) * w; ay += (P[j].nv[1] - q.nv[1]) * w; az += (P[j].nv[2] - q.nv[2]) * w;
      }
      const c = ws > 0 ? Math.min(1, p.viscosity) / ws * Math.min(1, ws / (h2 * h2 * h2 * 4)) : 0;
      q.v = [q.nv[0] + ax * c, q.nv[1] + ay * c, q.nv[2] + az * c];
    }
    for (const q of P) delete q.nv;
  }
  for (const q of P) q.age += 1 / fps;
  if (p.life > 0) st.parts = P.filter((q) => q.age < p.life);
}
function waterToGeo(st, p) {
  const g = new Geo(), deep = hex2rgb(p.c1), foam = hex2rgb(p.c2);
  g.Cd = []; g.N = []; g.pscale = [];
  for (const q of st.parts) {
    const sp = V.len(q.v), t = clamp(sp / Math.max(0.01, p.foamSpeed), 0, 1);
    const c = V.lerp(deep, foam, t * t); const k = 0.92 + 0.16 * q.shade;
    g.P.push(q.p.slice()); g.Cd.push(c.map((x) => Math.min(1, x * k))); g.N.push(sp > 1e-6 ? V.mul(q.v, 1 / sp) : [0, 1, 0]); g.pscale.push(1);
  }
  g.v = st.parts.map((q) => q.v.slice());
  g.sprite = { mode: 'ball', size: p.sep * 1.15, spec: 0.75 };
  return g;
}

// ---------- SAND: granular contacts with static/kinetic friction ----------
function stepSand(st, fr, p, src, col, fps) {
  const rad = Math.max(0.004, p.grain), d = rad * 2, d2 = d * d;
  const pp = { ...p, sep: d };
  seedParticles(st, pp, src, fr, fps, (e) => { const r = mulberry32(st.next * 17 + 3); return V.add(V.add(V.mul(e.n, p.speed), p.vel), V.mul([r() - 0.5, r() - 0.5, r() - 0.5], 2 * p.spread)); });
  const P = st.parts, N = P.length; if (!N) return;
  const sub = Math.max(1, p.substeps | 0), dt = 1 / fps / sub, mus = p.friction * 1.2, muk = p.friction;
  for (let s = 0; s < sub; s++) {
    const X = P.map((q) => { q.v = V.mul(V.add(q.v, V.mul(p.gravity, dt)), 1 - p.damping * dt); return V.add(q.p, V.mul(q.v, dt)); });
    const VP = P.map((q) => q.v.slice());
    for (let i = 0; i < N; i++) { X[i] = collide(col, P[i].p, X[i], P[i].v, rad, 0, p.friction); confine(P[i], X[i], rad, { ...p, bounce: 0 }); }
    const nb = neighbourLists(X, d);
    // inverse-mass weights: settled grains and grains lower in a stack act heavier (shock propagation)
    const W = P.map((q) => (q.rest > 3 ? 0.15 : 1));
    for (let it = 0; it < Math.max(1, p.iterations | 0); it++) {
      for (let i = 0; i < N; i++) for (const j of nb[i]) {
        if (j < i) continue;
        const xi = X[i], xj = X[j];
        const dx = xi[0] - xj[0], dy = xi[1] - xj[1], dz = xi[2] - xj[2], r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= d2 || r2 < 1e-14) continue;
        const dist = Math.sqrt(r2), nx = dx / dist, ny = dy / dist, nz = dz / dist, ov = d - dist;
        let wi = W[i] * (ny > 0.3 ? 1 : ny < -0.3 ? 0.3 : 1), wj = W[j] * (ny < -0.3 ? 1 : ny > 0.3 ? 0.3 : 1);
        const ws = wi + wj, ci = wi / ws, cj = wj / ws;
        xi[0] += nx * ov * ci; xi[1] += ny * ov * ci; xi[2] += nz * ov * ci;
        xj[0] -= nx * ov * cj; xj[1] -= ny * ov * cj; xj[2] -= nz * ov * cj;
        // friction on relative tangential displacement
        const pi = P[i].p, pj = P[j].p;
        const rx = (xi[0] - pi[0]) - (xj[0] - pj[0]), ry = (xi[1] - pi[1]) - (xj[1] - pj[1]), rz = (xi[2] - pi[2]) - (xj[2] - pj[2]);
        const rn = rx * nx + ry * ny + rz * nz, tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz, tl = Math.hypot(tx, ty, tz);
        if (tl > 1e-12) {
          const k = tl < mus * ov ? 1 : Math.min(1, (muk * ov) / tl);
          xi[0] -= tx * k * ci; xi[1] -= ty * k * ci; xi[2] -= tz * k * ci;
          xj[0] += tx * k * cj; xj[1] += ty * k * cj; xj[2] += tz * k * cj;
        }
      }
      for (let i = 0; i < N; i++) confine(P[i], X[i], rad, { ...p, bounce: 0 });
    }
    for (let i = 0; i < N; i++) {
      const q = P[i], x = X[i];
      // ground friction
      if (p.ground && x[1] <= p.groundY + rad + 1e-5) { const k = 1 - Math.min(1, p.friction * 1.5); x[0] = q.p[0] + (x[0] - q.p[0]) * k; x[2] = q.p[2] + (x[2] - q.p[2]) * k; }
      let v = V.mul(V.sub(x, q.p), 1 / dt);
      const dv = V.sub(v, VP[i]), dl = V.len(dv), cap = 1.2;
      if (dl > cap) v = V.add(VP[i], V.mul(dv, cap / dl));
      if (v[1] > 0 && VP[i][1] <= 0) v[1] = Math.min(v[1], 0.4);
      const sp = V.len(v);
      q.rest = sp < p.sleep * 3 ? (q.rest || 0) + 1 : 0;
      if (sp < p.sleep) v = [0, 0, 0], x[0] = q.p[0], x[2] = q.p[2], x[1] = Math.min(x[1], q.p[1]);
      q.v = v; q.p = x;
    }
  }
}
function sandToGeo(st, p) {
  const g = new Geo(), A = hex2rgb(p.c1), B = hex2rgb(p.c2);
  g.Cd = []; g.N = []; g.pscale = [];
  for (const q of st.parts) {
    g.P.push(q.p.slice()); g.Cd.push(V.lerp(A, B, q.shade)); g.N.push([0, 1, 0]); g.pscale.push(0.85 + 0.3 * rand(q.id * 0.77));
  }
  g.sprite = { mode: 'ball', size: p.grain * 2, spec: 0.08 };
  return g;
}

// ---------- FLUID SURFACE: density splat + surface nets + Taubin smoothing ----------
const CUBE_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
function taubin(g, iters) {
  const nb = Array.from({ length: g.P.length }, () => new Set());
  for (const f of g.prims) for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; nb[a].add(b); nb[b].add(a); }
  const nbA = nb.map((s) => [...s]);
  let P = g.P;
  const pass = (lam) => {
    P = P.map((p, i) => {
      const n = nbA[i]; if (!n.length) return p;
      let x = 0, y = 0, z = 0; for (const j of n) { x += P[j][0]; y += P[j][1]; z += P[j][2]; }
      const k = 1 / n.length;
      return [p[0] + lam * (x * k - p[0]), p[1] + lam * (y * k - p[1]), p[2] + lam * (z * k - p[2])];
    });
  };
  for (let i = 0; i < iters; i++) { pass(0.5); pass(-0.53); }
  g.P = P;
}
function fluidSurface(src, p) {
  const out = new Geo();
  const pts = src.P; if (!pts.length) return out;
  const R = Math.max(1e-3, p.radius * 2), R2 = R * R;
  const bb = src.bbox();
  let vs = Math.max(0.005, p.voxel);
  const span = [0, 1, 2].map((k) => bb.max[k] - bb.min[k] + 2 * R + 4 * vs);
  while (span[0] * span[1] * span[2] / (vs * vs * vs) > 4e6) vs *= 1.25; // memory guard
  const o = [0, 1, 2].map((k) => bb.min[k] - R - 2 * vs);
  const nx = Math.ceil(span[0] / vs) + 1, ny = Math.ceil(span[1] / vs) + 1, nz = Math.ceil(span[2] / vs) + 1;
  const sxy = nx * ny, F = new Float32Array(nx * ny * nz);
  const useCol = p.colorMode === 'particles' && src.Cd;
  const CR = useCol ? new Float32Array(F.length) : null, CG = useCol ? new Float32Array(F.length) : null, CB = useCol ? new Float32Array(F.length) : null;
  const rv = Math.ceil(R / vs);
  for (let n = 0; n < pts.length; n++) {
    const q = pts[n], s = src.pscale ? src.pscale[n] : 1;
    const ci = Math.round((q[0] - o[0]) / vs), cj = Math.round((q[1] - o[1]) / vs), ck = Math.round((q[2] - o[2]) / vs);
    for (let k = Math.max(0, ck - rv); k <= Math.min(nz - 1, ck + rv); k++) {
      const dz = o[2] + k * vs - q[2];
      for (let j = Math.max(0, cj - rv); j <= Math.min(ny - 1, cj + rv); j++) {
        const dy = o[1] + j * vs - q[1], dyz = dy * dy + dz * dz; if (dyz >= R2) continue;
        for (let i = Math.max(0, ci - rv); i <= Math.min(nx - 1, ci + rv); i++) {
          const dx = o[0] + i * vs - q[0], d2 = dx * dx + dyz; if (d2 >= R2) continue;
          const t = 1 - d2 / R2, w = t * t * t * s, idx = i + j * nx + k * sxy;
          F[idx] += w;
          if (useCol) { const c = src.Cd[n]; CR[idx] += w * c[0]; CG[idx] += w * c[1]; CB[idx] += w * c[2]; }
        }
      }
    }
  }
  const iso = p.iso, cx = nx - 1, cy = ny - 1, cxy = cx * cy;
  const cellV = new Int32Array(cx * cy * (nz - 1)).fill(-1);
  const tint = hex2rgb(p.color), cols = [];
  const corner = new Float32Array(8), cidx = new Int32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const idx = (i + (c & 1)) + (j + ((c >> 1) & 1)) * nx + (k + ((c >> 2) & 1)) * sxy;
      cidx[c] = idx; corner[c] = F[idx]; if (F[idx] > iso) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let x = 0, y = 0, z = 0, m = 0, r = 0, gr = 0, b = 0;
    for (const [a, e] of CUBE_EDGES) {
      const va = corner[a], ve = corner[e];
      if ((va > iso) === (ve > iso)) continue;
      const t = (iso - va) / (ve - va);
      x += (a & 1) + (((e & 1) - (a & 1)) * t); y += ((a >> 1) & 1) + ((((e >> 1) & 1) - ((a >> 1) & 1)) * t); z += ((a >> 2) & 1) + ((((e >> 2) & 1) - ((a >> 2) & 1)) * t);
      if (useCol) { const ins = va > iso ? cidx[a] : cidx[e], w = F[ins] || 1; r += CR[ins] / w; gr += CG[ins] / w; b += CB[ins] / w; }
      m++;
    }
    cellV[i + j * cx + k * cxy] = out.P.length;
    out.P.push([o[0] + (i + x / m) * vs, o[1] + (j + y / m) * vs, o[2] + (k + z / m) * vs]);
    cols.push(useCol ? [r / m, gr / m, b / m] : tint);
  }
  const cell = (i, j, k) => cellV[i + j * cx + k * cxy];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; out.prims.push(flip ? [d, c, b, a] : [a, b, c, d]); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v0 = F[i + j * nx + k * sxy] > iso, v1 = F[i + 1 + j * nx + k * sxy] > iso;
    if (v0 !== v1) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), !v0);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = F[i + j * nx + k * sxy] > iso, v1 = F[i + (j + 1) * nx + k * sxy] > iso;
    if (v0 !== v1) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), !v0);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = F[i + j * nx + k * sxy] > iso, v1 = F[i + j * nx + (k + 1) * sxy] > iso;
    if (v0 !== v1) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), !v0);
  }
  out.Cd = cols.map((c) => c.slice());
  if (p.smooth > 0) taubin(out, p.smooth | 0);
  const res = compact(out);
  res.primMat = res.prims.map(() => (p.material === 'plastic' ? null : p.material));
  return computeNormals(res);
}


// ---------- WHITEWATER: spray / foam / bubbles spawned from a water sim ----------
function stepWhitewater(st, fr, p, src, col, fps) {
  const dt = 1 / fps, t = (fr - 1) / fps;
  if (!src || !src.P.length) { st.parts = []; return; }
  if (!src.v) throw new Error('Input has no velocity — connect a Water node (or Particles)');
  const sep = p.sep > 0 ? p.sep : src.sprite ? src.sprite.size / 1.15 : 0.1;
  const h = sep * 2, h2 = h * h, X = src.P, VV = src.v, NW = X.length;
  // hash of water particles for neighbour queries
  const grid = new Map();
  for (let i = 0; i < NW; i++) { const k = hkey(Math.floor(X[i][0] / h), Math.floor(X[i][1] / h), Math.floor(X[i][2] / h)); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i); }
  const query = (x, fn) => {
    const ci = Math.floor(x[0] / h), cj = Math.floor(x[1] / h), ck = Math.floor(x[2] / h);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const arr = grid.get(hkey(ci + a, cj + b, ck + c)); if (!arr) continue;
      for (const j of arr) { const dx = x[0] - X[j][0], dy = x[1] - X[j][1], dz = x[2] - X[j][2], r2 = dx * dx + dy * dy + dz * dz; if (r2 < h2) fn(j, dx, dy, dz, r2); }
    }
  };
  // --- 1. emission potentials on every water particle
  const room = (p.maxCount | 0) - st.parts.length;
  if (room > 0) {
    const rng = mulberry32(fr * 7919 + (p.seed | 0) * 104729);
    const born = [];
    for (let i = 0; i < NW && born.length < room; i++) {
      const xi = X[i], vi = VV[i], sp = V.len(vi);
      const E = 0.5 * sp * sp; if (E < p.kMin) continue;
      let ta = 0, n = 0, nx = 0, ny = 0, nz = 0;
      query(xi, (j, dx, dy, dz, r2) => {
        if (j === i) return;
        const r = Math.sqrt(r2), w = 1 - r / h; n++;
        nx += dx * w; ny += dy * w; nz += dz * w;
        const rv = V.sub(vi, VV[j]), rl = V.len(rv); if (rl < 1e-6 || r < 1e-9) return;
        ta += rl * (1 - (rv[0] * dx + rv[1] * dy + rv[2] * dz) / (rl * r)) * w;
      });
      let crest = 0;
      if (n < p.surfaceN) { const nl = Math.hypot(nx, ny, nz); if (nl > 1e-9 && sp > 1e-6) crest = Math.max(0, (vi[0] * nx + vi[1] * ny + vi[2] * nz) / nl); }
      const Ita = clamp((ta - p.taMin) / (p.taMax - p.taMin), 0, 1), Iwc = clamp((crest - p.wcMin) / (p.wcMax - p.wcMin), 0, 1), Ik = clamp((E - p.kMin) / (p.kMax - p.kMin), 0, 1);
      const want = (p.rate * Ik * (p.wTrapped * Ita + p.wCrest * Iwc)) / fps;
      let cnt = Math.floor(want); if (rng() < want - cnt) cnt++;
      for (let k = 0; k < cnt; k++) {
        // random point in a disc around the parent, perpendicular to its velocity, nudged along it
        const d = sp > 1e-6 ? V.mul(vi, 1 / sp) : [0, 1, 0];
        const e1 = V.norm(Math.abs(d[1]) < 0.9 ? V.cross(d, [0, 1, 0]) : V.cross(d, [1, 0, 0])), e2 = V.cross(d, e1);
        const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * sep * 0.6;
        const pos = V.add(V.add(xi, V.add(V.mul(e1, Math.cos(a) * rr), V.mul(e2, Math.sin(a) * rr))), V.mul(vi, rng() * dt));
        born.push({ p: pos, v: V.add(vi, V.mul([rng() - 0.5, rng() - 0.5, rng() - 0.5], 0.4 * p.jitter)) });
      }
    }
    for (const b of born) { const id = st.next++; st.parts.push({ id, p: b.p, v: b.v, age: 0, life: p.life * (0.5 + rand(id * 0.913)), kind: 0, seedv: rand(id * 1.71) }); }
  }
  // --- 2. classify + advect
  const out = [];
  for (const q of st.parts) {
    let n = 0, ws = 0, ax = 0, ay = 0, az = 0;
    query(q.p, (j, dx, dy, dz, r2) => { const w = 1 - Math.sqrt(r2) / h; n++; ws += w; ax += VV[j][0] * w; ay += VV[j][1] * w; az += VV[j][2] * w; });
    const vavg = ws > 0 ? [ax / ws, ay / ws, az / ws] : [0, 0, 0];
    let ageRate = 1;
    if (n < p.sprayN) { // spray: ballistic
      q.kind = 0;
      q.v = V.mul(V.add(q.v, V.mul(p.gravity, dt)), Math.max(0, 1 - p.sprayDrag * dt));
      ageRate = 0.7;
    } else if (n > p.bubbleN) { // bubble: carried by the water and buoyant
      q.kind = 2;
      q.v = V.lerp(q.v, V.add(vavg, [0, p.buoyancy, 0]), Math.min(1, p.bubbleDrag * dt));
      ageRate = 1.4;
    } else { // foam: rides the surface
      q.kind = 1;
      q.v = V.lerp(q.v, vavg, Math.min(1, p.foamDrag * dt));
      ageRate = 1;
    }
    let np = V.add(q.p, V.mul(q.v, dt));
    np = collide(col, q.p, np, q.v, 0.005, 0.1, 0.5);
    if (p.ground && np[1] < p.groundY) { np[1] = p.groundY; if (q.v[1] < 0) q.v[1] = 0; q.v[0] *= 0.6; q.v[2] *= 0.6; if (q.kind === 0) ageRate = 4; }
    if (p.bounds) for (let k = 0; k < 3; k++) {
      const lo = p.bcenter[k] - p.bsize[k] / 2, hi = p.bcenter[k] + p.bsize[k] / 2;
      if (np[k] < lo) { np[k] = lo; if (q.v[k] < 0) q.v[k] *= -0.2; } else if (np[k] > hi) { np[k] = hi; if (q.v[k] > 0) q.v[k] *= -0.2; }
    }
    q.p = np; q.age += dt * ageRate;
    if (q.age < q.life) out.push(q);
  }
  st.parts = out;
}
function whitewaterToGeo(st, p) {
  const g = new Geo(), cs = [hex2rgb(p.sprayColor), hex2rgb(p.foamColor), hex2rgb(p.bubbleColor)];
  const show = [p.showSpray, p.showFoam, p.showBubbles], al = [0.75, 0.9, 0.55], sz = [0.55, 1, 0.7];
  g.Cd = []; g.N = []; g.pscale = []; g.alpha = []; g.v = [];
  for (const q of st.parts) {
    if (!show[q.kind]) continue;
    const fade = 1 - Math.pow(q.age / q.life, 2);
    g.P.push(q.p.slice()); g.Cd.push(cs[q.kind].slice()); g.N.push(V.len(q.v) > 1e-6 ? V.norm(q.v) : [0, 1, 0]); g.v.push(q.v.slice());
    g.pscale.push(sz[q.kind] * (0.6 + 0.8 * q.seedv) * (q.kind === 1 ? 0.6 + 0.4 * fade : 1));
    g.alpha.push(al[q.kind] * fade);
  }
  g.sprite = { mode: 'foam', size: p.size };
  return g;
}

// ======================================================================
// Shared helpers for the new tools
// ======================================================================
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
function qrot(q, v) { const u = [q[0], q[1], q[2]], s = q[3], uv = V.cross(u, v), uuv = V.cross(u, uv); return V.add(v, V.mul(V.add(V.mul(uv, s), uuv), 2)); }
function basisFor(n) { const u = V.norm(Math.abs(n[1]) < 0.9 ? V.cross([0, 1, 0], n) : V.cross([1, 0, 0], n)); return [u, V.cross(n, u)]; } // u × v = n
function triList(g) {
  const out = [];
  g.prims.forEach((f, fi) => { for (let i = 1; i + 1 < f.length; i++) out.push([f[0], f[i], f[i + 1], fi]); });
  return out;
}

// ======================================================================
// VORONOI FRACTURE
// ======================================================================
function clipPolyPlane(pts, n, d, lerpAttr) { // keep dot(n,p) - d <= 0 ; pts: [{p, c}]
  const out = [], cut = [];
  for (let i = 0; i < pts.length; i++) {
    const A = pts[i], B = pts[(i + 1) % pts.length];
    const da = V.dot(n, A.p) - d, db = V.dot(n, B.p) - d;
    if (da <= 0) out.push(A);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db), P = { p: V.lerp(A.p, B.p, t) };
      if (lerpAttr && A.c) P.c = V.lerp(A.c, B.c, t);
      out.push(P); cut.push(P.p);
    }
  }
  return { out, cut };
}
function orderOnPlane(pts, n) {
  const c = V.mul(pts.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / pts.length), [u, v] = basisFor(n);
  const uniq = [];
  for (const p of pts) if (!uniq.some((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-9)) uniq.push(p);
  return uniq.map((p) => ({ p, a: Math.atan2(V.dot(V.sub(p, c), v), V.dot(V.sub(p, c), u)) })).sort((a, b) => a.a - b.a).map((o) => o.p);
}
function convexCell(seed, planes, bb) { // returns faces [{pts:[[...]], plane: index|-1}]
  const [lo, hi] = bb;
  const C = (x, y, z) => [x ? hi[0] : lo[0], y ? hi[1] : lo[1], z ? hi[2] : lo[2]];
  let faces = [
    [C(1, 0, 0), C(1, 1, 0), C(1, 1, 1), C(1, 0, 1)], [C(0, 0, 0), C(0, 0, 1), C(0, 1, 1), C(0, 1, 0)],
    [C(0, 1, 0), C(0, 1, 1), C(1, 1, 1), C(1, 1, 0)], [C(0, 0, 0), C(1, 0, 0), C(1, 0, 1), C(0, 0, 1)],
    [C(0, 0, 1), C(1, 0, 1), C(1, 1, 1), C(0, 1, 1)], [C(0, 0, 0), C(0, 1, 0), C(1, 1, 0), C(1, 0, 0)],
  ].map((pts) => ({ pts, plane: -1 }));
  planes.forEach((pl, pi) => {
    const nf = [], cuts = [];
    for (const f of faces) {
      const r = clipPolyPlane(f.pts.map((p) => ({ p })), pl.n, pl.d, false);
      if (r.out.length >= 3) nf.push({ pts: r.out.map((o) => o.p), plane: f.plane });
      cuts.push(...r.cut);
    }
    if (cuts.length >= 3) { const cap = orderOnPlane(cuts, pl.n); if (cap.length >= 3) nf.push({ pts: cap, plane: pi }); }
    faces = nf;
  });
  return faces;
}
// cross-section loops of a closed mesh with a plane (chained through edge keys)
function crossSection(P, tris, n, d) {
  const segs = new Map(), eps = 1e-9;
  const sd = (i) => { const v = V.dot(n, P[i]) - d; return Math.abs(v) < eps ? eps : v; };
  const ek = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  const ept = (a, b) => { const da = sd(a), db = sd(b); return V.lerp(P[a], P[b], da / (da - db)); };
  const links = new Map(); const pos = new Map();
  for (const [a, b, c] of tris) {
    const d0 = sd(a), d1 = sd(b), d2 = sd(c), vs = [[a, d0], [b, d1], [c, d2]], cr = [];
    for (let i = 0; i < 3; i++) { const [x, dx] = vs[i], [y, dy] = vs[(i + 1) % 3]; if ((dx > 0) !== (dy > 0)) cr.push(ek(x, y)), pos.set(ek(x, y), ept(x, y)); }
    if (cr.length === 2) { for (const [k1, k2] of [[cr[0], cr[1]], [cr[1], cr[0]]]) { if (!links.has(k1)) links.set(k1, []); links.get(k1).push(k2); } }
  }
  const used = new Set(), loops = [];
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const loop = []; let cur = start, prev = null;
    while (cur && !used.has(cur)) { used.add(cur); loop.push(pos.get(cur)); const nx = (links.get(cur) || []).find((k) => k !== prev && !used.has(k)); prev = cur; cur = nx; }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
// --- 2D polygon helpers + ear clipping with holes
const area2 = (L) => { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function pip(pt, L) { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const a = L[i], b = L[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1] + 1e-300) + a[0]) c = !c; } return c; }
function clip2D(L, win) { // Sutherland–Hodgman against convex CCW window
  let out = L;
  for (let i = 0; i < win.length && out.length; i++) {
    const a = win[i], b = win[(i + 1) % win.length], inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const res = [];
    for (let k = 0; k < out.length; k++) {
      const P = out[k], Q = out[(k + 1) % out.length], ip = inside(P), iq = inside(Q);
      if (ip) res.push(P);
      if (ip !== iq) { const d1 = (b[0] - a[0]) * (P[1] - a[1]) - (b[1] - a[1]) * (P[0] - a[0]), d2 = (b[0] - a[0]) * (Q[1] - a[1]) - (b[1] - a[1]) * (Q[0] - a[0]), t = d1 / (d1 - d2); res.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    }
    out = res;
  }
  return out;
}
function earClip(outer, holes) { // outer CCW, holes CW; returns triangles of indices into returned verts
  let poly = outer.slice();
  // bridge holes, rightmost first
  holes.sort((A, B) => Math.max(...B.map((p) => p[0])) - Math.max(...A.map((p) => p[0])));
  for (const H of holes) {
    let hi = 0; H.forEach((p, i) => { if (p[0] > H[hi][0]) hi = i; });
    const M = H[hi];
    let best = -1, bd = Infinity;
    for (let i = 0; i < poly.length; i++) { // nearest visible-ish outer vertex to the right
      const p = poly[i]; if (p[0] < M[0] - 1e-12) continue;
      const dd = (p[0] - M[0]) ** 2 + (p[1] - M[1]) ** 2;
      if (dd >= bd) continue;
      let blocked = false;
      for (let k = 0; k < poly.length && !blocked; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; if (k === i || (k + 1) % poly.length === i) continue; if (segX(M, p, a, b)) blocked = true; }
      if (!blocked) { bd = dd; best = i; }
    }
    if (best < 0) { best = 0; poly.forEach((p, i) => { if ((p[0] - M[0]) ** 2 + (p[1] - M[1]) ** 2 < (poly[best][0] - M[0]) ** 2 + (poly[best][1] - M[1]) ** 2) best = i; }); }
    const hr = H.slice(hi).concat(H.slice(0, hi));
    poly = poly.slice(0, best + 1).concat(hr, [hr[0].slice()], [poly[best].slice()], poly.slice(best + 1));
  }
  const idx = poly.map((_, i) => i), tris = [];
  const isEar = (i0, i1, i2) => {
    const a = poly[i0], b = poly[i1], c = poly[i2];
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-14) return false;
    for (const j of idx) {
      if (j === i0 || j === i1 || j === i2) continue; const p = poly[j];
      if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
      const s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]), s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
      if (s1 >= 0 && s2 >= 0 && s3 >= 0) return false;
    }
    return true;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 20000) {
    let found = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      if (isEar(i0, i1, i2)) { tris.push([i0, i1, i2]); idx.splice(k, 1); found = true; break; }
    }
    if (!found) { // degenerate leftovers: fan the rest
      for (let k = 1; k + 1 < idx.length; k++) tris.push([idx[0], idx[k], idx[k + 1]]);
      idx.length = 0; break;
    }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return { verts: poly, tris };
}
function segX(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}
function capRegion(loops3, face, n) { // returns 3D triangles for (face polygon ∩ cross-section region)
  const [u, v] = basisFor(n), o = face[0];
  const to2 = (p) => { const q = V.sub(p, o); return [V.dot(q, u), V.dot(q, v)]; }, to3 = (q) => V.add(o, V.add(V.mul(u, q[0]), V.mul(v, q[1])));
  let win = face.map(to2); if (area2(win) < 0) win.reverse();
  const loops = [];
  for (const L of loops3) { const c = clip2D(L.map(to2), win); if (c.length >= 3 && Math.abs(area2(c)) > 1e-12) loops.push(c); }
  if (!loops.length) return [];
  // classify by nesting depth (even = outer, odd = hole)
  const depth = loops.map((L, i) => loops.reduce((s, M, j) => s + (j !== i && pip(L[0], M) ? 1 : 0), 0));
  const tris = [];
  loops.forEach((L, i) => {
    if (depth[i] % 2) return;
    const outer = area2(L) > 0 ? L : L.slice().reverse();
    const holes = loops.filter((H, j) => depth[j] === depth[i] + 1 && pip(H[0], L)).map((H) => (area2(H) < 0 ? H : H.slice().reverse()));
    const r = earClip(outer, holes);
    for (const t of r.tris) tris.push(t.map((k) => to3(r.verts[k])));
  });
  return tris;
}
function voronoiFracture(g, p) {
  if (!g.prims.length) throw new Error('Fracture needs polygon geometry');
  const tris = triList(g), P = g.P, rng = mulberry32((p.seed | 0) * 7717 + 11);
  const bb = g.bbox(), pad = V.mul(V.sub(bb.max, bb.min), 0.02).map((x) => Math.max(x, 1e-3));
  const box = [V.sub(bb.min, pad), V.add(bb.max, pad)];
  const col = buildCollider(g), closed = col && isClosed(g);
  // seeds: inside the volume, optionally biased toward an impact point
  const seeds = [], want = Math.max(2, p.pieces | 0);
  for (let tries = 0; seeds.length < want && tries < want * 200; tries++) {
    let s = [0, 1, 2].map((k) => bb.min[k] + rng() * (bb.max[k] - bb.min[k]));
    if (p.bias > 0) s = V.lerp(s, V.add(p.impact, V.mul(V.sub(s, p.impact), rng() ** 2)), p.bias);
    if (closed && !insideMesh(col.tris, s)) continue;
    seeds.push(s);
  }
  if (seeds.length < 2) throw new Error('Could not place fracture points inside the mesh');
  const out = new Geo(); out.Cd = []; out.piece = []; out.primMat = [];
  const inner = hex2rgb(p.innerColor), A = hex2rgb(p.c1), B = hex2rgb(p.c2);
  const triBB = tris.map(([a, b, c]) => [[0, 1, 2].map((k) => Math.min(P[a][k], P[b][k], P[c][k])), [0, 1, 2].map((k) => Math.max(P[a][k], P[b][k], P[c][k]))]);
  let pieceId = 0;
  seeds.forEach((s, si) => {
    const others = seeds.map((q, j) => ({ q, j, d: V.len(V.sub(q, s)) })).filter((o) => o.j !== si).sort((a, b) => a.d - b.d).slice(0, 40);
    const planes = others.map(({ q }) => { const n = V.norm(V.sub(q, s)), m = V.mul(V.add(q, s), 0.5); return { n, d: V.dot(n, m) }; });
    const faces = convexCell(s, planes, box);
    if (faces.length < 4) return;
    const used = new Set(faces.map((f) => f.plane).filter((x) => x >= 0)), cp = [...used].map((i) => planes[i]);
    const cmin = [Infinity, Infinity, Infinity], cmax = [-Infinity, -Infinity, -Infinity];
    faces.forEach((f) => f.pts.forEach((q) => { for (let k = 0; k < 3; k++) { cmin[k] = Math.min(cmin[k], q[k]); cmax[k] = Math.max(cmax[k], q[k]); } }));
    const piece = new Geo(); piece.Cd = []; const mats = [];
    const pieceCol = p.colorMode === 'random' ? V.lerp(A, B, rng()) : null;
    // outer surface inside this cell
    tris.forEach(([a, b, c, fi], ti) => {
      const [tl, th] = triBB[ti];
      if (th[0] < cmin[0] || tl[0] > cmax[0] || th[1] < cmin[1] || tl[1] > cmax[1] || th[2] < cmin[2] || tl[2] > cmax[2]) return;
      let poly = [a, b, c].map((i) => ({ p: P[i], c: g.Cd ? g.Cd[i] : [0.75, 0.75, 0.78] }));
      for (const pl of cp) { poly = clipPolyPlane(poly, pl.n, pl.d, true).out; if (poly.length < 3) return; }
      const base = piece.P.length;
      poly.forEach((q) => { piece.P.push(q.p.slice()); piece.Cd.push(pieceCol || q.c.slice()); });
      piece.prims.push(poly.map((_, k) => base + k)); mats.push(g.primMat ? g.primMat[fi] : null);
    });
    if (!piece.prims.length) return;
    // interior faces: each bisector face ∩ mesh cross-section
    for (const f of faces) {
      if (f.plane < 0) continue;
      const pl = planes[f.plane], loops = crossSection(P, tris, pl.n, pl.d);
      for (const t of capRegion(loops, f.pts, pl.n)) {
        const base = piece.P.length;
        t.forEach((q) => { piece.P.push(q); piece.Cd.push(inner.slice()); });
        piece.prims.push([base, base + 1, base + 2]); mats.push(p.innerMat === 'same' ? null : p.innerMat);
      }
    }
    piece.primMat = mats;
    let fp = fuse(piece, 1e-6);
    if (p.gap > 0) { const c = V.mul(fp.P.reduce((s2, q) => V.add(s2, q), [0, 0, 0]), 1 / fp.P.length); fp.P = fp.P.map((q) => V.add(c, V.mul(V.sub(q, c), 1 - p.gap))); }
    fp.piece = fp.prims.map(() => pieceId);
    out.append(fp); pieceId++;
  });
  out.piece = out.piece || [];
  if (out.primMat && out.primMat.every((m) => !m)) out.primMat = null;
  return computeNormals(out);
}
function isClosed(g) { const e = new Map(); for (const f of g.prims) for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length], k = a < b ? a + '_' + b : b + '_' + a; e.set(k, (e.get(k) || 0) + 1); } for (const c of e.values()) if (c !== 2) return false; return e.size > 0; }

// ======================================================================
// RIGID DEBRIS — tumbling rigid pieces with impulses, ground + piece contacts
// ======================================================================
const debrisCache = new WeakMap();
function debrisPieces(g) {
  if (debrisCache.has(g)) return debrisCache.get(g);
  if (!g.piece) throw new Error('Input has no pieces — connect a Voronoi Fracture node');
  const map = new Map();
  g.prims.forEach((f, fi) => { const id = g.piece[fi]; if (!map.has(id)) map.set(id, { pts: new Set(), prims: [] }); const m = map.get(id); m.prims.push(fi); f.forEach((v) => m.pts.add(v)); });
  const pieces = [...map.values()].map((m) => {
    const pts = [...m.pts], c = V.mul(pts.reduce((s, i) => V.add(s, g.P[i]), [0, 0, 0]), 1 / pts.length);
    const local = pts.map((i) => V.sub(g.P[i], c)), R = Math.max(1e-3, ...local.map(V.len));
    return { pts, c, local, R };
  });
  debrisCache.set(g, pieces); return pieces;
}
function stepDebris(st, fr, p, src, col, fps) {
  const pieces = debrisPieces(src);
  if (!st.init) {
    st.init = true; const r = mulberry32((p.seed | 0) * 313 + 9);
    st.parts = pieces.map((pc, i) => ({ id: i, x: pc.c.slice(), q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], active: 0, rj: [r(), r(), r(), r(), r(), r()] }));
  }
  const sub = 4, dt = 1 / fps / sub, t = (fr - 1) / fps;
  for (const b of st.parts) {
    if (b.active) continue;
    const pc = pieces[b.id];
    const reach = p.mode === 'impact' ? Math.max(0, t - (p.start - 1) / fps) * p.waveSpeed : Infinity;
    if (fr >= p.start && V.len(V.sub(pc.c, p.center)) <= reach) {
      b.active = 1;
      const d = V.sub(pc.c, p.center), dist = V.len(d), dir = dist > 1e-6 ? V.mul(d, 1 / dist) : [0, 1, 0];
      const k = p.strength / (1 + dist * dist * p.falloff);
      b.v = V.add(V.add(V.mul(dir, k), p.vel), V.mul([b.rj[0] - 0.5, b.rj[1] - 0.5, b.rj[2] - 0.5], 2 * p.jitter));
      b.w = V.mul([b.rj[3] - 0.5, b.rj[4] - 0.5, b.rj[5] - 0.5], 2 * p.spin);
    }
  }
  for (let s = 0; s < sub; s++) {
    for (const b of st.parts) {
      if (!b.active) continue;
      const pc = pieces[b.id], m = pc.R ** 3, I = 0.4 * m * pc.R * pc.R;
      b.v = V.mul(V.add(b.v, V.mul(p.gravity, dt)), 1 - p.drag * dt);
      b.x = V.add(b.x, V.mul(b.v, dt));
      b.q = qnorm(V.len(b.w) > 0 ? [b.q[0] + 0.5 * dt * (b.w[0] * b.q[3] + b.w[1] * b.q[2] - b.w[2] * b.q[1]), b.q[1] + 0.5 * dt * (b.w[1] * b.q[3] + b.w[2] * b.q[0] - b.w[0] * b.q[2]), b.q[2] + 0.5 * dt * (b.w[2] * b.q[3] + b.w[0] * b.q[1] - b.w[1] * b.q[0]), b.q[3] - 0.5 * dt * (b.w[0] * b.q[0] + b.w[1] * b.q[1] + b.w[2] * b.q[2])] : b.q);
      if (p.ground) { // deepest vertex contact with impulse response
        let lo = Infinity, lr = null;
        for (const L of pc.local) { const r = qrot(b.q, L), y = b.x[1] + r[1]; if (y < lo) { lo = y; lr = r; } }
        if (lo < p.groundY) {
          b.x[1] += p.groundY - lo;
          const n = [0, 1, 0], vc = V.add(b.v, V.cross(b.w, lr)), vn = V.dot(vc, n);
          if (vn < 0) {
            const rn = V.cross(lr, n), j = (-(1 + p.bounce) * vn) / (1 / m + V.dot(rn, rn) / I);
            b.v = V.add(b.v, V.mul(n, j / m)); b.w = V.add(b.w, V.mul(rn, j / I));
            const vc2 = V.add(b.v, V.cross(b.w, lr)), vt = V.sub(vc2, V.mul(n, V.dot(vc2, n))), vtl = V.len(vt);
            if (vtl > 1e-6) {
              const tdir = V.mul(vt, -1 / vtl), rt = V.cross(lr, tdir);
              const jt = Math.min(vtl / (1 / m + V.dot(rt, rt) / I), p.friction * j);
              b.v = V.add(b.v, V.mul(tdir, jt / m)); b.w = V.add(b.w, V.mul(rt, jt / I));
            }
          }
          b.w = V.mul(b.w, 1 - 0.6 * dt * 10 * p.rollDamp);
          if (V.len(b.v) < 0.05 && V.len(b.w) < 0.2) { b.v = V.mul(b.v, 0.5); b.w = V.mul(b.w, 0.5); }
        }
      }
      if (col) { const nx = collide(col, V.sub(b.x, V.mul(b.v, dt)), b.x, b.v, pc.R * 0.5, p.bounce, p.friction); b.x = nx; }
    }
    if (p.collide) { // piece-piece: bounding spheres
      const act = st.parts.filter((b) => b.active);
      for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
        const a = act[i], b = act[j], ra = pieces[a.id].R * 0.7, rb = pieces[b.id].R * 0.7;
        const d = V.sub(b.x, a.x), dl = V.len(d); if (dl >= ra + rb || dl < 1e-9) continue;
        const n = V.mul(d, 1 / dl), ov = ra + rb - dl, ma = ra ** 3, mb = rb ** 3, wa = mb / (ma + mb), wb = ma / (ma + mb);
        a.x = V.sub(a.x, V.mul(n, ov * wa)); b.x = V.add(b.x, V.mul(n, ov * wb));
        const rv = V.dot(V.sub(b.v, a.v), n);
        if (rv < 0) { const j2 = (-(1 + p.bounce * 0.5) * rv) / (1 / ma + 1 / mb); a.v = V.sub(a.v, V.mul(n, j2 / ma)); b.v = V.add(b.v, V.mul(n, j2 / mb)); }
      }
    }
  }
}
function debrisCook(p, ctx) {
  // custom driver around simCook so the output can reuse the fractured geometry
  const src = ctx.inputAt(0, 1);
  if (!src) throw new Error('Missing input — connect a Voronoi Fracture node');
  return simCook(p, ctx, stepDebris, (st) => {
    const pieces = debrisPieces(src), g = src.clone();
    for (const b of st.parts) {
      const pc = pieces[b.id];
      pc.pts.forEach((vi, k) => { g.P[vi] = V.add(b.x, qrot(b.q, pc.local[k])); });
    }
    return computeNormals(g);
  });
}

// ======================================================================
// CLOTH — position based dynamics
// ======================================================================
function clothInit(st, src, p) {
  const n = src.P.length;
  const ek = new Map(), edges = [], bends = [];
  const key = (a, b) => (a < b ? a * n + b : b * n + a);
  const faceOf = new Map(), SA = src.attrs && src.attrs.stiffness, ks = (a, b) => (SA ? Math.max(0, (SA[a] + SA[b]) / 2) : 1);
  src.prims.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length], k = key(a, b);
      if (!ek.has(k)) { ek.set(k, edges.length); edges.push([a, b, V.len(V.sub(src.P[a], src.P[b])), 0, ks(a, b)]); }
      if (!faceOf.has(k)) faceOf.set(k, []); faceOf.get(k).push([fi, i]);
    }
    if (f.length === 4) for (const [a, b] of [[f[0], f[2]], [f[1], f[3]]]) { const k = key(a, b); if (!ek.has(k)) { ek.set(k, edges.length); edges.push([a, b, V.len(V.sub(src.P[a], src.P[b])), 1, ks(a, b)]); } } // shear
  });
  // bending: vertices opposite a shared edge, both adjacent to the edge's first vertex
  for (const [k, fl] of faceOf) {
    if (fl.length !== 2) continue;
    const [f1, i1] = fl[0], [f2, i2] = fl[1], F1 = src.prims[f1], F2 = src.prims[f2];
    const a = F1[i1], o1 = F1[(i1 - 1 + F1.length) % F1.length], o2 = F2[(F2.indexOf(a) + 1) % F2.length];
    if (o1 !== o2) bends.push([o1, o2, V.len(V.sub(src.P[o1], src.P[o2])), ks(o1, o2)]);
  }
  // pins
  const run = compileSnippet('return (' + (p.pin.trim() || 'false') + ');');
  const bb = src.bbox();
  st.parts = src.P.map((q, i) => {
    const $ = { P: toVec(q), ptnum: i, numpt: n, bbmin: toVec(bb.min), bbmax: toVec(bb.max) };
    let pin = false; try { pin = !!run($); } catch (e) {}
    if (p.pinPaint && src.mask && src.mask[i] > 0.5) pin = true;
    return { p: q.slice(), v: [0, 0, 0], pin };
  });
  // neighbour sets for self-collision exclusion
  const nb = Array.from({ length: n }, () => new Set());
  for (const [a, b] of edges) { nb[a].add(b); nb[b].add(a); }
  // long-range tethers: no point may drift further from its nearest pin than in the rest pose (stops rubbery stretching)
  const pins = st.parts.map((q, i) => (q.pin ? i : -1)).filter((i) => i >= 0), tethers = [];
  if (pins.length) st.parts.forEach((q, i) => { if (q.pin) return; let best = -1, bd = Infinity; for (const j of pins) { const d = V.len(V.sub(src.P[i], src.P[j])); if (d < bd) { bd = d; best = j; } } tethers.push([i, best, bd]); });
  Object.defineProperty(st, 'topo', { value: { edges, bends, nb, n, tethers }, enumerable: true, writable: true });
  st.init = true;
}
function stepCloth(st, fr, p, src, col, fps) {
  if (!st.init || !st.topo) clothInit(st, src, p);
  const T = st.topo;
  if (src.P.length !== T.n) throw new Error('Cloth input changed point count — cloth needs fixed topology');
  const P = st.parts, sub = Math.max(1, p.substeps | 0), dt = 1 / fps / sub, t = (fr - 1) / fps;
  const prevPin = P.map((q) => q.p.slice());
  // per-point normals for aerodynamic forces
  const N = (() => { const g2 = new Geo(); g2.P = P.map((q) => q.p); g2.prims = src.prims; computeNormals(g2); return g2.N; })();
  const ts = 1 / Math.max(0.05, p.gustSize);
  for (let s = 0; s < sub; s++) {
    const a = (s + 1) / sub;
    const X = P.map((q, i) => {
      if (q.pin) return V.lerp(prevPin[i], src.P[i], a);
      let wind = p.wind;
      if (p.gust) wind = V.add(wind, V.mul([noise3(q.p[0] * ts + t, q.p[1] * ts, q.p[2] * ts), noise3(q.p[0] * ts, q.p[1] * ts + t, q.p[2] * ts + 9.1), noise3(q.p[0] * ts + 4.3, q.p[1] * ts, q.p[2] * ts + t)], p.gust));
      const rel = V.sub(wind, q.v), fa = V.add(V.mul(N[i], V.dot(rel, N[i]) * p.aero), V.mul(rel, p.drag));
      q.v = V.mul(V.add(q.v, V.mul(V.add(p.gravity, fa), dt)), 1 - p.damping * dt);
      return V.add(q.p, V.mul(q.v, dt));
    });
    const inv = P.map((q) => (q.pin ? 0 : 1));
    for (let it = 0; it < Math.max(1, p.iterations | 0); it++) {
      for (const [i, j, L, shear, kscale = 1] of T.edges) {
        const w = inv[i] + inv[j]; if (!w) continue;
        const d = V.sub(X[j], X[i]), l = V.len(d); if (l < 1e-9) continue;
        let C = l - L; if (C < 0 && p.compress < 1) C *= p.compress; // cloth buckles more easily than it stretches
        const k = Math.min(1, (shear ? p.shear : p.stretch) * kscale) * C / (l * w);
        if (inv[i]) X[i] = V.add(X[i], V.mul(d, k * inv[i]));
        if (inv[j]) X[j] = V.sub(X[j], V.mul(d, k * inv[j]));
      }
      if (p.bend > 0) for (const [i, j, L, kscale = 1] of T.bends) {
        const w = inv[i] + inv[j]; if (!w) continue;
        const d = V.sub(X[j], X[i]), l = V.len(d); if (l < 1e-9) continue;
        const k = (Math.min(1, p.bend * kscale) * (l - L)) / (l * w);
        if (inv[i]) X[i] = V.add(X[i], V.mul(d, k * inv[i]));
        if (inv[j]) X[j] = V.sub(X[j], V.mul(d, k * inv[j]));
      }
      for (const [i, j, L] of T.tethers) { const d = V.sub(X[i], X[j]), l = V.len(d); if (l > L * 1.02) X[i] = V.add(X[j], V.mul(d, (L * 1.02) / l)); }
      if (p.selfCollide && it === 0) {
        const th = p.thickness * 2, nbl = neighbourLists(X, th);
        for (let i = 0; i < X.length; i++) for (const j of nbl[i]) {
          if (j <= i || T.nb[i].has(j)) continue; const w = inv[i] + inv[j]; if (!w) continue;
          const d = V.sub(X[j], X[i]), l = V.len(d); if (l >= th || l < 1e-9) continue;
          const k = (l - th) / (l * w);
          if (inv[i]) X[i] = V.add(X[i], V.mul(d, k * inv[i]));
          if (inv[j]) X[j] = V.sub(X[j], V.mul(d, k * inv[j]));
        }
      }
    }
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      if (q.pin) { q.v = V.mul(V.sub(X[i], q.p), 1 / dt); q.p = X[i]; continue; }
      let x = collide(col, q.p, X[i], q.v, p.thickness, 0, p.friction);
      if (p.ground && x[1] < p.groundY + p.thickness) { x[1] = p.groundY + p.thickness; const k = 1 - p.friction; x[0] = q.p[0] + (x[0] - q.p[0]) * k; x[2] = q.p[2] + (x[2] - q.p[2]) * k; }
      q.v = V.mul(V.sub(x, q.p), 1 / dt); q.p = x;
    }
  }
}
function clothCook(p, ctx) {
  const src1 = ctx.inputAt(0, 1);
  if (!src1 || !src1.prims.length) throw new Error('Connect a polygon mesh (e.g. a Grid) as the cloth');
  return simCook(p, ctx, stepCloth, (st) => {
    const g = ctx.inputAt(0, Math.max(1, ctx.frame)).clone();
    if (st.parts.length === g.P.length) g.P = st.parts.map((q) => q.p.slice());
    return computeNormals(g);
  });
}

// ======================================================================
// HAIR — groom on a surface + strand dynamics
// ======================================================================
function hairRoots(skin, p) {
  const tris = triList(skin), r = mulberry32((p.seed | 0) * 6151 + 7);
  let total = 0; const cum = tris.map(([a, b, c]) => (total += V.len(V.cross(V.sub(skin.P[b], skin.P[a]), V.sub(skin.P[c], skin.P[a]))) * 0.5));
  const run = p.mask.trim() ? compileSnippet('return (' + p.mask + ');') : null;
  const roots = [];
  for (let k = 0, guard = 0; k < p.count && guard < p.count * 60; guard++) {
    const t = r() * total; let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < t) lo = m + 1; else hi = m; }
    let u = r(), v = r(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const R = { tri: lo, u, v, rnd: [r(), r(), r(), r()], len: 1 };
    const [ta, tb, tc] = tris[lo], bary = (A) => A[ta] * (1 - u - v) + A[tb] * u + A[tc] * v;
    if (p.useMask && skin.mask) { const m = bary(skin.mask); if (r() > m) continue; if (p.maskLength) R.len = Math.max(0.15, m); }
    if (skin.attrs && skin.attrs.length) R.len *= Math.max(0, bary(skin.attrs.length));
    if (skin.attrs && skin.attrs.stiffness) R.stiff = Math.max(0, bary(skin.attrs.stiffness));
    if (skin.Cd) R.col = [0, 1, 2].map((k) => skin.Cd[ta][k] * (1 - u - v) + skin.Cd[tb][k] * u + skin.Cd[tc][k] * v);
    if (R.len < 0.02) continue; // painted to (almost) zero length: no strand
    if (run) { const pos = triPoint(skin, tris[lo], u, v); if (!run({ P: toVec(pos), ptnum: k })) continue; }
    roots.push(R); k++;
  }
  return { tris, roots };
}
const triPoint = (g, [a, b, c], u, v) => V.add(V.mul(g.P[a], 1 - u - v), V.add(V.mul(g.P[b], u), V.mul(g.P[c], v)));
function rootFrame(g, tri) { const [a, b, c] = tri; const n = V.norm(V.cross(V.sub(g.P[b], g.P[a]), V.sub(g.P[c], g.P[a]))); const t = V.norm(V.sub(g.P[b], g.P[a])); return { n, t, b: V.cross(n, t) }; }
function hairRest(R, p, clumpOf, rootsLocal) { // rest offsets in the root's local frame (t, n, b)
  const seg = Math.max(2, p.segments | 0), L = p.length * (1 - p.lengthVar * R.rnd[0]) * (R.len ?? 1), pts = [];
  const comb = [p.comb[0], p.comb[1], p.comb[2]];
  for (let i = 0; i <= seg; i++) {
    const s = i / seg;
    // grow along the normal, bend toward the comb direction and droop
    let d = [comb[0] * s * s, 1 - s * s * p.droop, comb[2] * s * s];
    let pos = V.mul([d[0], d[1], d[2]], L * s);
    if (p.curl > 0) { const a = s * p.curlFreq * Math.PI * 2 + R.rnd[1] * 6.283, rad = p.curl * L * 0.08 * s; pos = V.add(pos, [Math.cos(a) * rad, 0, Math.sin(a) * rad]); }
    if (p.frizz > 0) pos = V.add(pos, V.mul([noise3(R.rnd[2] * 50, s * 6, 1), noise3(R.rnd[3] * 50, s * 6, 7), noise3(R.rnd[1] * 50, s * 6, 13)], p.frizz * L * 0.15 * s));
    pts.push(pos);
  }
  return pts;
}
function hairWorld(local, F, root) { return local.map((q) => V.add(root, V.add(V.add(V.mul(F.t, q[0]), V.mul(F.n, q[1])), V.mul(F.b, q[2])))); }
const hairCache = new WeakMap();
function hairSetup(skin1, p) {
  const key = JSON.stringify([p.count, p.seed, p.mask, p.useMask, p.maskLength]) + (skin1.__sig || '');
  let c = hairCache.get(skin1); if (c && c.key === key) return c;
  const { tris, roots } = hairRoots(skin1, p);
  c = { key, tris, roots }; hairCache.set(skin1, c); return c;
}
function hairGroom(skin, setup, p) {
  const out = [];
  // clumping: strands pull toward a few clump guides
  const nC = Math.max(1, Math.round(setup.roots.length * 0.06));
  const restAll = setup.roots.map((R) => hairRest(R, p));
  setup.roots.forEach((R, i) => {
    const tri = setup.tris[R.tri], F = rootFrame(skin, tri), root = triPoint(skin, tri, R.u, R.v);
    let rest = restAll[i];
    if (p.clump > 0) { const g = restAll[Math.floor(R.rnd[2] * nC) * Math.floor(setup.roots.length / nC) % setup.roots.length]; rest = rest.map((q, k) => V.lerp(q, [g[k][0] * 0.6 + q[0] * 0.4, q[1], g[k][2] * 0.6 + q[2] * 0.4], p.clump * (k / (rest.length - 1)))); }
    out.push(hairWorld(rest, F, root));
  });
  return out;
}
function stepHair(st, fr, p, skin, col, fps) {
  const setup = hairSetup(st.skin1, p);
  const groom = hairGroom(skin, setup, p);
  if (!st.init) { st.parts = groom.map((pts, i) => ({ id: i, pts: pts.map((q) => q.slice()), vel: pts.map(() => [0, 0, 0]) })); st.init = true; return; }
  if (!p.simulate) { st.parts.forEach((s, i) => { s.pts = groom[i].map((q) => q.slice()); s.vel = s.pts.map(() => [0, 0, 0]); }); return; }
  const sub = Math.max(1, p.substeps | 0), dt = 1 / fps / sub, t = (fr - 1) / fps, ts = 1 / Math.max(0.05, p.gustSize);
  const skinCol = p.skinCollide ? buildCollider(skin) : null;
  st.parts.forEach((s, si) => {
    const rest = groom[si], n = rest.length, prevRoot = s.pts[0].slice();
    const segL = rest.map((q, i) => (i ? V.len(V.sub(q, rest[i - 1])) : 0));
    for (let k = 0; k < sub; k++) {
      const a = (k + 1) / sub;
      const X = s.pts.map((q, i) => {
        if (i === 0) return V.lerp(prevRoot, rest[0], a);
        let f = p.gravity;
        if (p.wind[0] || p.wind[1] || p.wind[2] || p.gust) { let w = p.wind; if (p.gust) w = V.add(w, V.mul([noise3(q[0] * ts + t, q[1] * ts, q[2] * ts), noise3(q[0] * ts, q[1] * ts + t, q[2] * ts), noise3(q[0] * ts, q[1] * ts, q[2] * ts + t)], p.gust)); f = V.add(f, V.mul(V.sub(w, s.vel[i]), p.aero)); }
        s.vel[i] = V.mul(V.add(s.vel[i], V.mul(f, dt)), 1 - p.damping * dt);
        return V.add(q, V.mul(s.vel[i], dt));
      });
      for (let it = 0; it < Math.max(1, p.iterations | 0); it++) {
        // shape stiffness: pull toward the groomed pose (stronger near the root)
        const sk = setup.roots[si].stiff ?? 1;
        for (let i = 1; i < n; i++) { const k2 = Math.min(1, p.stiffness * sk) * (1 - (i / n) * p.tipLimp) * 0.5; X[i] = V.lerp(X[i], rest[i], k2); }
        // follow-the-leader inextensibility
        for (let i = 1; i < n; i++) { const d = V.sub(X[i], X[i - 1]), l = V.len(d) || 1e-9; X[i] = V.add(X[i - 1], V.mul(d, segL[i] / l)); }
      }
      for (let i = 1; i < n; i++) {
        let x = X[i];
        if (skinCol) x = collide(skinCol, s.pts[i], x, s.vel[i], p.skinOffset, 0, 0.2);
        if (col) x = collide(col, s.pts[i], x, s.vel[i], p.skinOffset, 0, 0.3);
        if (p.ground && x[1] < p.groundY) x[1] = p.groundY;
        s.vel[i] = V.mul(V.sub(x, s.pts[i]), 1 / dt); s.pts[i] = x;
      }
      s.vel[0] = V.mul(V.sub(X[0], s.pts[0]), 1 / dt); s.pts[0] = X[0];
    }
  });
}
function hairCook(p, ctx) {
  const skin1 = ctx.inputAt(0, 1);
  if (!skin1 || !skin1.prims.length) throw new Error('Connect a polygon surface to grow hair from');
  return simCook(p, ctx, (st, fr, pf, skin, col, fps) => { Object.defineProperty(st, 'skin1', { value: skin1, enumerable: false, writable: true, configurable: true }); stepHair(st, fr, pf, skin, col, fps); }, (st) => {
    const g = new Geo(), A0 = hex2rgb(p.rootColor), B0 = hex2rgb(p.tipColor), roots = hairSetup(skin1, p).roots;
    g.Cd = []; g.pscale = [];
    for (const s of st.parts) {
      const R = roots[s.id] || {}, inherit = p.inheritColor && R.col;
      const A = inherit ? R.col : A0, B = inherit ? V.lerp(R.col, B0, p.tipBlend) : B0;
      const n = s.pts.length, shade = 0.85 + 0.3 * rand(s.id * 0.37);
      if (p.look === 'ribbons') {
        const base = g.P.length;
        for (let i = 0; i < n; i++) {
          const tng = V.norm(V.sub(s.pts[Math.min(n - 1, i + 1)], s.pts[Math.max(0, i - 1)]));
          const side = V.norm(V.cross(tng, Math.abs(tng[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0]));
          const w = p.width * (1 - (i / (n - 1)) * 0.85) * 0.5, c = V.lerp(A, B, i / (n - 1)).map((x) => Math.min(1, x * shade));
          g.P.push(V.sub(s.pts[i], V.mul(side, w)), V.add(s.pts[i], V.mul(side, w))); g.Cd.push(c, c.slice()); g.pscale.push(w, w);
        }
        for (let i = 0; i + 1 < n; i++) { const a = base + i * 2; g.prims.push([a, a + 1, a + 3, a + 2]); }
      } else {
        const base = g.P.length;
        s.pts.forEach((q, i) => { g.P.push(q.slice()); g.Cd.push(V.lerp(A, B, i / (n - 1)).map((x) => Math.min(1, x * shade))); g.pscale.push(1 - i / n); });
        g.lines.push(s.pts.map((_, i) => base + i));
      }
    }
    return p.look === 'ribbons' ? computeNormals(g) : g;
  });
}

// ======================================================================
// VOXELIZE
// ======================================================================
function voxelize(g, p) {
  const out = new Geo();
  if (!g.P.length) return out;
  let vs = Math.max(0.005, p.size);
  const bb = g.bbox(); if (p.mode === 'heightfield') bb.min[1] = Math.min(bb.min[1], p.floor);
  const span = V.sub(bb.max, bb.min);
  while (((span[0] / vs + 2) * (span[1] / vs + 2) * (span[2] / vs + 2)) > 3e6) vs *= 1.2;
  const o = V.sub(bb.min, [vs * 0.5, vs * 0.5, vs * 0.5]);
  const nx = Math.ceil(span[0] / vs) + 2, ny = Math.ceil(span[1] / vs) + 2, nz = Math.ceil(span[2] / vs) + 2;
  const id = (i, j, k) => i + j * nx + k * nx * ny;
  const occ = new Uint8Array(nx * ny * nz), col = new Float32Array(nx * ny * nz * 3), cw = new Float32Array(nx * ny * nz);
  const cell = (q) => [Math.floor((q[0] - o[0]) / vs), Math.floor((q[1] - o[1]) / vs), Math.floor((q[2] - o[2]) / vs)];
  let markOcc = true;
  const mark = (q, c) => { const [i, j, k] = cell(q); if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return; const x = id(i, j, k); if (markOcc) occ[x] = 1; if (c) { col[x * 3] += c[0]; col[x * 3 + 1] += c[1]; col[x * 3 + 2] += c[2]; cw[x]++; } };
  const tris = g.prims.length ? triList(g) : [];
  // surface shell by dense triangle sampling (also records surface colour)
  const shell = () => {
    for (const [a, b, c] of tris) {
      const A = g.P[a], B = g.P[b], C = g.P[c], m = Math.max(1, Math.ceil(Math.max(V.len(V.sub(B, A)), V.len(V.sub(C, A)), V.len(V.sub(C, B))) / (vs * 0.45)));
      for (let i = 0; i <= m; i++) for (let j = 0; j <= m - i; j++) {
        const u = i / m, v = j / m, q = V.add(V.mul(A, 1 - u - v), V.add(V.mul(B, u), V.mul(C, v)));
        mark(q, g.Cd ? V.add(V.mul(g.Cd[a], 1 - u - v), V.add(V.mul(g.Cd[b], u), V.mul(g.Cd[c], v))) : null);
      }
    }
  };
  if (p.mode === 'points' || !tris.length) g.P.forEach((q, i) => mark(q, g.Cd ? g.Cd[i] : null));
  else if (p.mode === 'shell') shell();
  else if (p.mode === 'heightfield') {
    shell();
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { let top = -1; for (let j = ny - 1; j >= 0; j--) if (occ[id(i, j, k)]) { top = j; break; } const fj = Math.max(0, Math.floor((p.floor - o[1]) / vs)); for (let j = fj; j < top; j++) occ[id(i, j, k)] = 1; }
  } else { // solid: scanline parity along X, triangles bucketed by (y,z) column
    markOcc = false; shell(); markOcc = true;
    const buckets = new Map();
    tris.forEach((t, ti) => {
      const ys = t.slice(0, 3).map((x) => g.P[x][1]), zs = t.slice(0, 3).map((x) => g.P[x][2]);
      for (let j = Math.floor((Math.min(...ys) - o[1]) / vs - 0.5); j <= Math.ceil((Math.max(...ys) - o[1]) / vs - 0.5); j++)
        for (let k = Math.floor((Math.min(...zs) - o[2]) / vs - 0.5); k <= Math.ceil((Math.max(...zs) - o[2]) / vs - 0.5); k++) { const key = j * 100000 + k; let a = buckets.get(key); if (!a) buckets.set(key, (a = [])); a.push(ti); }
    });
    for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
      const arr = buckets.get(j * 100000 + k); if (!arr) continue;
      const y = o[1] + (j + 0.5) * vs + 1e-7, z = o[2] + (k + 0.5) * vs + 1.3e-7, xs = [];
      for (const ti of arr) {
        const [a, b, c] = tris[ti], A = g.P[a], B = g.P[b], C = g.P[c];
        const d = (B[1] - A[1]) * (C[2] - A[2]) - (C[1] - A[1]) * (B[2] - A[2]); if (Math.abs(d) < 1e-14) continue;
        const u = ((y - A[1]) * (C[2] - A[2]) - (C[1] - A[1]) * (z - A[2])) / d, v = ((B[1] - A[1]) * (z - A[2]) - (y - A[1]) * (B[2] - A[2])) / d;
        if (u < 0 || v < 0 || u + v > 1) continue;
        xs.push(A[0] + u * (B[0] - A[0]) + v * (C[0] - A[0]));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(0, Math.ceil((xs[q] - o[0]) / vs - 0.5)); i <= Math.min(nx - 1, Math.floor((xs[q + 1] - o[0]) / vs - 0.5)); i++) occ[id(i, j, k)] = 1;
    }
  }
  // colours
  const A = hex2rgb(p.c1), B = hex2rgb(p.c2), bbY = [bb.min[1], bb.max[1]];
  const colorOf = (i, j, k) => {
    const x = id(i, j, k), cy = o[1] + (j + 0.5) * vs;
    let c;
    if (p.colorMode === 'source' && cw[x] > 0) c = [col[x * 3] / cw[x], col[x * 3 + 1] / cw[x], col[x * 3 + 2] / cw[x]];
    else if (p.colorMode === 'source' && g.Cd) { // interior: nearest coloured voxel above in the column
      for (let jj = j + 1; jj < ny; jj++) { const y2 = id(i, jj, k); if (cw[y2] > 0) { c = [col[y2 * 3] / cw[y2], col[y2 * 3 + 1] / cw[y2], col[y2 * 3 + 2] / cw[y2]]; break; } }
      c = c || A.slice();
    } else if (p.colorMode === 'height') c = V.lerp(A, B, clamp((cy - bbY[0]) / (bbY[1] - bbY[0] || 1), 0, 1));
    else c = p.colorMode === 'constant' ? A.slice() : V.lerp(A, B, 0.5);
    const jt = (rand(i * 1.31 + j * 7.77 + k * 3.17) - 0.5) * p.jitter;
    return c.map((x2) => clamp(x2 * (1 + jt), 0, 1));
  };
  const filled = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && occ[id(i, j, k)] === 1;
  out.Cd = [];
  if (p.output === 'points') {
    out.pscale = [];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (occ[id(i, j, k)]) { out.P.push([o[0] + (i + 0.5) * vs, o[1] + (j + 0.5) * vs, o[2] + (k + 0.5) * vs]); out.Cd.push(colorOf(i, j, k)); out.pscale.push(vs); }
    out.N = out.P.map(() => [0, 1, 0]);
    return out;
  }
  const FACES = [[[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]], [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]], [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]], [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]]];
  const gap = clamp(p.gap, 0, 0.9) * 0.5;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!occ[id(i, j, k)]) continue;
    const c = colorOf(i, j, k);
    for (const [n, corners] of FACES) {
      if (gap === 0 && filled(i + n[0], j + n[1], k + n[2])) continue; // only exposed faces
      const base = out.P.length;
      for (const cc of corners) { out.P.push([o[0] + (i + gap + cc[0] * (1 - 2 * gap)) * vs, o[1] + (j + gap + cc[1] * (1 - 2 * gap)) * vs, o[2] + (k + gap + cc[2] * (1 - 2 * gap)) * vs]); out.Cd.push(c.slice()); }
      out.prims.push([base, base + 1, base + 2, base + 3]);
    }
  }
  return computeNormals(out);
}


// ---------- painted masks: compact base64 storage (one byte per point) ----------
function encodeMask(m) {
  const b = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) b[i] = Math.round(clamp(m[i], 0, 1) * 255);
  let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return m.length + ':' + btoa(s);
}
function encodeRGBA(rgba) { // Float32Array n*4 -> 'c4:n:base64'
  const b = new Uint8Array(rgba.length); for (let i = 0; i < rgba.length; i++) b[i] = Math.round(clamp(rgba[i], 0, 1) * 255);
  let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return 'c4:' + rgba.length / 4 + ':' + btoa(s);
}
function decodeRGBA(str) {
  if (!str || !str.startsWith('c4:')) return null;
  const k = str.indexOf(':', 3), n = +str.slice(3, k), bin = atob(str.slice(k + 1)), out = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) out[i] = (bin.charCodeAt(i) || 0) / 255;
  return { n, rgba: out };
}
function decodeMask(str) {
  if (str && str.startsWith('c4:')) return null;
  if (!str) return null; const k = str.indexOf(':'); if (k < 0) return null;
  const n = +str.slice(0, k), bin = atob(str.slice(k + 1)), out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (bin.charCodeAt(i) || 0) / 255;
  return out;
}
const paintAttrName = (p) => (p.attr === 'custom' ? String(p.name || 'weight').replace(/[^\w]/g, '') || 'weight' : p.attr);
const paintDefault = (attr) => (attr === 'mask' ? 0 : attrDef(attr));

// ---------- imported files (assets) ----------
// asset: { id, name, format, kind: 'mesh'|'cache', n, prims:{off,idx}|null, lines:{off,idx}|null, Cd:Float32Array|null,
//          piece:Int32Array|null (per prim), frames:[Float32Array n*3], times:Float64Array (seconds) }
const ASSETS = new Map();
function registerAsset(a) { ASSETS.set(a.id, a); }
function unflatList(L) { if (!L) return []; const out = new Array(L.off.length - 1); for (let i = 0; i < out.length; i++) out[i] = Array.from(L.idx.subarray(L.off[i], L.off[i + 1])); return out; }
function sampleAsset(a, p, ctx) {
  const F = a.frames, nf = F.length;
  if (nf === 1) return { P: F[0], P2: null, t: 0 };
  const T = a.times, t0 = T[0], t1 = T[nf - 1], span = t1 - t0;
  let t = ((ctx.frame - 1 - p.frameOffset) / (ctx.fps || 24)) * p.speed + t0;
  if (p.outside === 'loop' && span > 0) t = t0 + ((((t - t0) % span) + span) % span);
  else t = clamp(t, t0, t1);
  let lo = 0, hi = nf - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  const w = T[hi] > T[lo] ? clamp((t - T[lo]) / (T[hi] - T[lo]), 0, 1) : 0;
  return p.interpolate && w > 1e-6 && w < 1 - 1e-6 ? { P: F[lo], P2: F[hi], t: w } : { P: w > 0.5 ? F[hi] : F[lo], P2: null, t: 0 };
}
function fileCook(p, [inp], ctx) {
  if (!p.asset) throw new Error('No file yet — click “📂 Import file…” in the parameters');
  const a = ASSETS.get(p.asset);
  if (!a) throw new Error('This file’s data isn’t loaded — import it again with “📂 Import file…”');
  const S = sampleAsset(a, p, ctx), n = a.n;
  const zup = p.upAxis === 'z', sc = p.scale;
  const P = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = S.P[i * 3], y = S.P[i * 3 + 1], z = S.P[i * 3 + 2];
    if (S.P2) { x += (S.P2[i * 3] - x) * S.t; y += (S.P2[i * 3 + 1] - y) * S.t; z += (S.P2[i * 3 + 2] - z) * S.t; }
    P[i] = zup ? [x * sc, z * sc, -y * sc] : [x * sc, y * sc, z * sc];
  }
  if (a.kind === 'cache' && inp) {
    if (inp.P.length !== n) throw new Error(`The cache has ${n.toLocaleString()} points but the input geometry has ${inp.P.length.toLocaleString()} — they must match`);
    const g = inp.clone(); g.P = P; return g.prims.length ? computeNormals(g) : g;
  }
  const g = new Geo();
  g.P = P;
  g.prims = unflatList(a.prims); g.lines = unflatList(a.lines);
  if (a.Cd) { g.Cd = new Array(n); for (let i = 0; i < n; i++) g.Cd[i] = [a.Cd[i * 3], a.Cd[i * 3 + 1], a.Cd[i * 3 + 2]]; }
  if (a.piece && a.piece.length === g.prims.length) g.piece = Array.from(a.piece);
  if (zup) g.prims = g.prims; // handedness is preserved by the axis swap (a rotation), so winding stays valid
  return g.prims.length ? computeNormals(g) : g;
}
// ---------- node type registry ----------
const hex2rgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

const CAT_COLORS = { Generate: '#4f8cc9', Deform: '#c9844f', Topology: '#9a6ccf', Points: '#3fae8c', Dynamics: '#e0603a', Attribute: '#c94f7c', Utility: '#7d8590' };

const NODE_TYPES = {
  file: {
    label: 'File', cat: 'Generate', inputs: 1, optionalInputs: true, inputNames: ['geometry to apply a point cache to (optional)'],
    timeDep: (node) => { const a = ASSETS.get(node.params.asset); return !!a && a.frames.length > 1; },
    params: [
      { n: 'asset', l: 'File', t: 'file', d: '' },
      { n: 'frameOffset', l: 'Frame Offset', t: 'int', d: 0, min: -500, max: 500 },
      { n: 'speed', l: 'Speed', t: 'float', d: 1, min: 0, max: 4 },
      { n: 'outside', l: 'Outside Range', t: 'menu', d: 'hold', options: [['hold', 'Hold first/last frame'], ['loop', 'Loop']] },
      { n: 'interpolate', l: 'Interpolate Frames', t: 'toggle', d: true },
      { n: 'scale', l: 'Scale', t: 'float', d: 1, min: 0.0001, max: 100 },
      { n: 'upAxis', l: 'Up Axis', t: 'menu', d: 'y', options: [['y', 'Y up (as in file)'], ['z', 'Z up → convert to Y up']] },
    ],
    cook: (p, ins, ctx) => fileCook(p, ins, ctx),
  },
  box: {
    label: 'Box', cat: 'Generate', inputs: 0,
    params: [{ n: 'size', l: 'Size', t: 'vec3', d: [1, 1, 1] }, { n: 'center', l: 'Center', t: 'vec3', d: [0, 0, 0] }, { n: 'divs', l: 'Divisions', t: 'int', d: 1, min: 1, max: 20 }, { n: 'scale', l: 'Uniform Scale', t: 'float', d: 1, min: 0, max: 5 }],
    cook: (p) => boxGeo(V.mul(p.size, p.scale), p.center, p.divs),
  },
  sphere: {
    label: 'Sphere', cat: 'Generate', inputs: 0,
    params: [{ n: 'radius', l: 'Radius', t: 'float', d: 1, min: 0, max: 5 }, { n: 'center', l: 'Center', t: 'vec3', d: [0, 0, 0] }, { n: 'rows', l: 'Rows', t: 'int', d: 16, min: 3, max: 128 }, { n: 'cols', l: 'Columns', t: 'int', d: 24, min: 3, max: 128 }],
    cook: (p) => sphereGeo(p.radius, p.rows, p.cols, p.center),
  },
  grid: {
    label: 'Grid', cat: 'Generate', inputs: 0,
    params: [{ n: 'sizex', l: 'Size X', t: 'float', d: 10, min: 0, max: 50 }, { n: 'sizez', l: 'Size Z', t: 'float', d: 10, min: 0, max: 50 }, { n: 'rows', l: 'Rows', t: 'int', d: 20, min: 2, max: 300 }, { n: 'cols', l: 'Columns', t: 'int', d: 20, min: 2, max: 300 }, { n: 'center', l: 'Center', t: 'vec3', d: [0, 0, 0] }],
    cook: (p) => gridGeo(p.sizex, p.sizez, p.rows, p.cols, p.center),
  },
  torus: {
    label: 'Torus', cat: 'Generate', inputs: 0,
    params: [{ n: 'R', l: 'Major Radius', t: 'float', d: 1, min: 0, max: 5 }, { n: 'r', l: 'Minor Radius', t: 'float', d: 0.35, min: 0, max: 3 }, { n: 'cols', l: 'Columns', t: 'int', d: 32, min: 3, max: 200 }, { n: 'rows', l: 'Rows', t: 'int', d: 16, min: 3, max: 100 }, { n: 'center', l: 'Center', t: 'vec3', d: [0, 0, 0] }],
    cook: (p) => torusGeo(p.R, p.r, p.rows, p.cols, p.center),
  },
  tube: {
    label: 'Tube', cat: 'Generate', inputs: 0,
    params: [{ n: 'r1', l: 'Radius Bottom', t: 'float', d: 0.5, min: 0, max: 5 }, { n: 'r2', l: 'Radius Top', t: 'float', d: 0.5, min: 0, max: 5 }, { n: 'h', l: 'Height', t: 'float', d: 2, min: 0, max: 20 }, { n: 'rows', l: 'Rows', t: 'int', d: 8, min: 2, max: 200 }, { n: 'cols', l: 'Columns', t: 'int', d: 24, min: 3, max: 200 }, { n: 'caps', l: 'End Caps', t: 'toggle', d: true }, { n: 'center', l: 'Center', t: 'vec3', d: [0, 0, 0] }],
    cook: (p) => tubeGeo(p.r1, p.r2, p.h, p.rows, p.cols, p.caps, p.center),
  },
  circle: {
    label: 'Circle', cat: 'Generate', inputs: 0,
    params: [{ n: 'radius', l: 'Radius', t: 'float', d: 1, min: 0, max: 10 }, { n: 'divs', l: 'Divisions', t: 'int', d: 32, min: 3, max: 256 }, { n: 'filled', l: 'Filled Polygon', t: 'toggle', d: true }, { n: 'center', l: 'Center', t: 'vec3', d: [0, 0, 0] }],
    cook: (p) => circleGeo(p.radius, p.divs, p.filled, p.center),
  },
  line: {
    label: 'Line', cat: 'Generate', inputs: 0,
    params: [{ n: 'origin', l: 'Origin', t: 'vec3', d: [0, 0, 0] }, { n: 'dir', l: 'Direction', t: 'vec3', d: [0, 1, 0] }, { n: 'length', l: 'Length', t: 'float', d: 2, min: 0, max: 20 }, { n: 'points', l: 'Points', t: 'int', d: 10, min: 2, max: 1000 }],
    cook: (p) => {
      const g = new Geo(), d = V.norm(p.dir), n = Math.max(2, p.points | 0);
      for (let i = 0; i < n; i++) g.P.push(V.add(p.origin, V.mul(d, (p.length * i) / (n - 1))));
      g.lines.push(g.P.map((_, i) => i));
      g.N = g.P.map(() => [0, 0, 1]);
      return g;
    },
  },
  transform: {
    label: 'Transform', cat: 'Deform', inputs: 1,
    params: [{ n: 't', l: 'Translate', t: 'vec3', d: [0, 0, 0] }, { n: 'r', l: 'Rotate', t: 'vec3', d: [0, 0, 0] }, { n: 's', l: 'Scale', t: 'vec3', d: [1, 1, 1] }, { n: 'pivot', l: 'Pivot', t: 'vec3', d: [0, 0, 0] }, { n: 'us', l: 'Uniform Scale', t: 'float', d: 1, min: 0, max: 5 }],
    cook: (p, [g]) => {
      g = g.clone(); const M = rotMatrix(...p.r);
      g.P = g.P.map((q) => V.add(V.add(mulM(M, [(q[0] - p.pivot[0]) * p.s[0] * p.us, (q[1] - p.pivot[1]) * p.s[1] * p.us, (q[2] - p.pivot[2]) * p.s[2] * p.us]), p.pivot), p.t));
      if (g.N) g.N = g.N.map((n) => V.norm(mulM(M, n)));
      return g;
    },
  },
  mountain: {
    label: 'Mountain', cat: 'Deform', inputs: 1,
    params: [{ n: 'height', l: 'Height', t: 'float', d: 1, min: -5, max: 5 }, { n: 'freq', l: 'Element Size', t: 'float', d: 1, min: 0.05, max: 10 }, { n: 'octaves', l: 'Octaves', t: 'int', d: 5, min: 1, max: 8 }, { n: 'rough', l: 'Roughness', t: 'float', d: 0.5, min: 0, max: 1 }, { n: 'offset', l: 'Offset', t: 'vec3', d: [0, 0, 0] }],
    cook: (p, [g]) => {
      g = computeNormals(g.clone());
      const s = 1 / Math.max(1e-4, p.freq);
      g.P = g.P.map((q, i) => {
        const v = fbm(q[0] * s + p.offset[0] + 0.31, q[1] * s + p.offset[1] + 0.17, q[2] * s + p.offset[2] + 0.53, p.octaves, p.rough);
        return V.add(q, V.mul(g.N[i], v * p.height));
      });
      return computeNormals(g);
    },
  },
  twist: {
    label: 'Twist', cat: 'Deform', inputs: 1,
    params: [{ n: 'strength', l: 'Twist (deg/unit)', t: 'float', d: 90, min: -720, max: 720 }, { n: 'taper', l: 'Taper', t: 'float', d: 0, min: -1, max: 1 }, { n: 'pivot', l: 'Pivot Y', t: 'float', d: 0, min: -5, max: 5 }],
    cook: (p, [g]) => {
      g = g.clone();
      g.P = g.P.map((q) => {
        const y = q[1] - p.pivot, a = (p.strength * y * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), k = Math.max(0, 1 + p.taper * y);
        return [(q[0] * c - q[2] * s) * k, q[1], (q[0] * s + q[2] * c) * k];
      });
      return g;
    },
  },
  smooth: {
    label: 'Smooth', cat: 'Deform', inputs: 1,
    params: [{ n: 'iters', l: 'Iterations', t: 'int', d: 5, min: 0, max: 100 }, { n: 'strength', l: 'Strength', t: 'float', d: 0.5, min: 0, max: 1 }],
    cook: (p, [g]) => smoothGeo(g.clone(), p.iters | 0, p.strength),
  },
  wrangle: {
    label: 'Point Wrangle', cat: 'Deform', inputs: 1,
    params: [{ n: 'code', l: 'Snippet', t: 'code', d: '// Runs once per point. Attributes: @P @N @Cd @pscale\n// Globals: @ptnum @numpt @Time @Frame\n// Helpers: noise() fbm() rand() fit() mix() vec() + Math\n@P.y += sin(@P.x * 2 + @Time * 3) * 0.25;\n@Cd = vec(fit(@P.y, -0.25, 0.25, 0.1, 1), 0.45, 0.9);' }],
    cook: (p, [g], ctx) => pointWrangle(g.clone(), p.code, ctx),
  },
  subdivide: {
    label: 'Subdivide', cat: 'Topology', inputs: 1,
    params: [{ n: 'depth', l: 'Depth', t: 'int', d: 1, min: 0, max: 4 }, { n: 'smooth', l: 'Smooth (Catmull-Clark)', t: 'toggle', d: true }],
    cook: (p, [g]) => { let o = g.clone(); for (let i = 0; i < Math.min(5, p.depth | 0); i++) o = subdivide(o, p.smooth); return o; },
  },
  polyextrude: {
    label: 'PolyExtrude', cat: 'Topology', inputs: 1,
    params: [{ n: 'dist', l: 'Distance', t: 'float', d: 0.2, min: -2, max: 2 }, { n: 'inset', l: 'Inset', t: 'float', d: 0.2, min: -1, max: 1 }, { n: 'keepBase', l: 'Keep Base', t: 'toggle', d: false }],
    cook: (p, [g]) => polyExtrude(g, p.dist, p.inset, p.keepBase),
  },
  delete: {
    label: 'Delete', cat: 'Topology', inputs: 1,
    params: [{ n: 'expr', l: 'Delete If', t: 'string', d: 'rand(@primnum) < 0.3' }, { n: 'invert', l: 'Keep Instead', t: 'toggle', d: false }],
    cook: (p, [g], ctx) => deletePrims(g.clone(), p.expr, p.invert, ctx),
  },
  fuse: {
    label: 'Fuse', cat: 'Topology', inputs: 1,
    params: [{ n: 'tol', l: 'Distance', t: 'float', d: 0.001, min: 0, max: 0.5 }],
    cook: (p, [g]) => fuse(g, Math.max(1e-7, p.tol)),
  },
  scatter: {
    label: 'Scatter', cat: 'Points', inputs: 1,
    params: [{ n: 'count', l: 'Point Count', t: 'int', d: 200, min: 0, max: 20000 }, { n: 'seed', l: 'Seed', t: 'int', d: 1, min: 0, max: 100 }, { n: 'useMask', l: 'Density From Paint', t: 'toggle', d: true }],
    cook: (p, [g]) => scatter(g, Math.max(0, p.count | 0), p.seed | 0, p.useMask),
  },
  copytopoints: {
    label: 'Copy to Points', cat: 'Points', inputs: 2, inputNames: ['geometry', 'target points'],
    params: [{ n: 'scale', l: 'Uniform Scale', t: 'float', d: 1, min: 0, max: 5 }, { n: 'randScale', l: 'Random Scale', t: 'float', d: 0, min: 0, max: 1 }, { n: 'randRot', l: 'Random Rotation', t: 'float', d: 0, min: 0, max: 1 }, { n: 'align', l: 'Align to Normal', t: 'toggle', d: true }, { n: 'useColor', l: 'Inherit Point Color', t: 'toggle', d: false }, { n: 'seed', l: 'Seed', t: 'int', d: 0, min: 0, max: 100 }],
    cook: (p, [a, b]) => copyToPoints(a, b, p),
  },
  color: {
    label: 'Color', cat: 'Attribute', inputs: 1,
    params: [{ n: 'mode', l: 'Mode', t: 'menu', d: 'ramp', options: [['constant', 'Constant'], ['ramp', 'Ramp by Height'], ['noise', 'Noise'], ['randpt', 'Random per Point'], ['randprim', 'Random per Primitive']] }, { n: 'c1', l: 'Color A', t: 'color', d: '#2a4d7a' }, { n: 'c2', l: 'Color B', t: 'color', d: '#f2c27a' }, { n: 'freq', l: 'Noise Size', t: 'float', d: 1, min: 0.05, max: 10 }, { n: 'seed', l: 'Seed', t: 'int', d: 0, min: 0, max: 100 }],
    cook: (p, [g]) => {
      g = p.mode === 'randprim' ? unshare(g) : g.clone();
      const A = hex2rgb(p.c1), B = hex2rgb(p.c2), lerpC = (t) => V.lerp(A, B, clamp(t, 0, 1));
      const bb = g.bbox(), h = bb.max[1] - bb.min[1] || 1;
      if (p.mode === 'constant') g.Cd = g.P.map(() => A.slice());
      else if (p.mode === 'ramp') g.Cd = g.P.map((q) => lerpC((q[1] - bb.min[1]) / h));
      else if (p.mode === 'noise') { const s = 1 / Math.max(1e-3, p.freq); g.Cd = g.P.map((q) => lerpC(0.5 + fbm(q[0] * s + p.seed, q[1] * s, q[2] * s, 3) * 1.2)); }
      else if (p.mode === 'randpt') g.Cd = g.P.map((_, i) => lerpC(rand(i + p.seed * 101)));
      else {
        g.Cd = g.P.map(() => A.slice());
        g.prims.forEach((f, i) => { const c = lerpC(rand(i + p.seed * 101)); f.forEach((v) => (g.Cd[v] = c.slice())); });
      }
      return g;
    },
  },
  normal: {
    label: 'Normal', cat: 'Attribute', inputs: 1,
    params: [{ n: 'reverse', l: 'Reverse Winding', t: 'toggle', d: false }],
    cook: (p, [g]) => { g = g.clone(); if (p.reverse) g.prims = g.prims.map((f) => f.slice().reverse()); return computeNormals(g); },
  },
  particles: {
    label: 'Particles', cat: 'Dynamics', inputs: 2, timeDep: true, inputNames: ['emitter', 'collider (optional)'],
    params: [
      { n: 'rate', l: 'Birth Rate (/sec)', t: 'float', d: 400, min: 0, max: 5000 },
      { n: 'burst', l: 'Burst on Frame 1', t: 'int', d: 0, min: 0, max: 5000 },
      { n: 'life', l: 'Life (sec)', t: 'float', d: 3, min: 0.05, max: 20 },
      { n: 'lifeVar', l: 'Life Variance', t: 'float', d: 0.3, min: 0, max: 1 },
      { n: 'speed', l: 'Speed Along Normal', t: 'float', d: 4, min: -20, max: 20 },
      { n: 'vel', l: 'Initial Velocity', t: 'vec3', d: [0, 0, 0] },
      { n: 'spread', l: 'Random Velocity', t: 'float', d: 1, min: 0, max: 10 },
      { n: 'gravity', l: 'Gravity', t: 'vec3', d: [0, -9.8, 0] },
      { n: 'wind', l: 'Wind', t: 'vec3', d: [0, 0, 0] },
      { n: 'drag', l: 'Drag', t: 'float', d: 0.1, min: 0, max: 5 },
      { n: 'turb', l: 'Turbulence', t: 'float', d: 0, min: 0, max: 40 },
      { n: 'turbSize', l: 'Turbulence Size', t: 'float', d: 1, min: 0.05, max: 10 },
      { n: 'ground', l: 'Ground Collision', t: 'toggle', d: true },
      { n: 'groundY', l: 'Ground Height', t: 'float', d: 0, min: -10, max: 10 },
      { n: 'bounce', l: 'Bounce', t: 'float', d: 0.4, min: 0, max: 1 },
      { n: 'friction', l: 'Friction', t: 'float', d: 0.2, min: 0, max: 1 },
      { n: 'maxCount', l: 'Max Particles', t: 'int', d: 20000, min: 100, max: 100000 },
      { n: 'look', l: 'Output', t: 'menu', d: 'points', options: [['points', 'Points'], ['streaks', 'Streaks (motion lines)']] },
      { n: 'streak', l: 'Streak Length', t: 'float', d: 0.04, min: 0, max: 0.5 },
      { n: 'c1', l: 'Color Young', t: 'color', d: '#fff1b8' },
      { n: 'c2', l: 'Color Old', t: 'color', d: '#e0603a' },
      { n: 'size', l: 'Particle Scale', t: 'float', d: 1, min: 0, max: 5 },
      { n: 'shrink', l: 'Shrink with Age', t: 'toggle', d: true },
      { n: 'seed', l: 'Seed', t: 'int', d: 1, min: 0, max: 100 },
    ],
    cook: (p, ins, ctx) => simCook(p, ctx, stepParticles, particlesToGeo),
  },
  fire: {
    label: 'Fire', cat: 'Dynamics', inputs: 2, timeDep: true, inputNames: ['fuel / emitter', 'collider (optional)'],
    params: [
      { n: 'rate', l: 'Fuel Rate (/sec)', t: 'float', d: 1500, min: 0, max: 8000 },
      { n: 'burst', l: 'Burst on Frame 1', t: 'int', d: 0, min: 0, max: 5000 },
      { n: 'life', l: 'Flame Life (sec)', t: 'float', d: 0.9, min: 0.05, max: 5 },
      { n: 'lifeVar', l: 'Life Variance', t: 'float', d: 0.45, min: 0, max: 1 },
      { n: 'speed', l: 'Speed Along Normal', t: 'float', d: 0.4, min: -5, max: 10 },
      { n: 'vel', l: 'Initial Velocity', t: 'vec3', d: [0, 0.5, 0] },
      { n: 'spread', l: 'Random Velocity', t: 'float', d: 0.4, min: 0, max: 5 },
      { n: 'buoyancy', l: 'Buoyancy', t: 'float', d: 7, min: 0, max: 30 },
      { n: 'drag', l: 'Air Drag', t: 'float', d: 2.2, min: 0, max: 10 },
      { n: 'wind', l: 'Wind', t: 'vec3', d: [0, 0, 0] },
      { n: 'turb', l: 'Turbulence', t: 'float', d: 9, min: 0, max: 40 },
      { n: 'turbSize', l: 'Turbulence Size', t: 'float', d: 0.45, min: 0.05, max: 5 },
      { n: 'turbSpeed', l: 'Turbulence Speed', t: 'float', d: 2.5, min: 0, max: 10 },
      { n: 'flameSize', l: 'Flame Size', t: 'float', d: 0.22, min: 0.01, max: 2 },
      { n: 'intensity', l: 'Intensity', t: 'float', d: 0.24, min: 0, max: 3 },
      { n: 'tint', l: 'Flame Tint', t: 'color', d: '#ffffff' },
      { n: 'smoke', l: 'Emit Smoke', t: 'toggle', d: true },
      { n: 'smokeLife', l: 'Smoke Life (sec)', t: 'float', d: 2.5, min: 0.1, max: 10 },
      { n: 'smokeDensity', l: 'Smoke Density', t: 'float', d: 0.22, min: 0, max: 1 },
      { n: 'smokeBuoy', l: 'Smoke Buoyancy', t: 'float', d: 0.45, min: 0, max: 2 },
      { n: 'smokeColor', l: 'Smoke Color', t: 'color', d: '#2e2b29' },
      { n: 'ground', l: 'Ground Collision', t: 'toggle', d: false },
      { n: 'groundY', l: 'Ground Height', t: 'float', d: 0, min: -10, max: 10 },
      { n: 'maxCount', l: 'Max Particles', t: 'int', d: 15000, min: 100, max: 60000 },
      { n: 'seed', l: 'Seed', t: 'int', d: 1, min: 0, max: 100 },
    ],
    cook: (p, ins, ctx) => simCook(p, ctx, stepFire, fireToGeo),
  },
  water: {
    label: 'Water', cat: 'Dynamics', inputs: 2, timeDep: true, inputNames: ['source', 'collider (optional)'],
    params: [
      { n: 'mode', l: 'Source', t: 'menu', d: 'fill', options: [['fill', 'Fill Volume (frame 1)'], ['emit', 'Emit from Surface'], ['both', 'Fill + Emit']] },
      { n: 'rate', l: 'Emit Rate (/sec)', t: 'float', d: 600, min: 0, max: 5000 },
      { n: 'speed', l: 'Speed Along Normal', t: 'float', d: 2, min: -10, max: 20 },
      { n: 'vel', l: 'Initial Velocity', t: 'vec3', d: [0, 0, 0] },
      { n: 'spread', l: 'Random Velocity', t: 'float', d: 0.1, min: 0, max: 5 },
      { n: 'sep', l: 'Particle Separation', t: 'float', d: 0.1, min: 0.03, max: 0.5 },
      { n: 'gravity', l: 'Gravity', t: 'vec3', d: [0, -9.8, 0] },
      { n: 'viscosity', l: 'Viscosity', t: 'float', d: 0.05, min: 0, max: 1 },
      { n: 'substeps', l: 'Substeps', t: 'int', d: 2, min: 1, max: 8 },
      { n: 'iterations', l: 'Solver Iterations', t: 'int', d: 3, min: 1, max: 10 },
      { n: 'ground', l: 'Ground Collision', t: 'toggle', d: true },
      { n: 'groundY', l: 'Ground Height', t: 'float', d: 0, min: -10, max: 10 },
      { n: 'bounds', l: 'Container Box', t: 'toggle', d: false },
      { n: 'bsize', l: 'Container Size', t: 'vec3', d: [4, 6, 4] },
      { n: 'bcenter', l: 'Container Center', t: 'vec3', d: [0, 3, 0] },
      { n: 'life', l: 'Life (0 = forever)', t: 'float', d: 0, min: 0, max: 30 },
      { n: 'maxCount', l: 'Max Particles', t: 'int', d: 5000, min: 100, max: 30000 },
      { n: 'c1', l: 'Deep Color', t: 'color', d: '#1d5fa8' },
      { n: 'c2', l: 'Foam Color', t: 'color', d: '#e6f6ff' },
      { n: 'foamSpeed', l: 'Foam Speed', t: 'float', d: 5, min: 0.1, max: 20 },
      { n: 'seed', l: 'Seed', t: 'int', d: 1, min: 0, max: 100 },
    ],
    cook: (p, ins, ctx) => simCook(p, ctx, stepWater, waterToGeo),
  },
  sand: {
    label: 'Sand', cat: 'Dynamics', inputs: 2, timeDep: true, inputNames: ['source', 'collider (optional)'],
    params: [
      { n: 'mode', l: 'Source', t: 'menu', d: 'emit', options: [['emit', 'Emit from Surface'], ['fill', 'Fill Volume (frame 1)'], ['both', 'Fill + Emit']] },
      { n: 'rate', l: 'Emit Rate (/sec)', t: 'float', d: 500, min: 0, max: 5000 },
      { n: 'speed', l: 'Speed Along Normal', t: 'float', d: 0, min: -10, max: 20 },
      { n: 'vel', l: 'Initial Velocity', t: 'vec3', d: [0, -1, 0] },
      { n: 'spread', l: 'Random Velocity', t: 'float', d: 0.15, min: 0, max: 5 },
      { n: 'grain', l: 'Grain Radius', t: 'float', d: 0.045, min: 0.01, max: 0.3 },
      { n: 'friction', l: 'Friction', t: 'float', d: 0.6, min: 0, max: 1.5 },
      { n: 'gravity', l: 'Gravity', t: 'vec3', d: [0, -9.8, 0] },
      { n: 'damping', l: 'Air Damping', t: 'float', d: 0.1, min: 0, max: 5 },
      { n: 'sleep', l: 'Sleep Speed', t: 'float', d: 0.06, min: 0, max: 1 },
      { n: 'substeps', l: 'Substeps', t: 'int', d: 3, min: 1, max: 8 },
      { n: 'iterations', l: 'Solver Iterations', t: 'int', d: 3, min: 1, max: 10 },
      { n: 'ground', l: 'Ground Collision', t: 'toggle', d: true },
      { n: 'groundY', l: 'Ground Height', t: 'float', d: 0, min: -10, max: 10 },
      { n: 'bounds', l: 'Container Box', t: 'toggle', d: false },
      { n: 'bsize', l: 'Container Size', t: 'vec3', d: [4, 6, 4] },
      { n: 'bcenter', l: 'Container Center', t: 'vec3', d: [0, 3, 0] },
      { n: 'maxCount', l: 'Max Particles', t: 'int', d: 6000, min: 100, max: 30000 },
      { n: 'c1', l: 'Grain Color A', t: 'color', d: '#c9a66b' },
      { n: 'c2', l: 'Grain Color B', t: 'color', d: '#e8d3a2' },
      { n: 'seed', l: 'Seed', t: 'int', d: 1, min: 0, max: 100 },
    ],
    cook: (p, ins, ctx) => simCook(p, ctx, stepSand, sandToGeo),
  },
  fluidsurface: {
    label: 'Fluid Surface', cat: 'Dynamics', inputs: 1, inputNames: ['particles'],
    params: [
      { n: 'radius', l: 'Particle Radius', t: 'float', d: 0.07, min: 0.005, max: 0.5 },
      { n: 'voxel', l: 'Voxel Size', t: 'float', d: 0.05, min: 0.01, max: 0.3 },
      { n: 'iso', l: 'Surface Threshold', t: 'float', d: 0.55, min: 0.05, max: 3 },
      { n: 'smooth', l: 'Smoothing Iterations', t: 'int', d: 6, min: 0, max: 40 },
      { n: 'material', l: 'Material', t: 'menu', d: 'water', options: [['plastic', 'Plastic (default)'], ['water', 'Water (refractive)'], ['glass', 'Glass'], ['metal', 'Metal'], ['glow', 'Glow / emissive']] },
      { n: 'colorMode', l: 'Color', t: 'menu', d: 'constant', options: [['constant', 'Constant tint'], ['particles', 'From particle colours']] },
      { n: 'color', l: 'Tint', t: 'color', d: '#2f8fe0' },
    ],
    cook: (p, [g]) => fluidSurface(g, p),
  },
  paint: {
    label: 'Paint', cat: 'Attribute', inputs: 1,
    params: [
      { n: 'attr', l: 'Attribute', t: 'menu', d: 'mask', options: [['mask', 'Mask (hair density, cloth pins, emission)'], ['length', 'Hair length'], ['stiffness', 'Stiffness (hair & cloth)'], ['Cd', 'Colour'], ['custom', 'Custom attribute…']] },
      { n: 'name', l: 'Custom Name', t: 'string', d: 'weight', showIf: (p) => p.attr === 'custom' },
      { n: 'data', l: 'Painted Values', t: 'paint', d: '' },
      { n: 'invert', l: 'Invert', t: 'toggle', d: false },
      { n: 'blur', l: 'Blur', t: 'int', d: 0, min: 0, max: 20 },
    ],
    cook: (p, [g]) => {
      g = g.clone();
      const n = g.P.length, attr = paintAttrName(p);
      const nb = () => { const s2 = Array.from({ length: n }, () => new Set()); for (const f of g.prims) for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; s2[a].add(b); s2[b].add(a); } return s2; };
      if (attr === 'Cd') {
        const base = g.Cd || g.P.map(() => [0.8, 0.8, 0.8]), d = decodeRGBA(p.data);
        if (d && d.n !== n) throw new Error(`Painted on ${d.n} points but the input now has ${n} — use Clear to repaint`);
        let a = d ? Array.from({ length: n }, (_, i) => d.rgba[i * 4 + 3]) : g.P.map(() => 0);
        if (p.blur > 0) { const N = nb(); for (let it = 0; it < p.blur; it++) a = a.map((v, i) => { if (!N[i].size) return v; let t = 0; N[i].forEach((j) => (t += a[j])); return v * 0.5 + (t / N[i].size) * 0.5; }); }
        if (p.invert) a = a.map((v) => 1 - v);
        g.attrs = g.attrs || {};
        g.attrs.__base_r = base.map((c) => c[0]); g.attrs.__base_g = base.map((c) => c[1]); g.attrs.__base_b = base.map((c) => c[2]);
        g.Cd = base.map((c, i) => (d ? V.lerp(c, [d.rgba[i * 4], d.rgba[i * 4 + 1], d.rgba[i * 4 + 2]], a[i]) : c.slice()));
        return g;
      }
      const m = decodeMask(p.data);
      if (m && m.length !== n) throw new Error(`Painted on ${m.length} points but the input now has ${n} — use Clear to repaint`);
      let vals = m || g.P.map(() => paintDefault(attr));
      if (p.blur > 0) { const N = nb(); for (let it = 0; it < p.blur; it++) vals = vals.map((v, i) => { if (!N[i].size) return v; let t = 0; N[i].forEach((j) => (t += vals[j])); return v * 0.5 + (t / N[i].size) * 0.5; }); }
      if (p.invert) vals = vals.map((v) => 1 - v);
      if (attr === 'mask') g.mask = vals; else { g.attrs = g.attrs || {}; g.attrs[attr] = vals; }
      return g;
    },
  },
  material: {
    label: 'Material', cat: 'Attribute', inputs: 1,
    params: [{ n: 'type', l: 'Material', t: 'menu', d: 'glass', options: [['plastic', 'Plastic (default)'], ['water', 'Water (refractive)'], ['glass', 'Glass'], ['metal', 'Metal'], ['glow', 'Glow / emissive']] }],
    cook: (p, [g]) => { g = g.clone(); g.primMat = g.prims.map(() => (p.type === 'plastic' ? null : p.type)); return g; },
  },
  whitewater: {
    label: 'Whitewater', cat: 'Dynamics', inputs: 2, timeDep: true, inputNames: ['water particles', 'collider (optional)'],
    params: [
      { n: 'rate', l: 'Emission Rate', t: 'float', d: 18, min: 0, max: 500 },
      { n: 'wTrapped', l: 'Trapped Air Weight', t: 'float', d: 1, min: 0, max: 3 },
      { n: 'wCrest', l: 'Wave Crest Weight', t: 'float', d: 1, min: 0, max: 3 },
      { n: 'kMin', l: 'Min Energy', t: 'float', d: 1, min: 0, max: 20 },
      { n: 'kMax', l: 'Max Energy', t: 'float', d: 6, min: 0.1, max: 40 },
      { n: 'taMin', l: 'Trapped Air Min', t: 'float', d: 1.5, min: 0, max: 20 },
      { n: 'taMax', l: 'Trapped Air Max', t: 'float', d: 8, min: 0.1, max: 40 },
      { n: 'wcMin', l: 'Crest Min', t: 'float', d: 0.6, min: 0, max: 10 },
      { n: 'wcMax', l: 'Crest Max', t: 'float', d: 3, min: 0.1, max: 20 },
      { n: 'life', l: 'Lifespan (sec)', t: 'float', d: 2.5, min: 0.1, max: 15 },
      { n: 'sep', l: 'Water Separation (0 = auto)', t: 'float', d: 0, min: 0, max: 0.5 },
      { n: 'sprayN', l: 'Spray Below N Neighbours', t: 'int', d: 5, min: 0, max: 60 },
      { n: 'bubbleN', l: 'Bubble Above N Neighbours', t: 'int', d: 20, min: 1, max: 80 },
      { n: 'surfaceN', l: 'Surface Below N Neighbours', t: 'int', d: 18, min: 1, max: 60 },
      { n: 'gravity', l: 'Gravity', t: 'vec3', d: [0, -9.8, 0] },
      { n: 'sprayDrag', l: 'Spray Air Drag', t: 'float', d: 0.6, min: 0, max: 10 },
      { n: 'foamDrag', l: 'Foam Stickiness', t: 'float', d: 8, min: 0, max: 30 },
      { n: 'bubbleDrag', l: 'Bubble Drag', t: 'float', d: 6, min: 0, max: 30 },
      { n: 'buoyancy', l: 'Bubble Buoyancy', t: 'float', d: 1.2, min: 0, max: 10 },
      { n: 'jitter', l: 'Birth Velocity Jitter', t: 'float', d: 1, min: 0, max: 5 },
      { n: 'ground', l: 'Ground Collision', t: 'toggle', d: true },
      { n: 'groundY', l: 'Ground Height', t: 'float', d: 0, min: -10, max: 10 },
      { n: 'bounds', l: 'Container Box', t: 'toggle', d: false },
      { n: 'bsize', l: 'Container Size', t: 'vec3', d: [4, 6, 4] },
      { n: 'bcenter', l: 'Container Center', t: 'vec3', d: [0, 3, 0] },
      { n: 'maxCount', l: 'Max Particles', t: 'int', d: 15000, min: 100, max: 100000 },
      { n: 'size', l: 'Particle Size', t: 'float', d: 0.045, min: 0.005, max: 0.5 },
      { n: 'showSpray', l: 'Show Spray', t: 'toggle', d: true },
      { n: 'showFoam', l: 'Show Foam', t: 'toggle', d: true },
      { n: 'showBubbles', l: 'Show Bubbles', t: 'toggle', d: true },
      { n: 'sprayColor', l: 'Spray Color', t: 'color', d: '#ffffff' },
      { n: 'foamColor', l: 'Foam Color', t: 'color', d: '#eef6fb' },
      { n: 'bubbleColor', l: 'Bubble Color', t: 'color', d: '#bfe6ff' },
      { n: 'seed', l: 'Seed', t: 'int', d: 1, min: 0, max: 100 },
    ],
    cook: (p, ins, ctx) => simCook(p, ctx, stepWhitewater, whitewaterToGeo),
  },
  fracture: {
    label: 'Voronoi Fracture', cat: 'Topology', inputs: 1,
    params: [
      { n: 'pieces', l: 'Pieces', t: 'int', d: 24, min: 2, max: 300 },
      { n: 'seed', l: 'Seed', t: 'int', d: 1, min: 0, max: 100 },
      { n: 'bias', l: 'Cluster Toward Impact', t: 'float', d: 0, min: 0, max: 1 },
      { n: 'impact', l: 'Impact Point', t: 'vec3', d: [0, 0, 0] },
      { n: 'gap', l: 'Piece Gap', t: 'float', d: 0, min: 0, max: 0.3 },
      { n: 'colorMode', l: 'Outside Color', t: 'menu', d: 'keep', options: [['keep', 'Keep input colour'], ['random', 'Random per piece']] },
      { n: 'c1', l: 'Piece Color A', t: 'color', d: '#c9c4bb' },
      { n: 'c2', l: 'Piece Color B', t: 'color', d: '#8e8880' },
      { n: 'innerColor', l: 'Inside Color', t: 'color', d: '#d9744a' },
      { n: 'innerMat', l: 'Inside Material', t: 'menu', d: 'same', options: [['same', 'Same as outside']].concat([['plastic', 'Plastic (default)'], ['water', 'Water (refractive)'], ['glass', 'Glass'], ['metal', 'Metal'], ['glow', 'Glow / emissive']]) },
    ],
    cook: (p, [g]) => voronoiFracture(g, p),
  },
  debris: {
    label: 'Rigid Debris', cat: 'Dynamics', inputs: 2, timeDep: true, inputNames: ['fractured pieces', 'collider (optional)'],
    params: [
      { n: 'mode', l: 'Activation', t: 'menu', d: 'impact', options: [['impact', 'Shockwave from centre'], ['all', 'All pieces at start frame']] },
      { n: 'start', l: 'Start Frame', t: 'int', d: 12, min: 1, max: 500 },
      { n: 'center', l: 'Explosion Centre', t: 'vec3', d: [0, 1, 0] },
      { n: 'waveSpeed', l: 'Shockwave Speed', t: 'float', d: 8, min: 0.1, max: 100 },
      { n: 'strength', l: 'Explosion Strength', t: 'float', d: 6, min: 0, max: 60 },
      { n: 'falloff', l: 'Strength Falloff', t: 'float', d: 0.6, min: 0, max: 10 },
      { n: 'vel', l: 'Added Velocity', t: 'vec3', d: [0, 0, 0] },
      { n: 'jitter', l: 'Random Velocity', t: 'float', d: 1, min: 0, max: 10 },
      { n: 'spin', l: 'Random Spin', t: 'float', d: 6, min: 0, max: 40 },
      { n: 'gravity', l: 'Gravity', t: 'vec3', d: [0, -9.8, 0] },
      { n: 'drag', l: 'Air Drag', t: 'float', d: 0.05, min: 0, max: 5 },
      { n: 'ground', l: 'Ground Collision', t: 'toggle', d: true },
      { n: 'groundY', l: 'Ground Height', t: 'float', d: 0, min: -10, max: 10 },
      { n: 'bounce', l: 'Bounce', t: 'float', d: 0.3, min: 0, max: 1 },
      { n: 'friction', l: 'Friction', t: 'float', d: 0.6, min: 0, max: 2 },
      { n: 'rollDamp', l: 'Rolling Damping', t: 'float', d: 0.15, min: 0, max: 1 },
      { n: 'collide', l: 'Piece-Piece Collisions', t: 'toggle', d: true },
      { n: 'seed', l: 'Seed', t: 'int', d: 1, min: 0, max: 100 },
    ],
    cook: (p, ins, ctx) => debrisCook(p, ctx),
  },
  cloth: {
    label: 'Cloth', cat: 'Dynamics', inputs: 2, timeDep: true, inputNames: ['cloth mesh', 'collider (optional)'],
    params: [
      { n: 'pin', l: 'Pin Points Where', t: 'string', d: '@P.x < @bbmin.x + 0.01' },
      { n: 'pinPaint', l: 'Pin Painted Points', t: 'toggle', d: true },
      { n: 'stretch', l: 'Stretch Stiffness', t: 'float', d: 1, min: 0, max: 1 },
      { n: 'shear', l: 'Shear Stiffness', t: 'float', d: 0.6, min: 0, max: 1 },
      { n: 'compress', l: 'Compression Stiffness', t: 'float', d: 0.5, min: 0, max: 1 },
      { n: 'bend', l: 'Bend Stiffness', t: 'float', d: 0.15, min: 0, max: 1 },
      { n: 'gravity', l: 'Gravity', t: 'vec3', d: [0, -9.8, 0] },
      { n: 'wind', l: 'Wind', t: 'vec3', d: [0, 0, 0] },
      { n: 'gust', l: 'Gust Strength', t: 'float', d: 0, min: 0, max: 30 },
      { n: 'gustSize', l: 'Gust Size', t: 'float', d: 1.5, min: 0.05, max: 10 },
      { n: 'aero', l: 'Air Resistance', t: 'float', d: 1.2, min: 0, max: 10 },
      { n: 'drag', l: 'Wind Drag (along cloth)', t: 'float', d: 0.35, min: 0, max: 5 },
      { n: 'damping', l: 'Damping', t: 'float', d: 0.4, min: 0, max: 10 },
      { n: 'thickness', l: 'Thickness', t: 'float', d: 0.03, min: 0.001, max: 0.5 },
      { n: 'friction', l: 'Friction', t: 'float', d: 0.4, min: 0, max: 1 },
      { n: 'selfCollide', l: 'Self Collision', t: 'toggle', d: false },
      { n: 'ground', l: 'Ground Collision', t: 'toggle', d: true },
      { n: 'groundY', l: 'Ground Height', t: 'float', d: 0, min: -10, max: 10 },
      { n: 'substeps', l: 'Substeps', t: 'int', d: 4, min: 1, max: 16 },
      { n: 'iterations', l: 'Solver Iterations', t: 'int', d: 10, min: 1, max: 30 },
    ],
    cook: (p, ins, ctx) => clothCook(p, ctx),
  },
  hair: {
    label: 'Hair', cat: 'Dynamics', inputs: 2, timeDep: true, inputNames: ['skin surface', 'collider (optional)'],
    params: [
      { n: 'count', l: 'Strands', t: 'int', d: 1500, min: 1, max: 20000 },
      { n: 'mask', l: 'Grow Only Where', t: 'string', d: '' },
      { n: 'useMask', l: 'Density From Paint', t: 'toggle', d: true },
      { n: 'maskLength', l: 'Length From Paint', t: 'toggle', d: true },
      { n: 'segments', l: 'Segments', t: 'int', d: 10, min: 2, max: 40 },
      { n: 'length', l: 'Length', t: 'float', d: 0.5, min: 0.01, max: 5 },
      { n: 'lengthVar', l: 'Length Variance', t: 'float', d: 0.35, min: 0, max: 1 },
      { n: 'comb', l: 'Comb Direction (local)', t: 'vec3', d: [0, 0, 0] },
      { n: 'droop', l: 'Droop', t: 'float', d: 0.15, min: 0, max: 1 },
      { n: 'curl', l: 'Curl', t: 'float', d: 0, min: 0, max: 3 },
      { n: 'curlFreq', l: 'Curl Frequency', t: 'float', d: 3, min: 0.2, max: 20 },
      { n: 'frizz', l: 'Frizz', t: 'float', d: 0.2, min: 0, max: 2 },
      { n: 'clump', l: 'Clumping', t: 'float', d: 0.3, min: 0, max: 1 },
      { n: 'simulate', l: 'Simulate', t: 'toggle', d: true },
      { n: 'stiffness', l: 'Shape Stiffness', t: 'float', d: 0.12, min: 0, max: 1 },
      { n: 'tipLimp', l: 'Softer Tips', t: 'float', d: 0.7, min: 0, max: 1 },
      { n: 'gravity', l: 'Gravity', t: 'vec3', d: [0, -9.8, 0] },
      { n: 'wind', l: 'Wind', t: 'vec3', d: [0, 0, 0] },
      { n: 'gust', l: 'Gust Strength', t: 'float', d: 0, min: 0, max: 30 },
      { n: 'gustSize', l: 'Gust Size', t: 'float', d: 1, min: 0.05, max: 10 },
      { n: 'aero', l: 'Air Resistance', t: 'float', d: 1.5, min: 0, max: 10 },
      { n: 'damping', l: 'Damping', t: 'float', d: 2, min: 0, max: 20 },
      { n: 'skinCollide', l: 'Collide With Skin', t: 'toggle', d: true },
      { n: 'skinOffset', l: 'Skin Offset', t: 'float', d: 0.01, min: 0, max: 0.2 },
      { n: 'ground', l: 'Ground Collision', t: 'toggle', d: false },
      { n: 'groundY', l: 'Ground Height', t: 'float', d: 0, min: -10, max: 10 },
      { n: 'substeps', l: 'Substeps', t: 'int', d: 2, min: 1, max: 10 },
      { n: 'iterations', l: 'Solver Iterations', t: 'int', d: 3, min: 1, max: 20 },
      { n: 'look', l: 'Output', t: 'menu', d: 'lines', options: [['lines', 'Curves (lines)'], ['ribbons', 'Ribbons (shaded)']] },
      { n: 'width', l: 'Ribbon Width', t: 'float', d: 0.012, min: 0.001, max: 0.2 },
      { n: 'inheritColor', l: 'Colour From Skin', t: 'toggle', d: true },
      { n: 'tipBlend', l: 'Tip Colour Blend', t: 'float', d: 0.25, min: 0, max: 1 },
      { n: 'rootColor', l: 'Root Color', t: 'color', d: '#3b2414' },
      { n: 'tipColor', l: 'Tip Color', t: 'color', d: '#c98a4b' },
      { n: 'seed', l: 'Seed', t: 'int', d: 1, min: 0, max: 100 },
    ],
    cook: (p, ins, ctx) => hairCook(p, ctx),
  },
  voxelize: {
    label: 'Voxelize', cat: 'Topology', inputs: 1,
    params: [
      { n: 'size', l: 'Voxel Size', t: 'float', d: 0.2, min: 0.01, max: 2 },
      { n: 'mode', l: 'Fill', t: 'menu', d: 'solid', options: [['solid', 'Solid (closed meshes)'], ['shell', 'Surface shell'], ['heightfield', 'Heightfield (fill below)'], ['points', 'From points / particles']] },
      { n: 'floor', l: 'Heightfield Floor', t: 'float', d: 0, min: -20, max: 20 },
      { n: 'output', l: 'Output', t: 'menu', d: 'cubes', options: [['cubes', 'Cubes (exposed faces)'], ['points', 'Voxel centres (points)']] },
      { n: 'gap', l: 'Cube Gap', t: 'float', d: 0, min: 0, max: 0.6 },
      { n: 'colorMode', l: 'Color', t: 'menu', d: 'source', options: [['source', 'From input colour'], ['height', 'Height ramp'], ['constant', 'Constant']] },
      { n: 'c1', l: 'Color A', t: 'color', d: '#6b8f4e' },
      { n: 'c2', l: 'Color B', t: 'color', d: '#e6dcc4' },
      { n: 'jitter', l: 'Color Jitter', t: 'float', d: 0.15, min: 0, max: 1 },
    ],
    cook: (p, [g]) => voxelize(g, p),
  },
  merge: { label: 'Merge', cat: 'Utility', inputs: -1, params: [], cook: (p, ins) => { const g = new Geo(); ins.forEach((x) => x && g.append(x)); return g; } },
  null: { label: 'Null', cat: 'Utility', inputs: 1, params: [], cook: (p, [g]) => g.clone() },
};

function defaultParams(type) {
  const o = {};
  for (const d of NODE_TYPES[type].params) o[d.n] = Array.isArray(d.d) ? d.d.slice() : d.d;
  return o;
}

// ---------- parameter expressions ----------
const exprCache = new Map();
function evalNum(v, ctx) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (s === '') return 0;
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  let fn = exprCache.get(s);
  if (!fn) {
    const body = s.replace(/\$F\b/g, '__F').replace(/\$T\b/g, '__T');
    try { fn = new Function('__F', '__T', 'noise', 'rand', 'fit', 'with(Math){return (' + body + ');}'); } catch (e) { fn = () => NaN; }
    exprCache.set(s, fn);
  }
  try { const r = +fn(ctx.frame, ctx.time, noise3, rand, fit); return Number.isFinite(r) ? r : NaN; } catch (e) { return NaN; }
}
function isExpr(v) { return typeof v === 'string' && v.trim() !== '' && Number.isNaN(Number(v)); }
function evalParams(node, ctx) {
  const T = NODE_TYPES[node.type], out = {};
  for (const d of T.params) {
    const raw = node.params[d.n] ?? d.d;
    if (d.t === 'float' || d.t === 'int') { let x = evalNum(raw, ctx); if (Number.isNaN(x)) throw new Error(`Bad expression in “${d.l}”`); out[d.n] = d.t === 'int' ? Math.round(x) : x; }
    else if (d.t === 'vec3') out[d.n] = [0, 1, 2].map((k) => { const x = evalNum(raw[k], ctx); if (Number.isNaN(x)) throw new Error(`Bad expression in “${d.l}”`); return x; });
    else out[d.n] = raw;
  }
  return out;
}
function isTimeDep(node) {
  const td = NODE_TYPES[node.type].timeDep;
  if (typeof td === 'function' ? td(node) : td) return true;
  const s = JSON.stringify(node.params);
  return /\$F|\$T|@Time|@Frame/.test(s);
}

// ---------- cooking ----------
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

class Cooker {
  constructor() { this.cache = new Map(); this.errors = new Map(); this.timing = new Map(); this.sims = new Map(); }
  clear() { this.cache.clear(); this.sims.clear(); this.errors.clear(); }
  cook(nodes, id, ctx, stack = new Set()) {
    const n = nodes[id];
    if (!n) return new Geo();
    if (stack.has(id)) { this.errors.set(id, 'Cycle detected'); return new Geo(); }
    stack.add(id);
    const ins = n.inputs.map((i) => (i && nodes[i] ? this.cook(nodes, i, ctx, stack) : null));
    stack.delete(id);
    const td = isTimeDep(n);
    const sig = hashStr(n.type + JSON.stringify(n.params) + (n.bypass ? 'B' : '') + (td ? '@' + ctx.frame : '') + ins.map((g) => (g ? g.__sig : 'x')).join(','));
    const c = this.cache.get(id);
    if (c && c.sig === sig) return c.geo;
    const t0 = performance.now();
    let geo;
    try {
      const T = NODE_TYPES[n.type];
      if (n.bypass) geo = ins[0] ? ins[0].clone() : new Geo();
      else {
        if (T.inputs > 0 && !ins[0] && !T.optionalInputs) throw new Error('Missing input');
        const self = this;
        const c2 = {
          ...ctx, cooker: this, nodeId: id, node: n, nodes,
          inputAt: (i, f) => (n.inputs[i] && nodes[n.inputs[i]] ? self.cook(nodes, n.inputs[i], { ...ctx, frame: f, time: (f - 1) / (ctx.fps || 24) }) : null),
        };
        geo = T.cook(evalParams(n, ctx), T.inputs === -1 ? ins : ins.map((g) => g || null), c2);
      }
      this.errors.delete(id);
    } catch (e) { this.errors.set(id, e.message || String(e)); geo = new Geo(); }
    this.timing.set(id, performance.now() - t0);
    geo.__sig = sig;
    this.cache.set(id, { sig, geo });
    return geo;
  }
}

function toOBJ(g) {
  const L = ['# Exported from Proteus', `# ${g.P.length} points, ${g.prims.length} polygons`];
  g.P.forEach((p, i) => L.push(`v ${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}` + (g.Cd ? ' ' + g.Cd[i].map((c) => c.toFixed(4)).join(' ') : '')));
  g.prims.forEach((f) => L.push('f ' + f.map((i) => i + 1).join(' ')));
  g.lines.forEach((l) => L.push('l ' + l.map((i) => i + 1).join(' ')));
  return L.join('\n');
}

// ---------- compact transferable geometry ----------
function packGeo(g, withN) {
  const n = g.P.length, P = new Float32Array(n * 3);
  g.P.forEach((p, i) => P.set(p, i * 3));
  const pk = { P, n, sprite: g.sprite ? { ...g.sprite } : null };
  if (g.Cd) { pk.Cd = new Float32Array(n * 3); g.Cd.forEach((c, i) => pk.Cd.set(c, i * 3)); }
  if (g.pscale) pk.pscale = Float32Array.from(g.pscale);
  if (g.mask) pk.mask = Float32Array.from(g.mask);
  if (g.attrs) pk.attrs = mapAttrs(g.attrs, (v) => Float32Array.from(v));
  if (withN && g.N && g.N.length === n) { pk.N = new Float32Array(n * 3); g.N.forEach((c, i) => pk.N.set(c, i * 3)); }
  if (g.alpha) pk.alpha = Float32Array.from(g.alpha);
  const flat = (list) => { const off = new Int32Array(list.length + 1); let t = 0; list.forEach((f, i) => { off[i] = t; t += f.length; }); off[list.length] = t; const idx = new Int32Array(t); list.forEach((f, i) => idx.set(f, off[i])); return { off, idx }; };
  pk.prims = flat(g.prims); pk.lines = flat(g.lines);
  if (g.primMat) { const names = [...new Set(g.primMat)]; pk.matNames = names; pk.mat = Uint8Array.from(g.primMat, (m) => names.indexOf(m)); }
  pk.bytes = [P, pk.Cd, pk.N, pk.mask, ...Object.values(pk.attrs || {}), pk.pscale, pk.alpha, pk.prims.off, pk.prims.idx, pk.lines.off, pk.lines.idx, pk.mat].reduce((s, a) => s + (a ? a.byteLength : 0), 0);
  return pk;
}
function unpackGeo(pk) {
  const g = new Geo(), n = pk.n;
  g.P = new Array(n); for (let i = 0; i < n; i++) g.P[i] = [pk.P[i * 3], pk.P[i * 3 + 1], pk.P[i * 3 + 2]];
  if (pk.Cd) { g.Cd = new Array(n); for (let i = 0; i < n; i++) g.Cd[i] = [pk.Cd[i * 3], pk.Cd[i * 3 + 1], pk.Cd[i * 3 + 2]]; }
  if (pk.pscale) g.pscale = Array.from(pk.pscale);
  if (pk.mask) g.mask = Array.from(pk.mask);
  if (pk.attrs) g.attrs = mapAttrs(pk.attrs, (v) => Array.from(v));
  if (pk.N) { g.N = new Array(n); for (let i = 0; i < n; i++) g.N[i] = [pk.N[i * 3], pk.N[i * 3 + 1], pk.N[i * 3 + 2]]; }
  if (pk.alpha) g.alpha = Array.from(pk.alpha);
  const unflat = ({ off, idx }) => { const out = new Array(off.length - 1); for (let i = 0; i < out.length; i++) out[i] = Array.from(idx.subarray(off[i], off[i + 1])); return out; };
  g.prims = unflat(pk.prims); g.lines = unflat(pk.lines);
  if (pk.mat) g.primMat = Array.from(pk.mat, (k) => pk.matNames[k]);
  g.sprite = pk.sprite;
  return g;
}
function packTransfer(pk) { if (!pk) return []; return [pk.P, pk.Cd, pk.N, pk.mask, ...Object.values(pk.attrs || {}), pk.pscale, pk.alpha, pk.prims.off, pk.prims.idx, pk.lines.off, pk.lines.idx, pk.mat].filter(Boolean).map((a) => a.buffer); }

// ======================================================================
// Web Worker host: when this file runs inside a worker it serves cook requests
// ======================================================================
if (typeof window === 'undefined' && typeof self !== 'undefined' && typeof importScripts === 'function') {
  const wc = new Cooker();
  let wnodes = {}, cancel = false, busy = false;
  const queue = [];
  const reply = (msg, packs) => self.postMessage(msg, packs.flatMap(packTransfer));
  const cookAt = (id, frame, fps) => wc.cook(wnodes, id, { frame, time: (frame - 1) / fps, fps });
  async function handle(m) {
    if (m.type === 'scene') { wnodes = m.nodes; return; }
    if (m.type === 'clear') { wc.clear(); return; }
    if (m.type === 'asset') { registerAsset(m.asset); wc.cache.clear(); return; }
    if (m.type === 'cook') {
      const t0 = performance.now();
      const g = m.display && wnodes[m.display] ? cookAt(m.display, m.frame, m.fps) : null;
      const sg = m.selected && wnodes[m.selected] && m.selected !== m.display && m.wantSel ? cookAt(m.selected, m.frame, m.fps) : null;
      const same = g && g.__sig === m.haveSig;
      const pk = g && !same ? packGeo(g) : null, spk = sg ? packGeo(sg, true) : g && m.wantSel ? packGeo(g, true) : null;
      reply({ type: 'cooked', id: m.id, frame: m.frame, sig: g ? g.__sig : null, same, geo: pk, sel: spk, errors: [...wc.errors], timing: [...wc.timing], ms: performance.now() - t0 }, [pk, spk]);
      return;
    }
    if (m.type === 'frame') { const g = m.display && wnodes[m.display] ? cookAt(m.display, m.frame, m.fps) : new Geo(); const pk = packGeo(g); reply({ type: 'frameGeo', id: m.id, geo: pk }, [pk]); return; }
    if (m.type === 'bake') {
      cancel = false; let last = performance.now();
      for (let f = m.from; f <= m.to; f++) {
        if (cancel) break;
        const pk = packGeo(cookAt(m.display, f, m.fps));
        reply({ type: 'bakeFrame', id: m.id, frame: f, geo: pk }, [pk]);
        if (performance.now() - last > 30) { await new Promise((r) => setTimeout(r, 0)); last = performance.now(); }
      }
      self.postMessage({ type: 'bakeDone', id: m.id, cancelled: cancel, errors: [...wc.errors] });
    }
  }
  async function pump() {
    if (busy) return; busy = true;
    while (queue.length) { const m = queue.shift(); try { await handle(m); } catch (err) { self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) }); } }
    busy = false;
  }
  self.onmessage = (e) => { if (e.data.type === 'cancel') { cancel = true; return; } queue.push(e.data); pump(); };
  self.postMessage({ type: 'ready' });
}

if (typeof module !== 'undefined') module.exports = { registerAsset, ASSETS, packGeo, unpackGeo, Geo, NODE_TYPES, Cooker, defaultParams, computeNormals, faceNormal, toOBJ, evalNum, isExpr, CAT_COLORS };
