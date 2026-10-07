// Quick solve of the 4x4 by reduction with search (own code, no dependencies).
//
// Stages: centers, edge pairing, parity, then the reduced cube is a 3x3 and the
// two-phase solver finishes it. The result is replayed on the original cube
// before it is returned, so a bug here can only cost time, never a wrong answer.
//
// Frame. A 4x4 has no fixed centers, so "centers solved" only means something
// relative to the corners. The frame is the corner DBL (white-blue-red): after
// every center move the whole cube is rotated back until DBL is home again, and
// all center tables live in that frame. A frame move is a button plus the
// rotation that restores DBL; the physical buttons are recovered at the end by
// conjugating each one with the rotation accumulated so far.
//
//   centers: three stages, each an exact BFS table over a small coordinate
//     A  the 8 yellow/white centers sit on U and D                 C(24,8)
//     B  the 8 red/orange centers sit on R and L (U/D kept)        C(16,8)
//     C  yellow/white, green/blue, red/orange sorted inside their  70^3
//        own axis (axis sets kept)
//   Tables are exact distances, so a stage is solved by walking down them and
//   the search only has to choose among the optimal (and near optimal) paths.
//   pairing: greedy beam over a library of centers-preserving macros
//     slice, outer turns, slice back
//   The model (sticker permutations of every button) is read from CubeState,
//   never written by hand, as in search.js and two-phase.js.
import { CubeState, FACE_NORMALS } from '../cube-core.js';
import { generatorList } from './metric.js';
import { twoPhaseSolve, prepareTwoPhase } from './two-phase.js';
import { validateGrid } from '../editor/validate.js';
import { gridFromState } from '../editor/facelets.js';
import { ALGS } from '../content.js';

const COLOR = { U: 0, D: 1, F: 2, B: 3, R: 4, L: 5 };
const FACE_BY_COLOR = ['U', 'D', 'F', 'B', 'R', 'L'];
const ROT_TOKENS = ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'];

const slotKey = (pos, normal) => `${pos.join(',')}|${normal.join(',')}`;
// Permutation convention: new[i] = old[p[i]]. compose(a, b) = a then b.
const compose = (a, b) => { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[b[i]]; return o; };
const invertPerm = (p) => { const o = new Uint8Array(p.length); for (let i = 0; i < p.length; i++) o[p[i]] = i; return o; };
const permKey = (p) => String.fromCharCode(...p);

// ---------- model ----------
let MODEL = null;
export function model() { return (MODEL ??= buildModel()); }

