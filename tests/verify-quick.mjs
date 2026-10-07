// Verifies the exact "quick solve" search (src/js/quick): every app button is
// one move, rotations are free, and a result flagged optimal must be minimal.
//
//   node tests/verify-quick.mjs
//
// Minimality is checked against an independent oracle: a plain exhaustive
// search over every button (no table, no canonical states, no pruning, no
// dropped duplicate moves) that must find nothing shorter than the claim.
import { CubeState, invertAlg, invertToken } from '../src/js/cube-core.js';
import { quickSolve, prepare } from '../src/js/quick/search.js';

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
  check(r && r.ok && r.optimal && r.length === 3 && replayOk(state, r), `worker: estado serializado mal resuelto (${JSON.stringify(r)})`);
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
