// Two-phase solver (Kociemba's scheme, own code) for the 3x3.
//
// Phase 1 brings the cube into G1 = <U, D, R2, L2, F2, B2>: corners and edges
// oriented, the four middle-layer edges in the middle layer. Phase 2 solves
// the rest with G1 moves only. Both phases are IDA* over coordinates with
// pruning tables:
//
//   phase 1: twist (2187) x slice (495), flip (2048) x slice (495)
//   phase 2: corner perm (40320) x slice perm (24), U/D edge perm (40320) x slice perm
//
// The cubie model is NOT written by hand: slots, orientations and the 18 face
// moves are all read from CubeState (cube-core.js), so there is a single
// source of truth for what a move does. The move tables are checked against
// CubeState in tests/verify-quick.mjs.
//
// Orientation conventions (any consistent choice works, these are the usual):
//  - corner twist: 0 when the piece's U/D sticker sits on a U/D face of the
//    slot, else 1 or 2 by the clockwise order seen from outside the corner;
//  - edge flip: 0 when the piece's reference sticker (U/D, else F/B) sits on
//    the slot's reference axis (U/D layer slots: y; middle layer slots: z).
//
// The input may have moved centers (slice moves in the scramble). It is first
// rotated as a whole until centers are home (rotations are free), and the
// solution is relabelled back, so the result applies to the original state.
import { CubeState } from '../cube-core.js';
import { ROTATIONS, canonicalRotation, conjugate, optimizeSolution } from './optimize.js';

const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
export const MOVE_NAMES = FACE_ORDER.flatMap((f) => [f, f + '2', f + "'"]); // id = face * 3 + power - 1
const isP2Move = (m) => (m / 3 | 0) % 3 === 0 || m % 3 === 1; // U, D any power; others only half turns
export const P2_MOVES = MOVE_NAMES.map((_, m) => m).filter(isP2Move);

// ---------- cubie layout, read from CubeState ----------
const solvedModel = new CubeState(3);
const cornerCubies = solvedModel.cubies.filter((c) => c.type === 'corner');
const edgeCubies = [
  ...solvedModel.cubies.filter((c) => c.type === 'edge' && c.home[1] !== 0), // U/D layer: ids 0..7
  ...solvedModel.cubies.filter((c) => c.type === 'edge' && c.home[1] === 0), // middle layer: ids 8..11
];
const cornerSlot = new Map(cornerCubies.map((c, i) => [c.home.join(','), i]));
const edgeSlot = new Map(edgeCubies.map((c, i) => [c.home.join(','), i]));

function twistOf(state, c) {
  const f = c.faces.find((x) => x === 'U' || x === 'D');
  const nv = state.stickerNormal(c, f);
  if (nv[1] !== 0) return 0;
  const [px, py, pz] = c.pos.map((v) => Math.sign(v));
  const xFirst = py * px * pz === -1; // clockwise order (y, x, z) when the determinant is +1
  if (nv[0] !== 0) return xFirst ? 1 : 2;
  return xFirst ? 2 : 1;
}

function flipOf(state, c) {
  const axis = c.pos[1] !== 0 ? 1 : 2;
  const f = c.faces.find((x) => x === 'U' || x === 'D') ?? c.faces.find((x) => x === 'F' || x === 'B');
  return state.stickerNormal(c, f)[axis] !== 0 ? 0 : 1;
}

// Cubie arrays of a state: piece in each slot and its orientation. `bug` is a
// test-only switch that corrupts the mapping on purpose.
export function cubiesFromState(state, bug = null) {
  const cp = new Int8Array(8); const co = new Int8Array(8);
  const ep = new Int8Array(12); const eo = new Int8Array(12);
  for (const c of state.cubies) {
    if (c.type === 'corner') {
      const s = cornerSlot.get(c.pos.join(','));
      cp[s] = cornerSlot.get(c.home.join(','));
      co[s] = twistOf(state, c);
    } else if (c.type === 'edge') {
      const s = edgeSlot.get(c.pos.join(','));
      ep[s] = edgeSlot.get(c.home.join(','));
      eo[s] = flipOf(state, c);
    }
  }
  if (bug === 'swapCorners') { const t = cp[0]; cp[0] = cp[1]; cp[1] = t; }
  if (bug === 'swapEdges') { const t = ep[0]; ep[0] = ep[1]; ep[1] = t; }
  if (bug === 'twist') co[0] = (co[0] + 1) % 3;
  return { cp, co, ep, eo };
}

