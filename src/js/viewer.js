// three.js layer: a Stage (renderer, camera, light, loop) and a CubeView that
// mirrors a CubeState and animates its turns.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CubeState, FACE_COLORS, FACE_NORMALS, parseMove, pieceSolved } from './cube-core.js';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DIM_COLOR = new THREE.Color('#4A5063');
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

export class Stage {
  constructor(container, opts = {}) {
    this.container = container;
    this.updaters = new Set();
    this.visible = true;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();

    const key = new THREE.DirectionalLight('#ffffff', 1.4);
    key.position.set(4, 8, 6);
    this.scene.add(key, new THREE.AmbientLight('#ffffff', 0.25));

    this.camera = new THREE.PerspectiveCamera(opts.fov || 30, 1, 0.1, 100);
    const cp = opts.cameraPos || [6.2, 5.1, 8.0];
    this.camera.position.set(...cp);
    this.camera.lookAt(0, 0, 0);

    if (opts.controls !== false) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.enablePan = false;
      this.controls.minDistance = 6;
      this.controls.maxDistance = 18;
      this.controls.autoRotate = !!opts.autoRotate && !REDUCED_MOTION;
      this.controls.autoRotateSpeed = 0.8;
    }

    this.shadow = makeContactShadow();
    this.shadow.position.y = -(opts.shadowY ?? 2.35);
    this.scene.add(this.shadow);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; });
    this.io.observe(container);
    this.resize();

    this.clock = new THREE.Clock();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (!this.visible || document.hidden) { this.clock.getDelta(); return; }
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      for (const fn of this.updaters) fn(dt, t);
      this.controls?.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the cube framed on narrow screens.
    this.camera.zoom = this.camera.aspect < 0.9 ? Math.max(0.62, this.camera.aspect * 0.95) : 1;
    this.camera.updateProjectionMatrix();
  }

  onTick(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.io.disconnect();
    this.controls?.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) [].concat(o.material).forEach((m) => m.dispose());
    });
    this.envTexture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}

function makeContactShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(21,25,58,0.32)');
  grd.addColorStop(1, 'rgba(21,25,58,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

function roundedSquare(size, r) {
  const s = size / 2;
  const sh = new THREE.Shape();
  sh.moveTo(-s + r, -s);
  sh.lineTo(s - r, -s);
  sh.quadraticCurveTo(s, -s, s, -s + r);
  sh.lineTo(s, s - r);
  sh.quadraticCurveTo(s, s, s - r, s);
  sh.lineTo(-s + r, s);
  sh.quadraticCurveTo(-s, s, -s, s - r);
  sh.lineTo(-s, -s + r);
  sh.quadraticCurveTo(-s, -s, -s + r, -s);
  return new THREE.ShapeGeometry(sh, 6);
}

// Curved arrow in the XY plane, centered on angle 0, traveling
// counterclockwise around +Z. The outer group orients it; the inner group
// is mirrored (scale.y = -1) for clockwise turns.
function makeArrow(radius, arcDeg, thick = 1) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  const headLen = 0.42 * thick;
  const half = THREE.MathUtils.degToRad(arcDeg / 2);
  const headAng = headLen / radius;
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const a = -half + ((2 * half - headAng * 0.8) * i) / 32;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const ink = new THREE.MeshBasicMaterial({ color: '#15193A', transparent: true, opacity: 0, depthTest: false });
  const halo = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthTest: false });
  const body = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.055 * thick, 10), ink);
  const bodyHalo = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.095 * thick, 10), halo);
  const tip = half - headAng / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.17 * thick, headLen, 20), ink);
  const headHalo = new THREE.Mesh(new THREE.ConeGeometry(0.23 * thick, headLen * 1.3, 20), halo);
  for (const h of [head, headHalo]) {
    h.position.set(Math.cos(tip) * radius, Math.sin(tip) * radius, 0);
    h.rotation.z = tip; // the cone points +Y: rotated, it follows the tangent
  }
  bodyHalo.renderOrder = headHalo.renderOrder = 10;
  body.renderOrder = head.renderOrder = 11;
  inner.add(bodyHalo, headHalo, body, head);
  group.add(inner);
  group.userData = { materials: [ink, halo], inner };
  group.visible = false;
  return group;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CubeView {
  constructor(stage, n, opts = {}) {
    this.stage = stage;
    this.n = n;
    this.size = opts.size || 3;
    this.cell = this.size / n;
    this.state = new CubeState(n);
    this.group = new THREE.Group();
    if (opts.position) this.group.position.set(...opts.position);
    stage.scene.add(this.group);
    this.speed = 1;
    this.queue = Promise.resolve();
    this.generation = 0;
    this.focus = new Set();
    this.showArrows = opts.arrows !== false;

    const bodyGeo = new RoundedBoxGeometry(this.cell * 0.985, this.cell * 0.985, this.cell * 0.985, 3, this.cell * 0.11);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: '#17181f', roughness: 0.42, metalness: 0, clearcoat: 0.35 });
    const stickerGeo = roundedSquare(this.cell * 0.86, this.cell * 0.15);
    this.meshes = [];
    this.stickers = [];
    for (const c of this.state.cubies) {
      const m = new THREE.Mesh(bodyGeo, bodyMat);
      for (const f of c.faces) {
        const color = new THREE.Color(FACE_COLORS[f]);
        const mat = new THREE.MeshPhysicalMaterial({
          color: color.clone(), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25,
          emissive: new THREE.Color('#000000'),
        });
        const s = new THREE.Mesh(stickerGeo, mat);
        const nrm = new THREE.Vector3(...FACE_NORMALS[f]);
        s.position.copy(nrm).multiplyScalar(this.cell * 0.4935);
        s.lookAt(nrm.clone().multiplyScalar(10));
        s.userData = { face: f, cubie: c, base: color, target: color.clone(), on: true };
        m.add(s);
        this.stickers.push(s);
      }
      m.userData.cubie = c;
      this.meshes[c.id] = m;
      this.group.add(m);
    }
    this.pivot = new THREE.Group();
    this.group.add(this.pivot);

    // Face arrows sit on a visible face; belt arrows wrap the turning layer
    // when that face looks away from the camera or the layer is inside.
    this.faceArrows = [makeArrow(this.size * 0.36, 110), makeArrow(this.size * 0.36, 200)];
    this.beltArrows = [makeArrow(this.size * 0.82, 62, 1.15), makeArrow(this.size * 0.82, 120, 1.15)];
    this.arrows = [...this.faceArrows, ...this.beltArrows];
    this.group.add(...this.arrows);
    this.arrowFade = 0;

    this.syncAll();
    this.untick = stage.onTick((dt, t) => this.tick(dt, t));
  }

  syncCubie(c) {
    const m = this.meshes[c.id];
    m.position.set(...c.pos).multiplyScalar(this.cell / 2);
    const mat = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...c.basis[0]), new THREE.Vector3(...c.basis[1]), new THREE.Vector3(...c.basis[2]),
    );
    m.quaternion.setFromRotationMatrix(mat);
  }

  syncAll() { this.state.cubies.forEach((c) => this.syncCubie(c)); }

  // Cancels pending animations and jumps to `state` instantly.
  setState(state) {
    this.generation++;
    this.queue = Promise.resolve();
    for (const m of this.pivot.children.slice()) this.group.attach(m);
    this.pivot.rotation.set(0, 0, 0);
    this.state = state;
    // Re-bind cubie references used by stickers and meshes.
    for (const s of this.stickers) s.userData.cubie = state.cubies[s.userData.cubie.id];
    for (const m of this.meshes) m.userData.cubie = state.cubies[m.userData.cubie.id];
    this.syncAll();
    this.arrowFade = 0;
    this.refreshMask();
  }

  // mask(cubie, face) -> boolean: whether the sticker keeps its color.
  setMask(mask, { instant = false } = {}) {
    this.mask = mask;
    this.refreshMask();
    if (instant) for (const s of this.stickers) s.material.color.copy(s.userData.target);
  }

  refreshMask() {
    for (const s of this.stickers) {
      const on = this.mask ? this.mask(s.userData.cubie, s.userData.face) : true;
      s.userData.on = on;
      s.userData.target.copy(on ? s.userData.base : DIM_COLOR);
      // Matte when dimmed: reflections would make gray read as white.
      s.material.clearcoat = on ? 0.6 : 0;
      s.material.roughness = on ? 0.42 : 0.85;
      s.material.envMapIntensity = on ? 1 : 0.35;
    }
  }

  setFocus(ids) { this.focus = new Set(ids); }

  tick(dt, t) {
    const k = 1 - Math.pow(0.0001, dt);
    const pulse = REDUCED_MOTION ? 0.22 : 0.16 + 0.16 * Math.sin(t * 5.2);
    for (const s of this.stickers) {
      const mat = s.material;
      mat.color.lerp(s.userData.target, k);
      const lit = s.userData.on && this.focus.has(s.userData.cubie.id);
      const want = lit ? pulse : 0;
      mat.emissive.copy(s.userData.base).multiplyScalar(want);
    }
    const fade = THREE.MathUtils.clamp(this.arrowFade, 0, 1);
    for (const a of this.arrows) {
      const [ink, halo] = a.userData.materials;
      const o = a.visible ? fade : 0;
      ink.opacity = o * 0.92;
      halo.opacity = o * 0.9;
    }
  }

  placeArrow(move) {
    for (const a of this.arrows) a.visible = false;
    if (!this.showArrows) return;
    const Z = new THREE.Vector3(0, 0, 1);
    const axis = AXES[move.axis];
    const cam = this.group.worldToLocal(this.stage.camera.position.clone()).normalize();
    const max = this.n - 1;
    const outer = !!move.layers && move.layers.includes(move.side * max);
    const faceOn = outer && axis.clone().multiplyScalar(move.side).dot(cam) > 0.2;
    const set = faceOn ? this.faceArrows : this.beltArrows;
    const a = set[Math.abs(move.q) === 2 ? 1 : 0];
    a.visible = true;
    const base = new THREE.Quaternion().setFromUnitVectors(Z, axis);
    // Turn the arc so its middle faces the camera.
    const local = cam.clone().applyQuaternion(base.clone().invert());
    const phi = Math.atan2(local.y, local.x);
    a.quaternion.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(Z, phi));
    a.userData.inner.scale.set(1, Math.sign(move.q) || 1, 1);
    if (faceOn) {
      a.position.copy(axis).multiplyScalar(move.side * (this.size / 2 + 0.06));
    } else {
      const layers = move.layers || [0];
      const avg = layers.reduce((t, v) => t + v, 0) / layers.length;
      a.position.copy(axis).multiplyScalar((avg * this.cell) / 2);
    }
  }

  // Animates one move; resolves when the logical state has the move applied.
  turn(token, duration = 420) {
    const gen = this.generation;
    this.queue = this.queue.then(() => new Promise((resolve) => {
      if (gen !== this.generation) return resolve(false);
      const move = parseMove(token, this.n);
      const cubies = this.state.affected(move);
      for (const c of cubies) this.pivot.attach(this.meshes[c.id]);
      this.placeArrow(move);
      const total = REDUCED_MOTION ? 1 : (duration * (Math.abs(move.q) === 2 ? 1.35 : 1)) / this.speed;
      const angle = (move.q * Math.PI) / 2;
      let elapsed = 0;
      const stop = this.stage.onTick((dt) => {
        if (gen !== this.generation) { stop(); resolve(false); return; }
        elapsed += dt * 1000;
        const p = Math.min(elapsed / total, 1);
        this.arrowFade = p < 0.15 ? p / 0.15 : p > 0.8 ? (1 - p) / 0.2 : 1;
        this.pivot.rotation.set(0, 0, 0);
        this.pivot.rotation[['x', 'y', 'z'][move.axis]] = angle * ease(p);
        if (p >= 1) {
          stop();
          this.state.applyMove(move);
          for (const c of cubies) this.group.attach(this.meshes[c.id]);
          this.pivot.rotation.set(0, 0, 0);
          for (const c of cubies) this.syncCubie(c);
          this.arrowFade = 0;
          resolve(true);
        }
      });
    }));
    return this.queue;
  }

  dispose() {
    this.generation++;
    this.untick();
  }
}

