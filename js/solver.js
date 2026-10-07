// Teaching solver: solves any 3x3 or 4x4 state with the same steps and
// algorithms the guide teaches, and narrates each decision. Every choice is
// found by simulation: among the guide's moves, take the shortest one that
// advances the step without breaking what is already solved.
import { CubeState, parseMove, normalFace, tokenize, invertToken, FACE_NAMES } from './cube-core.js';
import { ALGS } from './content.js';

export const STEPS = {
  3: [
    ['orientar', 'Sostener el cubo'],
    ['margarita', 'La margarita'],
    ['cruz', 'La cruz blanca'],
    ['esquinas-blancas', 'Esquinas blancas'],
    ['segunda-capa', 'Segunda capa'],
    ['cruz-amarilla', 'Cruz amarilla'],
    ['aristas-amarillas', 'Aristas amarillas'],
    ['posicion-esquinas', 'Esquinas amarillas a su lugar'],
    ['girar-esquinas', 'Girar las esquinas amarillas'],
  ],
  4: [
    ['centros', 'Centros'],
    ['aristas', 'Emparejar aristas'],
    ['margarita', 'La margarita'],
    ['cruz', 'La cruz blanca'],
    ['esquinas-blancas', 'Esquinas blancas'],
    ['segunda-capa', 'Segunda capa'],
    ['paridad-oll', 'Paridad: arista volteada'],
    ['cruz-amarilla', 'Cruz amarilla'],
    ['paridad-pll', 'Paridad: aristas intercambiadas'],
    ['aristas-amarillas', 'Aristas amarillas'],
    ['posicion-esquinas', 'Esquinas amarillas a su lugar'],
    ['girar-esquinas', 'Girar las esquinas amarillas'],
  ],
};

// ---------- move helpers ----------
const cache = new Map();
const P = (n, t) => {
  const k = n + t;
  let m = cache.get(k);
  if (!m) { m = parseMove(t, n); cache.set(k, m); }
  return m;
};
const run = (s, toks) => { for (const t of toks) s.applyMove(P(s.n, t)); };
const unrun = (s, toks) => { for (let i = toks.length - 1; i >= 0; i--) s.applyMove(P(s.n, invertToken(toks[i]))); };
const T = (alg) => tokenize(alg);
const times = (alg, k) => Array.from({ length: k }, () => T(alg)).flat();

const SUF = ['', "'", '2'];
const OUTER = ['U', 'D', 'R', 'L', 'F', 'B'].flatMap((f) => SUF.map((x) => f + x));
const INNER = ['r', 'l', 'u', 'd', 'f', 'b'].flatMap((f) => SUF.map((x) => f + x));
const UT = [[], ['U'], ["U'"], ['U2']];
const YT = [[], ['y'], ["y'"], ['y2']];
const AXIS = { U: 1, D: 1, R: 0, L: 0, F: 2, B: 2 };
const axisOf = (t) => AXIS[t[0].toUpperCase()];

// ---------- state reading ----------
const nf = (s, c, f) => normalFace(s.stickerNormal(c, f));
const has = (c, f) => c.faces.includes(f);
const keyOf = (c) => c.faces.slice().sort().join('');
const ORDER = 'DUFBRL';
const nameOf = (c) => c.faces.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((f) => FACE_NAMES[f]).join('-');

function colorFaces(s) {
  const m = {};
  for (const c of s.cubies) if (c.type === 'center' && !(c.faces[0] in m)) m[c.faces[0]] = nf(s, c, c.faces[0]);
  return m;
}
const solvedRel = (s, c, cf) => c.faces.every((f) => nf(s, c, f) === cf[f]);
const solvedAbs = (s, c) => c.faces.every((f) => nf(s, c, f) === f);
const byIds = (s, ids) => ids.map((i) => s.cubies[i]);
const allSolved = (s, ids) => { const cf = colorFaces(s); return byIds(s, ids).every((c) => solvedRel(s, c, cf)); };
const top = (s, c) => c.pos[1] === s.n - 1;