function buildModel() {
  const t0 = performance.now();
  const solved = new CubeState(4);
  const keys = []; const colorOf = []; const typeOf = []; const cubieOf = [];
  for (const c of solved.cubies) {
    for (const f of c.faces) {
      keys.push(slotKey(c.home, FACE_NORMALS[f]));
      colorOf.push(COLOR[f]);
      typeOf.push(c.type);
      cubieOf.push(c.id);
    }
  }
  const N = keys.length;
  const idx = new Map(keys.map((k, i) => [k, i]));
  const permOf = (token) => {
    const s = new CubeState(4);
    s.applyMove(token);
    const p = new Uint8Array(N);
    for (const c of s.cubies) {
      for (const f of c.faces) p[idx.get(slotKey(c.pos, s.stickerNormal(c, f)))] = idx.get(slotKey(c.home, FACE_NORMALS[f]));
    }
    return p;
  };

  // Center slots: 4 per face in the order U D F B R L (axis sets are 0..7, 8..15, 16..23).
  const cstk = [];
  for (let f = 0; f < 6; f++) for (let s = 0; s < N; s++) if (typeOf[s] === 'center' && colorOf[s] === f) cstk.push(s);
  const cslotOf = new Int8Array(N).fill(-1);
  cstk.forEach((s, i) => { cslotOf[s] = i; });

  // Wing slots: 2 per edge location (both halves of a dedge), 24 in all.
  const wstk = []; const locKey = new Map();
  for (const c of solved.cubies) {
    if (c.type !== 'edge') continue;
    const k = c.faces.slice().sort().join('');
    if (!locKey.has(k)) locKey.set(k, locKey.size);
    const stickers = c.faces.map((f) => idx.get(slotKey(c.home, FACE_NORMALS[f])));
    wstk[locKey.get(k) * 2 + (wstk[locKey.get(k) * 2] ? 1 : 0)] = stickers;
  }
  const wslotOf = new Int8Array(N).fill(-1);
  wstk.forEach((st, w) => st.forEach((s) => { wslotOf[s] = w; }));
  // Wing class: unordered pair of colors (12 classes).
  const classOf = new Map();
  const wingClass = (a, b) => {
    const k = a < b ? `${a}${b}` : `${b}${a}`;
    if (!classOf.has(k)) classOf.set(k, classOf.size);
    return classOf.get(k);
  };
  for (const [a, b] of wstk.map((st) => st.map((s) => colorOf[s]))) wingClass(a, b);

  // The 24 whole-cube rotations with their shortest token list (at most 2 tokens).
  const idPerm = Uint8Array.from({ length: N }, (_, i) => i);
  const rotBase = ROT_TOKENS.map((t) => ({ tokens: [t], perm: permOf(t) }));
  const rots = [{ tokens: [], perm: idPerm }];
  const seen = new Set([permKey(idPerm)]);
  for (let h = 0; h < rots.length; h++) {
    for (const b of rotBase) {
      const perm = compose(rots[h].perm, b.perm);
      const k = permKey(perm);
      if (seen.has(k)) continue;
      seen.add(k);
      rots.push({ tokens: [...rots[h].tokens, ...b.tokens], perm });
    }
  }
  if (rots.length !== 24 || rots.some((r) => r.tokens.length > 2)) throw new Error('Rotaciones inconsistentes');
  const rotByKey = new Map(rots.map((r, i) => [permKey(r.perm), i]));

  // Reference corner DBL: its D sticker is refSlot; exactly one rotation sends
  // refSlot to any given corner sticker slot.
  const dbl = solved.cubies.find((c) => c.type === 'corner' && ['D', 'B', 'L'].every((f) => c.faces.includes(f)));
  const refSlot = idx.get(slotKey(dbl.home, FACE_NORMALS.D));
  const rotOf = new Int8Array(N).fill(-1);
  rots.forEach((r, q) => { rotOf[r.perm[refSlot]] = q; });

  // Raw buttons (63): the app's buttons in the current labeling.
  const buttons = generatorList(4).map((g) => {
    const perm = permOf(g.token);
    return { ...g, perm, cp: Uint8Array.from(cstk, (s) => cslotOf[perm[s]]), wp: Uint8Array.from(wstk, (st) => wslotOf[perm[st[0]]]) };
  });
  const buttonByPerm = new Map(buttons.map((b, i) => [permKey(b.perm), i]));
  const buttonByToken = new Map(buttons.map((b, i) => [b.token, i]));

  // Frame moves: a button followed by the rotation that brings DBL home.
  // Duplicates modulo that rotation (Dw = Uw' held differently) are dropped,
  // keeping the one that needs no rotation.
  const gens = [];
  const byKey = new Map();
  for (const b of buttons.slice().sort((x, y) => (rotOf[x.perm.indexOf(refSlot)] === 0 ? 0 : 1) - (rotOf[y.perm.indexOf(refSlot)] === 0 ? 0 : 1))) {
    const q = rotOf[b.perm.indexOf(refSlot)];
    const G = compose(b.perm, rots[q].perm);
    const k = permKey(G);
    if (byKey.has(k)) continue;
    byKey.set(k, gens.length);
    gens.push({
      token: b.token, base: b.base, block: b.block, axis: b.axis, layers: b.layers, q, G,
      cp: Uint8Array.from(cstk, (s) => cslotOf[G[s]]),
      wp: Uint8Array.from(wstk, (st) => wslotOf[G[st[0]]]),
    });
  }
  // Inverse and commutation relations among frame moves, by permutation.
  const Ginv = gens.map((g) => permKey(invertPerm(g.G)));
  gens.forEach((g, i) => { g.inv = gens.findIndex((h, j) => permKey(h.G) === Ginv[i] && j >= 0); });
  gens.forEach((g, i) => {
    g.comm = new Uint8Array(gens.length);
    gens.forEach((h, j) => {
      const ab = compose(g.G, h.G); const ba = compose(h.G, g.G);
      g.comm[j] = ab.every((v, t) => v === ba[t]) ? 1 : 0;
    });
  });

  return {
    N, idx, colorOf, typeOf, cubieOf, cstk, cslotOf, wstk, wslotOf, wingClass, rots, rotByKey, rotOf, refSlot,
    buttons, buttonByPerm, buttonByToken, gens, permOf, rotBase, solved, ms: performance.now() - t0,
  };
}

// Color per sticker slot of a CubeState (same convention as search.js).
export function stickersOf(m, state) {
  const out = new Uint8Array(m.N);
  for (const c of state.cubies) for (const f of c.faces) out[m.idx.get(slotKey(c.pos, state.stickerNormal(c, f)))] = COLOR[f];
  return out;
}
export const centersOf = (m, st) => Uint8Array.from(m.cstk, (s) => st[s]);
export function wingsOf(m, st) { return Uint8Array.from(m.wstk, (p) => m.wingClass(st[p[0]], st[p[1]])); }

