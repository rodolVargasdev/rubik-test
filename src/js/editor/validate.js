// Validation of a painted cube and its conversion to a CubeState. Pure module
// (browser and Node).
//
// A painted cube is legal when every physical piece exists exactly once and the
// whole is reachable by turning. Checks, in order, with a message per problem
// that names the piece and where it sits:
//   1. color counts (n*n of each) and fixed 3x3 centers
//   2. each corner/edge position holds a piece that exists (no repeated or
//      opposite colors, colors in the right cyclic order for corners); on the
//      4x4 each wing is told apart from its mirror twin by where it sits
//   3. no piece appears twice
//   4. only if all of that holds: corner twist sum (3x3 and 4x4), edge flip sum
//      and corner/edge permutation parity (3x3 only; on the 4x4 identical
//      centers and distinguishable wings absorb both)
import { CubeState, FACE_NAMES, FACE_NORMALS } from '../cube-core.js';
import { FACES, layout } from './facelets.js';

const ORDER = ['U', 'D', 'F', 'B', 'R', 'L'];
const FACE_ES = { U: 'arriba', D: 'abajo', F: 'frente', B: 'atrás', R: 'derecha', L: 'izquierda' };
const FEM = { U: 'amarilla', D: 'blanca', F: 'verde', B: 'azul', R: 'naranja', L: 'roja' };
const PLURAL = { U: 'amarillos', D: 'blancos', F: 'verdes', B: 'azules', R: 'naranjas', L: 'rojos' };
const OPPOSITE = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' };
const NUM = { 1: 'un', 2: 'dos', 3: 'tres' };
const AXIS_SIDES = [['derecha', 'izquierda'], ['arriba', 'abajo'], ['frente', 'atrás']];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const axisOf = (v) => v.findIndex((c) => c !== 0);
const sameVec = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------- names ----------
const facesOf = (stickers) => stickers.map((s) => s.face).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

function posName(p, n) {
  const faces = facesOf(p.stickers).map((f) => FACE_ES[f]);
  if (p.type === 'corner') return `la esquina de ${faces.join(', ')}`;
  if (p.type === 'edge') {
    const along = [0, 1, 2].find((a) => p.stickers.every((s) => s.normal[a] === 0));
    const edge = `la arista de ${faces[0]} y ${faces[1]}`;
    if (n === 3) return edge;
    return `la mitad ${AXIS_SIDES[along][p.pos[along] > 0 ? 0 : 1]} de ${edge}`;
  }
  return `el centro de ${faces[0]}`;
}

function pieceName(cubie, n) {
  const faces = cubie.faces.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const colors = faces.map((f) => FEM[f]);
  if (cubie.type === 'corner') return `la esquina ${colors[0]}, ${colors[1]} y ${colors[2]}`;
  const edge = `la arista ${colors[0]} y ${colors[1]}`;
  if (n === 3) return edge;
  const along = [0, 1, 2].find((a) => cubie.faces.every((f) => FACE_NORMALS[f][a] === 0));
  return `la mitad ${AXIS_SIDES[along][cubie.home[along] > 0 ? 0 : 1]} de ${edge}`;
}

// ---------- rotation from sticker correspondences ----------
// pairs: [[homeNormal, currentNormal], ...]. Returns the orientation matrix as
// CubeState `basis` (images of the unit vectors) or null when the pairs do not
// describe a proper rotation (a mirrored piece).
function basisFrom(pairs) {
  const [n1, g1] = pairs[0];
  const [n2, g2] = pairs[1];
  const ns = [n1, n2, cross(n1, n2)];
  const gs = [g1, g2, cross(g1, g2)];
  const basis = [0, 1, 2].map((a) => [0, 1, 2].map((r) => ns.reduce((t, nk, k) => t + gs[k][r] * nk[a], 0)));
  if (pairs[2]) {
    const [n3, g3] = pairs[2];
    const img = [0, 1, 2].map((r) => basis.reduce((t, col, a) => t + col[r] * n3[a], 0));
    if (!sameVec(img, g3)) return null;
  }
  return basis;
}
const applyBasis = (basis, v) => [0, 1, 2].map((r) => basis.reduce((t, col, a) => t + col[r] * v[a], 0));