// Pieces of a kind ("edge" includes 4x4 wings).
const whiteEdges = (s) => s.cubies.filter((c) => c.type === 'edge' && has(c, 'D'));
const whiteCorners = (s) => s.cubies.filter((c) => c.type === 'corner' && has(c, 'D'));
const midEdges = (s) => s.cubies.filter((c) => c.type === 'edge' && !has(c, 'D') && !has(c, 'U'));
const topEdges = (s) => s.cubies.filter((c) => c.type === 'edge' && has(c, 'U'));
const topCorners = (s) => s.cubies.filter((c) => c.type === 'corner' && has(c, 'U'));
const ids = (list) => list.map((c) => c.id);
const sameKey = (s, c) => s.cubies.filter((q) => q.type === c.type && keyOf(q) === keyOf(c)).map((q) => q.id);

// ---------- search ----------
function cand(groups) {
  const g = groups.filter((x) => x.moves.length);
  return { groups: g, flat: g.flatMap((x) => x.moves) };
}
const byLen = (a, b) => a.flat.length - b.flat.length;

function first(s, cands, goal) {
  for (const c of cands) {
    run(s, c.flat);
    const ok = goal();
    unrun(s, c.flat);
    if (ok) return c;
  }
  return null;
}

// Iterative deepening over outer moves; returns the move list or null.
function iddfs(s, maxDepth, goal) {
  const path = [];
  const rec = (d) => {
    if (goal()) return true;
    if (d === 0) return false;
    for (const t of OUTER) {
      const last = path[path.length - 1];
      if (last && (last[0] === t[0] || (axisOf(last) === axisOf(t) && last[0] > t[0]))) continue;
      s.applyMove(P(s.n, t));
      path.push(t);
      if (rec(d - 1)) return true;
      path.pop();
      s.applyMove(P(s.n, invertToken(t)));
    }
    return false;
  };
  for (let d = 0; d <= maxDepth; d++) {
    if (rec(d)) { const res = path.slice(); unrun(s, res); return res; }
  }
  return null;
}

// Whole-cube rotations, shortest first.
const ROTATIONS = (() => {
  const toks = ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'];
  const out = [[]];
  for (const a of toks) out.push([a]);
  for (const a of toks) for (const b of toks) if (a[0] !== b[0]) out.push([a, b]);
  return out;
})();

class Plan {
  constructor(s) { this.s = s; this.segs = []; }
  push(step, label, groups) {
    const g = groups.filter((x) => x.moves.length);
    if (!g.length) return;
    run(this.s, g.flatMap((x) => x.moves));
    this.segs.push({ step, label, groups: g.map((x) => ({ label: x.label, moves: x.moves.slice() })) });
  }
  skip(step, reason) { this.segs.push({ step, skipped: true, reason }); }
  done(step, note) { if (!this.segs.some((x) => x.step === step)) this.skip(step, note); }
}

const rotLabel = (r) => `Gira todo el cubo: ${r.join(' ')}`;

// ---------- 3x3 stages (also used on a reduced 4x4) ----------
function orient(p) {
  const s = p.s;
  const ok = () => { const cf = colorFaces(s); return cf.U === 'U' && cf.F === 'F'; };
  if (ok()) return p.skip('orientar', 'Ya estaba con amarillo arriba y verde al frente.');
  const r = first(s, ROTATIONS.map((m) => cand([{ moves: m }])), ok);
  p.push('orientar', 'Amarillo arriba y verde al frente', [{ label: rotLabel(r.flat), moves: r.flat }]);
}