// ---------- combinatorial ranks over bit masks ----------
const BIN = Array.from({ length: 26 }, (_, n) => Array.from({ length: 26 }, (_, k) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return k > n ? 0 : r;
}));
const POP = Uint8Array.from({ length: 256 }, (_, b) => { let c = 0; for (let t = 0; t < 8; t++) c += (b >> t) & 1; return c; });
// RK[(j * 17 + k) * 256 + b]: rank contribution of byte j holding value b when k bits are set below it.
const RK = (() => {
  const t = new Int32Array(3 * 17 * 256);
  for (let j = 0; j < 3; j++) {
    for (let k = 0; k < 17; k++) {
      for (let b = 0; b < 256; b++) {
        let r = 0; let c = k;
        for (let bit = 0; bit < 8; bit++) if ((b >> bit) & 1) { c++; r += BIN[8 * j + bit][c]; }
        t[(j * 17 + k) * 256 + b] = r;
      }
    }
  }
  return t;
})();
const rank24 = (m) => {
  const b0 = m & 255; const b1 = (m >> 8) & 255; const b2 = (m >> 16) & 255;
  const k1 = POP[b0];
  return RK[b0] + RK[(17 + k1) * 256 + b1] + RK[(34 + k1 + POP[b1]) * 256 + b2];
};
const rank16 = (m) => {
  const b0 = m & 255; const b1 = (m >> 8) & 255;
  return RK[b0] + RK[(17 + POP[b0]) * 256 + b1];
};
// 8-bit masks with four bits: ranks 0..69.
const RANK8 = new Int8Array(256).fill(-1);
const MASK8 = [];
for (let b = 0; b < 256; b++) if (POP[b] === 4) { RANK8[b] = MASK8.length; MASK8.push(b); }

// Byte-wise move tables for masks: tbl[j * 256 + b] = image of byte j, bits placed by the new slot.
function maskTable(cp, base, bytes) {
  const inv = new Int8Array(cp.length);
  cp.forEach((old, i) => { inv[old] = i; });
  const tbl = new Int32Array(bytes * 256);
  for (let j = 0; j < bytes; j++) {
    for (let b = 0; b < 256; b++) {
      let r = 0;
      for (let t = 0; t < 8; t++) if ((b >> t) & 1) r |= 1 << (inv[base + 8 * j + t] - base);
      tbl[j * 256 + b] = r;
    }
  }
  return tbl;
}
const mv24 = (t, m) => t[m & 255] | t[256 + ((m >> 8) & 255)] | t[512 + ((m >> 16) & 255)];
const mv16 = (t, m) => t[m & 255] | t[256 + ((m >> 8) & 255)];

// ---------- center tables ----------
let CT = null;
export function centerTables() { return (CT ??= buildCenterTables()); }

function buildCenterTables() {
  const t0 = performance.now();
  const m = model();
  const gens = m.gens;
  const preserves = (g, sets) => sets.every((s) => s.every((i) => s.includes(g.cp[i])));
  const sets = [Array.from({ length: 8 }, (_, i) => i), Array.from({ length: 8 }, (_, i) => 8 + i), Array.from({ length: 8 }, (_, i) => 16 + i)];
  const gA = gens.map((_, i) => i);
  const gB = gA.filter((i) => preserves(gens[i], [sets[0], [...sets[1], ...sets[2]]]));
  const gC = gA.filter((i) => preserves(gens[i], sets));

  // Stage A: exact distances over C(24,8) masks.
  const tA = gA.map((i) => maskTable(gens[i].cp, 0, 3));
  const distA = new Uint8Array(735471).fill(255);
  {
    let cur = new Int32Array(735471); let next = new Int32Array(735471);
    let n = 1; cur[0] = 0xFF; distA[rank24(0xFF)] = 0;
    for (let d = 0; n > 0; d++) {
      let nn = 0;
      for (let s = 0; s < n; s++) {
        const mk = cur[s];
        for (let g = 0; g < tA.length; g++) {
          const nm = mv24(tA[g], mk);
          const r = rank24(nm);
          if (distA[r] === 255) { distA[r] = d + 1; next[nn++] = nm; }
        }
      }
      [cur, next] = [next, cur]; n = nn;
    }
  }
  // Stage B: C(16,8) over slots 8..23.
  const tB = gB.map((i) => maskTable(Uint8Array.from(gens[i].cp, (v) => v), 8, 2));
  const distB = new Uint8Array(12870).fill(255);
  {
    // Moves preserve the U/D set, so slots 8..23 map among themselves.
    let cur = [0xFF00]; distB[rank16(0xFF00)] = 0;
    for (let d = 0; cur.length; d++) {
      const next = [];
      for (const mk of cur) {
        for (const t of tB) {
          const nm = mv16(t, mk);
          const r = rank16(nm);
          if (distB[r] === 255) { distB[r] = d + 1; next.push(nm); }
        }
      }
      cur = next;
    }
  }
  // Stage C: three axis sets, 70 states each.
  const move70 = [0, 1, 2].map((ax) => gC.map((i) => {
    const out = new Uint8Array(70);
    const cp = gens[i].cp;
    const inv = new Int8Array(24);
    cp.forEach((old, s) => { inv[old] = s; });
    MASK8.forEach((mk, r) => {
      let nm = 0;
      for (let t = 0; t < 8; t++) if ((mk >> t) & 1) nm |= 1 << (inv[8 * ax + t] - 8 * ax);
      out[r] = RANK8[nm];
    });
    return out;
  }));
  const distC = new Uint8Array(343000).fill(255);
  {
    const goal = (RANK8[0x0F] * 70 + RANK8[0x0F]) * 70 + RANK8[0x0F];
    let cur = [goal]; distC[goal] = 0;
    for (let d = 0; cur.length; d++) {
      const next = [];
      for (const code of cur) {
        const a = (code / 4900) | 0; const b = ((code / 70) | 0) % 70; const c = code % 70;
        for (let g = 0; g < gC.length; g++) {
          const nc = (move70[0][g][a] * 70 + move70[1][g][b]) * 70 + move70[2][g][c];
          if (distC[nc] === 255) { distC[nc] = d + 1; next.push(nc); }
        }
      }
      cur = next;
    }
  }
  let reachC = 0; for (let i = 0; i < distC.length; i++) if (distC[i] !== 255) reachC++;
  return { gA, gB, gC, distA, distB, distC, reachC, bytes: distA.length + distB.length + distC.length, ms: performance.now() - t0 };
}

