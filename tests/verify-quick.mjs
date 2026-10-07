// Verifies the exact "quick solve" search (src/js/quick): every app button is
// one move, rotations are free, and a result flagged optimal must be minimal.
//
//   node tests/verify-quick.mjs            (a few seconds, what the Docker build runs)
//   node tests/verify-quick.mjs --long 50  (also 50 long scrambles at the default budget)
//
// Minimality is checked against an independent oracle: a plain exhaustive
// search over every button (no table, no canonical states, no pruning, no
// dropped duplicate moves) that must find nothing shorter than the claim.
import { CubeState, invertAlg, invertToken } from '../src/js/cube-core.js';
import { quickSolve, exactSearch, prepare } from '../src/js/quick/search.js';
import * as TP from '../src/js/quick/two-phase.js';
import { optimizeSolution, replaySolves } from '../src/js/quick/optimize.js';

const longIdx = process.argv.indexOf('--long');
const LONG = longIdx > 0 ? Number(process.argv[longIdx + 1]) : 0;
if (longIdx > 0 && !(LONG > 0)) { console.log('Uso: --long N con N entero positivo'); process.exit(2); }

const t0 = performance.now();
let ok = 0;
const fails = [];
const check = (cond, msg) => { if (cond) ok++; else fails.push(msg); };

// Own list of buttons, written out here instead of reusing metric.js.
const FACES = ['U', 'D', 'R', 'L', 'F', 'B'];
const BASES = {
  3: [...FACES, 'M', 'E', 'S'],
  4: [...FACES, ...FACES.map((f) => f + 'w'), ...FACES.map((f) => f.toLowerCase()), 'M', 'E', 'S'],
};
const BUTTONS = Object.fromEntries([3, 4].map((n) => [n, BASES[n].flatMap((b) => [b, b + "'", b + '2'])]));

let seed = 20261007;
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(((seed >>> 8) / 16777216) * n); };

// k random buttons, optionally with rotations mixed in (they must cost 0).
function scramble(n, k, withRotations) {
  const out = [];
  for (let i = 0; i < k; i++) out.push(BUTTONS[n][rnd(BUTTONS[n].length)]);
  if (withRotations) {
    for (let r = 1 + rnd(3); r > 0; r--) {
      out.splice(rnd(out.length + 1), 0, ['x', 'y', 'z'][rnd(3)] + ['', "'", '2'][rnd(3)]);
    }
  }
  return out.join(' ');
}

const make = (n, alg) => new CubeState(n).apply(alg);

// Replays moves + rotation: solved, yellow up, green front.
function replayOk(state, res) {
  const s = state.clone();
  s.apply(res.moves.join(' '));
  s.apply(res.rotation.join(' '));
  if (!s.isSolved()) return false;
  for (const [key, color] of s.facelets()) {
    const face = key.split('|')[1];
    if ((face === 'U' || face === 'F') && color !== face) return false;
  }
  return true;
}

// Independent oracle: true when no sequence of fewer than `len` buttons solves
// the cube (solved = isSolved, any orientation). Plain exhaustive search.
// A missing length (search timed out) proves nothing, and nothing is shorter
// than zero moves.
function noShorterThan(state, len) {
  if (!Number.isInteger(len)) return false;
  if (len <= 0) return true;
  const n = state.n;
  const walk = (left) => {
    if (state.isSolved()) return false;
    if (left === 0) return true;
    for (const b of BUTTONS[n]) {
      state.applyMove(b);
      const none = walk(left - 1);
      state.applyMove(invertToken(b));
      if (!none) return false;
    }
    return true;
  };
  return walk(len - 1);
}

// ---------- tables ----------
for (const n of [3, 4]) {
  const p = prepare(n);
  console.log(`tabla ${n}x${n}: D1=${p.d1}, ${p.entries} estados, ${p.generators} giros, ${p.ms.toFixed(0)} ms`);
  check(p.entries > 1000, `${n}x${n}: tabla demasiado pequeña (${p.entries})`);
}

