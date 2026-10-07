// Logical NxN cube model. No rendering here: the same module runs in the
// browser and in the Node verification tests.
//
// Coordinates are "doubled" integers so that even and odd cubes share one
// grid: for n = 3 the layers are -2, 0, 2 and for n = 4 they are -3, -1, 1, 3.

export const FACE_COLORS = {
  U: '#FFD21F', // yellow
  D: '#F7F8FA', // white
  F: '#00A651', // green
  B: '#1258D6', // blue
  R: '#FF6A13', // orange
  L: '#D3203A', // red
};

export const FACE_NAMES = {
  U: 'amarillo', D: 'blanco', F: 'verde', B: 'azul', R: 'naranja', L: 'rojo',
};

export const FACE_NORMALS = {
  U: [0, 1, 0], D: [0, -1, 0],
  R: [1, 0, 0], L: [-1, 0, 0],
  F: [0, 0, 1], B: [0, 0, -1],
};

// axis: 0 = x, 1 = y, 2 = z. side: +1 or -1. dir: quarter-turn sign
// (+1 = +90 degrees by the right-hand rule) for the clockwise face turn.
const FACE_DEF = {
  R: { axis: 0, side: 1, dir: -1 },
  L: { axis: 0, side: -1, dir: 1 },
  U: { axis: 1, side: 1, dir: -1 },
  D: { axis: 1, side: -1, dir: 1 },
  F: { axis: 2, side: 1, dir: -1 },
  B: { axis: 2, side: -1, dir: 1 },
};
const SLICE_DEF = { M: 'L', E: 'D', S: 'F' };
const ROT_DEF = { x: 'R', y: 'U', z: 'F' };

export function normalFace(v) {
  for (const [k, n] of Object.entries(FACE_NORMALS)) {
    if (n[0] === v[0] && n[1] === v[1] && n[2] === v[2]) return k;
  }
  return null;
}

// Rotates `v` by q quarter turns (+90 degrees each, right-hand rule) about
// an axis. Closed form instead of a loop: the solver calls this millions of
// times.
export function rotateVec(v, axis, q) {
  const out = v.slice();
  rotateInPlace(out, axis, q);
  return out;
}

function rotateInPlace(v, axis, q) {
  const k = ((q % 4) + 4) % 4;
  if (!k) return;
  const x = v[0]; const y = v[1]; const z = v[2];
  if (axis === 0) {
    if (k === 1) { v[1] = -z; v[2] = y; } else if (k === 2) { v[1] = -y; v[2] = -z; } else { v[1] = z; v[2] = -y; }
  } else if (axis === 1) {
    if (k === 1) { v[0] = z; v[2] = -x; } else if (k === 2) { v[0] = -x; v[2] = -z; } else { v[0] = -z; v[2] = x; }
  } else if (k === 1) { v[0] = -y; v[1] = x; } else if (k === 2) { v[0] = -x; v[1] = -y; } else { v[0] = y; v[1] = -x; }
}

const TOKEN_RE = /^([URFDLB]w|[URFDLB]|[urfdlb]|[MES]|[xyz])(2'|2|')?$/;

