// Exact shortest-solution search (meet in the middle) for the 3x3 and 4x4.
//
// Metric: every app button is one move (see metric.js), rotations are free, and
// a cube counts as solved in any orientation. States are therefore compared
// "modulo rotation": each one is reduced to the one rotation that puts a
// reference corner back in its home slot.
//
//  - Table: every state within D1 moves of solved (BFS, keyed by a 64-bit hash
//    of the canonical state; only the distance is stored).
//  - Search: iterative deepening from the scramble. Layer k enumerates every
//    pruned sequence of exactly k moves and looks each end state up in the
//    table. Layers 0..k-1 found nothing, so every solution is longer than
//    (k-1)+D1; a hit at layer k is then exactly k+D1 long and proven minimal.
//    If the clock runs out after layer k, no solution is shorter than k+D1+1.
//
// Pruning (sound for this generator set): a move is skipped after a move of
// the same block (they merge into one button), and between two commuting
// moves (same axis, disjoint layers) only the order of ascending block index
// is kept. Any shortest solution has a representative in that normal form.
//
// Hash collisions: a table hit is never trusted. The solution is rebuilt and
// replayed on the sticker arrays, so a false positive is discarded. A false
// negative (two table states sharing a hash) has probability about 1e-8.
import { CubeState, FACE_NORMALS } from '../cube-core.js';
import { deserialize } from '../solver.js';
import { generatorList, commute } from './metric.js';
import { twoPhaseSolve } from './two-phase.js';

export { deserialize };

const FACE_ORDER = ['U', 'D', 'F', 'B', 'R', 'L'];
const FI = { U: 0, D: 1, F: 2, B: 3, R: 4, L: 5 };
const ROT_TOKENS = ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'];
// Distance table depth per size, chosen by measurement (see the task evidence).
export const DEFAULT_D1 = { 3: 4, 4: 3 };

// ---------- model: sticker permutations ----------
// A state is a Uint8Array of color indices, one per sticker slot. A move is a
// permutation p: after the move, new[i] = old[p[i]].
const slotKey = (pos, normal) => `${pos.join(',')}|${normal.join(',')}`;

function permOf(n, token, slotIdx, N) {
  const s = new CubeState(n);
  s.applyMove(token);
  const p = new Uint8Array(N);
  for (const c of s.cubies) {
    for (const f of c.faces) {
      p[slotIdx.get(slotKey(c.pos, s.stickerNormal(c, f)))] = slotIdx.get(slotKey(c.home, FACE_NORMALS[f]));
    }
  }
  return p;
}

function compose(a, b) { // apply a, then b
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[b[i]];
  return out;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
  };
}

const models = new Map();
function modelFor(n) {
  if (n !== 3 && n !== 4) throw new Error(`El armado rápido solo admite 3x3 y 4x4 (recibido ${n})`);
  let m = models.get(n);
  if (!m) { m = buildModel(n); models.set(n, m); }
  return m;
}

