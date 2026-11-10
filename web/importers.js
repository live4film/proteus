// ============================================================
// Proteus importers — pure JS readers that turn files into "assets"
//   asset = { name, format, kind: 'mesh'|'cache', n, prims:{off,idx}|null, lines:{off,idx}|null,
//             Cd: Float32Array|null, piece: Int32Array|null, frames: [Float32Array], times: Float64Array (s), notes: [] }
// ============================================================
const IMP = {};
IMP.flat = (lists) => { const off = new Int32Array(lists.length + 1); let t = 0; lists.forEach((f, i) => { off[i] = t; t += f.length; }); off[lists.length] = t; const idx = new Int32Array(t); lists.forEach((f, i) => idx.set(f, off[i])); return { off, idx }; };
IMP.text = (buf) => new TextDecoder('utf-8').decode(buf);
IMP.ext = (name) => (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();

// ---------------- OBJ ----------------
IMP.parseOBJ = function (text, name) {
  const P = [], C = [], faces = [], lines = [], piece = [];
  let hasColor = false, group = 0, groupNames = [], groupSeen = false;
  const L = text.split(/\r?\n/);
  for (let li = 0; li < L.length; li++) {
    let s = L[li];
    while (s.endsWith('\\') && li + 1 < L.length) s = s.slice(0, -1) + ' ' + L[++li];
    s = s.trim(); if (!s || s[0] === '#') continue;
    const t = s.split(/\s+/), k = t[0];
    if (k === 'v') {
      P.push(+t[1] || 0, +t[2] || 0, +t[3] || 0);
      if (t.length >= 7) { C.push(+t[4], +t[5], +t[6]); hasColor = true; } else C.push(NaN, NaN, NaN);
    } else if (k === 'f' || k === 'l') {
      const nv = P.length / 3, ids = [];
      for (let i = 1; i < t.length; i++) { let v = parseInt(t[i], 10); if (!Number.isFinite(v)) continue; v = v < 0 ? nv + v : v - 1; ids.push(v); }
      if (k === 'f' && ids.length >= 3) { faces.push(ids); piece.push(group); } else if (k === 'l' && ids.length >= 2) lines.push(ids);
    } else if (k === 'o' || k === 'g') {
      const nm = t.slice(1).join(' ') || 'default';
      if (!groupSeen && faces.length === 0) { groupSeen = true; groupNames[0] = nm; continue; }
      groupSeen = true; group++; groupNames[group] = nm;
    }
  }
  const n = P.length / 3;
  if (!n) throw new Error(`${name}: no vertices found — is this an OBJ file?`);
  let Cd = null;
  if (hasColor) { Cd = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) Cd[i] = Number.isFinite(C[i]) ? (C[i] > 1 ? C[i] / 255 : C[i]) : 0.8; }
  return { name, format: 'OBJ', kind: 'mesh', n, prims: faces.length ? IMP.flat(faces) : null, lines: lines.length ? IMP.flat(lines) : null, Cd, piece: group > 0 ? Int32Array.from(piece) : null, frames: [Float32Array.from(P)], times: new Float64Array([0]), notes: group > 0 ? [`${group + 1} groups → piece ids`] : [] };
};
// numbered OBJ files → one animated asset (same topology required)
IMP.objSequence = function (items, fps) {
  const frameNo = (nm) => { const m = nm.match(/(\d+)(?=\.[^.]+$)/); return m ? +m[1] : 0; };
  items.sort((a, b) => frameNo(a.name) - frameNo(b.name));
  const first = IMP.parseOBJ(items[0].text, items[0].name), frames = [first.frames[0]], times = [0];
  const f0 = frameNo(items[0].name);
  for (let i = 1; i < items.length; i++) {
    const a = IMP.parseOBJ(items[i].text, items[i].name);
    if (a.n !== first.n) throw new Error(`${items[i].name} has ${a.n} points but ${items[0].name} has ${first.n} — a sequence needs the same topology on every frame`);
    frames.push(a.frames[0]); times.push((frameNo(items[i].name) - f0) / fps);
  }
  return { ...first, name: items[0].name.replace(/\d+(?=\.[^.]+$)/, '#'), format: 'OBJ sequence', frames, times: Float64Array.from(times) };
};

