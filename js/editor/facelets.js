// Facelet grids for the cube editor: the unfolded net as data. A grid maps each
// face letter to n*n entries (row-major), each one a color letter (the face
// that color belongs to when solved) or null when unpainted. Pure module: it
// runs in the browser and in the Node tests.
//
// Net orientation (the usual cross): U on top; L F R B in the middle row; D
// below. Seen from outside each face, with U up for the side faces and F at
// the bottom edge of U (and the top edge of D).
import { CubeState, FACE_NORMALS, normalFace, pieceSolved } from '../cube-core.js';

export const FACES = ['U', 'L', 'F', 'R', 'B', 'D'];

// Doubled coordinates of the sticker at (row, col) of `face`, same grid as CubeState.
export function slotOf(n, face, idx) {
  const row = Math.floor(idx / n);
  const col = idx % n;
  const max = n - 1;
  const lo = (i) => -max + 2 * i; // grows with the index
  const hi = (i) => max - 2 * i; // shrinks with the index
  const pos = {
    U: [lo(col), max, lo(row)],
    D: [lo(col), -max, hi(row)],
    F: [lo(col), hi(row), max],
    B: [hi(col), hi(row), -max],
    R: [max, hi(row), hi(col)],
    L: [-max, hi(row), lo(col)],
  }[face];
  return { pos, normal: FACE_NORMALS[face] };
}

const layouts = new Map();

// positions: "x,y,z" -> { pos, type, stickers: [{ face, idx, normal }] }
// slotIndex: "x,y,z|face" -> { face, idx }
export function layout(n) {
  let l = layouts.get(n);
  if (l) return l;
  const positions = new Map();
  const slotIndex = new Map();
  for (const face of FACES) {
    for (let idx = 0; idx < n * n; idx++) {
      const { pos, normal } = slotOf(n, face, idx);
      const key = pos.join(',');
      let p = positions.get(key);
      if (!p) { p = { pos, key, stickers: [] }; positions.set(key, p); }
      p.stickers.push({ face, idx, normal });
      slotIndex.set(`${key}|${face}`, { face, idx });
    }
  }
  for (const p of positions.values()) p.type = ['', 'center', 'edge', 'corner'][p.stickers.length];
  l = { positions, slotIndex, solved: new CubeState(n) };
  layouts.set(n, l);
  return l;
}

// The middle sticker of a 3x3 face is a fixed center, not paintable.
export const isFixedCenter = (n, idx) => n === 3 && idx === 4;

export function emptyGrid(n) {
  const g = {};
  for (const f of FACES) g[f] = Array.from({ length: n * n }, (_, i) => (isFixedCenter(n, i) ? f : null));
  return g;
}

export function solvedGrid(n) {
  const g = {};
  for (const f of FACES) g[f] = Array(n * n).fill(f);
  return g;
}

export function cloneGrid(g) {
  return Object.fromEntries(FACES.map((f) => [f, g[f].slice()]));
}

export function gridFromState(state) {
  const { slotIndex } = layout(state.n);
  const g = {};
  for (const f of FACES) g[f] = Array(state.n * state.n).fill(null);
  for (const c of state.cubies) {
    for (const f of c.faces) {
      const nf = normalFace(state.stickerNormal(c, f));
      const slot = slotIndex.get(`${c.pos.join(',')}|${nf}`);
      g[slot.face][slot.idx] = f;
    }
  }
  return g;
}

// The editor holds a 3x3 with yellow up and green in front. A state that was
// rotated as a whole (x, y, z) is turned back so its centers sit at home.
export function holdNormalized(state) {
  if (state.n !== 3) return state;
  const toks = ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'];
  const tries = [[], ...toks.map((t) => [t]), ...toks.flatMap((a) => toks.map((b) => [a, b]))];
  for (const t of tries) {
    const s = state.clone().apply(t.join(' '));
    if (s.cubies.filter((c) => c.type === 'center').every((c) => pieceSolved(s, c))) return s;
  }
  return state;
}
