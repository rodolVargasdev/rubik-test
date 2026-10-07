// Post-optimization of a 3x3 solution in the app-button metric (see metric.js).
//
// A two-phase solution uses outer faces only. In the app every button costs
// one move and whole-cube rotations cost zero, so two cheap rewrites apply:
//
//  1. Consecutive moves of one axis (R, L, M on x; U, D, E on y; F, B, S on z)
//     commute, so their exponents add per button and cancel when they reach 0.
//  2. A pair of opposite faces R^p L^q that equals a slice move up to a
//     rotation (R L' = M + x) becomes the slice button. The rotation is pushed
//     to the end of the solution and the moves after it are relabelled.
//
// Nothing is trusted: every rewrite is replayed on the cube and discarded when
// the result is not solved, yellow up, green front.
import { CubeState } from '../cube-core.js';

const AXES = [
  { rot: 'x', pos: 'R', neg: 'L', slice: 'M' },
  { rot: 'y', pos: 'U', neg: 'D', slice: 'E' },
  { rot: 'z', pos: 'F', neg: 'B', slice: 'S' },
];
const SUFFIX = ['', '', '2', "'"]; // indexed by quarter turns (1..3) in the button's own direction
const axisOf = (base) => AXES.findIndex((a) => base === a.pos || base === a.neg || base === a.slice);
const tok = (base, e) => base + SUFFIX[e];

function parse(token) {
  const suf = token.slice(1);
  return { base: token[0], e: suf === '' ? 1 : suf === '2' ? 2 : 3 };
}

// Signature of what a sequence does to a solved cube. Pieces are told apart by
// color, so equal signatures mean equal operators (centers' own twist aside).
const sigOf = (tokens) => {
  const s = new CubeState(3);
  for (const t of tokens) s.applyMove(t);
  return [...s.facelets()].map(([k, v]) => `${k}>${v}`).sort().join(';');
};

// The 24 whole-cube rotations with their shortest token list (at most 2).
export const ROTATIONS = (() => {
  const out = [{ tokens: [], sig: sigOf([]) }];
  const seen = new Set([out[0].sig]);
  for (let head = 0; head < out.length; head++) {
    for (const t of ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2']) {
      const tokens = [...out[head].tokens, t];
      const sig = sigOf(tokens);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ tokens, sig });
    }
  }
  if (out.length !== 24 || out.some((r) => r.tokens.length > 2)) throw new Error('Rotaciones inconsistentes');
  return out;
})();

// Shortest token list for the net effect of a list of rotation tokens.
export function canonicalRotation(tokens) {
  const sig = sigOf(tokens);
  return ROTATIONS.find((r) => r.sig === sig).tokens.slice();
}

const BUTTONS = ['U', 'D', 'R', 'L', 'F', 'B', 'M', 'E', 'S'].flatMap((b) => [b, b + "'", b + '2']);
const conjCache = new Map();

// Token t' such that "t' then rot" equals "rot then t". Moves written for the
// cube after the rotation become moves for the cube before it.
export function conjugate(token, rotTokens) {
  const key = `${rotTokens.join(' ')}|${token}`;
  let r = conjCache.get(key);
  if (r) return r;
  const want = sigOf([...rotTokens, token]);
  r = BUTTONS.find((c) => sigOf([c, ...rotTokens]) === want);
  if (!r) throw new Error(`Sin conjugado para ${token} tras ${rotTokens.join(' ')}`);
  conjCache.set(key, r);
  return r;
}

// Solved, yellow up, green front after moves + rotation.
export function replaySolves(state, moves, rotation) {
  const s = state.clone();
  for (const t of moves) s.applyMove(t);
  for (const t of rotation) s.applyMove(t);
  if (!s.isSolved()) return false;
  for (const [key, color] of s.facelets()) {
    const face = key.split('|')[1];
    if ((face === 'U' || face === 'F') && color !== face) return false;
  }
  return true;
}