// ---------- random scrambles of exactly k buttons ----------
const PLAN = [
  { n: 3, kMax: 5, per: 40 },
  { n: 4, kMax: 4, per: 25 },
];
for (const { n, kMax, per } of PLAN) {
  let worst = 0;
  for (let k = 0; k <= kMax; k++) {
    for (let i = 0; i < per; i++) {
      const alg = scramble(n, k, i % 3 === 2);
      const state = make(n, alg);
      const res = quickSolve(state, { timeMs: 5000 });
      worst = Math.max(worst, res.ms);
      const tag = `${n}x${n} k=${k} "${alg}"`;
      check(res.optimal === true, `${tag}: no demostró el mínimo`);
      if (!res.moves) continue;
      check(res.length <= k, `${tag}: ${res.length} giros, más que la mezcla (${k})`);
      check(res.length === res.moves.length && res.lowerBound === res.length, `${tag}: longitud y cota incoherentes`);
      check(res.rotation.length <= 2, `${tag}: rotación final de ${res.rotation.length} giros`);
      check(replayOk(state, res), `${tag}: al reproducir ${res.moves.join(' ')} ${res.rotation.join(' ')} no queda armado y con amarillo arriba y verde al frente`);
    }
  }
  console.log(`mezclas aleatorias ${n}x${n}: k 0..${kMax}, ${per} por k, peor caso ${worst.toFixed(1)} ms`);
}

// A few deeper scrambles (the search itself is the subject here, not the oracle).
for (const { n, k, count } of [{ n: 3, k: 7, count: 4 }, { n: 4, k: 5, count: 4 }]) {
  for (let i = 0; i < count; i++) {
    const alg = scramble(n, k, true);
    const state = make(n, alg);
    const res = quickSolve(state, { timeMs: 20000 });
    check(res.optimal && res.length <= k && replayOk(state, res), `${n}x${n} k=${k} "${alg}": resultado inválido`);
  }
}

// Cross-check of the pruning and the dropped duplicate moves: a shallower
// table forces the search through more layers and must reach the same length.
for (const { n, k, count } of [{ n: 3, k: 6, count: 12 }, { n: 4, k: 5, count: 6 }]) {
  for (let i = 0; i < count; i++) {
    const alg = scramble(n, k, false);
    const state = make(n, alg);
    const deep = quickSolve(state, { timeMs: 20000 });
    const shallow = quickSolve(state, { timeMs: 20000, d1: 2 });
    check(shallow.optimal && shallow.length === deep.length && replayOk(state, shallow),
      `${n}x${n} "${alg}": con D1=2 dio ${shallow.length} y con la tabla normal ${deep.length}`);
  }
}

// ---------- independent minimality oracle ----------
// The claimed length must equal the true distance: replay proves "<= length",
// the exhaustive search proves "nothing shorter".
const ORACLE = [
  { n: 3, k: 3, count: 10 },
  { n: 3, k: 4, count: 2 },
  { n: 3, k: 2, count: 8 },
  { n: 4, k: 3, count: 6 },
  { n: 4, k: 2, count: 6 },
];
const to = performance.now();
let oracleRuns = 0;
for (const { n, k, count } of ORACLE) {
  for (let i = 0; i < count; i++) {
    const alg = scramble(n, k, false);
    const state = make(n, alg);
    const res = quickSolve(state, { timeMs: 5000 });
    check(noShorterThan(state.clone(), res.length), `${n}x${n} "${alg}": existe una solución más corta que ${res.length}`);
    oracleRuns++;
  }
}
console.log(`oráculo de minimalidad: ${oracleRuns} mezclas, ${(performance.now() - to).toFixed(0)} ms`);

// Counter-proof of the oracle: it must reject a claim that is too long and
// accept the exact distance.
check(noShorterThan(make(3, 'R U'), 2) && !noShorterThan(make(3, 'R U'), 3), 'contraprueba: el oráculo no distingue la distancia exacta de R U');
check(noShorterThan(make(4, 'r'), 1) && !noShorterThan(make(4, 'r'), 2), 'contraprueba: el oráculo no distingue la distancia exacta de r');
{
  const state = make(3, 'R U F');
  const res = quickSolve(state);
  const short = { moves: res.moves.slice(0, -1), rotation: res.rotation };
  check(replayOk(state, res) && !replayOk(state, short), 'contraprueba: replayOk no detecta una solución incompleta');
}

