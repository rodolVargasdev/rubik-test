// "Armado automático" and "Armado rápido" widget, shared by the notation view,
// both guides and the editor. It renders its own bar (buttons + speed) and
// narration panel inside `host` and drives whatever CubeView `getView()` returns.
import { solve, serialize } from './solver.js';
import { findPuzzle } from './puzzles/index.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const movesOf = (segs) => segs.reduce((t, x) => t + (x.groups ? x.groups.reduce((u, g) => u + g.moves.length, 0) : 0), 0);
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const puzzleOf = (n) => findPuzzle('nxn', n);

function safeGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export function mountAutoSolve(host, { getView, getN, setCaption, onStart = () => {}, onEnd = () => {}, idleSpeed = 0.85, stageEl = null }) {
  host.innerHTML = `
    <div class="solver-bar">
      <button class="btn btn-primary as-run" title="Arma el cubo desde donde está, paso a paso y con el método de la guía">Armado automático</button>
      <button class="btn as-quick" title="El camino más corto: cada botón cuenta un giro; las rotaciones no cuentan">Armado rápido</button>
      <div class="speed" role="group" aria-label="Velocidad del armado">
        <button data-s="0.6">Lento</button><button data-s="1.3">Normal</button><button data-s="3.2">Rápido</button>
      </div>
    </div>
    <section class="solver" hidden aria-live="polite">
      <div class="sv-head"><strong class="sv-title"></strong><span class="sv-count"></span></div>
      <p class="sv-label"></p>
      <p class="sv-status" hidden></p>
      <div class="alg sv-alg"></div>
      <div class="sv-extra" hidden></div>
      <ol class="sv-steps"></ol>
    </section>`;
  const q = (s) => host.querySelector(s);
  const qa = (s) => [...host.querySelectorAll(s)];
  const runBtn = q('.as-run');
  const quickBtn = q('.as-quick');
  const panel = q('.solver');
  const runTitle = runBtn.title;
  const quickTitle = quickBtn.title;

  let solving = false;
  let kind = null; // 'auto' | 'quick' while solving
  let searching = false; // the quick search is still running in its worker
  let enabled = true;
  let runId = 0;
  let worker = null;
  let quickWorker = null;
  let cancelSearch = null;
  const speedKey = 'rubik-auto-speed';
  let speed = safeGet(speedKey, 1.3);
  const markSpeed = () => qa('.speed button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.s) === speed)));
  markSpeed();
  q('.speed').addEventListener('click', (e) => {
    const sp = Number(e.target.closest('[data-s]')?.dataset.s);
    if (!sp) return;
    speed = sp;
    safeSet(speedKey, sp);
    markSpeed();
    if (solving) getView().speed = sp;
  });

  function refreshButtons() {
    runBtn.textContent = solving && kind === 'auto' ? 'Detener' : 'Armado automático';
    quickBtn.textContent = solving && kind === 'quick' ? (searching ? 'Cancelar' : 'Detener') : 'Armado rápido';
    runBtn.classList.toggle('btn-stop', solving && kind === 'auto');
    quickBtn.classList.toggle('btn-stop', solving && kind === 'quick');
    runBtn.disabled = solving ? kind !== 'auto' : !enabled;
    quickBtn.disabled = solving ? kind !== 'quick' : !enabled;
    runBtn.title = enabled ? runTitle : 'Disponible cuando el cubo sea válido';
    quickBtn.title = enabled ? quickTitle : 'Disponible cuando el cubo sea válido';
  }

  function setSolving(on, which = 'auto') {
    solving = on;
    kind = on ? which : null;
    if (!on) searching = false;
    refreshButtons();
    if (!on) getView().speed = idleSpeed;
  }

  function stop(message = 'Armado detenido. Puedes seguir girando o volver a pedirlo.') {
    if (!solving) return false;
    runId++;
    if (searching) { cancelSearch?.(); panel.hidden = true; }
    setSolving(false);
    const view = getView();
    view.setState(view.state);
    qa('.sv-step').forEach((x) => x.classList.remove('current'));
    setCaption(message);
    onEnd({ completed: false });
    return true;
  }

  async function solveHere(state) {
    try { return { ok: true, ...solve(state) }; } catch (err) { return { ok: false, error: err.message }; }
  }
  function computePlan(state) {
    return new Promise((resolve) => {
      try {
        worker ||= new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => resolve(e.data);
        worker.onerror = () => { worker = null; solveHere(state).then(resolve); };
        worker.postMessage(serialize(state));
      } catch { solveHere(state).then(resolve); }
    });
  }

  async function run() {
    if (solving) { stop(); return; }
    const n = getN();
    const view = getView();
    const steps = puzzleOf(n).steps;
    const stepTitle = (id) => steps.find(([k]) => k === id)?.[1] || id;
    const my = ++runId;
    setSolving(true, 'auto');
    onStart();
    // On narrow screens the stage scrolls away; bring it back into view.
    if (stageEl && window.innerWidth < 980) stageEl.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    await view.queue;
    if (my !== runId) return;
    setCaption(n === 4 ? 'Calculando el plan; el 4x4 puede tardar unos segundos' : 'Calculando el plan');
    const res = await computePlan(view.state.clone());
    if (my !== runId) return;
    if (!res.ok) { setSolving(false); setCaption(`No se encontró un plan: ${res.error}`); onEnd({ completed: false }); return; }

    panel.hidden = false;
    q('.sv-alg').classList.remove('long');
    q('.sv-status').hidden = true;
    q('.sv-extra').hidden = true;
    q('.sv-steps').hidden = false;
    q('.sv-steps').innerHTML = steps.map(([id, title], i) => {
      const segs = res.segments.filter((x) => x.step === id);
      const skipped = segs.length > 0 && segs.every((x) => x.skipped);
      return `<li class="sv-step${skipped ? ' skipped' : ''}" data-step="${id}">
        <span class="sv-dot" aria-hidden="true">${n === 3 ? i : i + 1}</span>
        <div><strong>${title}</strong><small>${skipped ? `Se omite. ${segs[0].reason}` : `${movesOf(segs)} giros`}</small></div>
      </li>`;
    }).join('');
    q('.sv-count').textContent = `${res.moves} giros en total`;
    if (res.moves === 0) {
      q('.sv-title').textContent = 'Ya estaba armado';
      q('.sv-label').textContent = 'No hace falta ningún paso: cada uno se omite con su motivo.';
      q('.sv-alg').innerHTML = '';
      setCaption('El cubo ya está armado.');
      setSolving(false);
      onEnd({ completed: true });
      return;
    }

    view.speed = speed;
    let played = 0;
    for (const seg of res.segments) {
      if (my !== runId) return;
      const li = q(`.sv-step[data-step="${seg.step}"]`);
      qa('.sv-step').forEach((x) => x.classList.toggle('current', x === li));
      q('.sv-title').textContent = stepTitle(seg.step);
      if (seg.skipped) {
        q('.sv-label').textContent = `Se omite: ${seg.reason}`;
        q('.sv-alg').innerHTML = '';
        setCaption(`Se omite: ${stepTitle(seg.step)}`, seg.reason);
        await wait(1600 / view.speed);
        continue;
      }
      q('.sv-label').textContent = seg.label;
      let k = 0;
      q('.sv-alg').innerHTML = seg.groups.map((g) => `<div class="group"><div class="chips">${g.moves.map((t) => `<span class="chip" data-k="${k++}">${t}</span>`).join('')}</div><span class="glabel">${g.label || ''}</span></div>`).join('');
      setCaption(stepTitle(seg.step), seg.label);
      const chips = qa('.sv-alg .chip');
      const groups = qa('.sv-alg .group');
      let idx = 0;
      for (let gi = 0; gi < seg.groups.length; gi++) {
        groups.forEach((g, j) => g.classList.toggle('active', j === gi));
        for (const t of seg.groups[gi].moves) {
          if (my !== runId) return;
          chips.forEach((c, j) => { c.classList.toggle('done', j < idx); c.classList.toggle('now', j === idx); });
          const ok = await view.turn(t);
          if (!ok || my !== runId) return;
          idx++;
          played++;
          q('.sv-count').textContent = `Giro ${played} de ${res.moves}`;
        }
      }
      chips.forEach((c) => { c.classList.remove('now'); c.classList.add('done'); });
      li?.classList.add('ok');
      await wait(450 / view.speed);
    }
    if (my !== runId) return;
    qa('.sv-step').forEach((x) => x.classList.remove('current'));
    q('.sv-title').textContent = 'Armado';
    q('.sv-label').textContent = `Listo en ${res.moves} giros, con los mismos pasos de la guía.`;
    q('.sv-alg').innerHTML = '';
    setCaption(`Armado en ${res.moves} giros.`);
    setSolving(false);
    onEnd({ completed: true });
  }

  // ---------- quick solve ----------
  // The search runs in a module worker; cancelling terminates it, and the next
  // search creates a fresh one. If workers are unavailable it runs inline.
  function computeQuick(state, n) {
    const opts = { timeMs: 2000, target: 0, ...puzzleOf(n).solvers.quickOptions };
    return new Promise((resolve) => {
      cancelSearch = () => { quickWorker?.terminate(); quickWorker = null; cancelSearch = null; resolve({ cancelled: true }); };
      const inline = async () => {
        try {
          const { quickSolve } = await import('./quick/search.js');
          cancelSearch = null;
          resolve({ ok: true, ...quickSolve(state, opts) });
        } catch (err) { cancelSearch = null; resolve({ ok: false, error: err.message }); }
      };
      try {
        quickWorker ||= new Worker(new URL('./quick-worker.js', import.meta.url), { type: 'module' });
        quickWorker.onmessage = (e) => { if (e.data.warmed) return; cancelSearch = null; resolve(e.data); };
        quickWorker.onerror = () => { quickWorker = null; inline(); };
        quickWorker.postMessage({ state: serialize(state), ...opts });
      } catch { inline(); }
    });
  }

  // Builds the lookup tables in the worker before the first click.
  const warmedFor = new Set();
  function warmUp() {
    const n = getN();
    if (warmedFor.has(n) || solving) return;
    warmedFor.add(n);
    try {
      quickWorker ||= new Worker(new URL('./quick-worker.js', import.meta.url), { type: 'module' });
      quickWorker.postMessage({ warm: n });
    } catch { /* the first click falls back to the main thread */ }
  }
  quickBtn.addEventListener('pointerenter', warmUp);
  quickBtn.addEventListener('focus', warmUp);

  function quickHead(count, label, status = '') {
    panel.hidden = false;
    q('.sv-alg').classList.remove('long');
    q('.sv-steps').hidden = true;
    q('.sv-extra').hidden = true;
    q('.sv-title').textContent = 'Armado rápido';
    q('.sv-count').textContent = count;
    q('.sv-label').textContent = label;
    const st = q('.sv-status');
    st.textContent = status;
    st.hidden = !status;
  }

  async function runQuick() {
    if (solving) { stop(); return; }
    const n = getN();
    const view = getView();
    const my = ++runId;
    setSolving(true, 'quick');
    searching = true;
    refreshButtons();
    onStart();
    if (stageEl && window.innerWidth < 980) stageEl.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    await view.queue;
    if (my !== runId) return;
    quickHead('', 'Buscando el camino más corto...');
    q('.sv-alg').innerHTML = '';
    setCaption('Buscando el camino más corto...', '', 'Armado rápido');
    const res = await computeQuick(view.state.clone(), n);
    if (my !== runId) return;
    searching = false;
    const finish = (completed, caption) => {
      setSolving(false);
      if (caption) setCaption(caption, '', 'Armado rápido');
      onEnd({ completed });
    };
    if (!res.ok) { quickHead('', `No se encontró un camino: ${res.error}`); q('.sv-alg').innerHTML = ''; finish(false); return; }

    if (res.moves === null) {
      quickHead('', '', `Sin camino corto demostrable a tiempo (al menos ${res.lowerBound} giros)`);
      q('.sv-alg').innerHTML = '';
      const extra = q('.sv-extra');
      extra.hidden = false;
      extra.innerHTML = '<button class="btn btn-small as-fallback">Usar el armado automático</button>';
      extra.querySelector('.as-fallback').addEventListener('click', () => { if (!solving) run(); });
      finish(false, 'Sin camino corto demostrable a tiempo');
      return;
    }

    const moves = res.moves;
    const rotation = res.rotation || [];
    if (moves.length === 0 && rotation.length === 0) {
      quickHead('0 giros', 'El cubo ya está armado');
      q('.sv-alg').innerHTML = '';
      finish(true, 'El cubo ya está armado');
      return;
    }
    quickHead(`${moves.length} giros`, '', res.optimal ? 'Mínimo demostrado' : `La más corta encontrada: entre ${res.lowerBound} y ${res.length} giros`);
    const movesHtml = moves.length
      ? `<div class="group"><div class="chips">${moves.map((t, k) => `<span class="chip" data-k="${k}">${t}</span>`).join('')}</div><span class="glabel">Giros</span></div>`
      : '';
    const holdHtml = rotation.length
      ? `<div class="group"><div class="chips"><span class="chip chip-hold">Sostener: ${rotation.join(' ')}</span></div><span class="glabel">No cuenta como giro</span></div>`
      : '';
    q('.sv-alg').innerHTML = movesHtml + holdHtml;
    // A long solution (the 4x4 has dozens of moves) scrolls inside its own box.
    q('.sv-alg').classList.toggle('long', moves.length > 24);
    const reveal = (chip) => {
      const box = q('.sv-alg');
      if (!chip || !box.classList.contains('long')) return;
      box.scrollTo({ top: chip.offsetTop - box.clientHeight / 2, behavior: REDUCED ? 'auto' : 'smooth' });
    };
    const chips = qa('.sv-alg .chip[data-k]');
    const hold = q('.sv-alg .chip-hold');
    setCaption(`${moves.length} giros`, '', 'Armado rápido');
    view.speed = speed;
    for (let i = 0; i < moves.length; i++) {
      if (my !== runId) return;
      chips.forEach((c, j) => { c.classList.toggle('done', j < i); c.classList.toggle('now', j === i); });
      reveal(chips[i]);
      const ok = await view.turn(moves[i]);
      if (!ok || my !== runId) return;
      q('.sv-count').textContent = `Giro ${i + 1} de ${moves.length}`;
    }
    chips.forEach((c) => { c.classList.remove('now'); c.classList.add('done'); });
    if (hold) {
      reveal(hold);
      hold.classList.add('now');
      for (const t of rotation) {
        if (my !== runId) return;
        const ok = await view.turn(t);
        if (!ok || my !== runId) return;
      }
      hold.classList.remove('now');
      hold.classList.add('done');
    }
    if (my !== runId) return;
    q('.sv-count').textContent = `${moves.length} giros`;
    finish(true, `Armado en ${moves.length} giros`);
  }

  runBtn.addEventListener('click', run);
  quickBtn.addEventListener('click', runQuick);
  refreshButtons();

  return {
    stop,
    isSolving: () => solving,
    hidePanel: () => { panel.hidden = true; },
    setEnabled: (on) => { enabled = on; refreshButtons(); },
    dispose: () => { runId++; worker?.terminate(); quickWorker?.terminate(); },
  };
}