function daisy(p) {
  const s = p.s;
  const cross = () => allSolved(s, ids(whiteEdges(s)));
  if (cross()) {
    p.skip('margarita', 'La cruz blanca ya estaba armada: la margarita no hace falta.');
    p.skip('cruz', 'La cruz blanca ya estaba armada.');
    return false;
  }
  const petals = () => whiteEdges(s).filter((c) => top(s, c) && nf(s, c, 'D') === 'U').map((c) => c.id);
  const total = whiteEdges(s).length;
  if (petals().length === total) { p.skip('margarita', 'Las aristas blancas ya formaban la margarita.'); return true; }
  for (let guard = 0; petals().length < total && guard < 12; guard++) {
    const before = petals();
    const path = iddfs(s, 5, () => { const now = petals(); return now.length > before.length && before.every((i) => now.includes(i)); });
    if (!path) throw new Error('margarita sin solución');
    run(s, path);
    const fresh = s.cubies[petals().find((i) => !before.includes(i))];
    unrun(s, path);
    const where = fresh.pos[1] === s.n - 1 ? 'arriba, con el blanco de lado'
      : fresh.pos[1] === -(s.n - 1) ? (nf(s, fresh, 'D') === 'D' ? 'abajo, con el blanco hacia abajo' : 'abajo, con el blanco de lado')
        : 'en la capa del medio';
    let k = 0;
    while (k < path.length && path[k][0] === 'U') k++;
    p.push('margarita', `Arista ${nameOf(fresh)}: está ${where}`, [
      { label: 'Libera el hueco de arriba', moves: path.slice(0, k) },
      { label: 'Súbela con el blanco hacia arriba', moves: path.slice(k) },
    ]);
  }
  return true;
}

function cross(p) {
  const s = p.s;
  const white = ids(whiteEdges(s));
  for (let guard = 0; !allSolved(s, white) && guard < 12; guard++) {
    const cf = colorFaces(s);
    const solved = white.filter((i) => solvedRel(s, s.cubies[i], cf));
    const petal = whiteEdges(s).find((c) => !solved.includes(c.id) && top(s, c) && nf(s, c, 'D') === 'U');
    const group = sameKey(s, petal);
    const cands = [];
    for (const u of UT) for (const X of ['F', 'R', 'B', 'L']) cands.push(cand([{ label: 'Alinea', moves: u }, { label: 'Baja', moves: [`${X}2`] }]));
    const c = first(s, cands.sort(byLen), () => allSolved(s, [...solved, ...group]));
    if (!c) throw new Error('cruz sin solución');
    const side = petal.faces.find((f) => f !== 'D');
    const face = c.flat[c.flat.length - 1][0];
    p.push('cruz', `Arista ${nameOf(petal)}: el ${FACE_NAMES[side]} va sobre su centro`, [
      { label: 'Alinea con la cara de arriba', moves: c.flat.slice(0, -1) },
      { label: `Bájala con media vuelta (${face}2)`, moves: [`${face}2`] },
    ]);
  }
}

const CORNER_NAMES = { 1: 'blanco a la derecha', 3: 'blanco hacia arriba', 5: 'blanco al frente', 2: 'atrapada abajo y girada', 4: 'atrapada abajo y girada' };

function corners(p) {
  const s = p.s;
  const base = ids(whiteEdges(s));
  const all = ids(whiteCorners(s));
  if (allSolved(s, all)) return p.skip('esquinas-blancas', 'Las cuatro esquinas blancas ya estaban en su lugar.');
  const solveCands = [];
  for (const y of YT) for (const u of UT) for (let k = 1; k <= 5; k++) {
    solveCands.push(cand([{ label: 'Gira el cubo para traer el hueco adelante a la derecha', moves: y },
      { label: 'Ubica la esquina encima de su lugar', moves: u },
      { label: `R U R' U' (${k} ${k === 1 ? 'vez' : 'veces'})`, moves: times(ALGS.SEXY, k), k }]));
  }
  solveCands.sort(byLen);
  const popCands = YT.map((y) => cand([{ label: 'Gira el cubo hacia la esquina atrapada', moves: y }, { label: "Sácala con R U R' U'", moves: T(ALGS.SEXY) }]));
  for (let guard = 0; !allSolved(s, all) && guard < 12; guard++) {
    const cf = colorFaces(s);
    const keep = [...base, ...all.filter((i) => solvedRel(s, s.cubies[i], cf))];
    const pending = whiteCorners(s).filter((c) => !keep.includes(c.id));
    const target = pending.find((c) => top(s, c)) || pending[0];
    const c = first(s, solveCands, () => allSolved(s, [...keep, target.id]));
    if (c) {
      const k = c.groups[c.groups.length - 1].k;
      p.push('esquinas-blancas', `Esquina ${nameOf(target)}: ${CORNER_NAMES[k]}`, c.groups);
      continue;
    }
    const pop = first(s, popCands, () => top(s, s.cubies[target.id]) && allSolved(s, keep));
    if (!pop) throw new Error('esquina sin solución');
    p.push('esquinas-blancas', `Esquina ${nameOf(target)}: atrapada en otro lugar, primero se saca`, pop.groups);
  }
}

