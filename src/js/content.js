// Guide content. Every case is built with the "inverse trick": the start
// state is target + inverse(alg), so playing `alg` always lands on target.
// tests/verify-algorithms.mjs checks that each start state is the situation
// the text describes.
import { CubeState, invertAlg, tokenize, normalFace } from './cube-core.js';

const has = (c, f) => c.faces.includes(f);
const keyOf = (c) => c.faces.slice().sort().join('');

export const MASKS = {
  all: () => true,
  cross: (c) => c.type === 'center' || (c.type === 'edge' && has(c, 'D')),
  firstLayer: (c) => c.type === 'center' || has(c, 'D'),
  f2l: (c) => c.type === 'center' || !has(c, 'U'),
  oll: (c, f) => c.type === 'center' || !has(c, 'U') || f === 'U',
  llEdges: (c, f) => c.type !== 'corner' || !has(c, 'U') || f === 'U',
  centers4: (c) => c.type === 'center',
  edges4: (c) => c.type !== 'corner',
};

// Focus helpers: return cubie ids to pulse.
const byKeys = (...keys) => (start) => start.cubies.filter((c) => keys.includes(keyOf(c))).map((c) => c.id);
const changed = (filter = () => true) => (start, target) => start.cubies
  .filter((c, i) => filter(c) && (c.pos.some((v, k) => v !== target.cubies[i].pos[k])
    || c.basis.some((b, k) => b.some((x, j) => x !== target.cubies[i].basis[k][j]))))
  .map((c) => c.id);
// Pieces of one kind that are not in their home slot (a swapped pair).
const misplaced = (filter) => (start) => start.cubies
  .filter((c) => filter(c) && c.pos.some((v, k) => v !== c.home[k])).map((c) => c.id);
const unpairedWings = (start) => {
  const slots = {};
  for (const c of start.cubies.filter((q) => q.type === 'edge')) {
    const k = c.pos.map((v) => (Math.abs(v) === start.n - 1 ? v : 0)).join(',');
    (slots[k] ||= []).push(c);
  }
  const ids = [];
  for (const ws of Object.values(slots)) {
    const [a, b] = ws;
    const nf = (q, f) => normalFace(start.stickerNormal(q, f));
    const same = keyOf(a) === keyOf(b) && a.faces.every((f) => nf(a, f) === nf(b, f));
    if (!same) ids.push(a.id, b.id);
  }
  return ids;
};

const rep = (alg, k) => Array(k).fill(alg).join(' ');
const SEXY = "R U R' U'";
const RIGHT = "U R U' R' U' F' U F";
const LEFT = "U' L' U L U F U' F'";
const OE = "F R U R' U' F'";
const SUNE = "R U R' U R U2 R'";
const CP = "U R U' L' U R' U' L";
const TWIST = "R' D' R D";
const DAISY = 'F2 R2 B2 L2';
// Two crossed halves in front (front-left top matches front-right bottom),
// built as a conjugate of the single-edge parity flip. Setup only: the
// learner never performs it.
const PAIR_SETUP = `L2 u2 F' r2 B2 U2 l U2 r' U2 r U2 F2 r F2 l' B2 r2 F u2 L2`;
// Last-layer 3x3 permutations used only to build the parity start states
// below (T, Y and Ua perms); the learner never performs them.
const T_PERM = "R U R' U' R' F R2 U' R' U' R U R' F'";
const Y_PERM = "F R U' R' U' R U R' F' R U R' U' R' F R F'";
const UA_PERM = "R U' R U R U R U' R' U' R2";
const UB_PERM = "R' U R' U' R' U' R' U R U R2";
const PLL_PARITY = "r2 U2 r2 Uw2 r2 u2";
// Parity start states: two edges (or two corners) swapped, everything else
// solved and all yellow up. Built with an even permutation plus the parity
// algorithm itself, so each one is a real state of a 4x4.
const PARITY_EDGES_ADJACENT = `U ${UA_PERM} U' ${PLL_PARITY}`;
const PARITY_CORNERS_ADJACENT = `U ${PLL_PARITY} U' ${T_PERM}`;
const PARITY_CORNERS_DIAGONAL = `U ${Y_PERM} ${UB_PERM} ${PLL_PARITY} U`;