// Stage coordinates of a center color array (colors 0..5 per slot).
export function coordA(c) { let m = 0; for (let i = 0; i < 24; i++) if (c[i] < 2) m |= 1 << i; return m; }
export function coordB(c) { let m = 0; for (let i = 8; i < 24; i++) if (c[i] >= 4) m |= 1 << (i - 8); return m; }
export function coordC(c) {
  let a = 0; let b = 0; let d = 0;
  for (let i = 0; i < 8; i++) { if (c[i] === 0) a |= 1 << i; if (c[8 + i] === 2) b |= 1 << i; if (c[16 + i] === 4) d |= 1 << i; }
  return (RANK8[a] * 70 + RANK8[b]) * 70 + RANK8[d];
}
export const hA = (c) => centerTables().distA[rank24(coordA(c))];
export const hB = (c) => centerTables().distB[rank16(coordB(c))];
export const hC = (c) => centerTables().distC[coordC(c)];

// ---------- center search ----------
// All paths of exactly `len` frame moves that end with h === 0, walking only
// through states whose exact distance still fits (so nothing is wasted).
function enumPaths(m, h, allowed, colors, len, cap, out) {
  const { gens } = m;
  const stack = Array.from({ length: len + 1 }, () => new Uint8Array(24));
  stack[0].set(colors);
  const path = new Int8Array(len);
  const dfs = (depth, prev) => {
    if (out.length >= cap) return;
    const cur = stack[depth];
    const rem = len - depth;
    const d = h(cur);
    if (d > rem) return;
    if (rem === 0) { out.push({ path: Array.from(path), colors: Uint8Array.from(cur) }); return; }
    for (const g of allowed) {
      if (prev >= 0 && (g === gens[prev].inv || (gens[prev].comm[g] && g < prev))) continue;
      const cp = gens[g].cp; const nxt = stack[depth + 1];
      for (let i = 0; i < 24; i++) nxt[i] = cur[cp[i]];
      path[depth] = g;
      dfs(depth + 1, g);
      if (out.length >= cap) return;
    }
  };
  dfs(0, -1);
}

// Candidates of one stage: optimal paths first, then one and two moves longer
// until `cap` paths are collected.
function stagePaths(m, h, allowed, colors, cap, slack) {
  const d0 = h(colors);
  if (d0 === 255) return [];
  const out = [];
  for (let len = d0; len <= d0 + slack && out.length < cap; len++) enumPaths(m, h, allowed, colors, len, cap, out);
  return out;
}

// Solves the three stages. Returns the best frame-move list plus a few
// alternatives of nearly the same length ({ path, stages }), or null.
export function solveCenters(colors, opts = {}) {
  const m = model();
  const T = centerTables();
  const { keepA = 24, capA = 4000, capB = 3000, slackA = 1, slackB = 1, alts = 8 } = opts;
  const candA = stagePaths(m, hA, T.gA, colors, capA, slackA)
    .map((p) => ({ ...p, score: p.path.length + (hB(p.colors) === 255 ? 255 : hB(p.colors)) }))
    .filter((p) => p.score < 255)
    .sort((x, y) => x.score - y.score)
    .slice(0, keepA);
  const top = []; // best combinations so far, sorted by total
  for (const a of candA) {
    if (top.length >= alts && a.score + 3 >= top[top.length - 1].total) break;
    const candB = stagePaths(m, hB, T.gB, a.colors, capB, slackB);
    for (const b of candB) {
      const c = hC(b.colors);
      if (c === 255) continue;
      const total = a.path.length + b.path.length + c;
      if (top.length >= alts && total >= top[top.length - 1].total) continue;
      top.push({ total, a, b, c });
      top.sort((x, y) => x.total - y.total);
      if (top.length > alts) top.pop();
    }
  }
  const out = [];
  for (const t of top) {
    const cOut = [];
    enumPaths(m, hC, T.gC, t.b.colors, t.c, 1, cOut);
    if (cOut.length) out.push({ path: [...t.a.path, ...t.b.path, ...cOut[0].path], stages: [t.a.path.length, t.b.path.length, t.c] });
  }
  return out.length ? { ...out[0], alts: out } : null;
}

