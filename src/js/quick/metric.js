// The "quick solve" metric: every button of the app costs one move. Whole-cube
// rotations (x, y, z) cost zero and are never part of the search. The generator
// list is derived from parseMove so it cannot drift from the notation.
import { parseMove } from '../cube-core.js';

const SUF = ['', "'", '2'];
const FACES = ['U', 'D', 'R', 'L', 'F', 'B'];

// 3x3 buttons: the six faces and the three middle slices. Wide moves and
// lowercase moves exist only from 4x4 on (on 3x3 they repeat a face or slice).
function bases(n) {
  const out = [...FACES];
  if (n >= 4) out.push(...FACES.map((f) => f + 'w'), ...FACES.map((f) => f.toLowerCase()));
  out.push('M', 'E', 'S');
  return out;
}

// Returns [{ token, base, block, axis, layers }]. `block` identifies the set of
// layers a move turns (same axis and same layers), so two moves of one block
// always merge into a single move.
export function generatorList(n) {
  const blocks = new Map();
  const list = [];
  for (const base of bases(n)) {
    for (const suf of SUF) {
      const token = base + suf;
      const m = parseMove(token, n);
      const bkey = `${m.axis}:${m.layers.slice().sort((a, b) => a - b).join(',')}`;
      if (!blocks.has(bkey)) blocks.set(bkey, blocks.size);
      list.push({ token, base, block: blocks.get(bkey), axis: m.axis, layers: m.layers });
    }
  }
  // Group by block so the order of generators is also the order of blocks.
  return list.sort((a, b) => a.block - b.block);
}

// Two moves of one axis commute when they turn disjoint sets of layers.
export function commute(a, b) {
  return a.axis === b.axis && !a.layers.some((c) => b.layers.includes(c));
}