export const ALGS = {
  SEXY, RIGHT, LEFT, OE, SUNE, CP, TWIST,
  OLL_PARITY: "r2 B2 U2 l U2 r' U2 r U2 F2 r F2 l' B2 r2",
  PLL_PARITY,
  PAIR: "Uw' R U R' F R' F' R Uw",
  LAST_TWO: "Dw R F' U R' F Dw'",
};

// groups: [count, label]; counts must add up to the move count.
function rg(alg, label, k) {
  return Array.from({ length: k }, (_, i) => [tokenize(alg).length, `${label} (vez ${i + 1} de ${k})`]);
}

export const GUIDE_3 = {
  id: '3x3',
  n: 3,
  title: 'Cubo 3x3: método por capas',
  hold: 'Amarillo arriba, verde al frente. No lo sueltes de esa posición salvo que el paso lo pida.',
  steps: [
    {
      id: 'margarita',
      title: 'La margarita',
      goal: 'Cuatro aristas blancas alrededor del centro amarillo, con el blanco mirando arriba.',
      how: [
        'Busca una arista con blanco (pieza de dos colores).',
        'Gira la cara de arriba hasta que el hueco donde va a llegar esté libre de pétalos.',
        'Sube la arista con un solo giro de la cara donde está. El blanco debe quedar mirando arriba.',
      ],
      tip: 'Regla de oro: antes de girar un lado, mira que no estés sacando un pétalo que ya pusiste.',
      cases: [
        { id: 'medio', name: 'Está en la capa del medio', base: DAISY, alg: "U R'", mask: 'cross', focus: byKeys('DR'),
          groups: [[1, 'Libera el hueco de arriba'], [1, 'Sube la arista con un giro']] },
        { id: 'abajo', name: 'Abajo, blanco hacia abajo', base: DAISY, alg: 'U F2', mask: 'cross', focus: byKeys('DF'),
          groups: [[1, 'Libera el hueco de arriba'], [1, 'Súbela con media vuelta']] },
        { id: 'lado', name: 'Abajo, blanco de lado', base: DAISY, alg: "F U L'", mask: 'cross', focus: byKeys('DL'),
          groups: [[1, 'Pásala a la capa del medio'], [1, 'Libera el hueco de arriba'], [1, 'Súbela con un giro']] },
      ],
    },
    {
      id: 'cruz',
      title: 'La cruz blanca',
      goal: 'Bajar cada pétalo a la cara blanca, alineado con el centro de su color.',
      how: [
        'Gira la cara de arriba hasta que el color lateral de un pétalo quede sobre el centro de su mismo color.',
        'Gira ese lado media vuelta (por ejemplo F2). El pétalo baja a su lugar.',
        'Repite con los otros tres pétalos.',
      ],
      tip: 'Si la cruz queda bien, cada arista blanca forma una T con el centro de su lado.',
      cases: [
        { id: 'uno', name: 'Un pétalo', base: '', alg: 'U F2', mask: 'cross', focus: byKeys('DF'),
          groups: [[1, 'Alinea el verde sobre el centro verde'], [1, 'Bájalo con media vuelta']] },
        { id: 'todos', name: 'La margarita completa', base: '', alg: 'U2 F2 U R2 U2 B2 U L2', mask: 'cross', focus: byKeys('DF', 'DR', 'DB', 'DL'),
          groups: [[2, 'Pétalo verde: alinea y baja'], [2, 'Pétalo naranja: alinea y baja'], [2, 'Pétalo azul: alinea y baja'], [2, 'Pétalo rojo: alinea y baja']] },
      ],
    },
    {
      id: 'esquinas-blancas',
      title: 'Esquinas blancas',
      goal: 'Completar la cara blanca con las cuatro esquinas, cada una entre sus dos colores.',
      how: [
        'Busca una esquina con blanco en la capa de arriba.',
        'Gira la cara de arriba hasta que la esquina quede justo encima de su lugar, delante a la derecha.',
        "Repite R U R' U' hasta que la esquina baje bien colocada (1, 3 o 5 veces según hacia dónde mire el blanco).",
      ],
      tip: 'No cuentes: repite y mira. Si una esquina blanca está abajo pero mal, hazlo una vez para subirla.',
      cases: [
        { id: 'derecha', name: 'Blanco a la derecha', base: '', alg: `U ${SEXY}`, mask: 'firstLayer', focus: byKeys('DFR'),
          groups: [[1, 'Ubícala encima de su lugar'], [4, "R U R' U' (una vez)"]] },
        { id: 'arriba', name: 'Blanco hacia arriba', base: '', alg: rep(SEXY, 3), mask: 'firstLayer', focus: byKeys('DFR'),
          groups: rg(SEXY, "R U R' U'", 3) },
        { id: 'frente', name: 'Blanco al frente', base: '', alg: rep(SEXY, 5), mask: 'firstLayer', focus: byKeys('DFR'),
          groups: rg(SEXY, "R U R' U'", 5) },
        { id: 'atrapada', name: 'Atrapada abajo y girada', base: '', alg: rep(SEXY, 2), mask: 'firstLayer', focus: byKeys('DFR'),
          groups: rg(SEXY, "R U R' U'", 2) },
      ],
    },
    {
      id: 'segunda-capa',
      title: 'Segunda capa',
      goal: 'Colocar las cuatro aristas del medio (las que no tienen amarillo).',
      how: [
        'Busca arriba una arista sin amarillo.',
        'Gira la cara de arriba hasta que su color del frente coincida con el centro de abajo: forma una T invertida.',
        'Mira su color de arriba: si coincide con el centro de la derecha, haz el algoritmo a la derecha; si coincide con el de la izquierda, el de la izquierda.',
      ],
      tip: 'Si una arista está metida en el medio pero al revés, haz el algoritmo a la derecha con cualquier arista de arriba para sacarla.',
      cases: [
        { id: 'derecha', name: 'Va a la derecha', base: '', alg: RIGHT, mask: 'f2l', focus: byKeys('FR'),
          groups: [[4, 'Abre el hueco de la derecha'], [4, 'Ciérralo con la arista dentro']] },
        { id: 'izquierda', name: 'Va a la izquierda', base: '', alg: LEFT, mask: 'f2l', focus: byKeys('FL'),
          groups: [[4, 'Abre el hueco de la izquierda'], [4, 'Ciérralo con la arista dentro']] },
        { id: 'volteada', name: 'Metida al revés', base: '', alg: `${RIGHT} U2 ${RIGHT}`, mask: 'f2l', focus: byKeys('FR'),
          groups: [[8, 'Sácala con el algoritmo a la derecha'], [1, 'Forma la T con el verde'], [8, 'Insértala bien']] },
      ],
    },
    {
      id: 'cruz-amarilla',
      title: 'Cruz amarilla',
      goal: 'Formar una cruz amarilla arriba. Las esquinas todavía no importan.',
      how: [
        'Mira solo las aristas amarillas de arriba: verás un punto, una L o una línea.',
        "Línea: ponla horizontal y haz F R U R' U' F'.",
        'L: ponla atrás a la izquierda y haz el algoritmo dos veces.',
        'Punto: haz el algoritmo una vez, coloca la L y sigue.',
      ],
      tip: 'Las piezas grises no importan en este paso: solo cuenta el amarillo de arriba.',
      cases: [
        { id: 'linea', name: 'Línea', base: '', alg: OE, mask: 'oll', focus: changed((c) => has(c, 'U') && c.type === 'edge'),
          groups: [[6, "F R U R' U' F'"]] },
        { id: 'ele', name: 'L', base: '', alg: rep(OE, 2), mask: 'oll', focus: changed((c) => has(c, 'U') && c.type === 'edge'),
          groups: [[6, 'Primera vez: la L se vuelve línea'], [6, 'Segunda vez: la línea se vuelve cruz']] },
        { id: 'punto', name: 'Punto', base: '', alg: `${OE} U2 ${OE} ${OE}`, mask: 'oll', focus: changed((c) => has(c, 'U') && c.type === 'edge'),
          groups: [[6, 'El punto se vuelve L'], [1, 'Lleva la L atrás a la izquierda'], [6, 'La L se vuelve línea'], [6, 'La línea se vuelve cruz']] },
      ],
    },
    {
      id: 'aristas-amarillas',
      title: 'Aristas amarillas',
      goal: 'Que cada arista de la cruz coincida con el centro de su lado.',
      how: [
        'Gira la cara de arriba hasta que coincidan al menos dos aristas con sus centros.',
        "Si son vecinas, ponlas atrás y a la derecha y haz R U R' U R U2 R'. Termina con U.",
        'Si son opuestas, haz el algoritmo una vez desde cualquier lado y gira arriba hasta ver dos vecinas atrás y a la derecha.',
      ],
      tip: 'Este algoritmo se llama Sune. Es el mismo que usan los speedcubers en el método CFOP.',
      cases: [
        { id: 'vecinas', name: 'Dos vecinas', base: '', alg: `${SUNE} U`, mask: 'llEdges', focus: changed((c) => has(c, 'U') && c.type === 'edge'),
          groups: [[7, "R U R' U R U2 R'"], [1, 'Alinea la capa de arriba']] },
        { id: 'opuestas', name: 'Dos opuestas', base: '', alg: `U' ${SUNE} U' ${SUNE} U`, mask: 'llEdges', focus: changed((c) => has(c, 'U') && c.type === 'edge'),
          groups: [[1, 'Empieza desde cualquier lado'], [7, 'Primera vez'], [1, 'Ahora hay dos vecinas: atrás y a la derecha'], [7, 'Segunda vez'], [1, 'Alinea la capa de arriba']] },
      ],
    },
    {
      id: 'posicion-esquinas',
      title: 'Esquinas amarillas a su lugar',
      goal: 'Llevar cada esquina a su rincón, aunque todavía esté girada.',
      how: [
        'Una esquina está en su lugar si tiene los tres colores de ese rincón, mire hacia donde mire el amarillo.',
        "Pon una esquina correcta delante a la derecha y haz U R U' L' U R' U' L (una o dos veces).",
        'Si ninguna está bien, hazlo una vez desde cualquier lado y quedará una correcta.',
      ],
      tip: 'Las aristas no se mueven de su lugar: el algoritmo solo rota tres esquinas.',
      cases: [
        { id: 'una', name: 'Una ya está bien', base: '', alg: CP, mask: 'all', focus: changed((c) => c.type === 'corner'),
          groups: [[8, "U R U' L' U R' U' L"]] },
        { id: 'ninguna', name: 'Ninguna está bien', base: '', alg: `${CP} U ${CP} U'`, mask: 'all', focus: changed((c) => c.type === 'corner'),
          groups: [[8, 'Primera vez, desde cualquier lado'], [1, 'Lleva la correcta adelante a la derecha'], [8, 'Segunda vez'], [1, 'Regresa la capa de arriba']] },
      ],
    },
    {
      id: 'girar-esquinas',
      title: 'Girar las esquinas amarillas',
      goal: 'Terminar el cubo: que el amarillo de cada esquina mire arriba.',
      how: [
        'Pon una esquina mal girada delante a la derecha, arriba.',
        "Repite R' D' R D hasta que su amarillo mire arriba (2 o 4 veces).",
        'Gira solo la cara de arriba (U) para traer la siguiente esquina mal girada al mismo sitio. Repite.',
      ],
      tip: 'A mitad del paso la parte de abajo se ve desarmada. Es normal: no gires el cubo completo y sigue; se arregla sola al final.',
      cases: [
        { id: 'dos', name: 'Dos esquinas', base: '', alg: `${rep(TWIST, 2)} U ${rep(TWIST, 4)} U'`, mask: 'all', focus: changed((c) => c.type === 'corner' && has(c, 'U')),
          groups: [...rg(TWIST, 'Primera esquina', 2), [1, 'Trae la siguiente con U'], ...rg(TWIST, 'Segunda esquina', 4), [1, 'Alinea y listo']] },
        { id: 'tres', name: 'Tres esquinas', base: '', alg: `${rep(TWIST, 2)} U ${rep(TWIST, 2)} U ${rep(TWIST, 2)} U2`, mask: 'all', focus: changed((c) => c.type === 'corner' && has(c, 'U')),
          groups: [...rg(TWIST, 'Primera esquina', 2), [1, 'Trae la siguiente con U'], ...rg(TWIST, 'Segunda esquina', 2), [1, 'Trae la siguiente con U'], ...rg(TWIST, 'Tercera esquina', 2), [1, 'Alinea y listo']] },
      ],
    },
  ],
};

