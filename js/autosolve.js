// "Armado automático" widget, shared by the notation view and both guides.
// It renders its own bar (button + speed) and narration panel inside `host`
// and drives whatever CubeView `getView()` returns.
import { solve, serialize, STEPS } from './solver.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const movesOf = (segs) => segs.reduce((t, x) => t + (x.groups ? x.groups.reduce((u, g) => u + g.moves.length, 0) : 0), 0);
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      <div class="speed" role="group" aria-label="Velocidad del armado">
        <button data-s="0.6">Lento</button><button data-s="1.3">Normal</button><button data-s="3.2">Rápido</button>
      </div>
    </div>
    <section class="solver" hidden aria-live="polite">
      <div class="sv-head"><strong class="sv-title"></strong><span class="sv-count"></span></div>
      <p class="sv-label"></p>
      <div class="alg sv-alg"></div>
      <ol class="sv-steps"></ol>
    </section>`;
  const q = (s) => host.querySelector(s);
  const qa = (s) => [...host.querySelectorAll(s)];
  const runBtn = q('.as-run');
  const panel = q('.solver');

  let solving = false;
  let runId = 0;
  let worker = null;
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

  function setSolving(on) {
    solving = on;
    runBtn.textContent = on ? 'Detener' : 'Armado automático';
    runBtn.classList.toggle('btn-stop', on);
    if (!on) getView().speed = idleSpeed;
  }

  function stop(message = 'Armado detenido. Puedes seguir girando o volver a pedirlo.') {
    if (!solving) return false;
    runId++;
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
    const stepTitle = (id) => STEPS[n].find(([k]) => k === id)?.[1] || id;
    const my = ++runId;
    setSolving(true);
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
    q('.sv-steps').innerHTML = STEPS[n].map(([id, title], i) => {
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
  runBtn.addEventListener('click', run);

  return {
    stop,
    isSolving: () => solving,
    hidePanel: () => { panel.hidden = true; },
    dispose: () => { runId++; worker?.terminate(); },
  };
}
