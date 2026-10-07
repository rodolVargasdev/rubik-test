// Runs the teaching solver off the main thread so the page never freezes.
import { solve, deserialize } from './solver.js';

self.onmessage = (e) => {
  try {
    self.postMessage({ ok: true, ...solve(deserialize(e.data)) });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