export const GUIDE_4 = {
  id: '4x4',
  n: 4,
  title: 'Cubo 4x4: método de reducción',
  hold: 'Amarillo arriba, verde al frente, naranja a la derecha. En el 4x4 tú decides dónde va cada centro: respeta ese orden.',
  steps: [
    {
      id: 'centros-opuestos',
      title: 'Centros amarillo y blanco',
      goal: 'Armar el bloque 2x2 amarillo arriba y luego el blanco en la cara opuesta.',
      how: [
        'Arma el centro amarillo arriba: junta piezas de dos en dos formando barras.',
        "Para subir una pieza al centro de arriba usa una capa interior: r U r'.",
        "Para meter una barra completa: r U2 r'. La capa interior baja, la cara de arriba gira y la capa vuelve.",
        'Gira el cubo para dejar el amarillo abajo, arma el blanco arriba de la misma forma y vuelve a poner el amarillo arriba.',
      ],
      tip: 'La letra minúscula (r) mueve solo la segunda capa desde la derecha. Las piezas grises no importan aquí.',
      cases: [
        { id: 'pieza', name: 'Subir una pieza', base: '', alg: "r U r'", mask: 'centers4', focus: changed((c) => c.type === 'center'),
          groups: [[1, 'Sube la columna interior'], [1, 'Gira arriba para guardar la pieza'], [1, 'Baja la columna']] },
        { id: 'barra', name: 'Meter una barra', base: '', alg: "r U2 r'", mask: 'centers4', focus: changed((c) => c.type === 'center'),
          groups: [[1, 'Sube la barra'], [1, 'Media vuelta arriba'], [1, 'Baja la columna vacía']] },
      ],
    },
    {
      id: 'centros-laterales',
      title: 'Los cuatro centros laterales',
      goal: 'Armar verde, naranja, azul y rojo en el orden correcto.',
      how: [
        'Con amarillo arriba y verde al frente: naranja a la derecha, azul atrás, rojo a la izquierda.',
        'Usa la misma técnica de barras, girando solo las capas que no rompen los centros amarillo y blanco.',
        'Para los dos últimos, pon uno al frente y otro arriba y cambia barras entre ellos.',
      ],
      tip: 'Si te equivocas de orden, el cubo parecerá armable pero nunca cerrará como 3x3.',
      cases: [
        { id: 'ultimos', name: 'Los dos últimos', base: '', alg: "Rw U2 Rw'", mask: 'centers4', focus: changed((c) => c.type === 'center'),
          groups: [[1, 'Sube la barra con dos capas'], [1, 'Media vuelta arriba'], [1, 'Regresa las dos capas']] },
      ],
    },
    {
      id: 'aristas',
      title: 'Emparejar aristas',
      goal: 'Unir las 24 medias aristas en 12 aristas dobles.',
      how: [
        'Busca dos medias aristas iguales: una adelante a la izquierda arriba y otra adelante a la derecha abajo.',
        "Une con Uw' (dos capas de arriba).",
        "Guarda la pareja con R U R' F R' F' R: sale la arista lista y entra una sin pareja.",
        'Repara los centros con Uw.',
      ],
      tip: 'Los centros se rompen un momento y se reparan con el último giro. Repite hasta que solo queden dos aristas sin pareja.',
      cases: [
        { id: 'par', name: 'Emparejar una arista', setup: PAIR_SETUP, alg: ALGS.PAIR, mask: 'edges4', focus: unpairedWings,
          groups: [[1, 'Une las dos mitades'], [7, 'Guarda la pareja arriba y trae otra arista'], [1, 'Repara los centros']] },
        { id: 'ultimas', name: 'Las dos últimas', base: '', alg: ALGS.LAST_TWO, mask: 'edges4', focus: unpairedWings,
          groups: [[1, 'Desplaza las mitades de abajo'], [5, 'Cambia de lugar las mitades de arriba'], [1, 'Regresa: cada mitad encuentra su pareja']] },
      ],
    },
    {
      id: 'como-3x3',
      title: 'Resolver como un 3x3',
      goal: 'Seguir los 8 pasos del 3x3 girando solo las caras exteriores.',
      how: [
        'Ahora cada centro 2x2 es un centro de 3x3 y cada arista doble es una arista.',
        'Usa exactamente los mismos algoritmos del 3x3 con las caras exteriores.',
        'Si aparece un caso imposible para un 3x3, es paridad: los dos pasos siguientes lo resuelven.',
      ],
      tip: 'Nunca gires capas interiores en esta etapa: separarías las aristas que emparejaste.',
      cases: [
        { id: 'segunda', name: 'Segunda capa en 4x4', base: '', alg: RIGHT, mask: 'f2l', focus: byKeys('FR'),
          groups: [[4, 'Abre el hueco de la derecha'], [4, 'Ciérralo con la arista doble dentro']] },
        { id: 'sune', name: 'Sune en 4x4', base: '', alg: `${SUNE} U`, mask: 'llEdges', focus: changed((c) => has(c, 'U') && c.type === 'edge'),
          groups: [[7, "R U R' U R U2 R'"], [1, 'Alinea la capa de arriba']] },
      ],
    },
    {
      id: 'paridad-oll',
      title: 'Paridad: una arista volteada',
      goal: 'Arreglar una sola arista doble volteada en la cruz amarilla.',
      how: [
        'Lo verás en la cruz amarilla: una o tres aristas con el amarillo de lado, algo imposible en un 3x3.',
        'Pon la arista volteada al frente, arriba.',
        "Haz r2 B2 U2 l U2 r' U2 r U2 F2 r F2 l' B2 r2 y sigue con la cruz normal.",
      ],
      tip: 'Es largo pero simétrico: empieza y termina con r2, y B2, U2, F2 aparecen en pares.',
      cases: [
        { id: 'oll', name: 'Arista volteada', base: '', alg: ALGS.OLL_PARITY, mask: 'oll', focus: changed((c) => c.type === 'edge'),
          groups: [[15, 'Algoritmo de paridad de orientación']] },
      ],
    },
    {
      id: 'paridad-pll',
      title: 'Paridad: dos piezas intercambiadas',
      goal: 'Cambiar dos aristas dobles para que lo que quede sea un caso normal del 3x3.',
      how: [
        'Lo verás al final: dos aristas o dos esquinas cambiadas entre sí (o una mezcla de ambas), algo imposible en un 3x3.',
        'La mezcla es lo más común, unas 5 de cada 6 veces. El algoritmo es el mismo en todos los casos.',
        "Haz r2 U2 r2 Uw2 r2 u2 sin importar dónde estén las piezas cambiadas.",
        'Con aristas opuestas el cubo queda armado. En los demás casos queda un caso normal del 3x3: termínalo con sus pasos.',
      ],
      tip: 'Uw2 gira dos capas de arriba; u2 gira solo la segunda capa.',
      cases: [
        { id: 'pll', name: 'Dos aristas opuestas', base: '', alg: ALGS.PLL_PARITY, mask: 'all', focus: changed((c) => c.type === 'edge'),
          groups: [[6, 'Algoritmo de paridad de permutación']] },
        { id: 'aristas-vecinas', name: 'Dos aristas vecinas', setup: PARITY_EDGES_ADJACENT, alg: ALGS.PLL_PARITY, mask: 'all', focus: changed((c) => c.type === 'edge'),
          groups: [[6, 'Paridad: cambia dos aristas y queda un caso del 3x3']] },
        { id: 'esquinas-vecinas', name: 'Dos esquinas vecinas', setup: PARITY_CORNERS_ADJACENT, alg: ALGS.PLL_PARITY, mask: 'all',
          focus: (s, t) => [...misplaced((c) => c.type === 'corner')(s), ...changed((c) => c.type === 'edge')(s, t)],
          groups: [[6, 'Paridad: cambia dos aristas y queda un caso del 3x3']] },
        { id: 'esquinas-diagonal', name: 'Dos esquinas en diagonal', setup: PARITY_CORNERS_DIAGONAL, alg: ALGS.PLL_PARITY, mask: 'all',
          focus: (s, t) => [...misplaced((c) => c.type === 'corner')(s), ...changed((c) => c.type === 'edge')(s, t)],
          groups: [[6, 'Paridad: cambia dos aristas y queda un caso del 3x3']] },
      ],
    },
  ],
};

