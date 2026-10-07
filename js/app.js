import { Stage, CubeView, AlgPlayer, changedPieces } from './viewer.js';
import { GUIDE_3, GUIDE_4, buildCase, groupRanges, NOTATION, METHOD_LOAD, MASKS, ALGS } from './content.js';
import { CubeState, tokenize, invertAlg, FACE_COLORS } from './cube-core.js';
import { solve, serialize, STEPS } from './solver.js';

const main = document.getElementById('main');
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let cleanup = null;

// ---------- small helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep in memory only */ }
  },
};

const swatch = (face) => `<i class="sw" style="--c:${FACE_COLORS[face]}"></i>`;

function holdLegend() {
  return `<div class="hold-legend" aria-label="Cómo sostener el cubo">${swatch('U')}<span>Arriba</span>${swatch('F')}<span>Frente</span></div>`;
}

function randomScramble(n, len) {
  const faces = n === 3 ? ['U', 'D', 'R', 'L', 'F', 'B'] : ['U', 'D', 'R', 'L', 'F', 'B', 'Uw', 'Rw', 'Fw'];
  const axisOf = (t) => ({ U: 1, D: 1, R: 0, L: 0, F: 2, B: 2 })[t[0]];
  const out = [];
  let last = -1;
  while (out.length < len) {
    const f = faces[Math.floor(Math.random() * faces.length)];
    if (axisOf(f) === last) continue;
    last = axisOf(f);
    out.push(f + ['', "'", '2'][Math.floor(Math.random() * 3)]);
  }
  return out;
}

// ---------- router ----------
const routes = {
  '': viewHome,
  notacion: viewNotation,
  '3x3': () => viewGuide(GUIDE_3),
  '4x4': () => viewGuide(GUIDE_4),
  'por-que': viewWhy,
};