// ---------------- STL ----------------
IMP.parseSTL = function (buf, name) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const head = IMP.text(u8.subarray(0, Math.min(512, u8.length)));
  const nTri = u8.length >= 84 ? dv.getUint32(80, true) : 0;
  const tris = [];
  if (u8.length === 84 + nTri * 50 && nTri > 0) {
    for (let i = 0; i < nTri; i++) { const o = 84 + i * 50 + 12; tris.push([0, 1, 2].map((k) => [dv.getFloat32(o + k * 12, true), dv.getFloat32(o + k * 12 + 4, true), dv.getFloat32(o + k * 12 + 8, true)])); }
  } else if (/^\s*solid/.test(head)) {
    const vs = [...IMP.text(u8).matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
    for (let i = 0; i + 2 < vs.length; i += 3) tris.push([vs[i], vs[i + 1], vs[i + 2]]);
  } else throw new Error(`${name}: not a valid STL file`);
  // weld identical corners so the mesh is connected
  const map = new Map(), P = [], faces = [];
  for (const t of tris) faces.push(t.map((p) => { const k = p.map((v) => Math.round(v * 1e5)).join(','); let id = map.get(k); if (id == null) { id = P.length / 3; map.set(k, id); P.push(p[0], p[1], p[2]); } return id; }));
  return { name, format: 'STL', kind: 'mesh', n: P.length / 3, prims: IMP.flat(faces), lines: null, Cd: null, piece: null, frames: [Float32Array.from(P)], times: new Float64Array([0]), notes: [] };
};

// ---------------- PC2 point cache ----------------
IMP.parsePC2 = function (buf, name, fps) {
  const dv = new DataView(buf);
  if (IMP.text(new Uint8Array(buf, 0, 11)) !== 'POINTCACHE2') throw new Error(`${name}: not a PC2 point cache`);
  const n = dv.getInt32(16, true), start = dv.getFloat32(20, true), rate = dv.getFloat32(24, true), ns = dv.getInt32(28, true);
  if (32 + n * ns * 12 > buf.byteLength) throw new Error(`${name}: file is truncated`);
  const frames = [], times = new Float64Array(ns);
  for (let s = 0; s < ns; s++) { frames.push(new Float32Array(buf.slice(32 + s * n * 12, 32 + (s + 1) * n * 12))); times[s] = (start + s * rate) / fps; }
  return { name, format: 'PC2', kind: 'cache', n, prims: null, lines: null, Cd: null, piece: null, frames, times, notes: [`${ns} samples from frame ${start}`] };
};