// Builds start/target states for a case.
export function buildCase(n, c) {
  let start;
  let target;
  if (c.setup) {
    start = new CubeState(n).apply(c.setup);
    target = start.clone().apply(c.alg);
  } else {
    target = new CubeState(n).apply(c.base);
    start = target.clone().apply(invertAlg(c.alg));
  }
  const focus = c.focus ? c.focus(start, target) : [];
  return { start, target, tokens: tokenize(c.alg), focus, mask: MASKS[c.mask] };
}

// Expands [count, label] groups into one label per move index.
export function groupRanges(c) {
  const out = [];
  let i = 0;
  for (const [count, label] of c.groups) {
    out.push({ from: i, to: i + count, label });
    i += count;
  }
  return out;
}

export const NOTATION = [
  { k: 'U', name: 'Arriba', en: 'Up' },
  { k: 'D', name: 'Abajo', en: 'Down' },
  { k: 'R', name: 'Derecha', en: 'Right' },
  { k: 'L', name: 'Izquierda', en: 'Left' },
  { k: 'F', name: 'Frente', en: 'Front' },
  { k: 'B', name: 'Atrás', en: 'Back' },
];

// Algorithms a learner memorizes per method. CFOP: 57 OLL + 21 PLL.
// Roux: 42 CMLL. This guide: the six algorithms listed in GUIDE_3.
export const METHOD_LOAD = [
  { name: 'Por capas (esta guía)', count: 6, note: 'Los demás pasos son intuitivos.' },
  { name: 'Roux', count: 42, note: '42 casos de CMLL, más bloques intuitivos.' },
  { name: 'CFOP completo', count: 78, note: '57 de OLL y 21 de PLL, más F2L.' },
];
