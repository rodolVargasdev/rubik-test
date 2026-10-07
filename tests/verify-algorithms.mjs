// Verifies every guide case by simulation: the start state must be the
// situation the text describes and the algorithm must reach the target.
// Run: node tests/verify-algorithms.mjs
import { CubeState, pieceSolved, normalFace, faceletDiff } from '../src/js/cube-core.js';
import { GUIDE_3, GUIDE_4, ALGS, buildCase } from '../src/js/content.js';

let failures = 0;
let passes = 0;
function check(name, cond, detail = '') {
  if (cond) { passes++; return; }
  failures++;
  console.log(`FALLA  ${name} ${detail}`);
}

const nf = (s, c, f) => normalFace(s.stickerNormal(c, f));
const has = (c, f) => c.faces.includes(f);
const solvedWhere = (s, pred) => s.cubies.filter(pred).every((c) => pieceSolved(s, c));
const petals = (s) => s.cubies.filter((c) => c.type === 'edge' && has(c, 'D') && nf(s, c, 'D') === 'U').length;
const yellowEdgesUp = (s) => s.cubies.filter((c) => c.type === 'edge' && has(c, 'U') && c.pos[1] === s.n - 1 && nf(s, c, 'U') === 'U').length;
const f2lDone = (s) => solvedWhere(s, (c) => !has(c, 'U'));
const centersDone = (s) => solvedWhere(s, (c) => c.type === 'center');
const unpairedSlots = (s) => {
  const slots = {};
  for (const c of s.cubies.filter((q) => q.type === 'edge')) {
    const k = c.pos.map((v) => (Math.abs(v) === s.n - 1 ? v : 0)).join(',');
    (slots[k] ||= []).push(c);
  }
  return Object.entries(slots).filter(([, [a, b]]) => !(a.faces.join() === b.faces.join()
    && a.faces.every((f) => nf(s, a, f) === nf(s, b, f)))).map(([k]) => k);
};
const matchedTopEdgeNames = (s) => s.cubies.filter((c) => c.type === 'edge' && has(c, 'U') && pieceSolved(s, c))
  .map((c) => c.faces.find((f) => f !== 'U')).sort().join('');
const matchedTopEdges = (s) => s.cubies.filter((c) => c.type === 'edge' && has(c, 'U') && pieceSolved(s, c)).length;
const placedTopCorners = (s) => s.cubies.filter((c) => c.type === 'corner' && has(c, 'U')
  && c.pos.every((v, i) => v === c.home[i])).length;
const after = (start, alg) => start.clone().apply(alg);