// ---------- edge pairing ----------
const OUTER_BASES = ['U', 'D', 'R', 'L', 'F', 'B'];
let LIB = null;
export function pairLibrary() { return (LIB ??= buildLibrary()); }

const SUFFIX = ['', "'", '2'];
const invTok = (t) => (t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : `${t}'`);

function buildLibrary() {
  const t0 = performance.now();
  const m = model();
  const { buttons, buttonByToken } = m;
  const id = (t) => buttonByToken.get(t);
  const outer = buttons.map((b, i) => (OUTER_BASES.includes(b.base) ? i : -1)).filter((i) => i >= 0);
  const inner = buttons.map((b, i) => (OUTER_BASES.includes(b.base) ? -1 : i)).filter((i) => i >= 0);
  const invOf = buttons.map((b) => id(invTok(b.token)));
  const faceRank = (i) => OUTER_BASES.indexOf(buttons[i].base);

  // Outer words up to 3 turns: no two in a row on one face, opposite faces in a fixed order.
  const words = [];
  const grow = (w, left) => {
    if (w.length) words.push(w.slice());
    if (!left) return;
    for (const t of outer) {
      const last = w[w.length - 1];
      if (last !== undefined) {
        const a = buttons[last]; const b = buttons[t];
        if (a.base === b.base || (a.axis === b.axis && faceRank(t) < faceRank(last))) continue;
      }
      w.push(t); grow(w, left - 1); w.pop();
    }
  };
  grow([], 3);
  // Known cores of the teaching solver, behind up to two outer turns.
  const cores = ["R U R' F R' F' R", "L' U' L F' L F L'", "R F' U R' F"].map((s) => s.split(' ').map(id));
  const setups = [[]];
  for (const a of outer) { setups.push([a]); for (const b of outer) if (buttons[a].base !== buttons[b].base && !(buttons[a].axis === buttons[b].axis && faceRank(b) < faceRank(a))) setups.push([a, b]); }
  for (const core of cores) for (const su of setups) words.push([...su, ...core]);

  const solvedC = Uint8Array.from({ length: 24 }, (_, i) => i >> 2);
  const tmp = new Uint8Array(24); const cur = new Uint8Array(24);
  const byWp = new Map();
  const tryMacro = (seq) => {
    cur.set(solvedC);
    for (const t of seq) { const cp = buttons[t].cp; for (let i = 0; i < 24; i++) tmp[i] = cur[cp[i]]; cur.set(tmp); }
    for (let i = 0; i < 24; i++) if (cur[i] !== solvedC[i]) return;
    let wp = buttons[seq[0]].wp;
    for (let k = 1; k < seq.length; k++) wp = compose(wp, buttons[seq[k]].wp);
    let pure = true; for (let i = 0; i < 24; i++) if (wp[i] !== i) { pure = false; break; }
    if (pure) return;
    const key = permKey(wp);
    const old = byWp.get(key);
    if (!old || old.seq.length > seq.length) byWp.set(key, { seq: seq.slice(), wp });
  };
  for (const a of inner) for (const w of words) tryMacro([a, ...w, invOf[a]]);
  const lib = [...byWp.values()].sort((x, y) => x.seq.length - y.seq.length);
  // Index by "which two source wings land together at location E": a macro can
  // only create a pair if both wings of some unpaired class are among its sources.
  const nm = lib.length;
  const start = new Int32Array(12 * 576 + 1);
  const keyOfMacro = (k, e) => { const wp = lib[k].wp; const a = wp[2 * e]; const b = wp[2 * e + 1]; return e * 576 + (a < b ? a * 24 + b : b * 24 + a); };
  for (let k = 0; k < nm; k++) for (let e = 0; e < 12; e++) start[keyOfMacro(k, e) + 1]++;
  for (let i = 0; i < start.length - 1; i++) start[i + 1] += start[i];
  const fill = start.slice(0, -1);
  const list = new Int32Array(nm * 12);
  for (let k = 0; k < nm; k++) for (let e = 0; e < 12; e++) list[fill[keyOfMacro(k, e)]++] = k;
  return { macros: lib, tokens: lib.map((e) => e.seq), wps: lib.map((e) => e.wp), start, list, stamp: new Int32Array(nm), tick: 0, ms: performance.now() - t0 };
}

