// Runs the exact shortest-solution search off the main thread. The page sends
// { state, timeMs, target } (state = serialize(...)) and gets back the
// quickSolve result. { warm: n } builds the tables for size n ahead of time.
import { quickSolve, deserialize, prepare } from './quick/search.js';
import { prepareTwoPhase } from './quick/two-phase.js';
import { prepareReduction } from './quick/reduction4.js';

self.onmessage = (e) => {
  try {
    if (e.data.warm) {
      prepare(e.data.warm);
      if (e.data.warm === 3) prepareTwoPhase();
      if (e.data.warm === 4) prepareReduction();
      self.postMessage({ warmed: true });
      return;
    }
    const { state, timeMs, target } = e.data;
    self.postMessage({ ok: true, ...quickSolve(deserialize(state), { timeMs, target }) });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
