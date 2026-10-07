// Puzzle registry: one entry per puzzle the app can teach, paint and solve.
// Views and the solve widget read from here instead of hardcoding 3x3 and 4x4.
// Pure module: no DOM, so the Node tests can import it.
//
// A puzzle provides:
//   id           unique string ('cube3')
//   name         label for toggles and titles ('3x3')
//   kind         model family ('nxn'); puzzles of one kind share model and viewer
//   n            size parameter of the family (layers per edge for 'nxn')
//   createState  () => a fresh solved state (an object with clone/apply/isSolved)
//   guide        the teaching content, or null when there is none yet
//   steps        [[id, title], ...] of the teaching solver, in order
//   solvers      { auto(state) -> plan, quick(state, options) -> result, quickOptions }
//   editor       { netSize, fixedCenters } for the painting view, or null
const REQUIRED = ['id', 'name', 'kind', 'n', 'createState', 'steps', 'solvers'];
const puzzles = new Map();

export function registerPuzzle(def) {
  for (const key of REQUIRED) {
    if (def[key] === undefined || def[key] === null) throw new Error(`El rompecabezas no define "${key}"`);
  }
  if (typeof def.createState !== 'function') throw new Error(`"${def.id}": createState debe ser una función`);
  if (typeof def.solvers.auto !== 'function' || typeof def.solvers.quick !== 'function') {
    throw new Error(`"${def.id}": solvers necesita auto y quick`);
  }
  if (puzzles.has(def.id)) throw new Error(`Ya existe un rompecabezas con el id "${def.id}"`);
  const entry = Object.freeze({ guide: null, editor: null, ...def });
  puzzles.set(def.id, entry);
  return entry;
}

export function getPuzzle(id) {
  const p = puzzles.get(id);
  if (!p) throw new Error(`Rompecabezas desconocido: "${id}"`);
  return p;
}

export const listPuzzles = () => [...puzzles.values()];

// The puzzle of a family for a given size, e.g. nxn + 4 -> the 4x4.
export function findPuzzle(kind, n) {
  return listPuzzles().find((p) => p.kind === kind && p.n === n);
}