export const pairsOf = (wc) => { let n = 0; for (let e = 0; e < 12; e++) if (wc[2 * e] === wc[2 * e + 1]) n++; return n; };

// Macros that create at least one pair from `wc`, as [k, pairsAfter] entries in `out`.
function gainers(L, wc, pairs0, out) {
  out.length = 0;
  const tick = ++L.tick;
  const where = [[], [], [], [], [], [], [], [], [], [], [], []];
  for (let i = 0; i < 24; i++) where[wc[i]].push(i);
  const nw = new Uint8Array(24);
  for (let c = 0; c < 12; c++) {
    const [s, t] = where[c];
    if ((s >> 1) === (t >> 1)) continue;
    const key = s * 24 + t;
    for (let e = 0; e < 12; e++) {
      const b = e * 576 + key;
      for (let i = L.start[b]; i < L.start[b + 1]; i++) {
        const k = L.list[i];
        if (L.stamp[k] === tick) continue;
        L.stamp[k] = tick;
        const wp = L.wps[k];
        let p = 0;
        for (let j = 0; j < 24; j++) nw[j] = wc[wp[j]];
        for (let j = 0; j < 12; j++) if (nw[2 * j] === nw[2 * j + 1]) p++;
        if (p > pairs0) out.push([k, p]);
      }
    }
  }
  return out;
}

// Greedy beam over the macro library: every step creates at least one pair.
// A state with no such macro takes a short preparation macro first (two
// macros chosen together). Returns the macros (lists of button ids) or null.
export function pairEdges(wc0, opts = {}) {
  const { width = 8, weight = 3.5, deadline = Infinity, prepTries = 400, noise = 0 } = opts;
  let seed = (opts.seed ?? 1) >>> 0;
  const jitter = () => { if (!noise) return 0; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 4294967296) * noise; };
  const finals = [];
  const L = pairLibrary();
  const nm = L.wps.length;
  let beam = [{ wc: wc0, pairs: pairsOf(wc0), len: 0, path: [] }];
  let best = null;
  const mid = new Uint8Array(24);
  const g1 = []; const g2 = [];
  for (let step = 0; step < 16 && beam.length; step++) {
    const cands = [];
    const stuck = [];
    for (const st of beam) {
      if (st.pairs === 12) continue;
      gainers(L, st.wc, st.pairs, g1);
      if (!g1.length) { stuck.push(st); continue; }
      for (const [k, p] of g1) {
        const len = st.len + L.tokens[k].length;
        if (best && len >= best.len) continue;
        cands.push({ score: len + (12 - p) * weight + jitter(), len, pairs: p, parent: st, ks: [k] });
      }
    }
    // Stuck states take a short preparation macro, then the best gaining macro.
    stuck.sort((x, y) => (x.len + (12 - x.pairs) * weight) - (y.len + (12 - y.pairs) * weight));
    for (const st of stuck) {
      if (cands.length >= width * 2) break;
      let found = 0;
      for (let k1 = 0; k1 < Math.min(nm, prepTries) && found < 8; k1++) {
        const wp = L.wps[k1];
        for (let i = 0; i < 24; i++) mid[i] = st.wc[wp[i]];
        gainers(L, mid, st.pairs, g2);
        let bestK = -1; let bestScore = Infinity; let bestP = 0;
        for (const [k2, p] of g2) {
          const sc = L.tokens[k2].length + (12 - p) * weight;
          if (sc < bestScore) { bestScore = sc; bestK = k2; bestP = p; }
        }
        if (bestK < 0) continue;
        const len = st.len + L.tokens[k1].length + L.tokens[bestK].length;
        if (best && len >= best.len) continue;
        cands.push({ score: len + (12 - bestP) * weight + jitter(), len, pairs: bestP, parent: st, ks: [k1, bestK] });
        found++;
      }
    }
    cands.sort((a, b) => a.score - b.score);
    const next = [];
    const seen = new Set();
    for (const c of cands) {
      if (next.length >= width) break;
      let wc = c.parent.wc;
      for (const k of c.ks) { const wp = L.wps[k]; wc = Uint8Array.from(wp, (v) => wc[v]); }
      const key = permKey(wc);
      if (seen.has(key)) continue;
      seen.add(key);
      const node = { wc, pairs: c.pairs, len: c.len, path: [...c.parent.path, ...c.ks] };
      if (node.pairs === 12) { finals.push(node); if (!best || node.len < best.len) best = node; } else next.push(node);
    }
    beam = next;
    if (performance.now() > deadline && best) break;
  }
  if (!best) return null;
  const form = (n) => ({ macros: n.path.map((k) => L.tokens[k]), len: n.len });
  finals.sort((x, y) => x.len - y.len);
  return { ...form(best), finals: finals.slice(0, 12).map(form) };
}