function buildModel(n) {
  const solvedState = new CubeState(n);
  const slotKeys = [];
  const slotFace = [];
  for (const c of solvedState.cubies) {
    for (const f of c.faces) {
      slotKeys.push(slotKey(c.home, FACE_NORMALS[f]));
      slotFace.push(f);
    }
  }
  const N = slotKeys.length;
  const slotIdx = new Map(slotKeys.map((k, i) => [k, i]));
  const solved = Uint8Array.from(slotFace, (f) => FI[f]);

  // The 24 rotations, each with its shortest token sequence (at most 2 tokens).
  const rotBase = ROT_TOKENS.map((t) => ({ tokens: [t], perm: permOf(n, t, slotIdx, N) }));
  const id = Uint8Array.from({ length: N }, (_, i) => i);
  const rots = [{ tokens: [], perm: id }];
  const seen = new Set([id.join(',')]);
  for (let head = 0; head < rots.length; head++) {
    for (const b of rotBase) {
      const perm = compose(rots[head].perm, b.perm);
      const key = perm.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      rots.push({ tokens: [...rots[head].tokens, ...b.tokens], perm });
    }
  }
  if (rots.length !== 24 || rots.some((r) => r.tokens.length > 2)) throw new Error('Rotaciones inconsistentes');

  // Reference corner: the white-blue-red piece (colors D, B, L). `refSlot` is
  // its D sticker in the solved cube; exactly one rotation Q has Q[refSlot]
  // equal to where that sticker currently is.
  const corners = solvedState.cubies.filter((c) => c.type === 'corner');
  const cornerSlots = Uint8Array.from(corners.flatMap((c) => c.faces.map((f) => slotIdx.get(slotKey(c.home, FACE_NORMALS[f])))));
  const ref = corners.find((c) => ['B', 'D', 'L'].every((f) => c.faces.includes(f)));
  const refSlot = slotIdx.get(slotKey(ref.home, FACE_NORMALS.D));
  const rotOf = new Int8Array(N).fill(-1);
  rots.forEach((r, q) => { rotOf[r.perm[refSlot]] = q; });
  const refMask = (1 << FI.D) | (1 << FI.B) | (1 << FI.L);

  const rnd = mulberry32(0x5eed1234 + n);
  const z1 = Int32Array.from({ length: N * 6 }, rnd);
  const z2 = Int32Array.from({ length: N * 6 }, rnd);

  // Generators, dropping those equal to an earlier one modulo a rotation
  // (e.g. Lw is Rw' held differently): the reachable classes do not change.
  const gens = [];
  for (const g of generatorList(n)) {
    const perm = permOf(n, g.token, slotIdx, N);
    const dup = gens.some((h) => rots.some((r) => perm.every((v, i) => v === h.perm[r.perm[i]])));
    if (!dup) gens.push({ ...g, perm });
  }
  const allowed = gens.map((p) => gens.map((g) => (
    p.block !== g.block && !(commute(p, g) && g.block < p.block)
  )));

  const faceSlots = FACE_ORDER.map((f) => slotFace.flatMap((x, i) => (x === f ? [i] : [])));
  return {
    n, N, slotIdx, slotFace, solved, rots, rotOf, cornerSlots, refMask, z1, z2, gens, allowed,
    faceSlots, tables: new Map(), h1: 0, h2: 0,
  };
}

// ---------- state helpers ----------
function toArray(m, state) {
  const out = new Uint8Array(m.N);
  for (const c of state.cubies) {
    for (const f of c.faces) out[m.slotIdx.get(slotKey(c.pos, state.stickerNormal(c, f)))] = FI[f];
  }
  return out;
}

function applyPerm(src, perm, dst) {
  for (let i = 0; i < perm.length; i++) dst[i] = src[perm[i]];
}

function isSolvedArr(m, st) {
  for (const slots of m.faceSlots) {
    const c = st[slots[0]];
    for (let j = 1; j < slots.length; j++) if (st[slots[j]] !== c) return false;
  }
  return true;
}

// Canonical hash of `st` modulo rotation, left in m.h1 / m.h2.
function hashKey(m, st) {
  const cs = m.cornerSlots;
  let s = -1;
  for (let c = 0; c < 24; c += 3) {
    const a = st[cs[c]]; const b = st[cs[c + 1]]; const d = st[cs[c + 2]];
    if (((1 << a) | (1 << b) | (1 << d)) === m.refMask) {
      s = a === FI.D ? cs[c] : b === FI.D ? cs[c + 1] : cs[c + 2];
      break;
    }
  }
  const Q = m.rots[m.rotOf[s]].perm;
  let h1 = 0; let h2 = 0;
  for (let i = 0; i < m.N; i++) {
    const z = i * 6 + st[Q[i]];
    h1 ^= m.z1[z]; h2 ^= m.z2[z];
  }
  m.h1 = h1; m.h2 = h2;
}

