# fase-2: paridades exhaustivas, armado rápido, editor de cubo y extensibilidad

Documento de traspaso entre PCs (2026-10-07). Lo verificado aquí se midió en la
sesión anterior; los estados se pueden reproducir con los algoritmos citados.

## Requerimientos del usuario (por escrito)

1. **4x4, esquinas intercambiadas en la última capa.** Exponer y resolver con
   rigor el caso de dos esquinas intercambiadas con todo el amarillo arriba
   (en diagonal y vecinas), y en general todos los casos límite.
2. **Botón "Armado rápido".** Calcular el camino más corto, trazarlo y
   ejecutarlo. Si la mezcla se resuelve en 3 giros, debe usar 3.
3. **Configurar el cubo pintándolo** (reemplaza la idea de la foto). Una
   interfaz elegante, en 3D con three.js o en una red 2D, donde el usuario pinta
   cada cara como tiene su cubo en ese momento; con eso se arma el estado y se
   pueden usar el armado automático y el rápido.
4. **Extensibilidad.** Todo debe ser repetible para sumar Pyraminx, 5x5 u
   otros.

## Hallazgos verificados

- El solucionador **sí arma** los dos estados del punto 1, pero:
  - la guía del 4x4 no los muestra (solo la paridad de dos aristas opuestas);
  - la narración es falsa: dice "Dos aristas quedaron intercambiadas" cuando lo
    intercambiado son dos esquinas (`lastLayerPerm` en `src/js/solver.js`
    tiene un solo rótulo fijo para la paridad PLL).
- Estados de prueba (aplicar sobre un 4x4 armado):
  - Esquinas **vecinas** intercambiadas, resto armado:
    `R U R' U' R' F R2 U' R' U' R U R' F' U r2 U2 r2 Uw2 r2 u2 U'`
  - Esquinas en **diagonal**: se encontró combinando ese estado con PLL de 3x3
    (T, Y, Ua, Ub) y ajustes de U, 52 giros. Recrearlo con una búsqueda igual:
    composiciones `[A, U^i, B, U^j, C]` sobre {Y, T, Ua, Ub, vecinas} y
    quedarse con el estado donde solo dos esquinas diagonales difieren y todas
    tienen el amarillo arriba.
- Las pruebas actuales usan mezclas al azar: no garantizan cubrir todos los
  casos de la última capa.

## Plan propuesto

1. **Rigor en la última capa (punto 1).**
   - Prueba exhaustiva: enumerar todos los estados de la última capa del 3x3 y
     del 4x4 reducido (BFS con generadores Sune, PLLs, paridades y U) y correr
     sobre cada uno las etapas finales del solucionador. Debe armar todos y
     nombrar bien cada caso. Es una corrida larga, aparte del build; dentro del
     Docker queda una muestra.
   - Narración de la paridad PLL según el caso real: aristas opuestas, aristas
     vecinas, esquinas vecinas, esquinas en diagonal.
   - Guía 4x4: un caso animado por familia de paridad, con su entrada en
     `EXPECT` de `tests/verify-algorithms.mjs`.
2. **Armado rápido (punto 2).**
   - 3x3: búsqueda exacta IDA* con cotas inferiores admisibles (tablas de la
     fase 1 de Kociemba: orientación de esquinas, de aristas y posición de la
     capa media) y límite de tiempo, en un worker. Si termina: "mínimo
     demostrado: N giros". Si no: solución corta en dos fases y mensaje honesto
     con la cota ("entre X e Y giros").
   - 4x4: no existe un método práctico para el mínimo en estados al azar. Exacto
     solo para mezclas cortas con límite de tiempo; si no alcanza, mostrar la
     mejor solución encontrada sin llamarla mínima.
   - Métrica por decidir con el usuario: recomendación, contar `U2` como 1 giro
     (métrica de media vuelta, la convención estándar).
   - Decidir si se escribe la búsqueda propia o se usa una biblioteca (por
     ejemplo, una implementación de dos fases). Si entra una dependencia, se
     informa y se registra en `docs/STACK_TECNOLOGICO.md` con auditoría.