// ---------- driver ----------
// Moves written in the frame labeling become physical buttons: a button b
// seen through the accumulated rotation R is R b R^-1.
function physicalToken(m, R, token) {
  const b = m.buttons[m.buttonByToken.get(token)];
  const p = compose(compose(R, b.perm), invertPerm(R));
  const i = m.buttonByPerm.get(permKey(p));
  if (i === undefined) throw new Error(`Sin botón físico para ${token}`);
  return m.buttons[i].token;
}

const parseQuarter = (t) => (t.endsWith("'") ? 3 : t.endsWith('2') ? 2 : 1);

// Merges consecutive moves of one block (also across commuting ones) and drops
// those that cancel. Pure rewriting of the button list, replay-checked by callers.
export function simplifyMoves(tokens) {
  const m = model();
  const out = [];
  for (const t of tokens) {
    const b = m.buttons[m.buttonByToken.get(t)];
    const baseTok = b.base;
    const q = parseQuarter(t);
    let done = false;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].block === b.block) {
        out[i].q = (out[i].q + q) % 4;
        if (!out[i].q) out.splice(i, 1);
        done = true;
        break;
      }
      if (!(out[i].axis === b.axis && !out[i].layers.some((c) => b.layers.includes(c)))) break;
    }
    if (!done) out.push({ block: b.block, axis: b.axis, layers: b.layers, base: baseTok, q: q % 4 });
  }
  return out.map((o) => (o.q === 1 ? o.base : o.q === 2 ? `${o.base}2` : `${o.base}'`));
}

// 3x3 reading of a reduced 4x4 (centers solved, edges paired): the 3x3 grid and its validation.
export function readAsThree(state) {
  const g4 = gridFromState(state);
  const pick = [0, 1, 3, 4, 5, 7, 12, 13, 15];
  const g3 = {};
  for (const f of Object.keys(g4)) g3[f] = pick.map((i) => g4[f][i]);
  return { grid: g3, check: validateGrid(g3, 3) };
}

const turn = (state, tokens) => { for (const t of tokens) state.applyMove(t); };

// The cube held so that DBL is home: { F (rotated copy), R (rotation applied) }.
export function frameOf(m, input) {
  const F = input.clone();
  const dbl = F.cubies.find((c) => c.type === 'corner' && ['D', 'B', 'L'].every((f) => c.faces.includes(f)));
  const q = m.rotOf[m.idx.get(slotKey(dbl.pos, F.stickerNormal(dbl, 'D')))];
  turn(F, m.rots[q].tokens);
  return { F, R: m.rots[q].perm };
}

export const centersDone = (m, a) => centersOf(m, a).every((v, i) => v === (i >> 2));

