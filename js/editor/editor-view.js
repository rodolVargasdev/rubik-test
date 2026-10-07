// "Pintar" view: an unfolded 2D net to paint the cube as the user holds it, a
// live 3D preview, validation messages and the shared solve widget.
import { Stage, CubeView } from '../viewer.js';
import { CubeState, FACE_COLORS, FACE_NAMES, normalFace } from '../cube-core.js';
import { deserialize } from '../solver.js';
import { mountAutoSolve } from '../autosolve.js';
import { FACES, layout, emptyGrid, solvedGrid, gridFromState, isFixedCenter, holdNormalized } from './facelets.js';
import { validateGrid } from './validate.js';
import { listPuzzles } from '../puzzles/index.js';

const FACE_LABEL = { U: 'superior', D: 'inferior', F: 'frontal', B: 'trasera', R: 'derecha', L: 'izquierda' };
const FACE_TITLE = { U: 'Arriba', D: 'Abajo', F: 'Frente', B: 'Atrás', R: 'Derecha', L: 'Izquierda' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// `shared.notation` holds { n, state } of the last cube shown in the notation view.
export function mountEditor(main, { store, shared }) {
  const sizes = listPuzzles().filter((p) => p.kind === 'nxn' && p.editor);
  let n = sizes.some((p) => p.n === store.get('rubik-editor-n', 3)) ? store.get('rubik-editor-n', 3) : sizes[0].n;
  const grids = Object.fromEntries(sizes.map((p) => [p.n, solvedGrid(p.n)]));
  let brush = 'F';
  let mode = 'paint'; // 'paint' | 'solve' (the 3D view shows the solve)
  let locked = false;
  let result = null;
  let dragging = false;

  main.innerHTML = `
  <section class="page-head">
    <h1>Pintar el cubo</h1>
    <p class="lede">Pinta cada cara como la tiene tu cubo ahora. Si es posible armarlo, se habilita el armado.</p>
  </section>
  <div class="editor-grid">
    <div class="ed-col">
      <div class="ed-top">
        <div class="seg" role="group" aria-label="Tamaño del cubo">${sizes.map((p) => `<button data-n="${p.n}">${p.n}x${p.n}</button>`).join('')}</div>
        <span class="chip-note"><i class="sw" style="--c:${FACE_COLORS.U}"></i>Amarillo arriba<i class="sw" style="--c:${FACE_COLORS.F}"></i>verde al frente</span>
      </div>
      <div class="net-wrap"><div class="net" id="net"></div></div>
      <div class="palette" role="radiogroup" aria-label="Color del pincel">
        ${FACES.map((f, i) => `<button class="pal" role="radio" data-c="${f}" title="Tecla ${i + 1}"><i class="sw" style="--c:${FACE_COLORS[f]}"></i>${cap(FACE_NAMES[f])}</button>`).join('')}
      </div>
      <p class="ed-status" id="ed-status" aria-live="polite"></p>
      <ul class="ed-msgs" id="ed-msgs" aria-live="polite"></ul>
      <div class="ed-actions">
        <button class="btn btn-small" id="ed-clear" title="Deja todo sin pintar; en el 3x3 quedan los centros">Vaciar</button>
        <button class="btn btn-small" id="ed-solved" title="Pinta el cubo armado">Cubo armado</button>
        <button class="btn btn-small" id="ed-current" title="Carga el cubo que quedó en la vista de notación" hidden>Desde la vista actual</button>
      </div>
    </div>
    <div class="stage-col">
      <div class="stage stage-tall" id="e-stage">
        <p class="stage-cap" id="e-cap" aria-live="polite">Así se ve tu cubo</p>
        <div class="hold-legend" aria-label="Cómo sostener el cubo"><i class="sw" style="--c:${FACE_COLORS.U}"></i><span>Arriba</span><i class="sw" style="--c:${FACE_COLORS.F}"></i><span>Frente</span></div>
        <button class="btn btn-small stage-reset" id="e-reset" title="Vuelve la cámara a la vista de frente">Vista inicial</button>
      </div>
      <div class="auto-host" id="e-auto"></div>
    </div>
  </div>`;

  const $ = (s) => main.querySelector(s);
  const $$ = (s) => [...main.querySelectorAll(s)];
  const cap3d = $('#e-cap');
  const stage = new Stage($('#e-stage'));
  let view = new CubeView(stage, n);
  view.speed = 0.85;
  $('#e-reset').addEventListener('click', () => stage.controls?.reset());

  const grid = () => grids[n];

  // ---------- net ----------
  const stickerLabel = (face, idx) => {
    const c = grid()[face][idx];
    const row = Math.floor(idx / n) + 1;
    const col = (idx % n) + 1;
    return `Cara ${FACE_LABEL[face]}, fila ${row}, columna ${col}, ${isFixedCenter(n, idx) ? `${FACE_NAMES[c]} (centro fijo)` : c ? FACE_NAMES[c] : 'sin pintar'}`;
  };

  function buildNet() {
    const net = $('#net');
    net.dataset.n = n;
    net.style.setProperty('--n', n);
    net.innerHTML = FACES.map((face) => `
      <div class="net-face" style="grid-area:${face}" role="group" aria-label="Cara ${FACE_LABEL[face]}">
        <span class="net-name">${FACE_TITLE[face]}</span>
        <div class="net-cells">${Array.from({ length: n * n }, (_, idx) => (isFixedCenter(n, idx)
    ? `<span class="stk fixed" role="img" data-face="${face}" data-idx="${idx}"></span>`
    : `<button type="button" class="stk" data-face="${face}" data-idx="${idx}"></button>`)).join('')}</div>
      </div>`).join('');
    for (const b of $$('.seg button')) b.setAttribute('aria-pressed', String(Number(b.dataset.n) === n));
  }

  function paintNet() {
    const g = grid();
    const bad = new Set(result.errors.flatMap((e) => e.stickers.map((s) => `${s.face}${s.idx}`)));
    for (const el of $$('.stk')) {
      const { face, idx } = el.dataset;
      const c = g[face][idx];
      el.style.setProperty('--c', c ? FACE_COLORS[c] : '');
      el.classList.toggle('empty', !c);
      el.classList.toggle('bad', bad.has(`${face}${idx}`));
      el.setAttribute('aria-label', stickerLabel(face, Number(idx)));
    }
  }

  // ---------- validation and messages ----------
  function paintMessages() {
    const status = $('#ed-status');
    const list = $('#ed-msgs');
    list.replaceChildren();
    const add = (cls, text) => { const li = document.createElement('li'); li.className = cls; li.textContent = text; list.append(li); };
    if (result.incomplete) status.textContent = `Faltan ${result.incomplete} stickers por pintar`;
    else if (!result.ok) status.textContent = result.errors.length === 1 ? 'Hay un problema' : `Hay ${result.errors.length} problemas`;
    else status.textContent = 'Cubo válido';
    status.dataset.state = result.ok ? 'ok' : result.incomplete ? 'info' : 'bad';
    for (const e of result.errors) add('err', e.message);
    if (result.ok) add('ok', 'Se puede armar. Elige el armado automático o el rápido.');
  }

  // 3D preview: stickers colored by the slot they sit in (paint mode).
  function previewPaint() {
    const { slotIndex } = layout(n);
    const g = grid();
    view.setPaint((cubie, face) => {
      const slot = slotIndex.get(`${cubie.pos.join(',')}|${normalFace(view.state.stickerNormal(cubie, face))}`);
      const c = g[slot.face][slot.idx];
      return c ? FACE_COLORS[c] : null;
    });
  }

  function refresh() {
    result = validateGrid(grid(), n);
    paintNet();
    paintMessages();
    auto.setEnabled(result.ok);
    if (mode === 'paint') previewPaint();
  }

  function enterPaint() {
    auto.hidePanel();
    mode = 'paint';
    view.setState(new CubeState(n));
    cap3d.textContent = 'Así se ve tu cubo';
  }

  // ---------- painting ----------
  function paintAt(el) {
    if (locked || !el || el.classList.contains('fixed')) return;
    const { face, idx } = el.dataset;
    if (mode === 'solve') enterPaint();
    if (grid()[face][idx] === brush) return;
    grid()[face][idx] = brush;
    refresh();
  }
  const netEl = $('#net');
  netEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.stk');
    if (!el || e.pointerType === 'touch') return;
    dragging = true;
    paintAt(el);
  });
  netEl.addEventListener('pointerover', (e) => { if (dragging) paintAt(e.target.closest('.stk')); });
  const stopDrag = () => { dragging = false; };
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);
  // Taps and the keyboard arrive as clicks.
  netEl.addEventListener('click', (e) => paintAt(e.target.closest('.stk')));

  function setBrush(c) {
    brush = c;
    for (const b of $$('.pal')) {
      b.setAttribute('aria-checked', String(b.dataset.c === c));
      b.tabIndex = b.dataset.c === c ? 0 : -1;
    }
  }
  $('.palette').addEventListener('click', (e) => { const b = e.target.closest('.pal'); if (b) setBrush(b.dataset.c); });
  $('.palette').addEventListener('keydown', (e) => {
    const i = FACES.indexOf(brush);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    setBrush(FACES[(i + step + 6) % 6]);
    $(`.pal[data-c="${brush}"]`).focus();
  });
  const onKey = (e) => {
    if (locked || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select')) return;
    const i = Number(e.key);
    if (i >= 1 && i <= 6) setBrush(FACES[i - 1]);
  };
  window.addEventListener('keydown', onKey);

  // ---------- size and actions ----------
  function setSize(nn) {
    if (locked || nn === n) return;
    n = nn;
    store.set('rubik-editor-n', n);
    view.dispose();
    stage.scene.remove(view.group);
    view = new CubeView(stage, n);
    view.speed = 0.85;
    mode = 'paint';
    auto.hidePanel();
    cap3d.textContent = 'Así se ve tu cubo';
    buildNet();
    refresh();
  }
  $('.seg').addEventListener('click', (e) => { const nn = Number(e.target.closest('[data-n]')?.dataset.n); if (nn) setSize(nn); });
  const load = (g) => { if (locked) return; if (mode === 'solve') enterPaint(); grids[n] = g; refresh(); };
  $('#ed-clear').addEventListener('click', () => load(emptyGrid(n)));
  $('#ed-solved').addEventListener('click', () => load(solvedGrid(n)));
  const currentBtn = $('#ed-current');
  currentBtn.hidden = !shared.notation;
  currentBtn.addEventListener('click', () => {
    if (locked || !shared.notation) return;
    const st = holdNormalized(deserialize(shared.notation));
    if (st.n !== n) setSize(st.n);
    load(gridFromState(st));
  });

  // ---------- solve widget ----------
  const auto = mountAutoSolve($('#e-auto'), {
    getView: () => view,
    getN: () => n,
    stageEl: $('#e-stage'),
    setCaption: (text, sub) => { cap3d.innerHTML = sub ? `${text}<br><span class="cap-sub">${sub}</span>` : text; },
    onStart: () => {
      locked = true;
      mode = 'solve';
      $$('.stk:not(.fixed), .pal, .ed-actions button, .seg button').forEach((b) => { b.disabled = true; });
      view.clearPaint();
      view.setState(result.state.clone());
    },
    onEnd: ({ completed }) => {
      locked = false;
      $$('.stk:not(.fixed), .pal, .ed-actions button, .seg button').forEach((b) => { b.disabled = false; });
      if (!completed) { enterPaint(); refresh(); }
    },
  });

  buildNet();
  setBrush(brush);
  refresh();

  return () => {
    auto.dispose();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
    view.dispose();
    stage.dispose();
  };
}