// The 24 proper rotations as bases, for centers that only need "some" orientation.
const ROTATIONS = (() => {
  const out = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const pparity = [1, -1, -1, 1, 1, -1];
  perms.forEach((pm, pi) => {
    for (let m = 0; m < 8; m++) {
      const sg = [m & 1 ? -1 : 1, m & 2 ? -1 : 1, m & 4 ? -1 : 1];
      if (sg[0] * sg[1] * sg[2] * pparity[pi] !== 1) continue;
      out.push([0, 1, 2].map((a) => { const v = [0, 0, 0]; v[pm[a]] = sg[a]; return v; }));
    }
  });
  return out;
})();

// ---------- parities ----------
function permParity(perm) {
  const seen = new Array(perm.length).fill(false);
  let odd = 0;
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = perm[j]) { seen[j] = true; len++; }
    odd += (len - 1) % 2;
  }
  return odd % 2;
}
const PRIORITY = { 1: 0, 2: 1, 0: 2 }; // U/D, then F/B, then R/L

// ---------- main ----------
// Returns { ok, incomplete, errors: [{ code, message, stickers: [{ face, idx }] }], state }.
// `incomplete` counts unpainted stickers; while it is above 0 only color
// overflows are reported.
export function validateGrid(grid, n) {
  const L = layout(n);
  const errors = [];
  const add = (code, message, stickers = []) => errors.push({ code, message, stickers });
  const stickersOf = (p) => p.stickers.map((s) => ({ face: s.face, idx: s.idx }));

  // 1. counts and fixed centers
  const counts = Object.fromEntries(FACES.map((f) => [f, 0]));
  const where = Object.fromEntries(FACES.map((f) => [f, []]));
  let empty = 0;
  for (const face of FACES) {
    grid[face].forEach((c, idx) => {
      if (!c) { empty++; return; }
      counts[c]++;
      where[c].push({ face, idx });
    });
  }
  if (n === 3) {
    for (const face of FACES) {
      const c = grid[face][4];
      if (c && c !== face) add('center', `El centro de ${FACE_ES[face]} debe ser ${FACE_NAMES[face]}: los centros del 3x3 no cambian.`, [{ face, idx: 4 }]);
    }
  }
  const target = n * n;
  const wrong = FACES.filter((c) => (empty ? counts[c] > target : counts[c] !== target));
  if (wrong.length) {
    const parts = wrong.map((c, i) => `${counts[c]} ${i === 0 ? 'stickers ' : ''}${PLURAL[c]}`);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0];
    add('count', `Hay ${list}: deben ser ${target} de cada color.`, wrong.flatMap((c) => (counts[c] > target ? where[c] : [])));
  }
  if (empty) return { ok: false, incomplete: empty, errors, state: null };

  // 2. every corner/edge position holds an existing piece
  const byColors = new Map();
  for (const c of L.solved.cubies) {
    if (c.type === 'center') continue;
    const k = c.faces.slice().sort().join('');
    if (!byColors.has(k)) byColors.set(k, []);
    byColors.get(k).push(c);
  }
  const used = new Map(); // cubie id -> [{ p, basis }]
  const centers = [];
  for (const p of L.positions.values()) {
    if (p.type === 'center') { if (n === 4) centers.push(p); continue; }
    const st = p.stickers.map((s) => ({ ...s, color: grid[s.face][s.idx] }));
    const colors = st.map((s) => s.color);
    const name = posName(p, n);
    const distinct = new Set(colors);
    if (distinct.size < colors.length) {
      const rep = colors.find((c, i) => colors.indexOf(c) !== i);
      const times = colors.filter((c) => c === rep).length;
      add('repeat', `${cap(name)} tiene ${NUM[times]} stickers ${PLURAL[rep]}: esa pieza no existe.`, stickersOf(p));
      continue;
    }
    const opp = colors.find((c) => colors.includes(OPPOSITE[c]));
    if (opp) {
      add('opposite', `${cap(name)} mezcla ${FACE_NAMES[opp]} y ${FACE_NAMES[OPPOSITE[opp]]}, que están en caras opuestas: esa pieza no existe.`, stickersOf(p));
      continue;
    }
    const cands = byColors.get(colors.slice().sort().join(''));
    const pairs = st.map((s) => [FACE_NORMALS[s.color], s.normal]);
    const basis = basisFrom(pairs);
    if (!basis) {
      add('mirror', `${cap(name)} tiene sus colores en el orden contrario (${colors.map((c) => FACE_NAMES[c]).join(', ')}): esa pieza no existe.`, stickersOf(p));
      continue;
    }
    const cubie = cands.find((c) => sameVec(applyBasis(basis, c.home), p.pos));
    if (!cubie) { add('missing', `${cap(name)} no corresponde a ninguna pieza.`, stickersOf(p)); continue; }
    if (!used.has(cubie.id)) used.set(cubie.id, []);
    used.get(cubie.id).push({ p, basis, st, cubie });
  }

  // 3. duplicates
  for (const [, list] of used) {
    if (list.length < 2) continue;
    const where2 = list.map((u) => posName(u.p, n)).join(' y ');
    add('duplicate', `${cap(pieceName(list[0].cubie, n))} aparece ${NUM[list.length] === 'un' ? 'una vez' : `${NUM[list.length]} veces`}: en ${where2}.`, list.flatMap((u) => stickersOf(u.p)));
  }
  if (errors.length) return { ok: false, incomplete: 0, errors, state: null };

  // 4. parities
  const placed = [...used.values()].map((l) => l[0]);
  const corners = placed.filter((u) => u.cubie.type === 'corner');
  const edges = placed.filter((u) => u.cubie.type === 'edge');
  const names = (list) => list.map((u) => posName(u.p, n)).join('; ');

  const twist = corners.map((u) => {
    const ref = u.st.find((s) => s.color === 'U' || s.color === 'D');
    const s = Math.sign(u.p.pos[0] * u.p.pos[1] * u.p.pos[2]);
    return (s > 0 ? [1, 2, 0] : [1, 0, 2]).indexOf(axisOf(ref.normal));
  });
  if (twist.reduce((a, b) => a + b, 0) % 3) {
    const bad = corners.filter((_, i) => twist[i]);
    add('twist', bad.length === 1
      ? `Una esquina está girada: revisa ${posName(bad[0].p, n)}.`
      : `Las esquinas giradas no cuadran, falta o sobra un tercio de vuelta: revisa ${names(bad)}.`, bad.flatMap((u) => stickersOf(u.p)));
  }

  if (n === 3) {
    const flip = edges.map((u) => {
      const [a, b] = u.cubie.faces;
      const homeHi = PRIORITY[axisOf(FACE_NORMALS[a])] < PRIORITY[axisOf(FACE_NORMALS[b])] ? a : b;
      const axes = u.st.map((s) => axisOf(s.normal));
      const posHi = PRIORITY[axes[0]] < PRIORITY[axes[1]] ? axes[0] : axes[1];
      return axisOf(u.st.find((s) => s.color === homeHi).normal) === posHi ? 0 : 1;
    });
    if (flip.reduce((x, y) => x + y, 0) % 2) {
      const bad = edges.filter((_, i) => flip[i]);
      add('flip', bad.length === 1
        ? `Una arista está volteada: revisa ${posName(bad[0].p, n)}.`
        : `Las aristas volteadas no cuadran, falta o sobra una: revisa ${names(bad)}.`, bad.flatMap((u) => stickersOf(u.p)));
    }
    // Index a position by the cubie that sits there when solved, so the
    // identity arrangement is the identity permutation.
    const slotOf = (ids) => new Map(ids.map((id, i) => [L.solved.cubies[id].home.join(','), i]));
    const cornerIds = L.solved.cubies.filter((c) => c.type === 'corner').map((c) => c.id);
    const edgeIds = L.solved.cubies.filter((c) => c.type === 'edge').map((c) => c.id);
    const permOf = (ids) => { const at = slotOf(ids); return ids.map((id) => at.get(used.get(id)[0].p.key)); };
    if (permParity(permOf(cornerIds)) !== permParity(permOf(edgeIds))) {
      add('parity', 'Dos piezas están intercambiadas: imposible sin desarmar el cubo. Revisa un par de esquinas o de aristas que estén cambiadas entre sí.');
    }
  }
  if (errors.length) return { ok: false, incomplete: 0, errors, state: null };

  // Valid: build the state.
  const state = new CubeState(n);
  for (const [id, [u]] of used) {
    state.cubies[id].pos = u.p.pos.slice();
    state.cubies[id].basis = u.basis.map((b) => b.slice());
  }
  if (n === 4) {
    const free = { };
    for (const f of FACES) free[f] = state.cubies.filter((c) => c.type === 'center' && c.faces[0] === f);
    for (const p of centers) {
      const s = p.stickers[0];
      const color = grid[s.face][s.idx];
      const cubie = free[color].shift();
      const m = ROTATIONS.find((r) => sameVec(applyBasis(r, FACE_NORMALS[color]), s.normal));
      cubie.pos = p.pos.slice();
      cubie.basis = m.map((b) => b.slice());
    }
  }
  return { ok: true, incomplete: 0, errors, state };
}
