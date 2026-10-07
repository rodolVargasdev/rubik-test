// Verifies the cube editor model (src/js/editor): painted facelets -> validation
// -> CubeState. Run: node tests/verify-editor.mjs [scrambles3] [scrambles4]
//
//  - round trip: scrambled state -> facelets -> validate -> state -> facelets
//    gives the same facelets and the same isSolved
//  - the solvers run on a reconstructed state and solve it
//  - every error class is triggered by a crafted coloring and the message names
//    the piece; valid colorings produce no error
//  - counter-check: one swapped pair of stickers is always reported on the 3x3;
//    on the 4x4 it is reported or the new coloring really is a legal state
import { CubeState } from '../src/js/cube-core.js';
import { solve } from '../src/js/solver.js';
import { quickSolve } from '../src/js/quick/search.js';
import { FACES, emptyGrid, solvedGrid, cloneGrid, gridFromState, holdNormalized } from '../src/js/editor/facelets.js';
import { validateGrid } from '../src/js/editor/validate.js';

let failures = 0;
let passes = 0;
const check = (name, cond, detail = '') => { if (cond) passes++; else { failures++; console.log(`FALLA  ${name} ${detail}`); } };

let seed = 987654;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const MOVES = {
  3: ['U', 'D', 'R', 'L', 'F', 'B', 'M', 'E', 'S', 'x', 'y', 'z'],
  4: ['U', 'D', 'R', 'L', 'F', 'B', 'Rw', 'Uw', 'Fw', 'r', 'u', 'f', 'x', 'y'],
};
const scramble = (n, len) => Array.from({ length: len }, () => pick(MOVES[n]) + pick(['', "'", '2'])).join(' ');
const sameGrid = (a, b) => FACES.every((f) => a[f].every((c, i) => c === b[f][i]));
const msgs = (r) => r.errors.map((e) => e.message).join(' | ');

const N3 = Number(process.argv[2] || 200);
const N4 = Number(process.argv[3] || 40);

// ---------- round trips ----------
const valid = { 3: [], 4: [] };
for (const [n, count] of [[3, N3], [4, N4]]) {
  for (let i = 0; i < count; i++) {
    const scr = scramble(n, n === 3 ? 30 : 50);
    const s = holdNormalized(new CubeState(n).apply(scr));
    const grid = gridFromState(s);
    const r = validateGrid(grid, n);
    check(`${n}x${n} #${i} un cubo real es válido`, r.ok && r.errors.length === 0, `${scr} :: ${msgs(r)}`);
    if (!r.ok) continue;
    check(`${n}x${n} #${i} ida y vuelta de stickers`, sameGrid(gridFromState(r.state), grid), scr);
    check(`${n}x${n} #${i} isSolved coincide`, r.state.isSolved() === s.isSolved(), scr);
    valid[n].push({ grid, state: r.state, scr });
  }
}

// Solved and trivially turned cubes.
for (const n of [3, 4]) {
  const r = validateGrid(solvedGrid(n), n);
  check(`${n}x${n} armado es válido y está armado`, r.ok && r.state.isSolved());
}

// ---------- the solvers run on a reconstructed state ----------
for (const n of [3, 4]) {
  for (const v of valid[n].slice(0, n === 3 ? 6 : 2)) {
    const res = solve(v.state);
    const end = v.state.clone();
    for (const seg of res.segments) if (!seg.skipped) for (const g of seg.groups) end.apply(g.moves.join(' '));
    check(`${n}x${n} el armado automático arma lo reconstruido`, res.solved && end.isSolved(), v.scr);
  }
}
for (const scr of ["R U F'", "R U R' U' L F2 D"]) {
  const s = new CubeState(3).apply(scr);
  const r = validateGrid(gridFromState(s), 3);
  const q = quickSolve(r.state, { timeMs: 1500 });
  const end = r.state.clone().apply((q.moves || []).join(' '));
  check(`3x3 el armado rápido arma lo reconstruido (${scr})`, q.moves && end.isSolved());
}

// ---------- error classes (3x3) ----------
const fresh = () => cloneGrid(solvedGrid(3));
const swap = (g, a, b) => { const t = g[a[0]][a[1]]; g[a[0]][a[1]] = g[b[0]][b[1]]; g[b[0]][b[1]] = t; };
const expectError = (name, g, code, re, n = 3) => {
  const r = validateGrid(g, n);
  const e = r.errors.find((x) => x.code === code);
  check(`${name}: no es válido`, !r.ok && r.state === null);
  check(`${name}: error ${code}`, !!e, msgs(r));
  if (e) check(`${name}: mensaje`, re.test(e.message), e.message);
  return e;
};

