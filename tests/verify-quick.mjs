// Verifies the exact "quick solve" search (src/js/quick): every app button is
// one move, rotations are free, and a result flagged optimal must be minimal.
//
//   node tests/verify-quick.mjs            (a few seconds, what the Docker build runs)
//   node tests/verify-quick.mjs --long 50  (also 50 long scrambles at the default budget)
//   node tests/verify-quick.mjs --long4 30 (also 30 long 4x4 scrambles at 4000 ms, with the length distribution)
//
// Minimality is checked against an independent oracle: a plain exhaustive
// search over every button (no table, no canonical states, no pruning, no
// dropped duplicate moves) that must find nothing shorter than the claim.
import { CubeState, invertAlg, invertToken, normalFace, faceletDiff } from '../src/js/cube-core.js';
import { quickSolve, exactSearch, prepare } from '../src/js/quick/search.js';
import * as TP from '../src/js/quick/two-phase.js';
import { optimizeSolution, replaySolves } from '../src/js/quick/optimize.js';
import * as RD from '../src/js/quick/reduction4.js';
import { ALGS } from '../src/js/content.js';

const longIdx = process.argv.indexOf('--long');
const LONG = longIdx > 0 ? Number(process.argv[longIdx + 1]) : 0;
if (longIdx > 0 && !(LONG > 0)) { console.log('Uso: --long N con N entero positivo'); process.exit(2); }

const long4Idx = process.argv.indexOf('--long4');
const LONG4 = long4Idx > 0 ? Number(process.argv[long4Idx + 1]) : 0;
if (long4Idx > 0 && !(LONG4 > 0)) { console.log('Uso: --long4 N con N entero positivo'); process.exit(2); }

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
const normalFaceOf = (s, c, f) => normalFace(s.stickerNormal(c, f));
const faceletDiffOf = (a, b) => faceletDiff(a, b);

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
  // With a 1 ms budget the reduction still builds its first solution (and only that one).
  const tightState = make(4, scramble(4, 25, true));
  const tight = quickSolve(tightState, { timeMs: 1 });
  check(tight.optimal === false && tight.lowerBound >= 1 && tight.moves && replayOk(tightState, tight), 'presupuesto mínimo: debía devolver una solución válida del primer intento');
  // The 4x4 without the reduction keeps the old contract: only the bound, never a made-up solution.
  const boundOnly = quickSolve(make(4, scramble(4, 25, true)), { timeMs: 100, reduction: false });
  check(boundOnly.optimal === false && boundOnly.moves === null && boundOnly.source === null && boundOnly.lowerBound >= 1, 'sin reducción: debía devolver solo la cota');
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
  // Easy states keep coming from the exact search.
  const easy = quickSolve(make(3, scramble(3, 4, false)), { timeMs: 2000 });
  check(easy.source === 'exact' && easy.optimal, '3x3 corto: debía venir de la búsqueda exacta');
  // A state with moved centers is normalized and still solved by the same replay.
  const mid = make(3, "M E S M2 E2 S2 R L' U D' F B' x y' R U F D L B M E S");
  const midRes = quickSolve(mid, { timeMs: 500 });
  check(midRes.moves && replayOk(mid, midRes), '3x3 con centros movidos: la solución no arma el cubo');
  if (LONG) longRun(LONG, 2000, true);
}