function middle(p) {
  const s = p.s;
  const base = [...ids(whiteEdges(s)), ...ids(whiteCorners(s))];
  const all = ids(midEdges(s));
  if (allSolved(s, all)) return p.skip('segunda-capa', 'La segunda capa ya estaba completa.');
  const cands = [];
  for (const y of YT) for (const u of UT) for (const [alg, side] of [[ALGS.RIGHT, 'derecha'], [ALGS.LEFT, 'izquierda']]) {
    cands.push(cand([{ label: 'Gira el cubo para poner su color al frente', moves: y },
      { label: 'Forma la T invertida', moves: u },
      { label: `Algoritmo a la ${side}`, moves: T(alg), side }]));
  }
  cands.sort(byLen);
  const popCands = YT.map((y) => cand([{ label: 'Gira el cubo hacia la arista atrapada', moves: y }, { label: 'Sácala con el algoritmo a la derecha', moves: T(ALGS.RIGHT) }]));
  for (let guard = 0; !allSolved(s, all) && guard < 16; guard++) {
    const cf = colorFaces(s);
    const keep = [...base, ...all.filter((i) => solvedRel(s, s.cubies[i], cf))];
    const pending = midEdges(s).filter((c) => !keep.includes(c.id));
    const target = pending.find((c) => top(s, c)) || pending[0];
    const group = sameKey(s, target);
    const c = first(s, cands, () => allSolved(s, [...keep, ...group]));
    if (c) {
      p.push('segunda-capa', `Arista ${nameOf(target)}: va a la ${c.groups[c.groups.length - 1].side}`, c.groups);
      continue;
    }
    const pop = first(s, popCands, () => group.every((i) => top(s, s.cubies[i])) && allSolved(s, keep));
    if (!pop) throw new Error('segunda capa sin solución');
    p.push('segunda-capa', `Arista ${nameOf(target)}: metida al revés, primero se saca`, pop.groups);
  }
}

const f2lIds = (s) => [...ids(whiteEdges(s)), ...ids(whiteCorners(s)), ...ids(midEdges(s))];
const upEdges = (s) => topEdges(s).filter((c) => nf(s, c, 'U') === 'U');

function shape(s) {
  const up = upEdges(s).filter((c) => top(s, c));
  const k = up.length * (s.n === 4 ? 0.5 : 1);
  if (k === 0) return 'Punto';
  if (k === 4) return 'Cruz';
  if (k === 2) {
    const xs = up.map((c) => (Math.abs(c.pos[0]) === s.n - 1 ? 'x' : 'z'));
    return xs.every((v) => v === xs[0]) ? 'Línea' : 'L';
  }
  return 'Impar';
}
const SHAPE_HINT = { Punto: 'Punto: haz el algoritmo una vez', L: 'L: atrás a la izquierda', 'Línea': 'Línea: en horizontal' };

function ollParity(p) {
  const s = p.s;
  const flipped = topEdges(s).filter((c) => nf(s, c, 'U') !== 'U').length / 2;
  if (flipped % 2 === 0) return p.skip('paridad-oll', 'No apareció: el número de aristas con el amarillo de lado es par.');
  const isUF = (c) => c.pos[1] === 3 && c.pos[2] === 3;
  const c = first(s, UT.map((u) => cand([{ moves: u }])), () => topEdges(s).some((q) => isUF(q) && nf(s, q, 'U') !== 'U'));
  p.push('paridad-oll', `Hay ${flipped === 1 ? 'una arista' : 'tres aristas'} con el amarillo de lado: imposible en un 3x3`, [
    { label: 'Lleva una arista volteada adelante', moves: c.flat },
    { label: 'Algoritmo de paridad de orientación', moves: T(ALGS.OLL_PARITY) },
  ]);
}