function route() {
  const key = location.hash.replace(/^#\/?/, '').split('/')[0];
  cleanup?.();
  cleanup = null;
  main.innerHTML = '';
  const view = routes[key] || viewHome;
  cleanup = view() || null;
  for (const a of $$('.nav a')) a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${key}`);
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

// ---------- home ----------
function viewHome() {
  main.innerHTML = `
  <section class="hero">
    <div class="hero-copy">
      <h1 class="display">Del cubo revuelto al cubo armado, un giro a la vez.</h1>
      <p class="lede">Dos métodos explicados con el cubo moviéndose frente a ti: por capas para el 3x3 y reducción para el 4x4. Cada giro trae su flecha, y cada paso, su motivo.</p>
      <div class="cta">
        <a class="btn btn-primary" href="#/3x3">Aprender el 3x3</a>
        <a class="btn" href="#/4x4">Aprender el 4x4</a>
      </div>
      <p class="hint">¿Primera vez? Empieza por <a href="#/notacion">cómo leer los giros</a>. Son cinco minutos y te ahorran horas.</p>
    </div>
    <div class="hero-stage stage" id="hero-stage">
      <p class="stage-cap" id="hero-cap" aria-live="polite"></p>
    </div>
  </section>
  <section class="route" aria-labelledby="route-title">
    <h2 id="route-title">La ruta recomendada</h2>
    <ol class="route-list">
      <li><a href="#/notacion"><strong>${swatch('D')}Leer los giros</strong><span>Seis letras y tres modificadores. Con esto puedes seguir cualquier algoritmo.</span></a></li>
      <li><a href="#/3x3"><strong>${swatch('F')}Armar el 3x3</strong><span>Ocho pasos, seis algoritmos cortos. Cada paso se apoya en el anterior.</span></a></li>
      <li><a href="#/por-que"><strong>${swatch('R')}Entender por qué funciona</strong><span>Por qué un algoritmo desarma y vuelve a armar, y por qué este método es el que conviene aprender.</span></a></li>
      <li><a href="#/4x4"><strong>${swatch('B')}Armar el 4x4</strong><span>Convertirlo en un 3x3 grande y resolver los dos casos que solo existen en cubos pares.</span></a></li>
    </ol>
  </section>`;

  const stage = new Stage($('#hero-stage'), { autoRotate: true, cameraPos: [5.4, 4.2, 7.4] });
  const view = new CubeView(stage, 3);
  const cap = $('#hero-cap');
  let alive = true;
  (async () => {
    if (REDUCED) {
      view.setState(new CubeState(3).apply(randomScramble(3, 20).join(' ')));
      cap.textContent = 'Un cubo revuelto: 20 giros al azar.';
      return;
    }
    await wait(700);
    while (alive) {
      const scr = randomScramble(3, 20);
      cap.textContent = 'Revolviendo con 20 giros al azar';
      view.speed = 3.2;
      for (const t of scr) { if (!alive) return; await view.turn(t); }
      await wait(900);
      cap.textContent = 'Deshaciendo los mismos giros, al revés';
      view.speed = 1.9;
      for (const t of tokenize(invertAlg(scr.join(' ')))) { if (!alive) return; await view.turn(t); }
      cap.textContent = 'Armado';
      await wait(2200);
    }
  })();
  return () => { alive = false; view.dispose(); stage.dispose(); };
}

// ---------- notation ----------
function describeMove(token) {
  const m = /^([URFDLB]w|[URFDLB]|[urfdlb]|[MES]|[xyz])(2'|2|')?$/.exec(token);
  if (!m) return '';
  const [, base, suf = ''] = m;
  const face = NOTATION.find((x) => x.k === base[0].toUpperCase());
  const dir = suf.startsWith('2') ? 'media vuelta' : suf === "'" ? 'en sentido antihorario' : 'en sentido horario';
  if ('xyz'.includes(base)) return `Todo el cubo gira ${dir}, igual que ${({ x: 'R', y: 'U', z: 'F' })[base]}.`;
  if ('MES'.includes(base)) return `La capa del medio gira ${dir}, igual que ${({ M: 'L', E: 'D', S: 'F' })[base]}.`;
  if (base.endsWith('w')) return `Las dos capas de ${face.name.toLowerCase()} giran ${dir}, mirando esa cara de frente.`;
  if (base === base.toLowerCase()) return `Solo la segunda capa desde ${face.name.toLowerCase()} gira ${dir}.`;
  return `La cara ${face.name.toLowerCase()} gira ${dir}, mirándola de frente.`;
}

function viewNotation() {
  let n = store.get('rubik-notation-n', 3);
  main.innerHTML = `
  <section class="page-head">
    <h1>Cómo leer los giros</h1>
    <p class="lede">Un algoritmo es una lista de giros. Cada letra nombra una cara; lo que va después dice hacia dónde gira.</p>
  </section>
  <div class="split">
    <div class="stage-col">
      <div class="stage stage-tall" id="n-stage">
        <p class="stage-cap" id="n-cap" aria-live="polite">Pulsa un giro para verlo</p>
        ${holdLegend()}
        <button class="btn btn-small stage-reset" id="n-reset" title="Vuelve el cubo al estado armado al instante">Armar de nuevo</button>
      </div>
      <div class="solver-bar">
        <button class="btn btn-primary" id="n-auto" title="Arma el cubo desde donde está, paso a paso y con el método de la guía">Armado automático</button>
        <div class="speed" role="group" aria-label="Velocidad del armado">
          <button data-s="0.6">Lento</button><button data-s="1.3">Normal</button><button data-s="3.2">Rápido</button>
        </div>
      </div>
      <section class="solver" id="solver" hidden aria-live="polite">
        <div class="sv-head"><strong id="sv-step"></strong><span id="sv-count"></span></div>
        <p class="sv-label" id="sv-label"></p>
        <div class="alg" id="sv-alg"></div>
        <ol class="sv-steps" id="sv-steps"></ol>
      </section>
    </div>
    <div class="panel">
      <div class="seg" role="group" aria-label="Tamaño del cubo">
        <button data-n="3">3x3</button><button data-n="4">4x4</button>
      </div>
      <h2>Las seis caras</h2>
      <ul class="faces">
        ${NOTATION.map((f) => `<li>${swatch(f.k)}<b>${f.k}</b><span>${f.name}</span><em>${f.en}</em></li>`).join('')}
      </ul>
      <h2>Los modificadores</h2>
      <dl class="mods">
        <div><dt>R</dt><dd>Horario, como las agujas del reloj, mirando esa cara de frente.</dd></div>
        <div><dt>R'</dt><dd>Antihorario. El apóstrofo se lee "prima".</dd></div>
        <div><dt>R2</dt><dd>Media vuelta. Da igual el sentido.</dd></div>
      </dl>
      <h2>Pruébalo</h2>
      <div class="pad" id="pad"></div>
      <p class="pad-desc" id="pad-desc" aria-live="polite">Teclado: la letra gira la cara; con Mayús, en sentido antihorario.</p>
    </div>
  </div>`;

  const stage = new Stage($('#n-stage'));
  let view = new CubeView(stage, n);
  view.speed = 0.85;
  const cap = $('#n-cap');
  const desc = $('#pad-desc');

  function buildPad() {
    const faces = ['U', 'D', 'R', 'L', 'F', 'B'];
    const extra = n === 3 ? ['M', 'E', 'S', 'x', 'y', 'z'] : ['Rw', 'Uw', 'Fw', 'r', 'u', 'f'];
    const row = (b) => `<div class="pad-row">${['', "'", '2'].map((s) => `<button class="chip-btn" data-t="${b}${s}">${b}${s}</button>`).join('')}</div>`;
    $('#pad').innerHTML = `<div class="pad-grid">${faces.map(row).join('')}</div>
      <p class="pad-sub">${n === 3 ? 'Capas del medio y giros de todo el cubo' : 'Capas dobles (w) y capas interiores (minúscula)'}</p>
      <div class="pad-grid">${extra.map(row).join('')}</div>`;
    for (const b of $$('.seg button')) b.setAttribute('aria-pressed', String(Number(b.dataset.n) === n));
  }
  buildPad();

  const doTurn = (t) => {
    cap.innerHTML = `<b class="tok">${t}</b>`;
    desc.textContent = describeMove(t);
    view.turn(t);
  };
  $('#pad').addEventListener('click', (e) => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (t && !solving) doTurn(t);
  });
  $('.seg').addEventListener('click', (e) => {
    const nn = Number(e.target.closest('[data-n]')?.dataset.n);
    if (!nn || nn === n || solving) return;
    n = nn;
    store.set('rubik-notation-n', n);
    view.dispose();
    stage.scene.remove(view.group);
    view = new CubeView(stage, n);
    view.speed = 0.85;
    buildPad();
  });
  $('#n-reset').addEventListener('click', () => { stopSolve(); view.setState(new CubeState(n)); cap.textContent = 'Armado'; });

  // ----- automatic solve -----
  let solving = false;
  let runId = 0;
  let worker = null;
  const autoBtn = $('#n-auto');
  const speedKey = 'rubik-auto-speed';
  let autoSpeed = store.get(speedKey, 1.3);
  const speedBtns = $$('.solver-bar .speed button');
  const markSpeed = () => speedBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.s) === autoSpeed)));
  markSpeed();
  $('.solver-bar .speed').addEventListener('click', (e) => {
    const sp = Number(e.target.closest('[data-s]')?.dataset.s);
    if (!sp) return;
    autoSpeed = sp;
    store.set(speedKey, sp);
    markSpeed();
    if (solving) view.speed = sp;
  });

  function setSolving(on) {
    solving = on;
    autoBtn.textContent = on ? 'Detener' : 'Armado automático';
    autoBtn.classList.toggle('btn-stop', on);
    $$('#pad button, .seg button').forEach((b) => { b.disabled = on; });
    if (!on) view.speed = 0.85;
  }

  function stopSolve() {
    if (!solving) return;
    runId++;
    setSolving(false);
    view.setState(view.state);
    $$('#sv-steps .sv-step').forEach((x) => x.classList.remove('current'));
    cap.textContent = 'Armado detenido. Puedes seguir girando o volver a pedirlo.';
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

  const stepTitle = (id) => STEPS[n].find(([k]) => k === id)?.[1] || id;
  const movesOf = (segs) => segs.reduce((t, x) => t + (x.groups ? x.groups.reduce((u, g) => u + g.moves.length, 0) : 0), 0);

  async function autoSolve() {
    if (solving) { stopSolve(); return; }
    const my = ++runId;
    setSolving(true);
    await view.queue;
    if (my !== runId) return;
    cap.textContent = n === 4 ? 'Calculando el plan; el 4x4 puede tardar unos segundos' : 'Calculando el plan';
    const res = await computePlan(view.state.clone());
    if (my !== runId) return;
    if (!res.ok) { setSolving(false); cap.textContent = `No se encontró un plan: ${res.error}`; return; }

    $('#solver').hidden = false;
    $('#sv-steps').innerHTML = STEPS[n].map(([id, title], i) => {
      const segs = res.segments.filter((x) => x.step === id);
      const skipped = segs.length > 0 && segs.every((x) => x.skipped);
      return `<li class="sv-step${skipped ? ' skipped' : ''}" data-step="${id}">
        <span class="sv-dot" aria-hidden="true">${n === 3 ? i : i + 1}</span>
        <div><strong>${title}</strong><small>${skipped ? `Se omite. ${segs[0].reason}` : `${movesOf(segs)} giros`}</small></div>
      </li>`;
    }).join('');
    $('#sv-count').textContent = `${res.moves} giros en total`;
    if (res.moves === 0) {
      $('#sv-step').textContent = 'Ya estaba armado';
      $('#sv-label').textContent = 'No hace falta ningún paso: cada uno se omite con su motivo.';
      $('#sv-alg').innerHTML = '';
      cap.textContent = 'El cubo ya está armado.';
      setSolving(false);
      return;
    }

    view.speed = autoSpeed;
    let played = 0;
    for (const seg of res.segments) {
      if (my !== runId) return;
      const li = $(`#sv-steps [data-step="${seg.step}"]`);
      $$('#sv-steps .sv-step').forEach((x) => x.classList.toggle('current', x === li));
      $('#sv-step').textContent = stepTitle(seg.step);
      if (seg.skipped) {
        $('#sv-label').textContent = `Se omite: ${seg.reason}`;
        $('#sv-alg').innerHTML = '';
        cap.innerHTML = `Se omite: ${stepTitle(seg.step)}<br><span class="cap-sub">${seg.reason}</span>`;
        await wait(1600 / view.speed);
        continue;
      }
      $('#sv-label').textContent = seg.label;
      let k = 0;
      $('#sv-alg').innerHTML = seg.groups.map((g) => `<div class="group"><div class="chips">${g.moves.map((t) => `<span class="chip" data-k="${k++}">${t}</span>`).join('')}</div><span class="glabel">${g.label || ''}</span></div>`).join('');
      cap.innerHTML = `${stepTitle(seg.step)}<br><span class="cap-sub">${seg.label}</span>`;
      const chips = $$('#sv-alg .chip');
      const groups = $$('#sv-alg .group');
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
          $('#sv-count').textContent = `Giro ${played} de ${res.moves}`;
        }
      }
      chips.forEach((c) => { c.classList.remove('now'); c.classList.add('done'); });
      li?.classList.add('ok');
      await wait(450 / view.speed);
    }
    if (my !== runId) return;
    $$('#sv-steps .sv-step').forEach((x) => x.classList.remove('current'));
    $('#sv-step').textContent = 'Armado';
    $('#sv-label').textContent = `Listo en ${res.moves} giros, con los mismos pasos de la guía.`;
    $('#sv-alg').innerHTML = '';
    cap.textContent = `Armado en ${res.moves} giros.`;
    setSolving(false);
  }
  autoBtn.addEventListener('click', autoSolve);

  const onKey = (e) => {
    if (solving || e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toUpperCase();
    if ('UDRLFB'.includes(k) && k.length === 1) { doTurn(k + (e.shiftKey ? "'" : '')); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);
  return () => { runId++; worker?.terminate(); window.removeEventListener('keydown', onKey); view.dispose(); stage.dispose(); };
}

// ---------- guides ----------
function viewGuide(guide) {
  const progressKey = 'rubik-progress';
  const progress = store.get(progressKey, {});
  const total = guide.steps.length;
  main.innerHTML = `
  <section class="page-head guide-head">
    <h1>${guide.title}</h1>
    <p class="lede">${guide.hold}</p>
  </section>
  <div class="guide-grid">
    <div class="stage-col">
      <div class="stage stage-guide" id="g-stage">
        <div class="stage-cap guide-cap" aria-live="polite">
          <span class="cap-step" id="cap-step"></span>
          <strong class="cap-label" id="cap-label"></strong>
        </div>
        ${holdLegend()}
        <button class="btn btn-small stage-reset" id="g-view" title="Vuelve la cámara a la vista de frente">Vista inicial</button>
      </div>
      <div class="player">
        <div class="cases" role="tablist" aria-label="Casos" id="cases"></div>
        <div class="alg" id="alg" aria-label="Algoritmo, toca un giro para saltar a él"></div>
        <div class="controls">
          <button class="icon-btn" id="b-restart" title="Volver al inicio del caso" aria-label="Volver al inicio">${icon('restart')}</button>
          <button class="icon-btn" id="b-prev" title="Deshacer un giro (flecha izquierda)" aria-label="Giro anterior">${icon('prev')}</button>
          <button class="icon-btn icon-btn-main" id="b-play" title="Reproducir o pausar (espacio)" aria-label="Reproducir">${icon('play')}</button>
          <button class="icon-btn" id="b-next" title="Un giro más (flecha derecha)" aria-label="Siguiente giro">${icon('next')}</button>
          <div class="speed" role="group" aria-label="Velocidad">
            <button data-s="0.5">Lento</button><button data-s="1">Normal</button><button data-s="1.8">Rápido</button>
          </div>
          <span class="count" id="count"></span>
        </div>
      </div>
    </div>
    <ol class="steps" id="steps">
      ${guide.steps.map((s, i) => `
      <li class="step" data-i="${i}">
        <button class="step-head" aria-expanded="false">
          <span class="step-num">${i + 1}</span>
          <span class="step-title">${s.title}</span>
          <span class="step-done" aria-label="Dominado" ${progress[`${guide.id}/${s.id}`] ? '' : 'hidden'}>${icon('check')}</span>
        </button>
        <div class="step-body" hidden>
          <p class="goal">${s.goal}</p>
          <ol class="how">${s.how.map((h) => `<li>${h}</li>`).join('')}</ol>
          <p class="tip">${s.tip}</p>
          <div class="step-foot">
            <label class="master"><input type="checkbox" data-key="${guide.id}/${s.id}" ${progress[`${guide.id}/${s.id}`] ? 'checked' : ''}> Ya lo domino</label>
            ${i < total - 1 ? `<button class="btn btn-small next-step" data-next="${i + 1}">Siguiente: ${guide.steps[i + 1].title}</button>` : `<a class="btn btn-small" href="${guide.n === 3 ? '#/4x4' : '#/por-que'}">${guide.n === 3 ? 'Ahora el 4x4' : 'Ver por qué funciona'}</a>`}
          </div>
        </div>
      </li>`).join('')}
    </ol>
  </div>`;

  const stage = new Stage($('#g-stage'), { cameraPos: guide.n === 4 ? [6.5, 5.4, 8.4] : [6.2, 5.1, 8.0] });
  const view = new CubeView(stage, guide.n);
  const speedKey = 'rubik-speed';
  view.speed = store.get(speedKey, 1);
  let stepIdx = 0;
  let caseDef = null;
  let ranges = [];

  const player = new AlgPlayer(view, { onChange: render });

  function render({ index, total: count, playing }) {
    $('#count').textContent = `Giro ${Math.min(index, count)} de ${count}`;
    $('#b-play').innerHTML = icon(playing ? 'pause' : 'play');
    $('#b-play').setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    $$('#alg .chip').forEach((c, i) => {
      c.classList.toggle('done', i < index - 1 || (i === index - 1 && !player.busy && !playing && index === count));
      c.classList.toggle('now', i === index - 1);
      c.classList.toggle('next', i === index && !playing);
    });
    const active = index === 0 ? null : ranges.find((r) => index - 1 >= r.from && index - 1 < r.to);
    $$('#alg .group').forEach((g, gi) => g.classList.toggle('active', ranges[gi] === active));
    $('#cap-step').textContent = `Paso ${stepIdx + 1} de ${total}: ${guide.steps[stepIdx].title}`;
    $('#cap-label').textContent = index === 0
      ? `Así se ve el caso. Pulsa reproducir.`
      : index === count && !playing ? 'Listo. Repítelo en tu cubo.' : active?.label || '';
  }

  function loadCase(ci) {
    const step = guide.steps[stepIdx];
    caseDef = step.cases[ci];
    const built = buildCase(guide.n, caseDef);
    ranges = groupRanges(caseDef);
    $('#cases').innerHTML = step.cases.map((c, i) => `<button role="tab" aria-selected="${i === ci}" data-c="${i}">${c.name}</button>`).join('');
    let k = 0;
    $('#alg').innerHTML = ranges.map((r) => `
      <div class="group"><div class="chips">${built.tokens.slice(r.from, r.to).map((t) => `<button class="chip" data-k="${k++}">${t}</button>`).join('')}</div>
      <span class="glabel">${r.label}</span></div>`).join('');
    player.load(built);
  }

  function openStep(i, { scroll = false } = {}) {
    stepIdx = i;
    $$('#steps .step').forEach((li, j) => {
      const open = j === i;
      li.classList.toggle('open', open);
      $('.step-head', li).setAttribute('aria-expanded', String(open));
      $('.step-body', li).hidden = !open;
    });
    loadCase(0);
    if (scroll) $(`#steps .step[data-i="${i}"]`).scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'nearest' });
    if (window.innerWidth < 980) $('#g-stage').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
  }

  $('#steps').addEventListener('click', (e) => {
    const head = e.target.closest('.step-head');
    if (head) openStep(Number(head.closest('.step').dataset.i));
    const nx = e.target.closest('.next-step');
    if (nx) openStep(Number(nx.dataset.next), { scroll: true });
  });
  $('#steps').addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-key]');
    if (!cb) return;
    progress[cb.dataset.key] = cb.checked;
    store.set(progressKey, progress);
    $('.step-done', cb.closest('.step')).hidden = !cb.checked;
  });
  $('#cases').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (b) loadCase(Number(b.dataset.c));
  });
  $('#alg').addEventListener('click', (e) => {
    const c = e.target.closest('[data-k]');
    if (!c) return;
    // Jump so that the tapped move is the next one to play.
    const k = Number(c.dataset.k);
    player.pause();
    const st = player.startState.clone().apply(player.tokens.slice(0, k).join(' '));
    player.index = k;
    view.setState(st);
    player.busy = false;
    player.emit();
  });
  $('#b-play').addEventListener('click', () => (player.playing ? player.pause() : player.play()));
  $('#b-next').addEventListener('click', () => { player.pause(); player.step(1); });
  $('#b-prev').addEventListener('click', () => { player.pause(); player.step(-1); });
  $('#b-restart').addEventListener('click', () => player.restart());
  $('#g-view').addEventListener('click', () => stage.controls?.reset());
  const speedBtns = $$('.speed button');
  const markSpeed = () => speedBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.s) === view.speed)));
  markSpeed();
  $('.speed').addEventListener('click', (e) => {
    const s = Number(e.target.closest('[data-s]')?.dataset.s);
    if (!s) return;
    view.speed = s;
    store.set(speedKey, s);
    markSpeed();
  });
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, [role="tab"]') && e.key !== ' ') return;
    if (e.key === ' ' && !e.target.closest('button, input')) { e.preventDefault(); player.playing ? player.pause() : player.play(); }
    if (e.key === 'ArrowRight') { player.pause(); player.step(1); }
    if (e.key === 'ArrowLeft') { player.pause(); player.step(-1); }
  };
  window.addEventListener('keydown', onKey);

  openStep(0);
  return () => { window.removeEventListener('keydown', onKey); player.pause(); view.dispose(); stage.dispose(); };
}