export function tokenize(alg) {
  if (!alg) return [];
  return alg
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function invertToken(t) {
  if (t.endsWith("2'")) return t.slice(0, -1);
  if (t.endsWith('2')) return t;
  if (t.endsWith("'")) return t.slice(0, -1);
  return t + "'";
}

export function invertAlg(alg) {
  return tokenize(alg).reverse().map(invertToken).join(' ');
}

// Resolves a move token into { axis, layers (doubled coords), q }.
export function parseMove(token, n) {
  const m = TOKEN_RE.exec(token);
  if (!m) throw new Error(`Movimiento no reconocido: ${token}`);
  const base = m[1];
  const suffix = m[2] || '';
  const max = n - 1;
  let face;
  let layers;
  if (ROT_DEF[base]) {
    face = ROT_DEF[base];
    layers = null; // whole cube
  } else if (SLICE_DEF[base]) {
    face = SLICE_DEF[base];
    layers = [];
    for (let c = -max + 2; c <= max - 2; c += 2) layers.push(c);
  } else {
    const upper = base[0].toUpperCase();
    face = upper;
    const { side } = FACE_DEF[upper];
    const depth = base.endsWith('w') ? [0, 1] : base === base.toLowerCase() ? [1] : [0];
    layers = depth.map((k) => side * (max - 2 * k));
  }
  const { axis, dir, side } = FACE_DEF[face];
  const times = suffix.startsWith('2') ? 2 : 1;
  const sign = suffix === "'" ? -1 : 1;
  // `side` names the face whose clockwise turn defines this move (M -> L).
  return { axis, layers, q: dir * sign * times, token, face, side };
}

export class CubeState {
  constructor(n) {
    this.n = n;
    this.cubies = [];
    const max = n - 1;
    let id = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (let k = 0; k < n; k++) {
          const p = [2 * i - max, 2 * j - max, 2 * k - max];
          if (!p.some((c) => Math.abs(c) === max)) continue;
          const faces = [];
          if (p[0] === max) faces.push('R');
          if (p[0] === -max) faces.push('L');
          if (p[1] === max) faces.push('U');
          if (p[1] === -max) faces.push('D');
          if (p[2] === max) faces.push('F');
          if (p[2] === -max) faces.push('B');
          this.cubies.push({
            id: id++,
            home: p.slice(),
            pos: p.slice(),
            // Images of the unit x, y, z vectors (orientation matrix columns).
            basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            faces,
            type: faces.length === 3 ? 'corner' : faces.length === 2 ? 'edge' : 'center',
          });
        }
      }
    }
  }

  clone() {
    const c = new CubeState(this.n);
    c.cubies.forEach((q, i) => {
      const s = this.cubies[i];
      q.pos = s.pos.slice();
      q.basis = s.basis.map((b) => b.slice());
    });
    return c;
  }

  affected(move) {
    if (!move.layers) return this.cubies.slice();
    return this.cubies.filter((c) => move.layers.includes(c.pos[move.axis]));
  }

  applyMove(move) {
    const m = typeof move === 'string' ? parseMove(move, this.n) : move;
    for (const c of this.cubies) {
      if (m.layers && !m.layers.includes(c.pos[m.axis])) continue;
      rotateInPlace(c.pos, m.axis, m.q);
      for (const b of c.basis) rotateInPlace(b, m.axis, m.q);
    }
    return m;
  }

  apply(alg) {
    for (const t of tokenize(alg)) this.applyMove(t);
    return this;
  }

  // Current outward normal of the sticker whose home face is `face`.
  stickerNormal(cubie, face) {
    const h = FACE_NORMALS[face];
    const out = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      if (!h[a]) continue;
      for (let r = 0; r < 3; r++) out[r] += cubie.basis[a][r] * h[a];
    }
    return out;
  }

  // Map "x,y,z|face" -> home color face, one entry per visible sticker.
  facelets() {
    const map = new Map();
    for (const c of this.cubies) {
      for (const f of c.faces) {
        const nf = normalFace(this.stickerNormal(c, f));
        map.set(`${c.pos.join(',')}|${nf}`, f);
      }
    }
    return map;
  }

  isSolved() {
    const seen = {};
    for (const [key, color] of this.facelets()) {
      const face = key.split('|')[1];
      if (seen[face] && seen[face] !== color) return false;
      seen[face] = color;
    }
    return true;
  }
}

// Number of facelets that differ between two states (same n).
export function faceletDiff(a, b) {
  const fa = a.facelets();
  const fb = b.facelets();
  let d = 0;
  for (const [k, v] of fa) if (fb.get(k) !== v) d++;
  return d;
}

// A piece is "in place" when every sticker points to the face of its own
// color. The guide never rotates the whole cube inside a case, so the face
// letters stay fixed and this check is exact for what the eye sees.
export function pieceSolved(state, cubie) {
  return cubie.faces.every((f) => normalFace(state.stickerNormal(cubie, f)) === f);
}