// ---------- ranking ----------
const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
const BINOM = Array.from({ length: 13 }, (_, n) => Array.from({ length: 13 }, (_, k) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return k > n ? 0 : r;
}));

function permRank(a, from, n) { // Lehmer code of a[from..from+n)
  let r = 0;
  for (let i = 0; i < n; i++) {
    let smaller = 0;
    for (let j = i + 1; j < n; j++) if (a[from + j] < a[from + i]) smaller++;
    r += smaller * FACT[n - 1 - i];
  }
  return r;
}

function permUnrank(r, n) {
  const pool = Array.from({ length: n }, (_, i) => i);
  const out = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const f = FACT[n - 1 - i];
    out[i] = pool.splice((r / f) | 0, 1)[0];
    r %= f;
  }
  return out;
}

const twistRank = (co) => { let r = 0; for (let i = 0; i < 7; i++) r = r * 3 + co[i]; return r; };
const twistUnrank = (r) => {
  const co = new Int8Array(8); let sum = 0;
  for (let i = 6; i >= 0; i--) { co[i] = r % 3; sum += co[i]; r = (r / 3) | 0; }
  co[7] = (3 - (sum % 3)) % 3;
  return co;
};
const flipRank = (eo) => { let r = 0; for (let i = 0; i < 11; i++) r = r * 2 + eo[i]; return r; };
const flipUnrank = (r) => {
  const eo = new Int8Array(12); let sum = 0;
  for (let i = 10; i >= 0; i--) { eo[i] = r & 1; sum += eo[i]; r >>= 1; }
  eo[11] = sum & 1;
  return eo;
};
// Slots holding the four middle-layer pieces (ids >= 8), as a combination rank.
const sliceRank = (ep) => {
  let r = 0; let k = 0;
  for (let s = 0; s < 12; s++) if (ep[s] >= 8) r += BINOM[s][++k];
  return r;
};
const sliceUnrank = (r) => {
  const ep = new Int8Array(12);
  for (let s = 11, k = 4; s >= 0 && k > 0; s--) if (BINOM[s][k] <= r) { r -= BINOM[s][k]; ep[s] = 8; k--; }
  return ep;
};

// ---------- moves and tables (built once, lazily) ----------
let T = null;

function buildMoves() {
  return MOVE_NAMES.map((name) => {
    const s = new CubeState(3);
    s.applyMove(name);
    const { cp, co, ep, eo } = cubiesFromState(s);
    return { cp, co, ep, eo };
  });
}

// BFS over the product of two coordinates; unreachable cells stay 255.
function pruneTable(sizeA, sizeB, moveA, moveB, nm, a0, b0) {
  const t = new Uint8Array(sizeA * sizeB).fill(255);
  t[a0 * sizeB + b0] = 0;
  for (let d = 0, added = 1; added > 0; d++) {
    added = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== d) continue;
      const a = (i / sizeB) | 0; const b = i - a * sizeB;
      for (let m = 0; m < nm; m++) {
        const j = moveA[a * nm + m] * sizeB + moveB[b * nm + m];
        if (t[j] === 255) { t[j] = d + 1; added++; }
      }
    }
  }
  return t;
}