3. **Editor para pintar el cubo (punto 3).**
   - Paleta de 6 colores; pintar tocando los stickers del cubo 3D (raycasting
     en three.js) y opcionalmente sobre una red 2D desplegada; rotar con la
     órbita existente.
   - Validación con mensajes claros: 9 (o 16) stickers por color, piezas que
     existen, orientación y paridad posibles. Si es imposible, indicar qué
     pieza está mal en lugar de rechazar sin explicar.
   - Convertir los colores pintados en un `CubeState` y entregarlo al armado
     automático y al rápido.
4. **Extensibilidad (punto 4).**
   - Registro de rompecabezas: cada uno aporta modelo, visor, método
     (contenido), solucionadores y pruebas con una interfaz común. La familia
     NxN es una sola implementación parametrizada por `n`.
   - Hoy `cube-core.js` y `viewer.js` ya sirven para cualquier NxN; `solver.js`
     y `content.js` son específicos de 3x3 y 4x4. Pyraminx necesita geometría
     propia (tetraedro); su espacio de estados es chico y admite una tabla
     óptima completa.

## Decisión de flujo (2026-10-07)

Se propuso SDD; el usuario delegó la decisión ("lo más rápido y con más
calidad"). Se entra por **ODD sobre este documento**, sin SDD: el plan, el
requerimiento escrito y la continuidad entre PCs ya viven aquí, y la calidad la
dan las pruebas exhaustivas con contraprueba, no artefactos de especificación.
Las decisiones de producto (métrica del armado rápido, forma del editor) se
preguntan al llegar a cada punto, una por vez.

- Rama: `feat/fase-2-paridades` (desde `main` @ `bea72df`).
- TDD: apagado (no hay configuración que lo active). Se corren las pruebas
  funcionales de "Cómo verificar"; la prueba nueva se escribe antes que la
  corrección y debe fallar primero sobre la narración actual.
- CI: apagado antes de la versión 1 (regla del usuario); solo existe el
  despliegue de Pages.

## Tareas

- [x] **T1.1** Prueba exhaustiva de la última capa (`tests/verify-last-layer.mjs`):
  enumerar por BFS todos los estados de la última capa con colores (3x3:
  62 208; 4x4 reducido: 248 832), resolver cada uno y comprobar armado, orden
  de pasos y rótulo de paridad contra un oráculo independiente. Contrapruebas:
  el conteo exacto del BFS y un oráculo que distingue un estado con paridad de
  uno sin ella. Muestra dentro del Docker. Ruta: delegada (2 archivos no
  triviales: prueba y solucionador).
- [x] **T1.2** Narración de la paridad PLL según el caso real (aristas opuestas,
  aristas vecinas, esquinas vecinas, esquinas en diagonal, mixto) y rótulo del
  paso. Mismo commit que T1.1.
- [x] **T1.3** Guía 4x4: un caso animado por familia de paridad PLL, con su
  entrada en `EXPECT`. Ruta: delegada (contenido + prueba).
- [x] **T1.4** Hallazgos de la revisión `review-63345b73fbfeb527` (aprobada,
  no bloqueantes): (a) el arnés paralelo no comprueba que cada hilo entregó sus
  contadores ni su código de salida, y podría informar 0 fallas con parte del
  espacio sin juzgar; (b) en Docker cada hilo repite el BFS completo, así que la
  memoria crece con los núcleos del host: limitar hilos en modo muestra; (c) el
  rótulo del caso en la prueba replica la regla del solucionador y no es un
  oráculo independiente: anclar "aristas vecinas" y "caso mixto" con estados
  conocidos y clasificar por un método distinto; (d) sugerencias: guardas de
  `seg` en `named4`, rechazar `--sample` inválido, comprobar que los objetivos
  de `esquinas-diagonal` y `aristas-vecinas` quedan sin armar.
- [ ] **T2** Armado rápido. Métrica decidida por el usuario (2026-10-07):
  **cada botón de la app cuenta un giro** (3x3: caras y capas medias M/E/S,
  media vuelta incluida; 4x4: cualquier bloque de capas contiguas; rotaciones
  x/y/z cuentan cero). Así una mezcla de 3 botones se resuelve en 3 como máximo.
  Sin dependencias nuevas: búsqueda propia, verificable por simulación.
  - [ ] **T2.1** Búsqueda exacta por encuentro a mitad de camino (ambos
    tamaños) en un worker con límite de tiempo: tabla de estados a profundidad
    <= 3 desde el armado y búsqueda desde la mezcla hasta completar. Demuestra
    el mínimo cuando lo encuentra. Prueba: mezclas de k botones dan solución
    <= k que arma al reproducirla; contraprueba de minimalidad contra
    enumeración exhaustiva independiente para k <= 3.
  - [ ] **T2.2** 3x3 largo: IDA* con tablas de cota (orientación de esquinas,
    de aristas, capa media) y, si se agota el tiempo, solución en dos fases
    mostrada como "la más corta encontrada" con la cota inferior demostrada
    ("entre X e Y giros"). 4x4 largo: sin mínimo práctico; se dice con
    honestidad y se ofrece el armado automático.
  - [ ] **T2.3** Interfaz: botón "Armado rápido" junto al automático; traza la
    lista de giros con su cuenta y la etiqueta "mínimo demostrado" o la cota, y
    la ejecuta animada. Revisión en navegador.
- [ ] **T3** Editor para pintar el cubo. Antes: decidir con el usuario la forma.
- [ ] **T4** Registro de rompecabezas.

## Evidencia

- **T1.1 + T1.2** (2026-10-07). RED antes de corregir (`verify-last-layer.mjs 4
  --sample 2000`): 972 fallas, todas de narración (el solucionador ya armaba
  todo). Después:
  - `verify-last-layer.mjs 3`: 62 208 estados, 497 676 correctas, 0 fallas, 24 s.
  - `verify-last-layer.mjs 4`: 248 832 estados, 0 fallas, 262 s con 20 hilos.
    Casos PLL narrados: aristas opuestas 3456, aristas vecinas 6912, esquinas
    vecinas 6912, esquinas en diagonal 3456, mixto 103 680.
  - `verify-last-layer.mjs all --sample 300`: 5003 correctas, 0 fallas.
  - `verify-algorithms.mjs`: 159/0. `verify-solver.mjs 60 8`: 278/0.
  - Hallazgo: el caso mixto (esquinas y aristas desordenadas a la vez) es el
    83 % de los estados con paridad PLL; la guía debería decirlo (T1.3).

## Cómo verificar el estado actual

```bash
node tests/verify-algorithms.mjs
node tests/verify-solver.mjs 300 40
node tests/verify-last-layer.mjs all --sample 300
# Corrida larga y exhaustiva (62 208 + 248 832 estados; unos 6 min con 20 hilos):
node tests/verify-last-layer.mjs all
docker build -t rubik-spa .
```
- **T1.3** (2026-10-07). Guía 4x4: casos `aristas-vecinas`, `esquinas-vecinas`,
  `esquinas-diagonal` (con `setup`; animan los 6 giros de la paridad y terminan
  en un caso normal del 3x3, como lo hace el solucionador) y texto del caso
  mixto. `verify-algorithms.mjs`: 178/0 (antes 159), con contrapruebas que
  distinguen vecinas de diagonal y aristas de esquinas. Revisado en el
  navegador: el caso diagonal se ve con todo el amarillo arriba, sin errores
  de consola.
- **T1.4** (2026-10-07, commit siguiente a `b113b69`). Arnés con guarda de
  hilos (3 autopruebas saboteadas que deben fallar), BFS único compartido,
  oráculo por intercambio aplicado: coincide con el solucionador en los 248 832
  estados. `all --sample 300`: 5128/0 en 8 s; `3`: 497 725/0 en 22 s; `4`:
  2 115 212/0 en 201 s; `verify-algorithms`: 180/0; `docker build` OK.
