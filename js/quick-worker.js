// Runs the exact shortest-solution search off the main thread. The page sends
// { state, timeMs } (state = serialize(...)) and gets back the quickSolve result.
import { quickSolve, deserialize } from './quick/search.js';

self.onmessage = (e) => {
  try {
    const { state, timeMs } = e.data;
    self.postMessage({ ok: true, ...quickSolve(deserialize(state), { timeMs }) });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