// Plays an algorithm step by step over a CubeView with play / pause / step.
export class AlgPlayer {
  constructor(view, { onChange } = {}) {
    this.view = view;
    this.onChange = onChange || (() => {});
    this.tokens = [];
    this.index = 0;
    this.playing = false;
    this.busy = false;
    this.pauseMs = 260;
  }

  load({ start, tokens, mask, focus }) {
    this.playing = false;
    this.busy = false;
    this.tokens = tokens;
    this.index = 0;
    this.startState = start;
    this.view.setState(start.clone());
    this.view.setMask(mask, { instant: true });
    this.view.setFocus(focus || []);
    this.emit();
  }

  restart() {
    this.playing = false;
    this.busy = false;
    this.index = 0;
    this.view.setState(this.startState.clone());
    this.emit();
  }

  emit() { this.onChange({ index: this.index, total: this.tokens.length, playing: this.playing }); }

  async step(dir = 1) {
    if (this.busy) return false;
    if (dir > 0 && this.index >= this.tokens.length) return false;
    if (dir < 0 && this.index <= 0) return false;
    this.busy = true;
    const token = dir > 0 ? this.tokens[this.index] : invert(this.tokens[this.index - 1]);
    this.index += dir;
    this.emit();
    const ok = await this.view.turn(token);
    this.busy = false;
    return ok;
  }

  async play() {
    if (this.index >= this.tokens.length) this.restart();
    if (this.playing) return;
    this.playing = true;
    this.emit();
    const gen = this.view.generation;
    while (this.playing && this.index < this.tokens.length) {
      const ok = await this.step(1);
      if (!ok || gen !== this.view.generation) break;
      await wait(this.pauseMs / this.view.speed);
    }
    if (gen === this.view.generation) {
      this.playing = false;
      this.emit();
    }
  }

  pause() { this.playing = false; this.emit(); }
}

function invert(t) {
  if (t.endsWith("2'")) return t.slice(0, -1);
  if (t.endsWith('2')) return t;
  return t.endsWith("'") ? t.slice(0, -1) : t + "'";
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Pieces whose position or orientation differs between two states.
export function changedPieces(a, b) {
  return a.cubies
    .filter((c, i) => {
      const d = b.cubies[i];
      return c.pos.some((v, k) => v !== d.pos[k]) || c.basis.some((v, k) => v.some((x, j) => x !== d.basis[k][j]));
    })
    .map((c) => c.id);
}

export { pieceSolved };