// ---------- named cases ----------
const named = [
  [3, 'M', 1, 'M en media vuelta valdría 2'],
  [3, 'R U', 2, 'nunca 1'],
  [3, "R L' x", 1, 'es M salvo rotación'],
  [3, 'U2', 1, 'media vuelta es un botón'],
  [3, '', 0, 'armado'],
  [3, 'x y2 z', 0, 'solo rotaciones cuestan 0'],
  [4, 'r', 1, 'capa interior'],
  [4, 'Rw', 1, 'bloque de dos capas'],
  [4, 'Lw', 1, 'equivale a Rw con otra rotación'],
  [4, 'M', 1, 'las dos capas medias'],
  [4, '', 0, 'armado'],
];
for (const [n, alg, want, why] of named) {
  const state = make(n, alg);
  const res = quickSolve(state);
  check(res.optimal && res.length === want, `${n}x${n} "${alg}": esperaba ${want} (${why}), dio ${res.length}`);
  check(res.moves && replayOk(state, res), `${n}x${n} "${alg}": la solución no deja el cubo armado y orientado`);
}
for (const [n, alg] of [[3, "R U F' D2 M E' S"], [4, "Rw U' r2 F d' M"]]) {
  const res = quickSolve(make(n, `${alg} ${invertAlg(alg)}`));
  check(res.optimal && res.length === 0, `${n}x${n}: mezcla y su inversa debía dar 0, dio ${res.length}`);
}

// ---------- time budget ----------
{
  const state = make(3, scramble(3, 25, true));
  const res = quickSolve(state, { timeMs: 300 });
  check(res.lowerBound >= 1 && res.lowerBound <= 25, `presupuesto: cota ${res.lowerBound} fuera de rango`);
  // Loose on purpose: it only catches a search that ignores the deadline, so a
  // slow build host cannot fail the image on timing alone.
  check(res.ms < 15000, `presupuesto: tardó ${res.ms.toFixed(0)} ms con 300 ms de tope`);
  check(res.optimal === false || (res.moves && replayOk(state, res)), 'presupuesto: resultado inválido');
  if (res.moves) check(replayOk(state, res), 'presupuesto: la solución devuelta no arma el cubo');
  console.log(`presupuesto 300 ms en una mezcla de 25: optimal=${res.optimal}, cota ${res.lowerBound}, ${res.ms.toFixed(0)} ms, ${res.explored} nodos`);
  // Counter-proof: a bigger budget on an easy state does prove the minimum.
  const easy = quickSolve(make(3, scramble(3, 6, false)), { timeMs: 5000 });
  check(easy.optimal === true, 'contraprueba: con tiempo de sobra debía demostrar el mínimo');
  const tight = quickSolve(make(4, scramble(4, 25, true)), { timeMs: 1 });
  check(tight.optimal === false && tight.moves === null && tight.lowerBound >= 1, 'presupuesto mínimo: debía devolver solo la cota');
}

// ---------- exact search: timeout lower bound ----------
// A search that stops after layer k proves "no solution shorter than k + D1 + 1".
// Forced to stop (maxLayer) on states whose true distance is proven by a full
// run, the bound must equal completed + D1 + 1 exactly and never exceed it.
{
  let tight = 0; let inflatedCaught = 0; let runs = 0;
  for (let i = 0; i < 12; i++) {
    const state = make(3, scramble(3, 7, false));
    const full = exactSearch(state, { timeMs: 20000, d1: 2 });
    check(full.optimal, 'cota: la búsqueda completa no demostró el mínimo');
    for (let cap = 0; cap + 2 + 1 <= full.length; cap++) {
      const cut = exactSearch(state, { timeMs: 20000, d1: 2, maxLayer: cap });
      runs++;
      check(!cut.optimal && cut.completed === cap, `cota: con tope ${cap} completó ${cut.completed}`);
      check(cut.lowerBound === cut.completed + cut.d1 + 1, `cota: ${cut.lowerBound} no es completed + D1 + 1 (${cut.completed + cut.d1 + 1})`);
      check(cut.lowerBound <= full.length, `cota: ${cut.lowerBound} supera la distancia real ${full.length}`);
      if (cut.lowerBound === full.length) tight++;
      // Counter-check: the off-by-one formula would claim more than the truth.
      if (cut.completed + cut.d1 + 2 > full.length) inflatedCaught++;
    }
  }
  check(tight > 0, 'cota: ningún caso tocó la distancia real, la prueba no es ajustada');
  check(inflatedCaught > 0, 'contraprueba: una cota completed + D1 + 2 debía superar la distancia real en algún caso');
  console.log(`cota por tiempo agotado: ${runs} cortes, ${tight} ajustados a la distancia real, ${inflatedCaught} detectarían una cota inflada`);
}

