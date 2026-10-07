# AGENTS.md: Cubo paso a paso

## Qué es
SPA estática que enseña a armar el 3x3 (por capas) y el 4x4 (reducción) con
animaciones three.js. Sin build: módulos ES servidos tal cual desde `src/`.

## Decisiones
- **Sujeción fija del cubo:** amarillo arriba (U), blanco abajo (D), verde al
  frente (F), naranja a la derecha (R), rojo a la izquierda (L), azul atrás (B).
  Todo texto y caso de la guía asume esa sujeción.
- **Truco del inverso:** cada caso define `alg` y opcionalmente `base`; el
  estado inicial es `base + inverso(alg)`, así reproducir `alg` siempre llega al
  objetivo. Si un caso real no se puede expresar así (emparejar aristas del
  4x4), usa `setup` y el objetivo pasa a ser `setup + alg`.
- **Ningún algoritmo entra sin verificar:** cada caso nuevo necesita su entrada
  en `EXPECT` de `tests/verify-algorithms.mjs`, que describe la situación
  inicial que el texto promete. La prueba falla si falta.
- **Notación:** mayúscula = cara; `w` = dos capas; minúscula = solo la segunda
  capa (r, u, l...); M/E/S siguen el sentido de L/D/F; x/y/z el de R/U/F.
- **Máscaras:** las piezas que no importan en un paso se pintan gris mate
  (`MASKS` en `content.js`); el gris es oscuro para no confundirse con el blanco.
- **Armado automático = mismo método que la guía:** `solver.js` no busca la
  solución óptima; en cada paso prueba por simulación combinaciones de los
  algoritmos de la guía (con ajustes de U y giros y) y elige la más corta que
  avanza sin romper lo armado. Cada paso que no hace falta se emite como
  omitido con su motivo. En el 4x4: centros por conmutadores de capa interior,
  aristas con Uw/Dw + R U R' F R' F' R, y para las últimas una preparación de
  hasta 4 giros exteriores antes de Dw R F' U R' F Dw' (los giros exteriores
  nunca separan una pareja).
- **Los centros del 4x4 se arman en su cara absoluta** (amarillo arriba, verde
  al frente), así que el 4x4 no necesita paso de orientación.
- **Editor "Pintar" (`#/pintar`):** red 2D (cruz: U arriba; L F R B; D abajo) con
  vista 3D en vivo. `editor/facelets.js` fija la geometría de la red y
  `editor/validate.js` valida (conteos, piezas que existen, duplicadas, giro de
  esquinas, volteo de aristas y paridad de permutación solo en 3x3) y arma el
  `CubeState`. En 3x3 los centros son fijos; en 4x4 las alas se distinguen de su
  gemela por la posición y la paridad no es error.
- **Armado rápido en la interfaz:** `autosolve.js` lo ejecuta en
  `quick-worker.js` (2 s, `target` 20 en 3x3).
- **Armado rápido del 4x4 por reducción con búsqueda** (`quick/reduction4.js`):
  búsqueda exacta hasta el 30% del tiempo; si no demuestra el mínimo, centros
  por tres tablas BFS exactas (marco fijo por la esquina DBL, cada giro más la
  rotación que la devuelve a su sitio), emparejado por haz sobre una biblioteca
  de macros que conservan los centros (giro de capa, giros exteriores, vuelta),
  paridad con `ALGS.OLL_PARITY`/`PLL_PARITY` según la lectura 3x3 del editor, y
  `two-phase.js` para el 3x3. Se exploran varias variantes dentro del
  presupuesto (4000 ms) y se entrega la más corta; todo se verifica por replay
  y, si falla, `moves: null`.
- **Textos de la interfaz en español neutro**, sin voseo y sin tipografía de IA.

## Agregar un rompecabezas
Todo vive en `src/js/puzzles/registry.js`; las vistas leen de ahí (rutas y
enlaces de las guías, selector de tamaño de notación y editor, pasos y
parámetros del armado rápido). `registerPuzzle` exige: `id`, `name`, `kind`,
`n`, `createState`, `steps`, `solvers` (`auto`, `quick`, `quickOptions`);
`guide` y `editor` son opcionales. Repite un id y lanza.
- **Familia NxN:** un 5x5 se agrega llamando una vez a `registerNxN(5, {...})`
  en `puzzles/index.js` cuando existan su guía (`content.js`) y su solucionador
  de enseñanza (`solver.js`); modelo, visor, editor y búsqueda rápida ya son
  genéricos. La búsqueda rápida solo cubre 3x3 y 4x4 hoy (`modelFor`).
- **Pyraminx:** necesita su propio modelo de estado y la geometría de un
  tetraedro en el visor (otro `kind`). Su espacio de estados es chico
  (933 120 posiciones sin contar las puntas), así que admite una tabla óptima
  completa por BFS en lugar de la búsqueda por encuentro a mitad de camino.
- Ningún puzzle entra sin su prueba: `tests/verify-registry.mjs` comprueba que
  cada uno resuelve una mezcla con ambos solucionadores.

## Trabajo en curso
- Fase 2 (paridades exhaustivas, armado rápido, editor para pintar el cubo,
  registro de rompecabezas): ver `odd/tasks/fase-2-paridades-armado-rapido-editor.md`.
- El repositorio es público por preferencia del usuario.
- Publicar en Pages: `git push origin "$(git subtree split --prefix src)":gh-pages`.

## Verificar
```bash
node tests/verify-algorithms.mjs
node tests/verify-solver.mjs 300 40
node tests/verify-last-layer.mjs all --sample 300
node tests/verify-quick.mjs
node tests/verify-editor.mjs
node tests/verify-registry.mjs
# Corrida larga y exhaustiva (62 208 + 248 832 estados; unos 6 min con 20 hilos), aparte del build:
node tests/verify-last-layer.mjs all
docker build -t rubik-spa .
```