// Full reduction. Explores several center/pairing variants within the budget
// (the first one always completes) and returns the shortest replay-checked
// solution: { moves, rotation, length, ... }. Throws if nothing could be built.
export function reduceSolve(input, opts = {}) {
  const { timeMs = 2500, target = 0, maxRounds = 80 } = opts;
  const t0 = performance.now();
  const m = model();
  const deadline = t0 + timeMs;
  const stat = { rounds: 0, built: 0, skipped: 0, failed: 0, polishGain: 0 };
  let lastError = null;

  const { F: F0, R: R0 } = frameOf(m, input);

  const cen = solveCenters(centersOf(m, stickersOf(m, F0)));
  if (!cen) throw new Error('Los centros no tienen solución por etapas');

  // Physical buttons and final rotation of a frame sequence.
  const assemble = (seq, extraRot) => {
    let R = R0;
    let phys = [];
    for (const { token, q } of seq) {
      phys.push(physicalToken(m, R, token));
      if (q) R = compose(R, m.rots[q].perm);
    }
    const rotIdx = m.rotByKey.get(permKey(compose(R, rotationPerm(m, extraRot))));
    if (rotIdx === undefined) throw new Error('Rotación final inválida');
    const faceLength = phys.length;
    phys = simplifyMoves(phys);
    const rotation = m.rots[rotIdx].tokens.slice();
    const chk = input.clone();
    turn(chk, phys);
    turn(chk, rotation);
    if (!chk.isSolved() || !heldRight(chk)) throw new Error('La reducción no dejó el cubo armado');
    return { moves: phys, rotation, length: phys.length, faceLength };
  };

  // Builds one candidate from a center plan and a pairing; null when it cannot beat `best`.
  let best = null;
  const build = (alt, macros, threeMs, force) => {
    const F = F0.clone();
    const seq = [];
    const push = (token, q = 0) => { seq.push({ token, q }); F.applyMove(token); if (q) turn(F, m.rots[q].tokens); };
    for (const g of alt.path) push(m.gens[g].token, m.gens[g].q);
    for (const mac of macros) for (const b of mac) push(m.buttons[b].token);
    {
      const a = stickersOf(m, F);
      if (pairsOf(wingsOf(m, a)) !== 12 || !centersDone(m, a)) throw new Error('Tras emparejar quedan aristas o centros sin armar');
    }
    let oll = 0; let pll = 0;
    for (let guard = 0; guard < 3; guard++) {
      const { check } = readAsThree(F);
      if (check.ok) break;
      const codes = new Set(check.errors.map((e) => e.code));
      if (codes.has('flip')) { for (const t of ALGS.OLL_PARITY.split(' ')) push(t); oll++; } else if (codes.has('parity')) { for (const t of ALGS.PLL_PARITY.split(' ')) push(t); pll++; } else throw new Error(`Lectura 3x3 inválida: ${check.errors.map((e) => e.code).join(',')}`);
    }
    const three = readAsThree(F);
    if (!three.check.ok) throw new Error('La paridad no quedó resuelta');
    {
      const a = stickersOf(m, F);
      if (pairsOf(wingsOf(m, a)) !== 12 || !centersDone(m, a)) throw new Error('La paridad rompió aristas o centros');
    }
    if (!force && best && seq.length + MIN_THREE >= best.length) { stat.skipped++; return null; }
    const tp = twoPhaseSolve(three.check.state, { timeMs: threeMs, target });
    const full = [...seq, ...tp.moves.map((token) => ({ token, q: 0 }))];
    const res = assemble(full, tp.rotation);
    stat.built++;
    return { ...res, prefix: seq, state3: three.check.state, threeLength: tp.moves.length, centers: alt.path.length, pairing: macros.reduce((n, x) => n + x.length, 0), oll, pll };
  };

  const wcAfter = (alt) => {
    const F = F0.clone();
    for (const g of alt.path) { F.applyMove(m.gens[g].token); if (m.gens[g].q) turn(F, m.rots[m.gens[g].q].tokens); }
    return wingsOf(m, stickersOf(m, F));
  };
  const wcByAlt = new Map();

  for (let round = 0; round < maxRounds; round++) {
    if (round > 0 && (best?.length === 0 || performance.now() > t0 + timeMs * 0.55)) break;
    stat.rounds++;
    const alt = cen.alts[round % cen.alts.length];
    if (!wcByAlt.has(alt)) wcByAlt.set(alt, wcAfter(alt));
    const wc = wcByAlt.get(alt);
    const variant = Math.floor(round / cen.alts.length);
    const pr = pairsOf(wc) === 12 ? { finals: [{ macros: [], len: 0 }] } : pairEdges(wc, {
      width: variant === 0 ? 24 : 16, weight: [3.5, 3, 4.5][variant % 3], noise: variant === 0 ? 0 : 2, seed: 17 + round, deadline,
    });
    if (!pr) { lastError = new Error('El emparejado de aristas no terminó'); continue; }
    for (const fin of pr.finals.slice(0, round === 0 ? 3 : 2)) {
      if (best && performance.now() > deadline) break;
      let cand = null;
      try {
        cand = build(alt, fin.macros, round === 0 ? Math.min(120, Math.max(15, timeMs * 0.1)) : 25, !best);
      } catch (err) { lastError = err; stat.failed++; }
      if (cand && (!best || cand.length < best.length)) best = cand;
    }
  }
  if (!best) throw lastError ?? new Error('La reducción no produjo solución');

  // Spend what is left improving the 3x3 part of the best candidate.
  const left = deadline - performance.now();
  if (left > 60) {
    try {
      const tp = twoPhaseSolve(best.state3, { timeMs: left * 0.8, target });
      if (tp.moves.length < best.threeLength) {
        const res = assemble([...best.prefix, ...tp.moves.map((token) => ({ token, q: 0 }))], tp.rotation);
        if (res.length < best.length) { stat.polishGain = best.length - res.length; best = { ...best, ...res, threeLength: tp.moves.length }; }
      }
    } catch (err) { stat.failed++; }
  }
  const { prefix, state3, ...out } = best;
  return { ...out, ms: performance.now() - t0, stat };
}

const MIN_THREE = 9;

function rotationPerm(m, tokens) {
  let p = m.rots[0].perm;
  for (const t of tokens) p = compose(p, m.rotBase.find((b) => b.tokens[0] === t).perm);
  return p;
}
function heldRight(s) {
  for (const [key, color] of s.facelets()) {
    const face = key.split('|')[1];
    if ((face === 'U' || face === 'F') && color !== face) return false;
  }
  return true;
}

export function prepareReduction() {
  const t0 = performance.now();
  model();
  const c = centerTables();
  const l = pairLibrary();
  const tp = prepareTwoPhase();
  return { ms: performance.now() - t0, bytes: c.bytes + l.list.byteLength + l.start.byteLength + tp.bytes, centersMs: c.ms, libraryMs: l.ms, twoPhaseMs: tp.ms };
}