// ---------- two-phase: coordinates ----------
const tpStats = TP.prepareTwoPhase();
console.log(`tablas de dos fases: ${tpStats.ms.toFixed(0)} ms, ${(tpStats.bytes / 1e6).toFixed(1)} MB`);
const FACE_BTNS = TP.MOVE_NAMES;
const P2_BTNS = FACE_BTNS.filter((_, m) => TP.P2_MOVES.includes(m));
const walk = (len, names = FACE_BTNS) => Array.from({ length: len }, () => names[rnd(names.length)]).join(' ');
const sameCoords = (a, b, keys) => keys.every((k) => a[k] === b[k]);
const HOME = TP.coordsFromState(new CubeState(3));
{
  // Table step vs coordinates recomputed from CubeState after the same move.
  let steps = 0;
  const run = (bug) => {
    let bad = 0;
    for (let i = 0; i < 25; i++) {
      const st = make(3, walk(1 + rnd(20)));
      const c0 = TP.coordsFromState(st);
      for (let m = 0; m < 18; m++) {
        const next = TP.coordsFromState(st.clone().apply(FACE_BTNS[m]), bug);
        if (!sameCoords(next, { ...c0, ...TP.stepPhase1(c0, m) }, ['twist', 'flip', 'slice'])) bad++;
        steps++;
      }
    }
    return bad;
  };
  check(run(null) === 0, 'coordenadas: la tabla de fase 1 no coincide con CubeState');
  check(run('twist') > 0, 'contraprueba: la torsión defectuosa no se detectó en fase 1');
  let bad2 = 0; let bugCp = 0; let bugEd = 0;
  for (let i = 0; i < 25; i++) {
    const st = make(3, walk(1 + rnd(20), P2_BTNS));
    const c0 = TP.coordsFromState(st);
    TP.P2_MOVES.forEach((m, k) => {
      const moved = st.clone().apply(FACE_BTNS[m]);
      const want = { ...c0, ...TP.stepPhase2(c0, k) };
      if (!sameCoords(TP.coordsFromState(moved), want, ['cp', 'ud', 'sp'])) bad2++;
      if (!sameCoords(TP.coordsFromState(moved, 'swapCorners'), want, ['cp'])) bugCp++;
      if (!sameCoords(TP.coordsFromState(moved, 'swapEdges'), want, ['ud', 'sp'])) bugEd++;
      // Phase 2 moves must keep the phase 1 coordinates at their solved values.
      const c1 = TP.coordsFromState(moved);
      if (c1.twist !== 0 || c1.flip !== 0 || c1.slice !== HOME.slice) bad2++;
    });
  }
  check(bad2 === 0, `coordenadas: la tabla de fase 2 no coincide con CubeState (${bad2})`);
  check(bugCp > 0, 'contraprueba: esquinas intercambiadas no se detectaron en fase 2');
  check(bugEd > 0, 'contraprueba: aristas intercambiadas no se detectaron en fase 2');
  console.log(`coordenadas: ${steps} pasos de fase 1 y los de fase 2 coinciden con CubeState`);
}