function yellowCross(p) {
  const s = p.s;
  const full = () => upEdges(s).length === topEdges(s).length;
  if (full()) return p.skip('cruz-amarilla', 'Las aristas ya tenían el amarillo arriba.');
  const cands = [];
  const build = (prefix, left) => {
    for (const u of UT) {
      const seq = [...prefix, u];
      cands.push(seq);
      if (left > 1) build(seq, left - 1);
    }
  };
  build([], 3);
  const keep = f2lIds(s);
  const list = cands.map((us) => cand(us.flatMap((u) => [{ moves: u }, { moves: T(ALGS.OE) }]))).sort(byLen);
  const c = first(s, list, () => full() && allSolved(s, keep));
  if (!c) throw new Error('cruz amarilla sin solución');
  // Replay it piece by piece to narrate each shape.
  for (let i = 0; i < c.flat.length;) {
    const u = [];
    while (c.flat[i][0] === 'U') u.push(c.flat[i++]);
    run(s, u);
    const sh = shape(s);
    unrun(s, u);
    const oe = c.flat.slice(i, i + 6);
    i += 6;
    p.push('cruz-amarilla', SHAPE_HINT[sh] || sh, [{ label: 'Coloca la figura', moves: u }, { label: "F R U R' U' F'", moves: oe }]);
  }
}

function edgeCands() {
  const out = [];
  for (const a of UT) {
    out.push(cand([{ label: 'Alinea la capa de arriba', moves: a }]));
    for (const b of UT) {
      out.push(cand([{ label: 'Gira arriba: dos vecinas atrás y a la derecha', moves: a }, { label: 'Sune', moves: T(ALGS.SUNE) }, { label: 'Alinea la capa de arriba', moves: b }]));
      for (const c of UT) {
        out.push(cand([{ label: 'Empieza desde cualquier lado', moves: a }, { label: 'Sune', moves: T(ALGS.SUNE) },
          { label: 'Gira arriba: dos vecinas atrás y a la derecha', moves: b }, { label: 'Sune', moves: T(ALGS.SUNE) }, { label: 'Alinea la capa de arriba', moves: c }]));
      }
    }
  }
  return out.sort(byLen);
}

function cornerCands() {
  const out = [];
  for (const y of YT) {
    for (const k of [1, 2]) out.push(cand([{ label: 'Gira el cubo: la esquina correcta adelante a la derecha', moves: y }, { label: k === 1 ? "U R U' L' U R' U' L" : "U R U' L' U R' U' L (2 veces)", moves: times(ALGS.CP, k) }]));
    for (const y2 of YT) for (const k of [1, 2]) {
      out.push(cand([{ label: 'Ninguna está bien: empieza desde cualquier lado', moves: y }, { label: "U R U' L' U R' U' L", moves: T(ALGS.CP) },
        { label: 'Gira el cubo: la esquina correcta adelante a la derecha', moves: y2 }, { label: k === 1 ? "U R U' L' U R' U' L" : "U R U' L' U R' U' L (2 veces)", moves: times(ALGS.CP, k) }]));
    }
  }
  return out.sort(byLen);
}

const placed = (s, c, cf) => {
  const want = [0, 0, 0];
  for (const f of c.faces) { const v = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] }[cf[f]]; for (let i = 0; i < 3; i++) want[i] += v[i]; }
  return c.pos.every((v, i) => Math.sign(v) === Math.sign(want[i]));
};

