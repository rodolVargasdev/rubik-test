// Verifies the teaching solver on random states, including inner-layer and
// whole-cube moves from the "Pruébalo" pad. Run: node tests/verify-solver.mjs [n3] [n4]
import { CubeState, tokenize } from '../src/js/cube-core.js';
import { solve, STEPS } from '../src/js/solver.js';
import { ALGS } from '../src/js/content.js';

let failures = 0;
let passes = 0;
const check = (name, cond, detail = '') => { if (cond) passes++; else { failures++; console.log(`FALLA  ${name} ${detail}`); } };

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const PAD = {
  3: ['U', 'D', 'R', 'L', 'F', 'B', 'M', 'E', 'S', 'x', 'y', 'z'],
  4: ['U', 'D', 'R', 'L', 'F', 'B', 'Rw', 'Uw', 'Fw', 'r', 'u', 'f'],
};
const scramble = (n, len) => Array.from({ length: len }, () => PAD[n][Math.floor(rnd() * PAD[n].length)] + ['', "'", '2'][Math.floor(rnd() * 3)]).join(' ');

function replay(n, start, segments) {
  const s = start.clone();
  for (const seg of segments) if (!seg.skipped) for (const g of seg.groups) s.apply(g.moves.join(' '));
  return s;
}
const oriented = (s) => s.isSolved() && s.cubies.filter((c) => c.type === 'center').every((c) => {
  const f = c.faces[0];
  const v = s.stickerNormal(c, f);
  return ({ U: v[1] === 1, D: v[1] === -1, R: v[0] === 1, L: v[0] === -1, F: v[2] === 1, B: v[2] === -1 })[f];
});

const N3 = Number(process.argv[2] || 150);
const N4 = Number(process.argv[3] || 12);
let total3 = 0; let total4 = 0; const t0 = Date.now();
for (const [n, count] of [[3, N3], [4, N4]]) {
  for (let i = 0; i < count; i++) {
    const scr = scramble(n, n === 3 ? 25 : 40);
    const start = new CubeState(n).apply(scr);
    let res;
    try { res = solve(start); } catch (e) { check(`${n}x${n} #${i} sin excepción`, false, `${e.message} | ${scr}`); continue; }
    const end = replay(n, start, res.segments);
    check(`${n}x${n} #${i} queda armado y orientado`, oriented(end) && res.solved, scr);
    const steps = STEPS[n].map(([id]) => id);
    check(`${n}x${n} #${i} cada paso aparece (hecho u omitido)`, steps.every((id) => res.segments.some((x) => x.step === id)));
    check(`${n}x${n} #${i} todo omitido trae motivo`, res.segments.filter((x) => x.skipped).every((x) => x.reason && x.reason.length > 10));
    check(`${n}x${n} #${i} pasos en orden`, res.segments.every((x, k, a) => k === 0 || steps.indexOf(a[k - 1].step) <= steps.indexOf(x.step)));
    if (n === 3) total3 += res.moves; else total4 += res.moves;
  }
}

// Already solved: every step skipped with a reason.
for (const n of [3, 4]) {
  const res = solve(new CubeState(n));
  check(`${n}x${n} armado: todos los pasos omitidos`, res.segments.every((x) => x.skipped) && res.moves === 0);
}
// Parity states must trigger their parity step; a plain 3x3-like state must not.
{
  const oll = solve(new CubeState(4).apply(ALGS.OLL_PARITY));
  check('paridad OLL detectada', oll.segments.some((x) => x.step === 'paridad-oll' && !x.skipped) && oll.solved);
  const pll = solve(new CubeState(4).apply(ALGS.PLL_PARITY));
  check('paridad PLL detectada', pll.segments.some((x) => x.step === 'paridad-pll' && !x.skipped) && pll.solved);
  const plain = solve(new CubeState(4).apply("R U R' U' F2"));
  check('Contraprueba: sin paridad no se usa paridad', plain.segments.filter((x) => x.step.startsWith('paridad')).every((x) => x.skipped));
}
// Counter-check: the replay check rejects a plan with a move removed.
{
  const start = new CubeState(3).apply("R U F' L2 D B");
  const res = solve(start);
  const cut = JSON.parse(JSON.stringify(res.segments));
  const g = cut.find((x) => !x.skipped).groups[0];
  g.moves = g.moves.slice(1);
  check('Contraprueba: un plan con un giro de menos no pasa como armado', !oriented(replay(3, start, cut)));
}

console.log(`\n${passes} comprobaciones correctas, ${failures} fallas.`);
console.log(`Promedio de giros: 3x3 ${(total3 / Math.max(N3, 1)).toFixed(0)}, 4x4 ${(total4 / Math.max(N4, 1)).toFixed(0)}. Tiempo: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