// ---------- two-phase: pruning admissibility ----------
{
  // True distance by plain iterative deepening over the move tables, no pruning.
  const dist = (c, nm, step, done, maxD) => {
    for (let d = 0; d <= maxD; d++) {
      const go = (cc, left) => {
        if (done(cc)) return true;
        if (left === 0) return false;
        for (let m = 0; m < nm; m++) if (go(step(cc, m), left - 1)) return true;
        return false;
      };
      if (go(c, d)) return d;
    }
    return Infinity;
  };
  const p1Done = (c) => c.twist === 0 && c.flip === 0 && c.slice === HOME.slice;
  const p2Done = (c) => c.cp === 0 && c.ud === 0 && c.sp === 0;
  let inflated = 0; let n1 = 0; let n2 = 0; let exact1 = 0;
  for (let i = 0; i < 30; i++) {
    const k = 1 + rnd(4);
    const c = TP.coordsFromState(make(3, walk(k)));
    const d = dist(c, 18, (cc, m) => ({ ...cc, ...TP.stepPhase1(cc, m) }), p1Done, k);
    const h = TP.phase1Bound(c);
    check(h <= d, `poda fase 1: cota ${h} mayor que la distancia real ${d}`);
    if (h === d) exact1++;
    if (h + 3 > d) inflated++;
    n1++;
  }
  for (let i = 0; i < 30; i++) {
    const k = 1 + rnd(4);
    const c = TP.coordsFromState(make(3, walk(k, P2_BTNS)));
    const d = dist(c, TP.P2_MOVES.length, (cc, m) => ({ ...cc, ...TP.stepPhase2(cc, m) }), p2Done, k);
    check(TP.phase2Bound(c) <= d, `poda fase 2: cota ${TP.phase2Bound(c)} mayor que la distancia real ${d}`);
    n2++;
  }
  check(exact1 > 0, 'poda fase 1: nunca fue exacta, la tabla parece vacía');
  check(inflated > 0, 'contraprueba: una cota inflada en 3 debía superar la distancia real');
  console.log(`poda: ${n1} estados de fase 1 (${exact1} exactos) y ${n2} de fase 2, ninguna cota sobrepasa la distancia real`);
}

// ---------- post-optimization ----------
{
  // The inverse of a scramble is a solution by construction.
  const sol = ['R', "L'", 'U2', 'F'];
  const st = make(3, invertAlg(sol.join(' ')));
  check(replaySolves(st, sol, []), 'optimización: la solución construida no arma el cubo');
  const o = optimizeSolution(st, sol, []);
  check(o.moves.length === 3 && o.rewrites === 1 && o.moves.some((t) => /^M/.test(t)), `optimización: R L' debía pasar a M, dio "${o.moves.join(' ')}"`);
  check(replaySolves(st, o.moves, o.rotation), 'optimización: el reescrito no arma el cubo');
  // Every axis and every pair of exponents (including ones that cannot be rewritten).
  let rewritten = 0; let pairs = 0;
  for (const [a, b] of [['R', 'L'], ['U', 'D'], ['F', 'B']]) {
    for (const p of ['', "'", '2']) {
      for (const q of ['', "'", '2']) {
        const seq = [a + p, b + q, 'U', 'R', "F'", 'D2'];
        const s2 = make(3, invertAlg(seq.join(' ')));
        const r = optimizeSolution(s2, seq, []);
        check(replaySolves(s2, r.moves, r.rotation) && r.moves.length <= seq.length, `optimización: ${seq.join(' ')} -> ${r.moves.join(' ')} no arma el cubo`);
        rewritten += r.rewrites; pairs++;
      }
    }
  }
  check(rewritten >= 3, `optimización: solo ${rewritten} reescritos en ${pairs} pares`);
  // Counter-checks: the replay guard rejects a broken rewrite.
  const broken = optimizeSolution(st, sol, [], { mutate: (c) => ({ moves: c.moves.slice(0, -1), rotation: c.rotation }) });
  check(broken.rewrites === 0 && broken.rejected >= 1 && broken.moves.join(' ') === sol.join(' '), `contraprueba: un reescrito roto no fue rechazado (${broken.moves.join(' ')})`);
  const wrongRot = optimizeSolution(st, sol, [], { mutate: (c) => ({ moves: c.moves, rotation: ['y'] }) });
  check(wrongRot.rewrites === 0 && wrongRot.rejected >= 1, 'contraprueba: una rotación final equivocada no fue rechazada');
  check(!replaySolves(st, ['R', 'U'], []) && !replaySolves(st, sol, ['x']), 'contraprueba: replaySolves acepta una solución falsa');
  console.log(`optimización: ${rewritten} reescrituras a botón de capa media en ${pairs} pares, todas con replay`);
}

