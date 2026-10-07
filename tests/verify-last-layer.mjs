// Exhaustive check of the last layer (everything else solved), 3x3 and reduced
// 4x4. Every last-layer state is enumerated by BFS over generators that keep
// the rest of the cube solved; each one is run through the solver and judged
// against an independent oracle written here from facelet colors.
// Run: node tests/verify-last-layer.mjs [3|4|all] [--sample K]
// With --sample K only every ceil(total/K)-th state (by BFS index) is solved;
// the enumeration and its counter-check stay complete.
import { CubeState, tokenize, normalFace } from '../src/js/cube-core.js';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { solve, STEPS } from '../src/js/solver.js';
import { ALGS } from '../src/js/content.js';

const args = process.argv.slice(2);
const sampleAt = args.indexOf('--sample');
const SAMPLE = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 0;
const which = args.find((a, i) => !(sampleAt >= 0 && i === sampleAt + 1) && ['3', '4', 'all'].includes(a)) || 'all';
const SIZES = which === 'all' ? [3, 4] : [Number(which)];
const JOBS = Math.max(1, availableParallelism());

let failures = 0;
let passes = 0;
const MAX_PRINT = 25;
const msgs = [];
let printed = 0;
const ok = (cond, msg) => {
  if (cond) { passes++; return; }
  failures++;
  if (isMainThread || msgs.length < MAX_PRINT) {
    const line = `FALLA  ${typeof msg === 'function' ? msg() : msg}`;
    if (isMainThread) { if (printed++ < MAX_PRINT) console.log(line); } else if (msgs.length < MAX_PRINT) msgs.push(line);
  }
};