function lastLayerPerm(p, EDGE, CORNER) {
  const s = p.s;
  const keep = f2lIds(s);
  const eIds = ids(topEdges(s));
  const edgesOK = () => allSolved(s, [...keep, ...eIds]);
  const cornersOK = () => { const cf = colorFaces(s); return topCorners(s).every((c) => placed(s, c, cf)) && edgesOK(); };
  const solvable = () => {
    const e = first(s, EDGE, edgesOK);
    if (!e) return false;
    run(s, e.flat);
    const ok = cornersOK() || !!first(s, CORNER, cornersOK);
    unrun(s, e.flat);
    return ok;
  };
  if (s.n === 4) {
    if (solvable()) p.skip('paridad-pll', 'No apareció: aristas y esquinas se pueden ordenar sin ella.');
    else {
      const c = first(s, UT.map((u) => cand([{ moves: u }, { moves: T(ALGS.PLL_PARITY) }])), solvable);
      if (!c) throw new Error('paridad PLL sin solución');
      p.push('paridad-pll', 'Dos aristas quedaron intercambiadas: imposible en un 3x3', [
        { label: 'Gira arriba', moves: c.flat.slice(0, c.flat.length - T(ALGS.PLL_PARITY).length) },
        { label: 'Algoritmo de paridad de permutación', moves: T(ALGS.PLL_PARITY) },
      ]);
    }
  }
  if (edgesOK()) p.skip('aristas-amarillas', 'Las aristas amarillas ya coincidían con sus centros.');
  else {
    const e = first(s, EDGE, edgesOK);
    const matched = () => { const cf = colorFaces(s); return topEdges(s).filter((c) => solvedRel(s, c, cf)).length / (s.n === 4 ? 2 : 1); };
    p.push('aristas-amarillas', e.flat.length <= 2 ? 'Solo faltaba alinear la capa de arriba'
      : e.groups.filter((g) => g.label === 'Sune').length === 2 ? 'Dos aristas correctas pero opuestas: Sune dos veces' : `Con ${matched()} correcta${matched() === 1 ? '' : 's'}: Sune una vez`, e.groups);
  }
  if (cornersOK()) p.skip('posicion-esquinas', 'Las cuatro esquinas ya estaban en su rincón.');
  else {
    const c = first(s, CORNER, cornersOK);
    if (!c) throw new Error('esquinas sin solución');
    const cf = colorFaces(s);
    const ok = topCorners(s).filter((q) => placed(s, q, cf)).length;
    p.push('posicion-esquinas', ok ? 'Una esquina ya está en su rincón' : 'Ninguna esquina está en su rincón', c.groups);
  }
}

function twistCorners(p) {
  const s = p.s;
  const UFR = (s.n - 1);
  const yellowUp = () => topCorners(s).every((c) => nf(s, c, 'U') === 'U');
  if (!yellowUp()) {
    for (let i = 0; i < 4 && !yellowUp(); i++) {
      const c = s.cubies.find((q) => q.type === 'corner' && q.pos.every((v) => v === UFR));
      let k = 0;
      while (nf(s, c, 'U') !== 'U' && k < 6) { run(s, T(ALGS.TWIST)); k++; }
      unrun(s, times(ALGS.TWIST, k));
      if (k) p.push('girar-esquinas', `Esquina ${nameOf(c)}: hasta que el amarillo mire arriba`, [{ label: `R' D' R D (${k} veces)`, moves: times(ALGS.TWIST, k) }]);
      if (!yellowUp()) p.push('girar-esquinas', 'Trae la siguiente esquina girada', [{ label: 'Solo la cara de arriba: U', moves: ['U'] }]);
    }
  } else p.skip('girar-esquinas', 'Todas las esquinas ya tenían el amarillo arriba.');
  // Align the top layer, then hold the cube as at the start.
  const auf = first(s, UT.map((u) => cand([{ moves: u }])), () => s.cubies.every((c) => solvedRel(s, c, colorFaces(s))));
  if (auf && auf.flat.length) p.push('girar-esquinas', 'Alinea la capa de arriba', [{ label: 'Alinea', moves: auf.flat }]);
  const ok = () => { const cf = colorFaces(s); return cf.U === 'U' && cf.F === 'F'; };
  if (!ok()) {
    const r = first(s, ROTATIONS.map((m) => cand([{ moves: m }])), ok);
    p.push('girar-esquinas', 'Vuelve a sostenerlo con el verde al frente', [{ label: rotLabel(r.flat), moves: r.flat }]);
  }
}

function solveAsThree(p) {
  if (daisy(p)) cross(p);
  corners(p);
  middle(p);
  if (p.s.n === 4) ollParity(p);
  yellowCross(p);
  lastLayerPerm(p, EDGE_CANDS, CORNER_CANDS);
  twistCorners(p);
}