// ---------- two-phase: long scrambles ----------
{
  const longRun = (count, timeMs, report) => {
    const lens = []; const times = [];
    for (let i = 0; i < count; i++) {
      const alg = scramble(3, 25, true);
      const state = make(3, alg);
      const res = quickSolve(state, { timeMs });
      const tag = `3x3 largo "${alg}"`;
      check(res.source === 'two-phase' || (res.source === 'exact' && res.optimal), `${tag}: origen ${res.source}`);
      check(res.moves && replayOk(state, res), `${tag}: la solución no deja el cubo armado y orientado`);
      if (!res.moves) continue;
      check(res.length <= 22, `${tag}: ${res.length} giros, más de 22`);
      check(res.lowerBound <= res.length && res.lowerBound >= 1, `${tag}: cota ${res.lowerBound} incoherente con longitud ${res.length}`);
      check(res.rotation.length <= 2, `${tag}: rotación final de ${res.rotation.length} giros`);
      lens.push(res.length); times.push(res.ms);
    }
    if (report) {
      const q = (a, f) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))];
      console.log(`3x3 largo (${count} mezclas de 25, presupuesto ${timeMs} ms): longitud min ${q(lens, 0)}, mediana ${q(lens, 0.5)}, máx ${q(lens, 1)}; tiempo min ${q(times, 0).toFixed(0)}, mediana ${q(times, 0.5).toFixed(0)}, máx ${q(times, 1).toFixed(0)} ms`);
      const hist = {};
      lens.forEach((l) => { hist[l] = (hist[l] || 0) + 1; });
      console.log('  histograma de longitudes:', Object.entries(hist).map(([l, c]) => `${l}:${c}`).join(' '));
    }
  };
  longRun(5, 500, true);
  // A 4x4 that is not proven stays without a solution (the UI offers the teaching solver).
  const big = quickSolve(make(4, scramble(4, 25, true)), { timeMs: 200 });
  check(big.source === null && big.moves === null && big.lowerBound >= 1, '4x4 largo: debía devolver solo la cota y source null');
  // Easy states keep coming from the exact search.
  const easy = quickSolve(make(3, scramble(3, 4, false)), { timeMs: 2000 });
  check(easy.source === 'exact' && easy.optimal, '3x3 corto: debía venir de la búsqueda exacta');
  // A state with moved centers is normalized and still solved by the same replay.
  const mid = make(3, "M E S M2 E2 S2 R L' U D' F B' x y' R U F D L B M E S");
  const midRes = quickSolve(mid, { timeMs: 500 });
  check(midRes.moves && replayOk(mid, midRes), '3x3 con centros movidos: la solución no arma el cubo');
  if (LONG) longRun(LONG, 2000, true);
}

// ---------- oracle edges ----------
check(noShorterThan(make(3, "R R'"), 0), 'oráculo: una mezcla que se anula debe aceptar longitud 0');
check(!noShorterThan(make(3, 'R'), null), 'oráculo: sin longitud (tiempo agotado) no demuestra nada');
check(noShorterThan(make(3, 'R U'), 2) && !noShorterThan(make(3, 'R U'), 3), 'oráculo: R U está a distancia 2');

// ---------- worker entry point ----------
// Runs src/js/quick-worker.js with a stand-in `self`, as the browser would.
{
  const { serialize } = await import('../src/js/solver.js');
  const replies = [];
  globalThis.self = { postMessage: (m) => replies.push(m) };
  await import('../src/js/quick-worker.js');
  const state = make(3, "R U' M2");
  self.onmessage({ data: { state: serialize(state), timeMs: 2000 } });
  const r = replies.shift();
  check(r && r.ok && r.optimal && r.source === 'exact' && r.length === 3 && replayOk(state, r), `worker: estado serializado mal resuelto (${JSON.stringify(r)})`);
  self.onmessage({ data: { state: serialize(new CubeState(2)), timeMs: 100 } });
  const bad = replies.shift();
  check(bad && bad.ok === false && /3x3 y 4x4/.test(bad.error), `worker: un 2x2 debía responder ok:false con motivo (${JSON.stringify(bad)})`);
  delete globalThis.self;
}

const secs = ((performance.now() - t0) / 1000).toFixed(1);
if (fails.length) {
  console.log(`FALLA: ${fails.length} comprobaciones fallidas (${ok} correctas), ${secs} s`);
  fails.slice(0, 30).forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log(`${ok} comprobaciones correctas, 0 fallas, ${secs} s`);