function buildTables() {
  const t0 = performance.now();
  const mv = buildMoves();
  const solved = cubiesFromState(solvedModel);
  const P2 = P2_MOVES;

  const twistMove = new Uint16Array(2187 * 18);
  for (let r = 0; r < 2187; r++) {
    const co = twistUnrank(r);
    for (let m = 0; m < 18; m++) {
      const n = new Int8Array(8);
      for (let s = 0; s < 8; s++) n[s] = (co[mv[m].cp[s]] + mv[m].co[s]) % 3;
      twistMove[r * 18 + m] = twistRank(n);
    }
  }
  const flipMove = new Uint16Array(2048 * 18);
  for (let r = 0; r < 2048; r++) {
    const eo = flipUnrank(r);
    for (let m = 0; m < 18; m++) {
      const n = new Int8Array(12);
      for (let s = 0; s < 12; s++) n[s] = (eo[mv[m].ep[s]] + mv[m].eo[s]) % 2;
      flipMove[r * 18 + m] = flipRank(n);
    }
  }
  const sliceMove = new Uint16Array(495 * 18);
  for (let r = 0; r < 495; r++) {
    const ep = sliceUnrank(r);
    for (let m = 0; m < 18; m++) {
      const n = new Int8Array(12);
      for (let s = 0; s < 12; s++) n[s] = ep[mv[m].ep[s]];
      sliceMove[r * 18 + m] = sliceRank(n);
    }
  }
  const cpMove = new Uint16Array(40320 * P2.length);
  const udMove = new Uint16Array(40320 * P2.length);
  for (let r = 0; r < 40320; r++) {
    const p = permUnrank(r, 8);
    P2.forEach((m, k) => {
      const n = new Int8Array(8);
      for (let s = 0; s < 8; s++) n[s] = p[mv[m].cp[s]];
      cpMove[r * P2.length + k] = permRank(n, 0, 8);
      const e = new Int8Array(8);
      for (let s = 0; s < 8; s++) {
        if (mv[m].ep[s] >= 8) throw new Error('Un giro de la fase 2 saca una arista de su capa');
        e[s] = p[mv[m].ep[s]];
      }
      udMove[r * P2.length + k] = permRank(e, 0, 8);
    });
  }
  const spMove = new Uint8Array(24 * P2.length);
  for (let r = 0; r < 24; r++) {
    const p = permUnrank(r, 4);
    P2.forEach((m, k) => {
      const n = new Int8Array(4);
      for (let s = 0; s < 4; s++) n[s] = p[mv[m].ep[8 + s] - 8];
      spMove[r * P2.length + k] = permRank(n, 0, 4);
    });
  }

  const sliceHome = sliceRank(solved.ep);
  const pruneTwist = pruneTable(2187, 495, twistMove, sliceMove, 18, 0, sliceHome);
  const pruneFlip = pruneTable(2048, 495, flipMove, sliceMove, 18, 0, sliceHome);
  const pruneCp = pruneTable(40320, 24, cpMove, spMove, P2.length, 0, 0);
  const pruneUd = pruneTable(40320, 24, udMove, spMove, P2.length, 0, 0);

  const arrays = { twistMove, flipMove, sliceMove, cpMove, udMove, spMove, pruneTwist, pruneFlip, pruneCp, pruneUd };
  const bytes = Object.values(arrays).reduce((s, a) => s + a.byteLength, 0);
  return { mv, sliceHome, ...arrays, bytes, ms: performance.now() - t0 };
}

function tables() { return (T ??= buildTables()); }

// Builds the tables if needed and returns their statistics.
export function prepareTwoPhase() {
  const t = tables();
  return { ms: t.ms, bytes: t.bytes };
}

// ---------- coordinates ----------
export function coordsOf(c) {
  return {
    twist: twistRank(c.co), flip: flipRank(c.eo), slice: sliceRank(c.ep),
    cp: permRank(c.cp, 0, 8), ud: permRank(c.ep, 0, 8), sp: permRank(Int8Array.from(c.ep.subarray(8), (v) => v - 8), 0, 4),
  };
}
export const coordsFromState = (state, bug) => coordsOf(cubiesFromState(state, bug));

// Phase 1 coordinates after move m, by table.
export function stepPhase1(c, m) {
  const t = tables();
  return { twist: t.twistMove[c.twist * 18 + m], flip: t.flipMove[c.flip * 18 + m], slice: t.sliceMove[c.slice * 18 + m] };
}
// Phase 2 coordinates after the k-th phase 2 move (P2_MOVES[k]), by table.
export function stepPhase2(c, k) {
  const t = tables();
  const n = P2_MOVES.length;
  return { cp: t.cpMove[c.cp * n + k], ud: t.udMove[c.ud * n + k], sp: t.spMove[c.sp * n + k] };
}

// Admissible lower bounds on the number of face moves left in each phase.
export function phase1Bound(c) {
  const t = tables();
  return Math.max(t.pruneTwist[c.twist * 495 + c.slice], t.pruneFlip[c.flip * 495 + c.slice]);
}
export function phase2Bound(c) {
  const t = tables();
  return Math.max(t.pruneCp[c.cp * 24 + c.sp], t.pruneUd[c.ud * 24 + c.sp]);
}

function applyCubie(c, m, mv) {
  const g = mv[m];
  const out = { cp: new Int8Array(8), co: new Int8Array(8), ep: new Int8Array(12), eo: new Int8Array(12) };
  for (let s = 0; s < 8; s++) { out.cp[s] = c.cp[g.cp[s]]; out.co[s] = (c.co[g.cp[s]] + g.co[s]) % 3; }
  for (let s = 0; s < 12; s++) { out.ep[s] = c.ep[g.ep[s]]; out.eo[s] = (c.eo[g.ep[s]] + g.eo[s]) % 2; }
  return out;
}