// ---------- generators that keep everything outside the U layer solved ----------
const GENS = {
  3: [
    ['U', 'U'],
    ['Sune', ALGS.SUNE],
    ['OE', ALGS.OE],
    ['T', "R U R' U' R' F R2 U' R' U' R U R' F'"],
    ['Y', "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
    ['Ua', "R U' R U R U R U' R' U' R2"],
    ['A', "R' F R' B2 R F' R' B2 R2"],
  ],
};
GENS[4] = [...GENS[3], ['OLLpar', ALGS.OLL_PARITY], ['PLLpar', ALGS.PLL_PARITY]];

const LETTERS = 'UDFBRL';

// Sticker locations of a solved cube, in a fixed order.
function locTable(n) {
  const solved = new CubeState(n);
  const locs = [...solved.facelets().keys()];
  const idx = new Map(locs.map((k, i) => [k, i]));
  const inTop = locs.map((k) => Number(k.split('|')[0].split(',')[1]) === n - 1);
  const base = Uint8Array.from(locs, (k) => LETTERS.indexOf(solved.facelets().get(k)));
  return { locs, idx, inTop, base };
}

// Facelet permutation of an algorithm: perm[i] = where the sticker that starts
// at location i ends up.
function facePerm(n, alg, T) {
  const s = new CubeState(n).apply(alg);
  const perm = new Int32Array(T.locs.length);
  for (const c of s.cubies) {
    for (const f of c.faces) {
      const from = T.idx.get(`${c.home.join(',')}|${f}`);
      const to = T.idx.get(`${c.pos.join(',')}|${normalFace(s.stickerNormal(c, f))}`);
      perm[from] = to;
    }
  }
  return perm;
}
const applyPerm = (arr, perm) => { const out = new Uint8Array(arr.length); for (let i = 0; i < arr.length; i++) out[perm[i]] = arr[i]; return out; };
const keyOf = (arr) => Buffer.from(arr).toString('latin1');

// True when a facelet array leaves everything outside the U layer solved.
const keepsRest = (arr, T) => T.base.every((v, i) => T.inTop[i] || arr[i] === v);

function enumerate(n, T, check = true) {
  const gens = GENS[n].map(([name, alg]) => ({ name, alg, perm: facePerm(n, alg, T) }));
  if (check) for (const g of gens) ok(keepsRest(applyPerm(T.base, g.perm), T), () => `${n}x${n} el generador ${g.name} deja el resto armado`);
  // Counter-check: a generator that does break the rest must be rejected.
  if (check) ok(!keepsRest(applyPerm(T.base, facePerm(n, 'R', T)), T), 'Contraprueba: R no es un generador válido de la última capa');
  const states = [T.base];
  const parent = [-1];
  const via = [-1];
  const seen = new Map([[keyOf(T.base), 0]]);
  for (let i = 0; i < states.length; i++) {
    for (let g = 0; g < gens.length; g++) {
      const next = applyPerm(states[i], gens[g].perm);
      const k = keyOf(next);
      if (seen.has(k)) continue;
      seen.set(k, states.length);
      states.push(next);
      parent.push(i);
      via.push(g);
    }
  }
  return { states, parent, via, gens };
}

function rebuild(n, E, i) {
  const algs = [];
  for (let j = i; E.parent[j] >= 0; j = E.parent[j]) algs.push(E.gens[E.via[j]].alg);
  return new CubeState(n).apply(algs.reverse().join(' '));
}

// ---------- independent oracle (reads colors only) ----------
const CORNER_RING = [[1, 1], [1, -1], [-1, -1], [-1, 1]]; // (sx, sz): FR, BR, BL, FL
const EDGE_RING = ['F', 'R', 'B', 'L'];
const sortedKey = (a) => a.slice().sort().join('');

function colorReader(state) {
  const map = state.facelets();
  return (x, y, z, f) => map.get(`${x},${y},${z}|${f}`);
}

// Top-layer corner and edge permutations (home slot per current slot), plus
// the number of flipped edges, read from colors alone.
function readTop(n, col) {
  const m = n - 1;
  const cornerHome = new Map(CORNER_RING.map(([sx, sz], i) => [sortedKey(['U', sx > 0 ? 'R' : 'L', sz > 0 ? 'F' : 'B']), i]));
  const hc = CORNER_RING.map(([sx, sz]) => cornerHome.get(sortedKey([
    col(sx * m, m, sz * m, 'U'), col(sx * m, m, sz * m, sx > 0 ? 'R' : 'L'), col(sx * m, m, sz * m, sz > 0 ? 'F' : 'B')])));
  const wingXs = n === 3 ? [0] : [-1, 1];
  const wings = (side) => wingXs.map((t) => {
    if (side === 'F') return [t, m, m, 'F'];
    if (side === 'B') return [t, m, -m, 'B'];
    if (side === 'R') return [m, m, t, 'R'];
    return [-m, m, t, 'L'];
  });
  const he = EDGE_RING.map((side) => {
    const [x, y, z, f] = wings(side)[0];
    return EDGE_RING.indexOf(sortedKey([col(x, y, z, 'U'), col(x, y, z, f)]).replace('U', ''));
  });
  let flipped = 0;
  for (const side of EDGE_RING) for (const [x, y, z] of wings(side)) if (col(x, y, z, 'U') !== 'U') flipped++;
  return { hc, he, flippedEdges: flipped / (n === 4 ? 2 : 1), up: [...cornerHome.keys()].length };
}

function permParity(h) {
  const seen = [false, false, false, false];
  let cycles = 0;
  for (let i = 0; i < 4; i++) {
    if (seen[i]) continue;
    cycles++;
    for (let j = i; !seen[j]; j = h[j]) seen[j] = true;
  }
  return (4 - cycles) % 2;
}

// Case seen with the best common U alignment: exactly two pieces of one kind
// out of place and the other kind placed.
function oracleClass({ hc, he }) {
  const miss = (h, k) => [0, 1, 2, 3].filter((j) => h[j] !== (j + k) % 4);
  for (let k = 0; k < 4; k++) {
    const mc = miss(hc, k);
    const me = miss(he, k);
    if (mc.length === 0 && me.length === 2) return (me[0] - me[1] + 4) % 4 === 2 ? 'aristas opuestas' : 'aristas vecinas';
    if (me.length === 0 && mc.length === 2) return (mc[0] - mc[1] + 4) % 4 === 2 ? 'esquinas en diagonal' : 'esquinas vecinas';
  }
  return 'caso mixto';
}
const CLASSES = ['aristas opuestas', 'aristas vecinas', 'esquinas vecinas', 'esquinas en diagonal', 'caso mixto'];

const oracle = (n, state) => {
  const top = readTop(n, colorReader(state));
  return { ...top, pllParity: permParity(top.hc) !== permParity(top.he), cls: oracleClass(top) };
};

// ---------- solver result checks ----------
const oriented = (s) => s.isSolved() && s.cubies.filter((c) => c.type === 'center').every((c) => {
  const f = c.faces[0];
  const v = s.stickerNormal(c, f);
  return ({ U: v[1] === 1, D: v[1] === -1, R: v[0] === 1, L: v[0] === -1, F: v[2] === 1, B: v[2] === -1 })[f];
});

// State at the moment `stop` step starts (all earlier non-skipped steps applied).
function stateBefore(start, segments, stop) {
  const s = start.clone();
  for (const seg of segments) {
    if (seg.step === stop) break;
    if (!seg.skipped) for (const g of seg.groups) s.apply(g.moves.join(' '));
  }
  return s;
}

function checkState(n, start, tag, stats) {
  const o = oracle(n, start);
  let res;
  try { res = solve(start); } catch (e) { ok(false, () => `${tag} sin excepción: ${e.message}`); return null; }
  const end = start.clone();
  for (const seg of res.segments) if (!seg.skipped) for (const g of seg.groups) end.apply(g.moves.join(' '));
  ok(res.solved && oriented(end), () => `${tag} queda armado y orientado`);
  const order = STEPS[n].map(([id]) => id);
  ok(order.every((id) => res.segments.some((x) => x.step === id)), () => `${tag} cada paso aparece`);
  ok(res.segments.every((x) => !x.skipped || (x.reason && x.reason.length > 10)), () => `${tag} todo omitido trae motivo`);
  ok(res.segments.every((x, k, a) => k === 0 || order.indexOf(a[k - 1].step) <= order.indexOf(x.step)), () => `${tag} pasos en orden`);
  ok(res.segments.every((x) => order.includes(x.step)), () => `${tag} solo pasos conocidos`);
  if (n === 3) {
    ok(o.hc && permParity(o.hc) === permParity(o.he), () => `${tag} oráculo 3x3: paridades de esquinas y aristas iguales`);
    ok(o.flippedEdges % 2 === 0, () => `${tag} oráculo 3x3: aristas volteadas pares`);
    return { o, res };
  }
  const oll = res.segments.find((x) => x.step === 'paridad-oll');
  const pll = res.segments.find((x) => x.step === 'paridad-pll');
  ok(!!oll && !oll.skipped === (o.flippedEdges % 2 === 1), () => `${tag} paridad OLL del solucionador coincide con el oráculo (aristas volteadas ${o.flippedEdges})`);
  ok(!!pll && !pll.skipped === o.pllParity, () => `${tag} paridad PLL del solucionador coincide con el oráculo (oráculo: ${o.pllParity})`);
  if (pll && !pll.skipped) {
    const at = oracle(n, stateBefore(start, res.segments, 'paridad-pll'));
    const named = CLASSES.filter((c) => (pll.label || '').includes(c));
    ok(named.length === 1 && named[0] === at.cls, () => `${tag} narración de la paridad: oráculo ${at.cls}, solucionador "${pll.label}"`);
    stats.classes[at.cls] = (stats.classes[at.cls] || 0) + 1;
  }
  if (o.flippedEdges % 2 === 1) stats.oll++;
  if (o.pllParity) stats.pll++;
  return { o, res };
}

// ---------- run ----------
// Solving every state is the slow part, so the states are split among worker
// threads (interleaved so each gets the same mix); each one enumerates the
// space itself and reports its counters back.
function runShard(n, shard, shards, step) {
  const T = locTable(n);
  const E = enumerate(n, T, false);
  const stats = { classes: {}, oll: 0, pll: 0, solved: 0 };
  for (let i = 0, c = 0; i < E.states.length; i += step, c++) {
    if (c % shards !== shard) continue;
    const start = rebuild(n, E, i);
    const map = start.facelets();
    ok(T.locs.every((k, j) => LETTERS[E.states[i][j]] === map.get(k)), () => `${n}x${n} #${i} la reconstruccion coincide con el BFS`);
    if (checkState(n, start, `${n}x${n} #${i}`, stats)) stats.solved++;
  }
  return stats;
}

if (!isMainThread) {
  const { n, shard, shards, step } = workerData;
  const stats = runShard(n, shard, shards, step);
  parentPort.postMessage({ stats, passes, failures, msgs });
  process.exit(0);
}

const solveParallel = (n, step) => new Promise((resolve) => {
  const total = { classes: {}, oll: 0, pll: 0, solved: 0 };
  let pending = JOBS;
  for (let shard = 0; shard < JOBS; shard++) {
    const w = new Worker(new URL(import.meta.url), { workerData: { n, shard, shards: JOBS, step }, argv: process.argv.slice(2), execArgv: ['--no-warnings'] });
    w.on('message', ({ stats, passes: p, failures: f, msgs: m }) => {
      passes += p; failures += f;
      for (const line of m) if (printed++ < MAX_PRINT) console.log(line);
      total.oll += stats.oll; total.pll += stats.pll; total.solved += stats.solved;
      for (const [k, v] of Object.entries(stats.classes)) total.classes[k] = (total.classes[k] || 0) + v;
    });
    w.on('error', (e) => { failures++; console.log(`FALLA  hilo ${shard}: ${e.message}`); });
    w.on('exit', () => { if (--pending === 0) resolve(total); });
  }
});

const t00 = Date.now();
for (const n of SIZES) {
  const t0 = Date.now();
  const T = locTable(n);
  const E = enumerate(n, T);
  const expected = n === 3 ? 62208 : 248832;
  console.log(`
${n}x${n}: ${E.states.length} estados de última capa enumerados (esperado ${expected}) en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  ok(E.states.length === expected, () => `${n}x${n} conteo exacto de la última capa: ${E.states.length} en vez de ${expected}`);

  const step = SAMPLE > 0 ? Math.ceil(E.states.length / SAMPLE) : 1;
  const t1 = Date.now();
  const stats = await solveParallel(n, step);
  console.log(`${n}x${n}: ${stats.solved} estados resueltos${step > 1 ? ` (muestra: uno de cada ${step})` : ' (todos)'} en ${((Date.now() - t1) / 1000).toFixed(1)} s con ${JOBS} hilos`);
  if (n === 4) {
    console.log(`4x4: con paridad OLL ${stats.oll}, con paridad PLL ${stats.pll}; casos narrados: ${JSON.stringify(stats.classes)}`);
  }

  // ---------- named cases with counter-checks ----------
  printed = 0;
  if (n === 4) {
    const named = (alg) => new CubeState(4).apply(alg);
    const named4 = (name, alg, wantClass, wantParity) => {
      const st = named(alg);
      const o = oracle(4, st);
      ok(o.pllParity === wantParity, () => `${name}: el oráculo ${wantParity ? 'debe' : 'no debe'} marcar paridad PLL`);
      const r = checkState(4, st, name, { classes: {}, oll: 0, pll: 0 });
      if (wantParity && r) {
        const seg = r.res.segments.find((x) => x.step === 'paridad-pll');
        ok(o.cls === wantClass, () => `${name}: oráculo ${o.cls}, se esperaba ${wantClass}`);
        ok(seg && !seg.skipped && seg.label.includes(wantClass), () => `${name}: la narración debe decir "${wantClass}", dice "${seg && seg.label}"`);
        ok(!CLASSES.filter((c) => c !== wantClass).some((c) => (seg.label || '').includes(c)), () => `${name}: la narración no debe nombrar otro caso`);
      }
      if (!wantParity && r) ok(r.res.segments.find((x) => x.step === 'paridad-pll').skipped, () => `${name}: no debe usar paridad`);
    };
    named4('esquinas vecinas', "R U R' U' R' F R2 U' R' U' R U R' F' U r2 U2 r2 Uw2 r2 u2 U'", 'esquinas vecinas', true);
    named4('PLL_PARITY sola', ALGS.PLL_PARITY, 'aristas opuestas', true);
    named4('T-perm sin paridad', "R U R' U' R' F R2 U' R' U' R U R' F'", null, false);
    // Diagonal corners: a state with the whole U face yellow whose oracle class is diagonal.
    let diag = -1;
    for (let i = 0; i < E.states.length && diag < 0; i++) {
      const up = T.locs.every((k, j) => !k.endsWith('|U') || Number(k.split(',')[1]) !== 3 || E.states[i][j] === 0);
      if (!up) continue;
      const st = rebuild(4, E, i);
      if (oracle(4, st).cls === 'esquinas en diagonal' && oracle(4, st).pllParity) diag = i;
    }
    ok(diag >= 0, 'existe un estado con todo el amarillo arriba y dos esquinas en diagonal');
    if (diag >= 0) {
      const st = rebuild(4, E, diag);
      const r = checkState(4, st, 'esquinas en diagonal', { classes: {}, oll: 0, pll: 0 });
      const seg = r && r.res.segments.find((x) => x.step === 'paridad-pll');
      ok(seg && !seg.skipped && seg.label.includes('esquinas en diagonal'), () => `esquinas en diagonal: la narración dice "${seg && seg.label}"`);
    }
  }
}

// Oracle counter-checks (independent of the solver).
{
  const st4 = (alg) => new CubeState(4).apply(alg);
  ok(oracle(4, st4("R U R' U' R' F R2 U' R' U' R U R' F' U r2 U2 r2 Uw2 r2 u2 U'")).pllParity, 'Contraprueba: el oráculo marca paridad en dos esquinas vecinas');
  ok(!oracle(4, st4("R U R' U' R' F R2 U' R' U' R U R' F'")).pllParity, 'Contraprueba: el oráculo no marca paridad en una T-perm');
  ok(!oracle(4, new CubeState(4)).pllParity, 'Contraprueba: el oráculo no marca paridad en el cubo armado');
}

console.log(`\n${passes} comprobaciones correctas, ${failures} fallas.`);
console.log(`Tiempo total: ${((Date.now() - t00) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