// ---------- 4x4 reduction ----------
// Centers (exact tables), edge pairing (macro library), parity and the 3x3
// finish. Every solution is replayed on the original cube.
{
  const m = RD.model();
  const prep = RD.prepareReduction();
  const T = RD.centerTables();
  console.log(`reducción 4x4: tablas listas, construidas en (modelo ${m.ms.toFixed(0)}, centros ${T.ms.toFixed(0)}, biblioteca ${RD.pairLibrary().ms.toFixed(0)}), ${(prep.bytes / 1e6).toFixed(1)} MB, ${m.gens.length} giros de marco, ${RD.pairLibrary().macros.length} macros`);
  check(T.reachC === 343000, `tabla de centros C: ${T.reachC} de 343000 estados alcanzables`);
  check(T.distA.length === 735471 && T.distB.length === 12870, 'tablas de centros: tamaños inesperados');
  for (const [name, t] of [['A', T.distA], ['B', T.distB], ['C', T.distC]]) {
    let top = 0; let goals = 0;
    for (const v of t) { if (v !== 255 && v > top) top = v; if (v === 0) goals++; }
    check(top < 14 && goals === 1, `tabla de centros ${name}: un solo estado meta y distancias acotadas (máx ${top})`);
  }

  // The frame model against CubeState: centers and wings after a move (plus its restoring
  // rotation) must equal the permutations the search uses. Counter-check: another move's permutation fails.
  {
    let bad = 0; let wrongCaught = 0; let checks = 0;
    for (let i = 0; i < 25; i++) {
      const { F } = RD.frameOf(m, make(4, scramble(4, 30, true)));
      const c0 = RD.centersOf(m, RD.stickersOf(m, F));
      const w0 = RD.wingsOf(m, RD.stickersOf(m, F));
      for (let g = 0; g < m.gens.length; g += 1 + rnd(3)) {
        const G = m.gens[g];
        const F2 = F.clone();
        F2.applyMove(G.token);
        if (G.q) F2.apply(m.rots[G.q].tokens.join(' '));
        const st = RD.stickersOf(m, F2);
        const cc = RD.centersOf(m, st); const ww = RD.wingsOf(m, st);
        const mine = Uint8Array.from(G.cp, (v) => c0[v]); const mineW = Uint8Array.from(G.wp, (v) => w0[v]);
        if (cc.some((v, k) => v !== mine[k]) || ww.some((v, k) => v !== mineW[k])) bad++;
        const other = m.gens[(g + 1 + rnd(m.gens.length - 1)) % m.gens.length];
        if (Uint8Array.from(other.cp, (v) => c0[v]).some((v, k) => v !== cc[k])) wrongCaught++;
        // The restoring rotation leaves DBL home.
        const dbl = F2.cubies.find((c) => c.type === 'corner' && ['D', 'B', 'L'].every((f) => c.faces.includes(f)));
        if (dbl.pos.some((v, k) => v !== dbl.home[k])) bad++;
        checks++;
      }
    }
    check(bad === 0, `modelo de marco: ${bad} diferencias con CubeState`);
    check(wrongCaught > 0, 'contraprueba: la permutación de otro giro no se detectó');
    console.log(`modelo de marco: ${checks} giros de marco coinciden con CubeState en centros, aristas y esquina DBL`);
  }

  // Pruning admissibility: every table value is at most the true distance found by a
  // plain iterative deepening (no table). Counter-check: an inflated bound is caught.
  {
    const atGoal = {
      A: (c) => { for (let i = 0; i < 8; i++) if (c[i] > 1) return false; return true; },
      B: (c) => { for (let i = 16; i < 24; i++) if (c[i] < 4) return false; return true; },
      C: (c) => c.every((v, i) => v === i >> 2),
    };
    const plainDist = (c0, gset, goal, maxD) => {
      for (let d = 0; d <= maxD; d++) {
        const go = (c, left) => {
          if (goal(c)) return true;
          if (!left) return false;
          for (const g of gset) if (go(Uint8Array.from(m.gens[g].cp, (v) => c[v]), left - 1)) return true;
          return false;
        };
        if (go(c0, d)) return d;
      }
      return Infinity;
    };
    const hOf = { A: RD.hA, B: RD.hB, C: RD.hC };
    const sets = { A: T.gA, B: T.gB, C: T.gC };
    let inflated = 0; let exact = 0; let n = 0;
    for (const st of ['A', 'B', 'C']) {
      for (let i = 0; i < 8; i++) {
        const k = 1 + rnd(3);
        let c = Uint8Array.from({ length: 24 }, (_, j) => j >> 2);
        for (let j = 0; j < k; j++) { const cp = m.gens[sets[st][rnd(sets[st].length)]].cp; c = Uint8Array.from(cp, (v) => c[v]); }
        const d = plainDist(c, sets[st], atGoal[st], k);
        const h = hOf[st](c);
        check(h <= d, `poda de centros ${st}: cota ${h} mayor que la distancia real ${d}`);
        if (h === d) exact++;
        if (h + 3 > d) inflated++;
        n++;
      }
    }
    check(exact > 0, 'poda de centros: ninguna cota fue exacta, las tablas parecen vacías');
    check(inflated > 0, 'contraprueba: una cota inflada en 3 debía superar la distancia real');
    console.log(`poda de centros: ${n} estados, ninguna cota supera la distancia real (${exact} exactas)`);
  }

  // Library macros: centers stay solved and the wing effect matches CubeState.
  {
    const L = RD.pairLibrary();
    let bad = 0; let corrupt = 0;
    const base = RD.wingsOf(m, RD.stickersOf(m, new CubeState(4)));
    for (let i = 0; i < 300; i++) {
      const k = rnd(L.macros.length);
      const st = new CubeState(4);
      for (const b of L.tokens[k]) st.applyMove(m.buttons[b].token);
      const a = RD.stickersOf(m, st);
      if (!RD.centersDone(m, a)) bad++;
      const want = Uint8Array.from(L.wps[k], (v) => base[v]);
      if (RD.wingsOf(m, a).some((v, j) => v !== want[j])) bad++;
      const wrong = Uint8Array.from(L.wps[(k + 1) % L.macros.length], (v) => base[v]);
      if (RD.wingsOf(m, a).some((v, j) => v !== wrong[j])) corrupt++;
    }
    check(bad === 0, `biblioteca de macros: ${bad} macros que rompen centros o no coinciden con CubeState`);
    check(corrupt > 0, 'contraprueba: el efecto de otra macro no se detectó');
  }

  // Stage checks on random scrambles: after centers all 24 are solved; after pairing all 12
  // dedges are paired and the centers are still solved.
  for (let i = 0; i < 4; i++) {
    const alg = scramble(4, 40, true);
    const { F } = RD.frameOf(m, make(4, alg));
    const start = RD.stickersOf(m, F);
    check(!RD.centersDone(m, start), `etapas: la mezcla ${i} ya traía los centros armados`);
    const cen = RD.solveCenters(RD.centersOf(m, start));
    check(!!cen, `etapas: sin plan de centros "${alg}"`);
    if (!cen) continue;
    for (const g of cen.path) { F.applyMove(m.gens[g].token); if (m.gens[g].q) F.apply(m.rots[m.gens[g].q].tokens.join(' ')); }
    check(RD.centersDone(m, RD.stickersOf(m, F)), `etapas: centros sin armar tras el plan "${alg}"`);
    const wc = RD.wingsOf(m, RD.stickersOf(m, F));
    check(RD.pairsOf(wc) < 12, `etapas: la mezcla ${i} ya traía las aristas emparejadas`);
    const pr = RD.pairEdges(wc, { width: 8 });
    check(!!pr, `etapas: sin plan de emparejado "${alg}"`);
    if (!pr) continue;
    for (const mac of pr.macros) for (const b of mac) F.applyMove(m.buttons[b].token);
    const a = RD.stickersOf(m, F);
    check(RD.pairsOf(RD.wingsOf(m, a)) === 12 && RD.centersDone(m, a), `etapas: tras emparejar quedan aristas o centros sin armar "${alg}"`);
    // Independent pair check on CubeState: both wings of every edge show the same colors on the same faces.
    const seen = {};
    for (const c of F.cubies) if (c.type === 'edge') (seen[c.pos.map((v) => (Math.abs(v) === 3 ? v : 0)).join(',')] ||= []).push(c);
    const unpaired = Object.values(seen).filter(([a1, b1]) => !(a1.faces.slice().sort().join('') === b1.faces.slice().sort().join('') && a1.faces.every((f) => normalFaceOf(F, a1, f) === normalFaceOf(F, b1, f))));
    check(unpaired.length === 0, `etapas: ${unpaired.length} aristas sin pareja según CubeState`);
  }

  // Parity detection against what the algorithms are known to do (not against the detector):
  // a 3x3-only scramble is legal; each parity algorithm adds exactly its own defect.
  {
    const flags = (alg) => new Set(RD.readAsThree(make(4, alg)).check.errors.map((e) => e.code));
    const base3 = "R U2 F' L2 D B' U";
    const fl = flags(base3);
    check(fl.size === 0, `paridad: una mezcla de 3x3 legal se marcó como ${[...fl]}`);
    const oll = flags(`${base3} ${ALGS.OLL_PARITY}`);
    check(oll.has('flip') && !oll.has('parity'), `paridad OLL: marcas ${[...oll]}`);
    const pll = flags(`${base3} ${ALGS.PLL_PARITY}`);
    check(pll.has('parity') && !pll.has('flip'), `paridad PLL: marcas ${[...pll]}`);
    const both = flags(`${base3} ${ALGS.OLL_PARITY} ${ALGS.PLL_PARITY}`);
    check(both.has('flip') && both.has('parity'), `paridad doble: marcas ${[...both]}`);
    // The crafted parity states must solve.
    for (const [name, alg] of [
      ['OLL', `${base3} ${ALGS.OLL_PARITY}`], ['PLL', `${base3} ${ALGS.PLL_PARITY}`], ['OLL y PLL', `${base3} ${ALGS.OLL_PARITY} ${ALGS.PLL_PARITY}`],
    ]) {
      const state = make(4, alg);
      const res = RD.reduceSolve(state, { timeMs: 500 });
      check(replayOk(state, { moves: res.moves, rotation: res.rotation }), `paridad ${name}: la solución no arma el cubo`);
      check(res.length < 90, `paridad ${name}: ${res.length} giros`);
    }
  }

  // simplifyMoves: same cube, never longer; cancels what cancels (counter-check: dropping a move changes the cube).
  {
    check(RD.simplifyMoves(['R', "R'"]).length === 0 && RD.simplifyMoves(['R', 'L', "R'"]).join(' ') === 'L', "simplificación: R R' y R L R' no se reducen como se esperaba");
    check(RD.simplifyMoves(['U', 'u', "U'"]).join(' ') === 'u', "simplificación: U u U' debía quedar u");
    let bad = 0; let caught = 0;
    for (let i = 0; i < 40; i++) {
      const list = scramble(4, 12 + rnd(20), false).split(' ');
      const a = make(4, list.join(' ')); const b = make(4, RD.simplifyMoves(list).join(' '));
      if (faceletDiffOf(a, b)) bad++;
      if (faceletDiffOf(a, make(4, list.slice(1).join(' ')))) caught++;
    }
    check(bad === 0, `simplificación: ${bad} listas cambiaron el cubo`);
    check(caught > 0, 'contraprueba: quitar un giro debía cambiar el cubo');
  }

  // End to end through quickSolve: 40-button scrambles with inner slices and rotations.
  {
    const lens = [];
    for (let i = 0; i < 4; i++) {
      const alg = scramble(4, 40, true);
      const state = make(4, alg);
      const res = quickSolve(state, { timeMs: 700 });
      const tag = `4x4 reducción "${alg}"`;
      check(res.source === 'reduction' || (res.source === 'exact' && res.optimal), `${tag}: origen ${res.source}${res.error ? ` (${res.error})` : ''}`);
      check(!!res.moves && replayOk(state, res), `${tag}: la solución no arma el cubo con amarillo arriba y verde al frente`);
      if (!res.moves) continue;
      check(res.lowerBound <= res.length && res.lowerBound >= 1, `${tag}: cota ${res.lowerBound} incoherente con longitud ${res.length}`);
      check(res.length < 150 && res.optimal === false, `${tag}: ${res.length} giros`);
      check(res.rotation.length <= 2, `${tag}: rotación final de ${res.rotation.length} giros`);
      lens.push(res.length);
    }
    console.log(`4x4 reducción (4 mezclas de 40, 700 ms): longitudes ${lens.join(' ')}`);
  }

  // Long run, behind --long4 N: length and time distribution at the app budget.
  if (LONG4) {
    const lens = []; const times = [];
    for (let i = 0; i < LONG4; i++) {
      const alg = scramble(4, 40, true);
      const state = make(4, alg);
      const res = quickSolve(state, { timeMs: 4000 });
      check(!!res.moves && replayOk(state, res), `4x4 largo "${alg}": no deja el cubo armado y orientado`);
      if (!res.moves) continue;
      check(res.lowerBound <= res.length, `4x4 largo "${alg}": cota ${res.lowerBound} mayor que ${res.length}`);
      lens.push(res.length); times.push(res.ms);
    }
    const q = (a, f) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))];
    console.log(`4x4 largo (${LONG4} mezclas de 40, 4000 ms): longitud min ${q(lens, 0)}, mediana ${q(lens, 0.5)}, máx ${q(lens, 1)}; tiempo min ${q(times, 0).toFixed(0)}, mediana ${q(times, 0.5).toFixed(0)}, máx ${q(times, 1).toFixed(0)} ms`);
    const hist = {};
    lens.forEach((l) => { const b = Math.floor(l / 10) * 10; hist[b] = (hist[b] || 0) + 1; });
    console.log('  histograma de longitudes (por decenas):', Object.entries(hist).map(([l, c]) => `${l}s:${c}`).join(' '));
    check(q(lens, 0.5) <= 90, `4x4 largo: la mediana ${q(lens, 0.5)} supera 90`);
  }
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
  self.onmessage({ data: { warm: 4 } });
  check(replies.shift()?.warmed === true, 'worker: warm 4 debía responder warmed');
  const state4 = make(4, scramble(4, 30, true));
  self.onmessage({ data: { state: serialize(state4), timeMs: 600 } });
  const r4 = replies.shift();
  check(r4 && r4.ok && (r4.source === 'reduction' || r4.optimal) && replayOk(state4, r4), `worker: 4x4 mal resuelto (${JSON.stringify(r4)?.slice(0, 200)})`);
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