// Rotation (tokens) after which every center is home, found among the 24.
function homeRotation(state) {
  for (const r of ROTATIONS) {
    const s = state.clone();
    for (const t of r.tokens) s.applyMove(t);
    if (s.cubies.every((c) => c.type !== 'center' || c.pos.every((v, i) => v === c.home[i]))) return { tokens: r.tokens, state: s };
  }
  throw new Error('Ninguna rotación devuelve los centros a su sitio');
}

// ---------- the search ----------
// Finds a short solution of a 3x3 state, spending up to timeMs after the first
// solution has been found (the first one is always completed). Returns face
// moves relabelled for the ORIGINAL state plus the final rotation, already
// post-optimized in the app-button metric.
export function twoPhaseSolve(input, { timeMs = 1200, target = 0 } = {}) {
  if (input.n !== 3) throw new Error('Las dos fases solo admiten el 3x3');
  const t0 = performance.now();
  const t = tables();
  const home = homeRotation(input);
  const base = cubiesFromState(home.state);
  const c0 = coordsOf(base);
  const deadline = t0 + timeMs;
  const P2 = P2_MOVES;
  const p2Face = P2.map((m) => (m / 3) | 0);
  const isP2 = new Uint8Array(18); P2.forEach((m) => { isP2[m] = 1; });

  let nodes = 0; let stop = false; let best = Infinity; let bestPath = null; let firstMs = null;
  const path1 = new Int8Array(32); const path2 = new Int8Array(32);
  const clock = () => {
    if ((++nodes & 1023) === 0 && best < Infinity && performance.now() > deadline) stop = true;
    return stop;
  };

  const dfs2 = (cp, ud, sp, rem, last, depth) => {
    const h = Math.max(t.pruneCp[cp * 24 + sp], t.pruneUd[ud * 24 + sp]);
    if (h > rem) return false;
    if (rem === 0) return true;
    if (clock()) return false;
    for (let k = 0; k < P2.length; k++) {
      const face = p2Face[k];
      if (face === last || (last >= 0 && face % 3 === last % 3 && face < last)) continue;
      path2[depth] = P2[k];
      if (dfs2(t.cpMove[cp * P2.length + k], t.udMove[ud * P2.length + k], t.spMove[sp * P2.length + k], rem - 1, face, depth + 1)) return true;
      if (stop) return false;
    }
    return false;
  };

  const solvePhase2 = (d1, last) => {
    let c = base;
    for (let i = 0; i < d1; i++) c = applyCubie(c, path1[i], t.mv);
    const k = coordsOf(c);
    const cap = Math.min(18, best - 1 - d1);
    for (let len = 0; len <= cap; len++) {
      if (dfs2(k.cp, k.ud, k.sp, len, last, 0)) {
        best = d1 + len;
        bestPath = [...path1.subarray(0, d1), ...path2.subarray(0, len)];
        firstMs ??= performance.now() - t0;
        return;
      }
      if (stop) return;
    }
  };

  const dfs1 = (tw, fl, sl, rem, last, depth) => {
    const h = Math.max(t.pruneTwist[tw * 495 + sl], t.pruneFlip[fl * 495 + sl]);
    if (h > rem) return;
    if (rem === 0) {
      // A last move that phase 2 could also make means a shorter phase 1 exists.
      if (depth > 0 && isP2[path1[depth - 1]]) return;
      solvePhase2(depth, last);
      return;
    }
    if (clock()) return;
    for (let m = 0; m < 18; m++) {
      const face = (m / 3) | 0;
      if (face === last || (last >= 0 && face % 3 === last % 3 && face < last)) continue;
      path1[depth] = m;
      dfs1(t.twistMove[tw * 18 + m], t.flipMove[fl * 18 + m], t.sliceMove[sl * 18 + m], rem - 1, face, depth + 1);
      if (stop) return;
    }
  };

  for (let d1 = 0; d1 <= 12 && d1 < best && !stop && best > target; d1++) dfs1(c0.twist, c0.flip, c0.slice, d1, -1, 0);
  if (!bestPath) throw new Error('Las dos fases no hallaron solución');

  // Faces in the rotated frame -> faces of the original state, then optimize.
  const faceMoves = Array.from(bestPath, (m) => conjugate(MOVE_NAMES[m], home.tokens));
  const rotation = canonicalRotation(home.tokens);
  const opt = optimizeSolution(input, faceMoves, rotation);
  return {
    moves: opt.moves, rotation: opt.rotation, length: opt.moves.length, faceLength: faceMoves.length,
    rewrites: opt.rewrites, nodes, firstMs, ms: performance.now() - t0,
  };
}