// For each axis and pair of exponents (p of the positive face, q of the
// negative one): the slice exponent s and rotation exponent a with
// pos^p neg^q == slice^s rot^a, found by brute force (never written by hand).
const PAIR = AXES.map((ax) => {
  const rules = {};
  for (let p = 1; p <= 3; p++) {
    for (let q = 1; q <= 3; q++) {
      const want = sigOf([tok(ax.pos, p), tok(ax.neg, q)]);
      for (let s = 1; s <= 3; s++) {
        for (let a = 0; a <= 3; a++) {
          const seq = [tok(ax.slice, s), ...(a ? [tok(ax.rot, a)] : [])];
          if (sigOf(seq) === want) rules[`${p}${q}`] = { s, a };
        }
      }
    }
  }
  return rules;
});

// Splits a move list into runs of one axis, adding the exponents per button.
function toRuns(moves) {
  const runs = [];
  for (const t of moves) {
    const { base, e } = parse(t);
    const axis = axisOf(base);
    let run = runs[runs.length - 1];
    if (!run || run.axis !== axis) { run = { axis, exps: { [AXES[axis].pos]: 0, [AXES[axis].slice]: 0, [AXES[axis].neg]: 0 } }; runs.push(run); }
    run.exps[base] = (run.exps[base] + e) % 4;
  }
  return runs;
}

function fromRuns(runs) {
  const out = [];
  for (const { axis, exps } of runs) {
    const ax = AXES[axis];
    for (const b of [ax.pos, ax.slice, ax.neg]) if (exps[b]) out.push(tok(b, exps[b]));
  }
  return out;
}

const simplify = (moves) => fromRuns(toRuns(moves));

// Every one-pair rewrite of `moves`, as { moves, rotation } candidates.
function* rewrites(moves, rotation) {
  const runs = toRuns(moves);
  for (let i = 0; i < runs.length; i++) {
    const ax = AXES[runs[i].axis];
    const p = runs[i].exps[ax.pos];
    const q = runs[i].exps[ax.neg];
    const rule = p && q ? PAIR[runs[i].axis][`${p}${q}`] : null;
    if (!rule) continue;
    const head = fromRuns(runs.slice(0, i));
    const swapped = { axis: runs[i].axis, exps: { ...runs[i].exps, [ax.pos]: 0, [ax.neg]: 0 } };
    swapped.exps[ax.slice] = (swapped.exps[ax.slice] + rule.s) % 4;
    const turn = rule.a ? [tok(ax.rot, rule.a)] : [];
    const tail = fromRuns(runs.slice(i + 1)).map((t) => conjugate(t, turn));
    yield {
      moves: simplify([...head, ...fromRuns([swapped]), ...tail]),
      rotation: canonicalRotation([...turn, ...rotation]),
    };
  }
}

// Returns { moves, rotation, rewrites, rejected }. `hooks.mutate` is a test
// hook that may corrupt a candidate before the replay guard sees it.
export function optimizeSolution(state, moves, rotation, hooks = {}) {
  let cur = { moves: moves.slice(), rotation: rotation.slice() };
  let accepted = 0;
  let rejected = 0;
  if (!replaySolves(state, cur.moves, cur.rotation)) return { ...cur, rewrites: 0, rejected: 0 };
  const merged = simplify(cur.moves);
  if (replaySolves(state, merged, cur.rotation)) cur.moves = merged; else rejected++;
  for (let progress = true; progress;) {
    progress = false;
    for (let cand of rewrites(cur.moves, cur.rotation)) {
      if (hooks.mutate) cand = hooks.mutate(cand);
      if (cand.moves.length < cur.moves.length && replaySolves(state, cand.moves, cand.rotation)) {
        cur = cand;
        accepted++;
        progress = true;
        break;
      }
      rejected++;
    }
  }
  return { ...cur, rewrites: accepted, rejected };
}