// ---------- distance table (open addressing, stores distance + 1) ----------
class Table {
  constructor() { this.cap = 1 << 16; this.count = 0; this.alloc(); }

  alloc() {
    this.k1 = new Int32Array(this.cap); this.k2 = new Int32Array(this.cap); this.d = new Uint8Array(this.cap);
  }

  find(a, b) {
    const mask = this.cap - 1;
    for (let i = a & mask; this.d[i]; i = (i + 1) & mask) {
      if (this.k1[i] === a && this.k2[i] === b) return this.d[i] - 1;
    }
    return -1;
  }

  insert(a, b, dist) {
    const mask = this.cap - 1;
    let i = a & mask;
    for (; this.d[i]; i = (i + 1) & mask) if (this.k1[i] === a && this.k2[i] === b) return false;
    this.k1[i] = a; this.k2[i] = b; this.d[i] = dist + 1;
    if (++this.count * 2 > this.cap) this.grow();
    return true;
  }

  grow() {
    const { k1, k2, d, cap } = this;
    this.cap = cap * 2; this.count = 0; this.alloc();
    const mask = this.cap - 1;
    for (let j = 0; j < cap; j++) {
      if (!d[j]) continue;
      let i = k1[j] & mask;
      while (this.d[i]) i = (i + 1) & mask;
      this.k1[i] = k1[j]; this.k2[i] = k2[j]; this.d[i] = d[j]; this.count++;
    }
  }
}

function buildTable(m, d1) {
  const t0 = performance.now();
  const table = new Table();
  const { N, gens } = m;
  hashKey(m, m.solved);
  table.insert(m.h1, m.h2, 0);
  let frontier = Uint8Array.from(m.solved);
  let size = 1;
  const tmp = new Uint8Array(N);
  for (let depth = 0; depth < d1; depth++) {
    const keep = depth + 1 < d1; // the last layer is only looked up, never expanded
    let next = new Uint8Array(keep ? N * 1024 : 0);
    let nsize = 0;
    for (let s = 0; s < size; s++) {
      const st = frontier.subarray(s * N, (s + 1) * N);
      for (const g of gens) {
        applyPerm(st, g.perm, tmp);
        hashKey(m, tmp);
        if (!table.insert(m.h1, m.h2, depth + 1) || !keep) continue;
        if ((nsize + 1) * N > next.length) { const bigger = new Uint8Array(next.length * 2); bigger.set(next); next = bigger; }
        next.set(tmp, nsize * N);
        nsize++;
      }
    }
    frontier = next;
    size = nsize;
  }
  return { table, entries: table.count, ms: performance.now() - t0, d1 };
}

// Lazily builds (once per size and depth) the table; returns its statistics.
export function prepare(n, d1 = DEFAULT_D1[n]) {
  const m = modelFor(n);
  let t = m.tables.get(d1);
  if (!t) { t = buildTable(m, d1); m.tables.set(d1, t); }
  return { n, d1, entries: t.entries, ms: t.ms, generators: m.gens.length };
}

// ---------- search ----------
// Whole-cube rotation (0 to 2 tokens) that leaves yellow up and green front.
function finalRotation(m, st) {
  const u = m.slotFace.indexOf('U');
  const f = m.slotFace.indexOf('F');
  for (const r of m.rots.slice().sort((a, b) => a.tokens.length - b.tokens.length)) {
    if (st[r.perm[u]] === FI.U && st[r.perm[f]] === FI.F) return r.tokens;
  }
  throw new Error('Ninguna rotación deja el cubo como lo sostiene la aplicación');
}