const EDGE_CANDS = edgeCands();
const CORNER_CANDS = cornerCands();

// ---------- 4x4 reduction ----------
const COLOR_ORDER = ['U', 'D', 'F', 'R', 'B', 'L'];

let CENTER_CANDS = null;
function centerCands() {
  if (CENTER_CANDS) return CENTER_CANDS;
  const setups = [[], ...OUTER.map((t) => [t])];
  const out = [];
  for (const su of setups) for (const sl of INNER) for (const t of OUTER) {
    if (axisOf(sl) === axisOf(t)) continue;
    out.push(cand([{ label: 'Prepara la pieza', moves: su }, { label: 'Capa interior', moves: [sl] }, { label: 'Guarda la pieza', moves: [t] }, { label: 'Regresa la capa', moves: [invertToken(sl)] }]));
  }
  CENTER_CANDS = out.sort(byLen);
  return CENTER_CANDS;
}

function centers(p) {
  const s = p.s;
  const cs = s.cubies.filter((c) => c.type === 'center');
  const onFace = (f) => cs.filter((c) => c.faces[0] === f);
  if (cs.every((c) => solvedAbs(s, c))) return p.skip('centros', 'Los seis centros ya estaban armados.');
  const cands = centerCands();
  const locked = [];
  for (const f of COLOR_ORDER) {
    const mine = onFace(f).map((c) => c.id);
    const count = () => mine.filter((i) => solvedAbs(s, s.cubies[i])).length;
    if (count() === 4) { locked.push(...mine); continue; }
    for (let guard = 0; count() < 4 && guard < 12; guard++) {
      const keep = [...locked, ...mine.filter((i) => solvedAbs(s, s.cubies[i]))];
      const n0 = count();
      const c = first(s, cands, () => count() > n0 && keep.every((i) => solvedAbs(s, s.cubies[i])));
      if (!c) throw new Error(`centro ${f} sin solución`);
      p.push('centros', `Centro ${FACE_NAMES[f]}: pieza ${n0 + 1} de 4`, c.groups);
    }
    locked.push(...mine);
  }
}

const slotKey = (s, c) => c.pos.map((v) => (Math.abs(v) === s.n - 1 ? v : 0)).join(',');
function unpaired(s) {
  const slots = {};
  for (const c of s.cubies) if (c.type === 'edge') (slots[slotKey(s, c)] ||= []).push(c);
  const bad = [];
  for (const [k, [a, b]] of Object.entries(slots)) {
    const same = keyOf(a) === keyOf(b) && a.faces.every((f) => nf(s, a, f) === nf(s, b, f));
    if (!same) bad.push(k);
  }
  return bad;
}

let PAIR_CANDS = null;
function pairCands() {
  if (PAIR_CANDS) return PAIR_CANDS;
  const outer = [[], ...OUTER.map((t) => [t])];
  for (const a of OUTER) for (const b of OUTER) if (a[0] !== b[0]) outer.push([a, b]);
  // A whole-cube turn first lets two back slots come to the front.
  const setups = YT.flatMap((y) => outer.map((o) => [...y, ...o]));
  const flips = [["R U R' F R' F' R", 'Guarda la pareja y trae otra arista'], ["L' U' L F' L F L'", 'Guarda la pareja y trae otra arista']];
  const out = [];
  for (const su of setups) {
    for (const w of ["Uw'", 'Uw', 'Dw', "Dw'"]) for (const [m, lbl] of flips) {
      out.push(cand([{ label: 'Coloca las dos mitades', moves: su }, { label: 'Une las mitades', moves: [w] }, { label: lbl, moves: T(m) }, { label: 'Repara los centros', moves: [invertToken(w)] }]));
    }
    for (const w of ['Dw', "Dw'", 'Uw', "Uw'"]) {
      out.push(cand([{ label: 'Coloca las dos últimas', moves: su }, { label: 'Desplaza las mitades', moves: [w] }, { label: "R F' U R' F", moves: T("R F' U R' F") }, { label: 'Junta las mitades', moves: [invertToken(w)] }]));
    }
    out.push(cand([{ label: 'Lleva la arista cruzada adelante arriba', moves: su }, { label: 'Algoritmo de paridad: separa y vuelve a unir', moves: T(ALGS.OLL_PARITY) }]));
  }
  PAIR_CANDS = out.sort(byLen);
  return PAIR_CANDS;
}

