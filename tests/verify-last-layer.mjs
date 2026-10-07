// Exhaustive check of the last layer (everything else solved), 3x3 and reduced
// 4x4. Every last-layer state is enumerated by BFS over generators that keep
// the rest of the cube solved; each one is run through the solver and judged
// against an independent oracle written here from facelet colors.
// Run: node tests/verify-last-layer.mjs [3|4|all] [--sample K]
// With --sample K only every ceil(total/K)-th state (by BFS index) is solved;
// the enumeration and its counter-check stay complete.
// Hidden self-test modes (--selftest=drop|crash|short) make one worker misbehave
// on purpose; the main run launches each in a child process and requires it to FAIL.
import { CubeState, tokenize, normalFace } from '../src/js/cube-core.js';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { solve, STEPS } from '../src/js/solver.js';
import { ALGS, GUIDE_4, buildCase } from '../src/js/content.js';

const args = process.argv.slice(2);
const sampleAt = args.indexOf('--sample');
const SAMPLE = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 0;
if (isMainThread && sampleAt >= 0 && !(Number.isInteger(SAMPLE) && SAMPLE > 0)) {
  console.log(`ERROR  --sample exige un entero positivo, se recibió "${args[sampleAt + 1] ?? ''}"`);
  process.exit(1);
}
const SELFTEST = (args.find((a) => a.startsWith('--selftest=')) || '').slice('--selftest='.length);
const which = args.find((a, i) => !(sampleAt >= 0 && i === sampleAt + 1) && ['3', '4', 'all'].includes(a)) || 'all';
const SIZES = which === 'all' ? [3, 4] : [Number(which)];
// Sample runs (Docker) and sabotaged self-tests stay small so the build does
// not scale with the host's cores; only the exhaustive run uses every core.
const JOBS = Math.max(1, SAMPLE > 0 || SELFTEST ? Math.min(4, availableParallelism()) : availableParallelism());

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

// Independent classification, by actually swapping two same-kind pieces: a
// state is "one transposition" when swapping the pieces in two slots of one kind
// leaves a last layer that is solved up to a single common U turn. Adjacent or
// opposite is read from the geometry of the two slots, not from ring indices.
const CORNER_XZ = CORNER_RING;
const EDGE_XZ = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // F, R, B, L as (x, z)
const turnU = ([x, z], k) => { let v = [x, z]; for (let i = 0; i < k; i++) v = [-v[1], v[0]]; return v; };
const sameXZ = (a, b) => a[0] === b[0] && a[1] === b[1];
const solvedUpToAuf = (cHome, eHome) => [0, 1, 2, 3].some((k) =>
  cHome.every((h, j) => sameXZ(h, turnU(CORNER_XZ[j], k))) && eHome.every((h, j) => sameXZ(h, turnU(EDGE_XZ[j], k))));