// Expected start situation per "guide/step/case".
const EXPECT = {
  '3x3/margarita/medio': (s) => petals(s) === 3,
  '3x3/margarita/abajo': (s) => petals(s) === 3,
  '3x3/margarita/lado': (s) => petals(s) === 3
    && s.cubies.some((c) => has(c, 'D') && c.type === 'edge' && c.pos[1] === -2 && nf(s, c, 'D') !== 'D'),
  '3x3/cruz/uno': (s) => petals(s) === 1 && s.cubies.filter((c) => c.type === 'edge' && has(c, 'D') && pieceSolved(s, c)).length === 3,
  '3x3/cruz/todos': (s) => petals(s) === 4,
  '3x3/esquinas-blancas/derecha': (s) => cornerDFR(s).pos[1] === 2 && nf(s, cornerDFR(s), 'D') !== 'U',
  '3x3/esquinas-blancas/arriba': (s) => cornerDFR(s).pos[1] === 2 && nf(s, cornerDFR(s), 'D') === 'U',
  '3x3/esquinas-blancas/frente': (s) => cornerDFR(s).pos[1] === 2 && nf(s, cornerDFR(s), 'D') === 'F',
  '3x3/esquinas-blancas/atrapada': (s) => cornerDFR(s).pos[1] === -2 && !pieceSolved(s, cornerDFR(s)),
  '3x3/segunda-capa/derecha': (s) => edgeAtUF(s, 'R'),
  '3x3/segunda-capa/izquierda': (s) => edgeAtUF(s, 'L'),
  '3x3/segunda-capa/volteada': (s) => {
    const e = s.cubies.find((c) => c.faces.slice().sort().join('') === 'FR');
    return e.pos.join() === '2,0,2' && !pieceSolved(s, e)
      && solvedWhere(s, (c) => !has(c, 'U') && c !== e);
  },
  '3x3/cruz-amarilla/linea': (s) => f2lDone(s) && yellowEdgesUp(s) === 2 && lineIsHorizontal(s),
  '3x3/cruz-amarilla/ele': (s) => f2lDone(s) && yellowEdgesUp(s) === 2 && !lineIsHorizontal(s),
  '3x3/cruz-amarilla/punto': (s) => f2lDone(s) && yellowEdgesUp(s) === 0,
  '3x3/aristas-amarillas/vecinas': (s) => f2lDone(s) && yellowEdgesUp(s) === 4 && matchedTopEdgeNames(s) === 'BR',
  '3x3/aristas-amarillas/opuestas': (s) => f2lDone(s) && yellowEdgesUp(s) === 4 && matchedTopEdgeNames(s) === 'BF',
  '3x3/posicion-esquinas/una': (s) => f2lDone(s) && matchedTopEdges(s) === 4 && placedTopCorners(s) === 1,
  '3x3/posicion-esquinas/ninguna': (s) => f2lDone(s) && matchedTopEdges(s) === 4 && placedTopCorners(s) === 0,
  '3x3/girar-esquinas/dos': (s) => f2lDone(s) && placedTopCorners(s) === 4 && s.cubies.filter((c) => !pieceSolved(s, c)).length === 2,
  '3x3/girar-esquinas/tres': (s) => f2lDone(s) && placedTopCorners(s) === 4 && s.cubies.filter((c) => !pieceSolved(s, c)).length === 3,
  '4x4/centros-opuestos/pieza': (s) => s.cubies.filter((c) => c.type === 'center' && !pieceSolved(s, c)).length === 2,
  '4x4/centros-opuestos/barra': (s) => s.cubies.filter((c) => c.type === 'center' && !pieceSolved(s, c)).length === 4,
  '4x4/centros-laterales/ultimos': (s) => s.cubies.filter((c) => c.type === 'center' && !pieceSolved(s, c)).length === 4,
  '4x4/aristas/par': (s) => centersDone(s) && sameSet(unpairedSlots(s), ['-3,0,3', '3,0,3']),
  '4x4/aristas/ultimas': (s) => centersDone(s) && sameSet(unpairedSlots(s), ['-3,0,3', '3,0,3']),
  '4x4/como-3x3/segunda': (s) => centersDone(s) && unpairedSlots(s).length === 0,
  '4x4/como-3x3/sune': (s) => centersDone(s) && unpairedSlots(s).length === 0 && matchedTopEdges(s) === 4,
  '4x4/paridad-oll/oll': (s) => centersDone(s) && onlyBrokenAt(s, ['1,3,3', '-1,3,3']),
  '4x4/paridad-pll/pll': (s) => centersDone(s) && onlyBrokenAt(s, ['1,3,3', '-1,3,3', '1,3,-3', '-1,3,-3']),
};

function cornerDFR(s) { return s.cubies.find((c) => c.faces.slice().sort().join('') === 'DFR'); }
function edgeAtUF(s, side) {
  const e = s.cubies.find((c) => c.pos.join() === '0,2,2');
  return has(e, 'F') && has(e, side) && nf(s, e, 'F') === 'F' && nf(s, e, side) === 'U'
    && solvedWhere(s, (c) => !has(c, 'U') && c !== e && !(has(c, 'F') && has(c, side) && c.type === 'edge'));
}
function lineIsHorizontal(s) {
  const up = s.cubies.filter((c) => c.type === 'edge' && has(c, 'U') && nf(s, c, 'U') === 'U');
  return up.every((c) => c.pos[2] === 0);
}
function sameSet(a, b) { return a.length === b.length && a.every((x) => b.includes(x)); }
function onlyBrokenAt(s, positions) {
  const broken = s.cubies.filter((c) => !pieceSolved(s, c)).map((c) => c.pos.join());
  return sameSet(broken, positions);
}

