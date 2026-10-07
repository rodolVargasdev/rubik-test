// Registers the built-in puzzles. Import this module (not registry.js alone)
// to get a populated registry.
import { CubeState } from '../cube-core.js';
import { GUIDE_3, GUIDE_4 } from '../content.js';
import { solve, STEPS } from '../solver.js';
import { quickSolve } from '../quick/search.js';
import { registerPuzzle, getPuzzle, listPuzzles, findPuzzle } from './registry.js';

// The NxN family is one implementation parameterized by n: model (CubeState),
// viewer (CubeView) and the quick search are generic; the guide and the
// teaching solver are written per size.
export function registerNxN(n, { guide, steps, solver = solve, quickOptions }) {
  return registerPuzzle({
    id: `cube${n}`,
    name: `${n}x${n}`,
    kind: 'nxn',
    n,
    createState: () => new CubeState(n),
    guide,
    steps,
    solvers: {
      auto: solver,
      quick: quickSolve,
      quickOptions: { timeMs: 2000, target: 0, ...quickOptions },
    },
    editor: { netSize: n, fixedCenters: n === 3 },
  });
}

registerNxN(3, { guide: GUIDE_3, steps: STEPS[3], quickOptions: { target: 20 } });
registerNxN(4, { guide: GUIDE_4, steps: STEPS[4], quickOptions: { timeMs: 4000 } });

export { registerPuzzle, getPuzzle, listPuzzles, findPuzzle };