// ---------------- Maya nCache (.xml + .mcc) ----------------
// MCC files are IFF: FOR4 (32-bit sizes, 4-byte aligned) or FOR8 (64-bit sizes, 8-byte aligned)
IMP.readMCC = function (buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  const isTag = (o) => o + 4 <= u8.length && [0, 1, 2, 3].every((k) => (u8[o + k] >= 48 && u8[o + k] <= 57) || (u8[o + k] >= 65 && u8[o + k] <= 90));
  const kind = tag(0);
  if (kind !== 'FOR4' && kind !== 'FOR8') throw new Error('not a Maya cache (.mcc) file');
  const big = kind === 'FOR8';
  // FOR8 layout: tag(4) pad(4) size(8)  — detect a 4-byte pad after the tag
  const pad = big && tag(16) === 'CACH' ? 4 : 0;
  const hdr = big ? 4 + pad + 8 : 8, align = big ? 8 : 4;
  const size = (o) => (big ? Number(dv.getBigUint64(o + 4 + pad, false)) : dv.getUint32(o + 4, false));
  // linear scan with explicit form tracking
  let currentForm = null; const forms = [];
  const scan = (start, end) => {
    let o = start;
    while (o + hdr <= end) {
      const t = tag(o), sz = size(o);
      if (t === 'FOR4' || t === 'FOR8') {
        currentForm = { type: tag(o + hdr), chunks: [] }; forms.push(currentForm);
        let st = o + hdr + 4; if (big && !isTag(st) && isTag(st + 4)) st += 4; // FOR8 pads the form type to 8 bytes
        scan(st, o + hdr + sz);
      }
      else currentForm.chunks.push({ t, o: o + hdr, sz });
      o = Math.ceil((o + hdr + sz) / align) * align;
    }
  };
  scan(0, u8.length);
  const str = (c) => { let e = c.o; while (e < c.o + c.sz && u8[e]) e++; return IMP.text(u8.subarray(c.o, e)); };
  const i32 = (c) => dv.getInt32(c.o, false);
  const out = { start: null, end: null, samples: [] }; // samples: [{ tick, channels: {name: Float32Array} }]
  for (const f of forms) {
    if (f.type === 'CACH') for (const c of f.chunks) { if (c.t === 'STIM') out.start = i32(c); if (c.t === 'ETIM') out.end = i32(c); }
    if (f.type === 'MYCH') {
      let tick = null, name = null, count = 0; const ch = {};
      for (const c of f.chunks) {
        if (c.t === 'TIME') { if (tick !== null && Object.keys(ch).length) { out.samples.push({ tick, channels: { ...ch } }); for (const k in ch) delete ch[k]; } tick = i32(c); }
        else if (c.t === 'CHNM') name = str(c);
        else if (c.t === 'SIZE') count = i32(c);
        else if (c.t === 'FVCA' || c.t === 'DVCA' || c.t === 'FBCA' || c.t === 'DBLA') {
          const vec = c.t === 'FVCA' || c.t === 'DVCA', dbl = c.t === 'DVCA' || c.t === 'DBLA', comps = vec ? 3 : 1, m = count * comps;
          const a = new Float32Array(m);
          for (let i = 0; i < m; i++) a[i] = dbl ? dv.getFloat64(c.o + i * 8, false) : dv.getFloat32(c.o + i * 4, false);
          ch[name] = { data: a, comps };
        }
      }
      out.samples.push({ tick: tick ?? out.start ?? 0, channels: ch });
    }
  }
  return out;
};
IMP.parseNCache = function (files, fps) { // files: [{name, buf}]
  const xmlF = files.find((f) => IMP.ext(f.name) === 'xml'), mccs = files.filter((f) => IMP.ext(f.name) === 'mcc');
  if (!mccs.length) throw new Error('Select the .mcc file(s) together with the .xml description');
  let channel = null, interp = 'positions', tpf = 6000 / fps, xmlInfo = '';
  if (xmlF) {
    const x = IMP.text(xmlF.buf);
    const tp = x.match(/TimePerFrame="(\d+)"/); if (tp) tpf = +tp[1];
    const chs = [...x.matchAll(/<channel\d+\s+([^>]*)\/?>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
    const pos = chs.find((c) => /position/i.test(c.ChannelInterpretation || '')) || chs[0];
    if (pos) { channel = pos.ChannelName; interp = pos.ChannelInterpretation || interp; }
    const ct = x.match(/cacheType\s+Type="(\w+)"/); xmlInfo = ct ? ct[1] : '';
  }
  // frame-per-file names: <base>Frame<N>[Tick<T>].mcc
  const tickOf = (nm) => { const m = nm.match(/Frame(-?\d+)(?:Tick(\d+))?\.mcc$/i); return m ? +m[1] * tpf + (m[2] ? +m[2] : 0) : null; };
  const samples = [];
  for (const f of mccs) {
    const r = IMP.readMCC(f.buf);
    for (const s of r.samples) samples.push({ tick: mccs.length > 1 ? tickOf(f.name) ?? s.tick : s.tick, channels: s.channels });
  }
  samples.sort((a, b) => a.tick - b.tick);
  const pick = (chs) => { if (channel && chs[channel]) return chs[channel]; const ks = Object.keys(chs).filter((k) => chs[k].comps === 3); return chs[ks.find((k) => /position/i.test(k)) || ks[0]]; };
  const first = pick(samples[0].channels);
  if (!first) throw new Error('No point positions found in the cache');
  const n = first.data.length / 3, frames = [], times = [];
  for (const s of samples) { const c = pick(s.channels); if (!c || c.data.length !== n * 3) continue; frames.push(c.data); times.push(s.tick / 6000); }
  const name = (xmlF || mccs[0]).name;
  return { name, format: 'Maya nCache', kind: 'cache', n, prims: null, lines: null, Cd: null, piece: null, frames, times: Float64Array.from(times), notes: [`channel “${channel || 'auto'}” (${interp})${xmlInfo ? ', ' + xmlInfo : ''}`, `${frames.length} samples`] };
};

// ---------------- Alembic (.abc, Ogawa) ----------------
IMP.parseAlembic = function (buf, name) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (IMP.text(u8.subarray(0, 5)) !== 'Ogawa') {
    if (u8[1] === 0x48 && u8[2] === 0x44 && u8[3] === 0x46) throw new Error(`${name} is an old HDF5 Alembic. Re-export it as Ogawa (the default in current Maya, Houdini and Blender).`);
    throw new Error(`${name}: not an Alembic file`);
  }
  const MASK = 0x7fffffffffffffffn;
  const u64 = (o) => Number(dv.getBigUint64(o, true));
  const group = (off) => { if (!off) return []; const n = u64(off), kids = []; for (let i = 0; i < n; i++) { const v = dv.getBigUint64(off + 8 + i * 8, true); kids.push({ data: (v >> 63n) === 1n, off: Number(v & MASK) }); } return kids; };
  const data = (k) => { if (!k || !k.off) return new Uint8Array(0); const sz = u64(k.off); return u8.subarray(k.off + 8, k.off + 8 + sz); };
  const root = group(u64(8));
  // indexed metadata
  const meta = [''];
  { const d = data(root[5]); let o = 0; while (o < d.length) { const l = d[o]; meta.push(IMP.text(d.subarray(o + 1, o + 1 + l))); o += 1 + l; } }
  // time samplings
  const tsl = [];
  { const d = data(root[4]), v = new DataView(d.buffer, d.byteOffset, d.byteLength); let o = 0; while (o + 16 <= d.length) { const maxS = v.getUint32(o, true), tpc = v.getFloat64(o + 4, true), nt = v.getUint32(o + 12, true); const times = []; for (let i = 0; i < nt; i++) times.push(v.getFloat64(o + 16 + i * 8, true)); tsl.push({ maxS, tpc, times }); o += 16 + nt * 8; } }
  const ACYCLIC = Number.MAX_VALUE / 32;
  const tsTime = (ti, i) => { const ts = tsl[ti]; if (!ts || !ts.times.length) return i / 24; const n = ts.times.length; if (ts.tpc >= ACYCLIC * 0.999) return ts.times[Math.min(i, n - 1)]; return ts.times[i % n] + Math.floor(i / n) * ts.tpc; };
  const POD = [[1, 'u8'], [1, 'u8'], [1, 'i8'], [2, 'u16'], [2, 'i16'], [4, 'u32'], [4, 'i32'], [8, 'u64'], [8, 'i64'], [2, 'f16'], [4, 'f32'], [8, 'f64'], [1, 'str'], [4, 'wstr']];
  // property headers
  const readProps = (gKids) => {
    if (!gKids.length) return [];
    const d = data(gKids[gKids.length - 1]), v = new DataView(d.buffer, d.byteOffset, d.byteLength), props = [];
    let o = 0, pi = 0;
    try {
      while (o + 4 <= d.length) {
        const info = v.getUint32(o, true); o += 4;
        const ptype = info & 3, hint = (info >> 2) & 3;
        const rd = () => { let x; if (hint === 0) { x = v.getUint8(o); o += 1; } else if (hint === 1) { x = v.getUint16(o, true); o += 2; } else { x = v.getUint32(o, true); o += 4; } return x; };
        const p = { type: ['compound', 'scalar', 'array'][ptype], kid: gKids[pi++] };
        let md;
        if (ptype !== 0) {
          p.pod = (info >> 4) & 0xf; p.extent = (info >> 12) & 0xff; md = (info >> 20) & 0xff;
          p.n = rd();
          if (info & 0x200) { p.first = rd(); p.last = rd(); } else if (info & 0x800) { p.first = 0; p.last = 0; } else { p.first = 1; p.last = p.n - 1; }
          p.ts = info & 0x100 ? rd() : 0;
        } else md = (info >> 20) & 0xff;
        const nl = rd(); p.name = IMP.text(d.subarray(o, o + nl)); o += nl;
        if (md === 0xff) { const ml = rd(); p.meta = IMP.text(d.subarray(o, o + ml)); o += ml; } else p.meta = meta[md] || '';
        props.push(p);
      }
    } catch (e) { /* trailing bytes */ }
    return props;
  };
  const stored = (p, i) => { if (p.first === 0 && p.last === 0) return 0; if (i < p.first) return 0; if (i > p.last) return p.last - p.first + 1; return i - p.first + 1; };
  const typed = (p, bytes) => {
    const [sz, t] = POD[p.pod]; const cnt = Math.floor(bytes.length / sz), v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = t === 'f64' || t === 'i64' || t === 'u64' ? new Float64Array(cnt) : t === 'f32' || t === 'f16' ? new Float32Array(cnt) : new Int32Array(cnt);
    for (let i = 0; i < cnt; i++) out[i] = t === 'f32' ? v.getFloat32(i * 4, true) : t === 'f64' ? v.getFloat64(i * 8, true) : t === 'i32' ? v.getInt32(i * 4, true) : t === 'u32' ? v.getUint32(i * 4, true) : t === 'u8' ? v.getUint8(i) : t === 'i8' ? v.getInt8(i) : t === 'u16' ? v.getUint16(i * 2, true) : t === 'i16' ? v.getInt16(i * 2, true) : t === 'i64' ? Number(v.getBigInt64(i * 8, true)) : t === 'u64' ? Number(v.getBigUint64(i * 8, true)) : 0;
    return out;
  };
  const sampleOf = (p, i) => {
    const kids = group(p.kid.off), s = stored(p, Math.max(0, Math.min(i, p.n - 1)));
    const dk = p.type === 'array' ? kids[s * 2] : kids[s];
    let b = data(dk);
    const want = POD[p.pod][0] * Math.max(1, p.extent);
    if (p.type === 'scalar') { if (b.length === want + 16) b = b.subarray(16); }
    else if (b.length >= 16) b = b.subarray(16);
    return typed(p, b);
  };
  const child = (props, nm) => props.find((p) => p.name === nm);
  // object tree
  const readObject = (gOff, nm, md, parent) => {
    const kids = group(gOff), obj = { name: nm, meta: md, parent, props: [], children: [] };
    if (!kids.length) return obj;
    obj.props = kids[0] && !kids[0].data ? readProps(group(kids[0].off)) : [];
    const hdr = data(kids[kids.length - 1]), hv = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
    const heads = []; let o = 0;
    while (o + 5 <= hdr.length - 32) { const nl = hv.getUint32(o, true); o += 4; const cn = IMP.text(hdr.subarray(o, o + nl)); o += nl; const mi = hdr[o]; o += 1; let cm; if (mi === 0xff) { const ml = hv.getUint32(o, true); o += 4; cm = IMP.text(hdr.subarray(o, o + ml)); o += ml; } else cm = meta[mi] || ''; heads.push({ name: cn, meta: cm }); }
    heads.forEach((h, i) => { const k = kids[1 + i]; if (k && !k.data) obj.children.push(readObject(k.off, h.name, h.meta, obj)); });
    return obj;
  };
  const top = readObject(root[2].off, 'ABC', '', null);
  // gather meshes and transforms
  const meshes = [], allT = new Set();
  const xformOf = (obj) => { if (!/AbcGeom_Xform/.test(obj.meta)) return null; const xc = child(obj.props, '.xform'); if (!xc) return { ops: [], vals: null, inherits: true }; const xp = readProps(group(xc.kid.off)); const ops = child(xp, '.ops'), vals = child(xp, '.vals'), inh = child(xp, '.inherits'); return { ops: ops ? Array.from(sampleOf(ops, 0)) : [], vals, inherits: inh ? sampleOf(inh, 0)[0] !== 0 : true }; };
  const visit = (obj) => {
    if (/AbcGeom_(PolyMesh|SubD|Points)/.test(obj.meta)) {
      const gc = child(obj.props, '.geom');
      if (gc) {
        const gp = readProps(group(gc.kid.off)), P = child(gp, 'P');
        if (P) {
          const fi = child(gp, '.faceIndices'), fc = child(gp, '.faceCounts');
          const chain = []; for (let p = obj.parent; p; p = p.parent) { const x = xformOf(p); if (x) { chain.push(x); if (!x.inherits) break; } }
          meshes.push({ name: obj.name, P, fi, fc, chain });
          for (const pr of [P, ...chain.map((c) => c.vals).filter(Boolean)]) if (pr.n > 1) for (let i = 0; i < pr.n; i++) allT.add(+tsTime(pr.ts, i).toFixed(9));
        }
      }
    }
    obj.children.forEach(visit);
  };
  visit(top);
  if (!meshes.length) throw new Error(`${name}: no polygon meshes or points found`);
  let times = [...allT].sort((a, b) => a - b); if (!times.length) times = [0];
  if (times.length > 2000) { const st = Math.ceil(times.length / 2000); times = times.filter((_, i) => i % st === 0); }
  const idxAt = (p, T) => { let best = 0; for (let i = 0; i < p.n; i++) if (tsTime(p.ts, i) <= T + 1e-9) best = i; else break; return best; };
  const CH = [3, 3, 4, 16, 1, 1, 1];
  const matOf = (x, T) => { // column-vector 4x4 as array[16] row-major
    let M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (!x.vals || !x.ops.length) return M;
    const v = sampleOf(x.vals, idxAt(x.vals, T)); let c = 0;
    const mul = (A, B) => { const R = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) for (let q = 0; q < 4; q++) R[r * 4 + q] += A[r * 4 + k] * B[k * 4 + q]; return R; };
    const rot = (ax, ay, az, deg) => { const l = Math.hypot(ax, ay, az) || 1, x2 = ax / l, y2 = ay / l, z2 = az / l, a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a), t = 1 - cs; return [t * x2 * x2 + cs, t * x2 * y2 - sn * z2, t * x2 * z2 + sn * y2, 0, t * x2 * y2 + sn * z2, t * y2 * y2 + cs, t * y2 * z2 - sn * x2, 0, t * x2 * z2 - sn * y2, t * y2 * z2 + sn * x2, t * z2 * z2 + cs, 0, 0, 0, 0, 1]; };
    for (const op of x.ops) {
      const ty = op >> 4, k = CH[ty] || 0, a = Array.from(v.subarray ? v.subarray(c, c + k) : v.slice(c, c + k)); c += k;
      let O;
      if (ty === 0) O = [a[0], 0, 0, 0, 0, a[1], 0, 0, 0, 0, a[2], 0, 0, 0, 0, 1];
      else if (ty === 1) O = [1, 0, 0, a[0], 0, 1, 0, a[1], 0, 0, 1, a[2], 0, 0, 0, 1];
      else if (ty === 2) O = rot(a[0], a[1], a[2], a[3]);
      else if (ty === 3) { O = new Array(16); for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) O[r * 4 + q] = a[q * 4 + r]; }
      else O = rot(ty === 4 ? 1 : 0, ty === 5 ? 1 : 0, ty === 6 ? 1 : 0, a[0]);
      M = mul(M, O);
    }
    return M;
  };
  // topology
  const prims = [], piece = [], offs = []; let n = 0; const notes = [];
  meshes.forEach((m, mi) => {
    const P0 = sampleOf(m.P, 0), np = P0.length / 3; offs.push(n); m.np = np;
    if (m.fi && m.fc) {
      const idx = sampleOf(m.fi, 0), cnt = sampleOf(m.fc, 0); let o = 0;
      for (const c of cnt) { const f = []; for (let k = c - 1; k >= 0; k--) f.push(idx[o + k] + n); o += c; if (c >= 3) { prims.push(f); piece.push(mi); } } // Alembic winds clockwise
      if (m.fi.n > 1 && m.fi.last > 0) notes.push(`${m.name}: changing topology isn't supported — using the first frame's faces`);
    }
    n += np;
  });
  const frames = times.map((T) => {
    const F = new Float32Array(n * 3);
    meshes.forEach((m, mi) => {
      let P = sampleOf(m.P, idxAt(m.P, T)); if (P.length !== m.np * 3) P = sampleOf(m.P, 0);
      const Ms = m.chain.map((x) => matOf(x, T)); // child-most first
      for (let i = 0; i < m.np; i++) {
        let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        for (const M of Ms) { const nx = M[0] * x + M[1] * y + M[2] * z + M[3], ny = M[4] * x + M[5] * y + M[6] * z + M[7], nz = M[8] * x + M[9] * y + M[10] * z + M[11]; x = nx; y = ny; z = nz; }
        F.set([x, y, z], (offs[mi] + i) * 3);
      }
    });
    return F;
  });
  return { name, format: 'Alembic', kind: 'mesh', n, prims: prims.length ? IMP.flat(prims) : null, lines: null, Cd: null, piece: meshes.length > 1 && prims.length ? Int32Array.from(piece) : null, frames, times: Float64Array.from(times), notes: [`${meshes.length} object${meshes.length > 1 ? 's' : ''}: ${meshes.map((m) => m.name).slice(0, 6).join(', ')}${meshes.length > 6 ? '…' : ''}`, ...notes] };
};
if (typeof module !== 'undefined') module.exports = IMP;