// `maxLayer` is a test hook: stop after that many completed layers, as a timeout would.
export function exactSearch(input, { timeMs = 2000, d1, maxLayer = 63 } = {}) {
  const t0 = performance.now();
  const state = input instanceof CubeState ? input : deserialize(input);
  const m = modelFor(state.n);
  const depth1 = d1 ?? DEFAULT_D1[state.n];
  prepare(state.n, depth1);
  const { table } = m.tables.get(depth1);
  const deadline = performance.now() + timeMs;
  const { N, gens, allowed } = m;
  const stack = Array.from({ length: 64 }, () => new Uint8Array(N));
  const path = new Int32Array(64);
  let explored = 0;
  let timedOut = false;
  let found = null;
  let k = 0;

  // Rebuilds the last t moves by greedy descent through the table, then checks
  // the result by simulation (a hash false positive fails here, harmlessly).
  const finish = (st, t) => {
    const seq = [];
    const cur = Uint8Array.from(st);
    const nxt = new Uint8Array(N);
    for (let step = t; step > 0; step--) {
      let ok = false;
      for (let gi = 0; gi < gens.length && !ok; gi++) {
        applyPerm(cur, gens[gi].perm, nxt);
        hashKey(m, nxt);
        if (table.find(m.h1, m.h2) === step - 1) { seq.push(gi); cur.set(nxt); ok = true; }
      }
      if (!ok) return null;
    }
    return isSolvedArr(m, cur) ? { seq, end: cur } : null;
  };

  const dfs = (depth, prev) => {
    const st = stack[depth];
    if (depth === k) {
      explored++;
      if ((explored & 2047) === 0 && performance.now() > deadline) { timedOut = true; return false; }
      hashKey(m, st);
      const t = table.find(m.h1, m.h2);
      if (t < 0) return false;
      const tail = finish(st, t);
      if (!tail) return false;
      found = { head: Array.from(path.subarray(0, k)), tail: tail.seq, end: tail.end };
      return true;
    }
    for (let gi = 0; gi < gens.length; gi++) {
      if (prev >= 0 && !allowed[prev][gi]) continue;
      applyPerm(st, gens[gi].perm, stack[depth + 1]);
      path[depth] = gi;
      if (dfs(depth + 1, gi)) return true;
      if (timedOut) return false;
    }
    return false;
  };

  stack[0].set(toArray(m, state));
  let completed = -1;
  for (k = 0; k < Math.min(stack.length - 1, maxLayer + 1); k++) {
    if (dfs(0, -1) || timedOut) break;
    completed = k;
  }
  const ms = performance.now() - t0;
  if (!found) {
    return { moves: null, rotation: null, length: null, optimal: false, lowerBound: Math.max(completed + depth1 + 1, 0), completed, d1: depth1, explored, ms };
  }
  const moves = [...found.head, ...found.tail].map((i) => gens[i].token);
  return { moves, rotation: finalRotation(m, found.end), length: moves.length, optimal: true, lowerBound: moves.length, completed, d1: depth1, explored, ms };
}

// Combined entry point. 3x3: up to 40 percent of the budget goes to the exact
// search; when it cannot prove the minimum, the two-phase solver spends the
// rest and the result is a short (not proven minimal) solution whose
// lowerBound still comes from the exact search. 4x4: exact search only.
//   source: 'exact' (proven minimum) | 'two-phase' | null (no solution)
export function quickSolve(input, { timeMs = 2000, d1, twoPhase = true, target = 0 } = {}) {
  const state = input instanceof CubeState ? input : deserialize(input);
  const useTwo = twoPhase && state.n === 3;
  const t0 = performance.now();
  const ex = exactSearch(state, { timeMs: useTwo ? timeMs * 0.4 : timeMs, d1 });
  if (ex.optimal) return { ...ex, source: 'exact' };
  if (!useTwo) return { ...ex, source: null };
  const tp = twoPhaseSolve(state, { timeMs: Math.max(timeMs - (performance.now() - t0), 0), target });
  return {
    ...ex, moves: tp.moves, rotation: tp.rotation, length: tp.length, optimal: false, source: 'two-phase',
    lowerBound: Math.min(ex.lowerBound, tp.length),
    twoPhase: { faceLength: tp.faceLength, rewrites: tp.rewrites, firstMs: tp.firstMs, nodes: tp.nodes },
    ms: performance.now() - t0,
  };
}