// ---------- why ----------
function viewWhy() {
  const max = Math.max(...METHOD_LOAD.map((m) => m.count));
  main.innerHTML = `
  <section class="page-head">
    <h1>Por qué estos métodos</h1>
    <p class="lede">No son los más rápidos del mundo. Son los que te llevan de cero a armarlo con la menor cantidad de cosas que recordar, y sin callejones sin salida.</p>
  </section>

  <section class="why-block">
    <div class="why-text">
      <h2>Menos que memorizar</h2>
      <p>Cada cuadro es un algoritmo que hay que aprender de memoria. El método por capas resuelve el cubo con seis; el resto de los pasos se razonan mirando el cubo.</p>
      <p class="fine">Recuentos por definición de cada método: CFOP completo son 57 casos de OLL y 21 de PLL; Roux usa 42 casos de CMLL.</p>
    </div>
    <div class="units" role="img" aria-label="${METHOD_LOAD.map((m) => `${m.name}: ${m.count} algoritmos`).join('. ')}">
      ${METHOD_LOAD.map((m, mi) => `
      <div class="unit-row">
        <div class="unit-head"><strong>${m.name}</strong><span class="unit-count">${m.count}</span></div>
        <div class="unit-grid" style="--cols:${Math.ceil(max / 3)}">${Array.from({ length: m.count }, (_, i) => `<i style="--d:${i}" class="${mi === 0 ? 'lit' : ''}"></i>`).join('')}</div>
        <p class="unit-note">${m.note}</p>
      </div>`).join('')}
    </div>
  </section>

  <section class="why-block why-block-rev">
    <div class="stage stage-why" id="w-stage">
      <p class="stage-cap" id="w-cap" aria-live="polite"></p>
      <button class="btn btn-small stage-reset" id="w-replay">Repetir</button>
    </div>
    <div class="why-text">
      <h2>Desarmar a propósito, y volver</h2>
      <p>Un algoritmo no evita tocar lo que ya armaste: lo desarma y lo vuelve a armar. Mira las dos capas de abajo mientras se repite R U R' U' seis veces.</p>
      <p>A la sexta vez el cubo vuelve exactamente a como empezó. Por eso, en el paso de las esquinas blancas, basta con repetir hasta que la esquina quede bien: nunca rompes lo anterior de forma permanente.</p>
    </div>
  </section>

  <section class="why-block">
    <div class="why-text">
      <h2>Una escalera, no un callejón</h2>
      <p>Cada paso por capas es una versión lenta de una fase de CFOP, el método que usan casi todos los speedcubers. Cuando quieras ir más rápido, cambias un paso a la vez sin volver a empezar.</p>
    </div>
    <div class="ladder">
      ${[
        ['Cruz', ['Margarita', 'Cruz blanca'], 'D'],
        ['F2L', ['Esquinas blancas', 'Segunda capa'], 'F'],
        ['OLL', ['Cruz amarilla', 'Girar esquinas'], 'U'],
        ['PLL', ['Aristas amarillas', 'Esquinas a su lugar'], 'R'],
      ].map(([phase, steps, f]) => `
      <div class="rung" style="--c:${FACE_COLORS[f]};--lc:${f === 'D' ? '#8A91A6' : FACE_COLORS[f]}">
        <div class="rung-steps">${steps.map((s) => `<span>${s}</span>`).join('')}</div>
        <div class="rung-line" aria-hidden="true"></div>
        <div class="rung-phase">${phase}</div>
      </div>`).join('')}
      <p class="ladder-cap"><span>Método por capas</span><span>CFOP</span></p>
    </div>
  </section>

  <section class="why-block why-block-rev">
    <div class="stage stage-why stage-dual" id="d-stage">
      <p class="stage-cap" id="d-cap" aria-live="polite"></p>
    </div>
    <div class="why-text">
      <h2>El 4x4 es un 3x3 disfrazado</h2>
      <p>La reducción arma primero los centros en bloques de 2x2 y une las aristas en parejas. Desde ese momento, el 4x4 de la izquierda responde a los mismos giros que el 3x3 de la derecha.</p>
      <p>Todo lo que aprendiste en el 3x3 sirve tal cual. Solo hay que aprender lo nuevo: centros, aristas y dos casos de paridad.</p>
    </div>
  </section>

  <section class="why-block">
    <div class="why-text">
      <h2>Por qué aparece la paridad</h2>
      <p>En un 3x3 los centros no se mueven y cada arista es una sola pieza, así que ciertos estados son imposibles: una sola arista volteada, o solo dos aristas intercambiadas.</p>
      <p>En un 4x4 cada arista son dos piezas sueltas y los centros no tienen un lugar fijo. Al emparejar, puede quedar un número impar de intercambios escondido. Aparece al final como uno de esos estados "imposibles", y se arregla con un algoritmo propio.</p>
      <a class="btn" href="#/4x4">Ver los dos algoritmos de paridad</a>
    </div>
    <figure class="parity-fig">
      <div class="stage stage-dual" id="p-stage"></div>
      <figcaption class="parity-caps"><span>Una arista volteada</span><span>Dos aristas intercambiadas</span></figcaption>
    </figure>
  </section>`;

  const disposers = [];
  let alive = true;

  // Repeat the sexy move six times over the first two layers.
  const ws = new Stage($('#w-stage'));
  const wv = new CubeView(ws, 3);
  wv.setMask(MASKS.f2l, { instant: true });
  disposers.push(() => { wv.dispose(); ws.dispose(); });
  const wcap = $('#w-cap');
  let run = 0;
  async function sexyLoop() {
    const my = ++run;
    wv.setState(new CubeState(3));
    wv.speed = 1.6;
    for (let k = 1; k <= 6; k++) {
      wcap.innerHTML = `<b class="tok">R U R' U'</b> vez ${k} de 6`;
      for (const t of tokenize(ALGS.SEXY)) { if (!alive || my !== run) return; await wv.turn(t); }
      await wait(250);
    }
    if (my === run) wcap.textContent = 'De vuelta al inicio. Nada se perdió.';
  }
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && run === 0) sexyLoop(); }, { threshold: 0.4 });
  io.observe($('#w-stage'));
  disposers.push(() => io.disconnect());
  $('#w-replay').addEventListener('click', sexyLoop);

  // 4x4 and 3x3 in lockstep.
  const ds = new Stage($('#d-stage'), { cameraPos: [0, 4.4, 12.2], shadowY: 1.9 });
  const big = new CubeView(ds, 4, { size: 2.6, position: [-1.95, 0, 0] });
  const small = new CubeView(ds, 3, { size: 2.6, position: [1.95, 0, 0] });
  big.group.rotation.y = small.group.rotation.y = -0.5;
  disposers.push(() => { big.dispose(); small.dispose(); ds.dispose(); });
  const dcap = $('#d-cap');
  (async () => {
    const seq = tokenize(`${ALGS.SUNE} U ${invertAlg(`${ALGS.SUNE} U`)} ${ALGS.RIGHT} ${invertAlg(ALGS.RIGHT)}`);
    big.speed = small.speed = 1.1;
    while (alive) {
      for (const t of seq) {
        if (!alive) return;
        dcap.innerHTML = `Mismo giro, mismo efecto: <b class="tok">${t}</b>`;
        await Promise.all([big.turn(t), small.turn(t)]);
        await wait(REDUCED ? 600 : 120);
      }
      await wait(1200);
    }
  })();

  // Parity snapshots: both "impossible" states side by side.
  const ps = new Stage($('#p-stage'), { cameraPos: [0, 5.6, 11.6], shadowY: 1.9 });
  [[ALGS.OLL_PARITY, MASKS.oll, -1.95], [ALGS.PLL_PARITY, MASKS.all, 1.95]].forEach(([alg, mask, x]) => {
    const v = new CubeView(ps, 4, { size: 2.6, position: [x, 0, 0] });
    v.group.rotation.y = -0.45;
    v.setState(new CubeState(4).apply(alg));
    v.setMask(mask, { instant: true });
    v.setFocus(changedPieces(new CubeState(4), v.state).filter((id) => v.state.cubies[id].type === 'edge'));
    disposers.push(() => v.dispose());
  });
  disposers.push(() => ps.dispose());

  return () => { alive = false; disposers.forEach((d) => d()); };
}

// ---------- icons ----------
function icon(name) {
  const p = {
    play: '<path d="M8 5.5v13l11-6.5z"/>',
    pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
    next: '<path d="M6 5.5v13l9-6.5zM16 5h3v14h-3z"/>',
    prev: '<path d="M18 5.5v13l-9-6.5zM5 5h3v14H5z"/>',
    restart: '<path d="M12 5a7 7 0 1 1-6.6 4.7l1.9.6A5 5 0 1 0 12 7v3L7.5 6 12 2z"/>',
    check: '<path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/>',
  }[name];
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">${p}</svg>`;
}

route();
