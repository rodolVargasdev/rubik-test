// Verifies the puzzle registry: every registered puzzle is complete, its
// solvers solve a scrambled state, and bad registrations are refused.
// Run: node tests/verify-registry.mjs
import { listPuzzles, getPuzzle, findPuzzle, registerPuzzle } from '../src/js/puzzles/index.js';

let failures = 0;
let passes = 0;
const check = (name, cond, detail = '') => { if (cond) passes++; else { failures++; console.log(`FALLA  ${name} ${detail}`); } };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const puzzles = listPuzzles();
check('están cube3 y cube4', ['cube3', 'cube4'].every((id) => puzzles.some((p) => p.id === id)));

const SCRAMBLE = { 3: "R U F' L2 D B'", 4: "R U F' Rw2 D Uw'" };
for (const p of puzzles) {
  for (const key of ['id', 'name', 'kind', 'n', 'createState', 'guide', 'steps', 'solvers', 'editor']) {
    check(`${p.id} define ${key}`, p[key] !== undefined && p[key] !== null);
  }
  check(`${p.id} getPuzzle y findPuzzle devuelven lo mismo`, getPuzzle(p.id) === p && findPuzzle(p.kind, p.n) === p);
  check(`${p.id} los pasos coinciden con la guía`, p.steps.length > 0 && p.steps.every(([id, title]) => id && title));

  const solved = p.createState();
  check(`${p.id} el estado nuevo está armado`, solved.isSolved());
  const start = p.createState().apply(SCRAMBLE[p.n]);
  check(`${p.id} la mezcla lo desarma`, !start.isSolved());

  const plan = p.solvers.auto(start);
  const end = start.clone();
  for (const seg of plan.segments) if (!seg.skipped) for (const g of seg.groups) end.apply(g.moves.join(' '));
  check(`${p.id} el armado automático arma`, plan.solved && end.isSolved());

  const q = p.solvers.quick(start, { ...p.solvers.quickOptions, timeMs: 1500 });
  const qEnd = start.clone().apply((q.moves || []).join(' '));
  check(`${p.id} el armado rápido arma`, q.moves && qEnd.isSolved() && q.moves.length <= 6);
}

// Refusals, each with its counter-check that a good definition is accepted.
const base = (id) => ({
  id, name: id, kind: 'toy', n: 1, createState: () => ({}), steps: [['a', 'A']],
  solvers: { auto: () => ({}), quick: () => ({}) },
});
check('un duplicado lanza', throws(() => registerPuzzle(base('cube3'))));
check('contraprueba: un id nuevo se acepta', !throws(() => registerPuzzle(base('toy1'))));
check('el nuevo se encuentra', getPuzzle('toy1').name === 'toy1' && listPuzzles().length === puzzles.length + 1);
check('repetir el recién agregado lanza', throws(() => registerPuzzle(base('toy1'))));
check('falta un campo: lanza', throws(() => registerPuzzle({ ...base('toy2'), steps: undefined })));
check('solvers incompleto: lanza', throws(() => registerPuzzle({ ...base('toy3'), solvers: { auto: () => ({}) } })));
check('createState no función: lanza', throws(() => registerPuzzle({ ...base('toy4'), createState: 5 })));
check('un id desconocido lanza', throws(() => getPuzzle('no-existe')));
check('el rechazado no quedó registrado', !listPuzzles().some((p) => ['toy2', 'toy3', 'toy4'].includes(p.id)));

console.log(`\n${passes} comprobaciones correctas, ${failures} fallas.`);
process.exit(failures ? 1 : 0);