// Plan B for the last edges: the short "last two" family needs the halves
// in an exact spot. Outer turns never split a pair, so search a longer outer
// setup (up to 4 turns) in front of that family only.
const LAST_CORES = ['Dw', "Dw'", 'Uw', "Uw'"].map((w) => [w, "R F' U R' F", invertToken(w)]);
function deepLastTwo(s, progress) {
  const path = [];
  let found = null;
  const tryCores = () => {
    for (const core of LAST_CORES) {
      const mv = [core[0], ...T(core[1]), core[2]];
      run(s, mv);
      const ok = progress();
      unrun(s, mv);
      if (ok) { found = core; return true; }
    }
    return false;
  };
  const rec = (d) => {
    if (d === 0) return tryCores();
    for (const t of OUTER) {
      const last = path[path.length - 1];
      if (last && (last[0] === t[0] || (axisOf(last) === axisOf(t) && last[0] > t[0]))) continue;
      s.applyMove(P(s.n, t));
      path.push(t);
      if (rec(d - 1)) { s.applyMove(P(s.n, invertToken(t))); return true; }
      path.pop();
      s.applyMove(P(s.n, invertToken(t)));
    }
    return false;
  };
  for (let d = 3; d <= 4; d++) {
    if (rec(d)) {
      return cand([{ label: 'Coloca las dos últimas', moves: path.slice() }, { label: 'Desplaza las mitades', moves: [found[0]] },
        { label: "R F' U R' F", moves: T(found[1]) }, { label: 'Junta las mitades', moves: [found[2]] }]);
    }
  }
  return null;
}

function edges(p) {
  const s = p.s;
  if (!unpaired(s).length) return p.skip('aristas', 'Las doce aristas ya estaban emparejadas.');
  const cs = s.cubies.filter((c) => c.type === 'center').map((c) => c.id);
  const cands = pairCands();
  for (let guard = 0; unpaired(s).length && guard < 24; guard++) {
    const before = unpaired(s);
    const progress = () => unpaired(s).length < before.length && cs.every((i) => solvedAbs(s, s.cubies[i]));
    let c = first(s, cands, progress);
    if (!c) c = deepLastTwo(s, progress);
    if (!c) throw new Error(`aristas sin solución: ${before.join(' ')}`);
    run(s, c.flat);
    const after = unpaired(s);
    const newly = before.filter((k) => !after.includes(k));
    const piece = s.cubies.find((q) => q.type === 'edge' && newly.includes(slotKey(s, q)));
    unrun(s, c.flat);
    const left = after.length;
    p.push('aristas', `Arista ${piece ? nameOf(piece) : ''} emparejada${left ? `, quedan ${left}` : ''}`.replace('Arista  ', 'Arista '), c.groups);
  }
}

// ---------- entry point ----------
export function solve(state) {
  const s = state.clone();
  const p = new Plan(s);
  if (s.n === 3) orient(p);
  else { centers(p); edges(p); }
  solveAsThree(p);
  const ok = s.isSolved() && colorFaces(s).U === 'U' && colorFaces(s).F === 'F';
  return { segments: p.segs, solved: ok, moves: p.segs.reduce((t, x) => t + (x.groups ? x.groups.reduce((u, g) => u + g.moves.length, 0) : 0), 0) };
}

export function serialize(state) { return { n: state.n, cubies: state.cubies.map((c) => ({ pos: c.pos, basis: c.basis })) }; }
export function deserialize({ n, cubies }) {
  const s = new CubeState(n);
  s.cubies.forEach((c, i) => { c.pos = cubies[i].pos.slice(); c.basis = cubies[i].basis.map((b) => b.slice()); });
  return s;
}