{
  const g = emptyGrid(3);
  const r = validateGrid(g, 3);
  check('vacío: 48 stickers por pintar', r.incomplete === 48 && !r.ok);
}
{
  const g = fresh(); g.U[0] = 'F';
  expectError('conteo', g, 'count', /Hay 8 stickers amarillos y 10 verdes: deben ser 9 de cada color/);
}
{
  const g = fresh(); g.U[4] = 'F';
  expectError('centro 3x3', g, 'center', /El centro de arriba debe ser amarillo/);
}
{
  const g = fresh(); swap(g, ['U', 0], ['F', 2]);
  expectError('color repetido', g, 'repeat', /La esquina de arriba, frente, derecha tiene dos stickers amarillos: esa pieza no existe/);
}
{
  const g = fresh(); swap(g, ['F', 2], ['D', 0]);
  expectError('colores opuestos', g, 'opposite', /mezcla amarillo y blanco/);
}
{
  const g = fresh(); g.U[8] = 'U'; g.F[2] = 'R'; g.R[0] = 'F';
  expectError('esquina en espejo', g, 'mirror', /esquina de arriba, frente, derecha tiene sus colores en el orden contrario/);
}
{
  const g = fresh(); g.R[1] = 'F'; g.F[5] = 'R';
  expectError('arista repetida', g, 'duplicate', /La arista amarilla y verde aparece dos veces/);
}
{
  const g = fresh(); g.U[8] = 'R'; g.F[2] = 'U'; g.R[0] = 'F';
  const e = expectError('esquina girada', g, 'twist', /Una esquina está girada: revisa la esquina de arriba, frente, derecha/);
  check('esquina girada: resalta 3 stickers', e && e.stickers.length === 3);
}
{
  const g = fresh(); g.U[7] = 'F'; g.F[1] = 'U';
  const e = expectError('arista volteada', g, 'flip', /Una arista está volteada: revisa la arista de arriba y frente/);
  check('arista volteada: resalta 2 stickers', e && e.stickers.length === 2);
}
{
  const g = fresh(); swap(g, ['F', 1], ['R', 1]); // two edges exchanged, corners untouched
  expectError('paridad de permutación', g, 'parity', /Dos piezas están intercambiadas: imposible sin desarmar el cubo/);
}

// A valid state next to each class stays valid (guards that the crafted ones differ).
check('contraprueba: dos esquinas y dos aristas intercambiadas es válido', (() => {
  const s = new CubeState(3).apply("R U R' U' R' F R2 U' R' U' R U R' F'"); // T-perm: two corners and two edges
  return validateGrid(gridFromState(s), 3).ok;
})());

// ---------- error classes (4x4) ----------
{
  const g = cloneGrid(solvedGrid(4)); g.U[0] = 'F';
  expectError('4x4 conteo', g, 'count', /Hay 15 stickers amarillos y 17 verdes: deben ser 16 de cada color/, 4);
}
{
  const g = cloneGrid(solvedGrid(4)); swap(g, ['U', 0], ['F', 3]);
  expectError('4x4 color repetido', g, 'repeat', /esquina de arriba, frente, derecha|esquina de arriba, atrás, izquierda/, 4);
}
{
  // A yellow-green wing painted where the yellow-orange one belongs: the green
  // wing exists twice (counts kept equal by moving an orange sticker over).
  const g = cloneGrid(solvedGrid(4));
  g.R[1] = 'F'; g.F[6] = 'R';
  const r = validateGrid(g, 4);
  check('4x4 ala repetida o inexistente se reporta', !r.ok && r.errors.some((e) => ['duplicate', 'mirror', 'repeat'].includes(e.code)), msgs(r));
  check('4x4 el mensaje de ala nombra la pieza', r.errors.some((e) => /arista|esquina/.test(e.message)), msgs(r));
}
{
  const g = cloneGrid(solvedGrid(4)); g.U[15] = 'R'; g.F[3] = 'U'; g.R[0] = 'F'; // corner UFR twisted
  expectError('4x4 esquina girada', g, 'twist', /Una esquina está girada: revisa la esquina de arriba, frente, derecha/, 4);
}
{
  // On the 4x4 the permutation parity is NOT an error: two swapped wings are legal.
  const s = new CubeState(4).apply("r2 U2 r2 Uw2 r2 u2"); // parity-style state: one edge flipped
  check('4x4 paridad de aristas no es error', validateGrid(gridFromState(s), 4).ok);
}
{
  // Two corners swapped on a 4x4 is legal (parity absorbed by centers and wings).
  const s = new CubeState(4).apply("R U R' U' R' F R2 U' R' U' R U R' F' U r2 U2 r2 Uw2 r2 u2 U'");
  check('4x4 dos esquinas intercambiadas es válido', validateGrid(gridFromState(s), 4).ok);
}

// ---------- counter-check: one swapped pair of stickers ----------
let swaps3 = 0; let swaps4 = 0; let legal4 = 0;
for (const n of [3, 4]) {
  const pool = valid[n];
  const rounds = n === 3 ? 2500 : 600;
  for (let k = 0; k < rounds; k++) {
    const base = pick(pool);
    const g = cloneGrid(base.grid);
    const cells = FACES.flatMap((f) => g[f].map((_, i) => [f, i])).filter(([f, i]) => !(n === 3 && i === 4));
    const a = pick(cells); const b = pick(cells);
    if (g[a[0]][a[1]] === g[b[0]][b[1]]) continue;
    swap(g, a, b);
    const r = validateGrid(g, n);
    if (n === 3) {
      swaps3++;
      check('3x3 un sticker cambiado siempre se reporta', !r.ok && r.errors.length > 0, `${base.scr} ${a} ${b}`);
    } else {
      swaps4++;
      if (r.ok) {
        legal4++;
        check('4x4 si pasa, el estado reconstruido reproduce lo pintado', sameGrid(gridFromState(r.state), g), `${base.scr} ${a} ${b}`);
      } else check('4x4 el error trae mensaje', r.errors.length > 0 && r.errors.every((e) => e.message.length > 10));
    }
  }
}
check('contraprueba: el cambio de un sticker se detecta con frecuencia en 4x4', swaps4 > 0 && legal4 < swaps4);
console.log(`stickers cambiados: 3x3 ${swaps3}, 4x4 ${swaps4} (legales en 4x4: ${legal4})`);

console.log(`\n${passes} comprobaciones correctas, ${failures} fallas.`);
process.exit(failures ? 1 : 0);