function oracleClass({ hc, he }) {
  const cHome = hc.map((h) => CORNER_XZ[h]);
  const eHome = he.map((h) => EDGE_XZ[h]);
  if (solvedUpToAuf(cHome, eHome)) return 'sin permutación';
  const tries = [['corners', cHome, CORNER_XZ], ['edges', eHome, EDGE_XZ]];
  for (const [kind, home, slots] of tries) {
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        const swapped = home.slice();
        [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
        const fixed = kind === 'corners' ? solvedUpToAuf(swapped, eHome) : solvedUpToAuf(cHome, swapped);
        if (!fixed) continue;
        const across = slots[a][0] + slots[b][0] === 0 && slots[a][1] + slots[b][1] === 0;
        if (kind === 'edges') return across ? 'aristas opuestas' : 'aristas vecinas';
        return across ? 'esquinas en diagonal' : 'esquinas vecinas';
      }
    }
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
// threads (interleaved so each gets the same mix). The main thread enumerates
// once and shares the result through SharedArrayBuffers, so workers never repeat
// the BFS and memory stays flat however many cores the host has.
function runShard(n, shard, shards, step, shared) {
  const T = locTable(n);
  const L = T.locs.length;
  const flat = new Uint8Array(shared.states);
  const E = {
    states: { length: shared.count },
    parent: new Int32Array(shared.parent),
    via: new Int8Array(shared.via),
    gens: GENS[n].map(([name, alg]) => ({ name, alg })),
  };
  const stats = { classes: {}, oll: 0, pll: 0, solved: 0, tested: 0 };
  for (let i = 0, c = 0; i < shared.count; i += step, c++) {
    if (c % shards !== shard) continue;
    if (SELFTEST === 'short' && shard === 0 && !stats.dropped) { stats.dropped = true; continue; }
    stats.tested++;
    const start = rebuild(n, E, i);
    const map = start.facelets();
    ok(T.locs.every((k, j) => LETTERS[flat[i * L + j]] === map.get(k)), () => `${n}x${n} #${i} la reconstruccion coincide con el BFS`);
    if (checkState(n, start, `${n}x${n} #${i}`, stats)) stats.solved++;
  }
  return stats;
}

if (!isMainThread) {
  const { n, shard, shards, step, shared } = workerData;
  if (SELFTEST === 'drop' && shard === 0) process.exit(0); // exits cleanly without reporting
  if (SELFTEST === 'crash' && shard === 0) process.exit(3); // exits with a failure code
  const stats = runShard(n, shard, shards, step, shared);
  parentPort.postMessage({ shard, stats, passes, failures, msgs });
  process.exit(0);
}

// Packs the BFS result into shared memory for the workers.
function share(E, T) {
  const L = T.locs.length;
  const states = new SharedArrayBuffer(E.states.length * L);
  const flat = new Uint8Array(states);
  E.states.forEach((st, i) => flat.set(st, i * L));
  const parent = new SharedArrayBuffer(E.states.length * 4);
  new Int32Array(parent).set(E.parent);
  const via = new SharedArrayBuffer(E.states.length);
  new Int8Array(via).set(E.via);
  return { states, parent, via, count: E.states.length };
}

// Every shard must report its counters and exit with code 0, and together they
// must have solved exactly the number of states that the sampling promised.
const solveParallel = (n, step, shared, expectedStates) => new Promise((resolve) => {
  const total = { classes: {}, oll: 0, pll: 0, solved: 0, tested: 0 };
  const reported = new Set();
  let pending = JOBS;
  for (let shard = 0; shard < JOBS; shard++) {
    const w = new Worker(new URL(import.meta.url), { workerData: { n, shard, shards: JOBS, step, shared }, argv: process.argv.slice(2), execArgv: ['--no-warnings'] });
    w.on('message', ({ shard: sh, stats, passes: p, failures: f, msgs: m }) => {
      reported.add(sh);
      passes += p; failures += f;
      for (const line of m) if (printed++ < MAX_PRINT) console.log(line);
      total.oll += stats.oll; total.pll += stats.pll; total.solved += stats.solved; total.tested += stats.tested;
      for (const [k, v] of Object.entries(stats.classes)) total.classes[k] = (total.classes[k] || 0) + v;
    });
    w.on('error', (e) => { failures++; console.log(`FALLA  hilo ${shard}: ${e.message}`); });
    w.on('exit', (code) => {
      ok(code === 0, `${n}x${n} el hilo ${shard} terminó con código ${code}`);
      ok(reported.has(shard), `${n}x${n} el hilo ${shard} no entregó sus contadores`);
      if (--pending === 0) {
        ok(reported.size === JOBS, `${n}x${n} faltó el resultado de ${JOBS - reported.size} hilo(s)`);
        ok(total.solved === expectedStates, `${n}x${n} se resolvieron ${total.solved} estados y se esperaban ${expectedStates}`);
        resolve(total);
      }
    });
  }
});

// Runs this same file in a child with a sabotaged worker; it must exit with 1.
const selfTest = (mode) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), '3', '--sample', '12', `--selftest=${mode}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('exit', (code) => resolve({ code, out }));
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
  const shared = share(E, T);
  const expectedStates = Math.ceil(E.states.length / step);
  const stats = await solveParallel(n, step, shared, expectedStates);
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
      ok(!!r, () => `${name}: el solucionador devolvió un resultado`);
      if (!r) return;
      const seg = r.res.segments.find((x) => x.step === 'paridad-pll');
      ok(!!seg, () => `${name}: existe el paso paridad-pll`);
      if (!seg) return;
      if (wantParity) {
        const label = seg.label || '';
        ok(o.cls === wantClass, () => `${name}: oráculo ${o.cls}, se esperaba ${wantClass}`);
        ok(!seg.skipped && label.includes(wantClass), () => `${name}: la narración debe decir "${wantClass}", dice "${label}"`);
        ok(!CLASSES.filter((c) => c !== wantClass).some((c) => label.includes(c)), () => `${name}: la narración no debe nombrar otro caso`);
      } else ok(seg.skipped, () => `${name}: no debe usar paridad`);
    };
    named4('esquinas vecinas', "R U R' U' R' F R2 U' R' U' R U R' F' U r2 U2 r2 Uw2 r2 u2 U'", 'esquinas vecinas', true);
    const Y_PERM = "F R U' R' U' R U R' F' R U R' U' R' F R F'";
    named4('mixto (Y-perm y paridad)', `${Y_PERM} ${ALGS.PLL_PARITY}`, 'caso mixto', true);
    const guideSetup = (id) => GUIDE_4.steps.find((x) => x.id === 'paridad-pll').cases.find((q) => q.id === id).setup;
    named4('aristas vecinas (setup de la guía)', guideSetup('aristas-vecinas'), 'aristas vecinas', true);
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
  const clsOf = (alg) => oracle(4, st4(alg)).cls;
  ok(clsOf(ALGS.PLL_PARITY) === 'aristas opuestas', 'Contraprueba: el oráculo reconoce dos aristas opuestas');
  ok(clsOf(`U ${"R U' R U R U R U' R' U' R2"} U' ${ALGS.PLL_PARITY}`) !== 'aristas opuestas', 'Contraprueba: el oráculo distingue vecinas de opuestas');
  ok(clsOf("R U R' U' R' F R2 U' R' U' R U R' F'") === 'caso mixto', 'Contraprueba: una T-perm no es una sola transposición');
  ok(clsOf('U2') === 'sin permutación', 'Contraprueba: una vuelta de U no cuenta como permutación');
}

// Guard self-test: a worker that drops its result, exits with an error code or
// skips a state must make the run fail. Skipped inside the sabotaged children.
if (!SELFTEST) {
  const modes = { drop: 'faltó el resultado', crash: 'terminó con código 3', short: 'se resolvieron' };
  const results = await Promise.all(Object.keys(modes).map(selfTest));
  Object.entries(modes).forEach(([mode, text], i) => {
    ok(results[i].code === 1 && results[i].out.includes(text), () => `Contraprueba del arnés: con --selftest=${mode} debía fallar con "${text}" (código ${results[i].code})`);
  });
  console.log(`Contraprueba del arnés: ${Object.keys(modes).length} hilos saboteados detectados`);
}

console.log(`\n${passes} comprobaciones correctas, ${failures} fallas.`);
console.log(`Tiempo total: ${((Date.now() - t00) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