for (const guide of [GUIDE_3, GUIDE_4]) {
  for (const step of guide.steps) {
    for (const c of step.cases) {
      const name = `${guide.id}/${step.id}/${c.id}`;
      const built = buildCase(guide.n, c);
      const end = after(built.start, c.alg);
      check(`${name} llega al objetivo`, faceletDiff(end, built.target) === 0);
      check(`${name} los grupos suman los movimientos`, c.groups.reduce((t, [k]) => t + k, 0) === built.tokens.length,
        `(${c.groups.reduce((t, [k]) => t + k, 0)} vs ${built.tokens.length})`);
      check(`${name} tiene piezas resaltadas`, built.focus.length > 0);
      const exp = EXPECT[name];
      check(`${name} tiene expectativa`, !!exp);
      if (exp) check(`${name} empieza en la situación descrita`, exp(built.start));
    }
  }
}

// Intermediate claims made in the text.
{
  const c = GUIDE_3.steps.find((s) => s.id === 'aristas-amarillas').cases.find((q) => q.id === 'opuestas');
  const { start } = buildCase(3, c);
  const mid = after(start, `U' ${ALGS.SUNE} U'`);
  const nfUp = (q) => q.faces.find((f) => f !== 'U');
  const matched = mid.cubies.filter((q) => q.type === 'edge' && has(q, 'U') && pieceSolved(mid, q)).map(nfUp).sort().join('');
  check('Sune desde opuestas deja dos vecinas atrás y a la derecha', matched === 'BR', matched);
}
{
  const steps4 = GUIDE_4.steps.find((s) => s.id === 'aristas').cases;
  const par = buildCase(4, steps4.find((q) => q.id === 'par'));
  check('4x4 par: el primer giro forma la pareja adelante a la derecha',
    !unpairedSlots(after(par.start, par.tokens[0])).includes('3,0,3'));
  check('4x4 par: al final los centros quedan armados', centersDone(after(par.start, ALGS.PAIR)));
  const ult = buildCase(4, steps4.find((q) => q.id === 'ultimas'));
  const beforeLast = after(ult.start, ult.tokens.slice(0, -1).join(' '));
  check('4x4 ultimas: el último giro junta todas las mitades',
    unpairedSlots(beforeLast).length > 0 && unpairedSlots(after(beforeLast, ult.tokens.at(-1))).length === 0);
}
{
  // The full sexy move repeated six times is the identity: the "why" demo.
  check('(R U R\' U\') x6 vuelve al cubo armado', new CubeState(3).apply(Array(6).fill(ALGS.SEXY).join(' ')).isSolved());
  check('Sune x6 vuelve al cubo armado', new CubeState(3).apply(Array(6).fill(ALGS.SUNE).join(' ')).isSolved());
}

// Counter-checks: the guards must detect broken input.
{
  const broken = { ...GUIDE_3.steps[3].cases[0], alg: "U R U' R' U' F' U" }; // last move missing
  const b = buildCase(3, broken);
  check('Contraprueba: un algoritmo incompleto no reproduce la situación descrita',
    !EXPECT['3x3/segunda-capa/derecha'](b.start));
  const flipped3 = new CubeState(3).apply(ALGS.OE);
  check('Contraprueba: la expectativa de paridad rechaza un caso de 3x3',
    !onlyBrokenAt(new CubeState(4).apply("R U R' U'"), ['1,3,3', '-1,3,3']) && !flipped3.isSolved());
  check('Contraprueba: un estado mezclado no pasa como "no armado"', !new CubeState(3).apply('R').isSolved());
}

console.log(`\n${passes} comprobaciones correctas, ${failures} fallas.`);
process.exit(failures ? 1 : 0);
