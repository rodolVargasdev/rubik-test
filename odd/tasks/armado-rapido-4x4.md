# armado-rapido-4x4: solución corta para cualquier mezcla del 4x4

## Objetivo
Que "Armado rápido" entregue siempre una solución en el 4x4, no solo la cota,
y mucho más corta que el armado automático (~300 giros).

## Por qué
Pedido del usuario (2026-10-07): "desarrolla el algoritmo matemático para que
sea funcional el armado de 4x4 rápido". El mínimo exacto del 4x4 no es
calculable en la práctica para mezclas al azar; la búsqueda exacta actual
demuestra hasta unos 7 giros y en lo demás solo devuelve la cota.

## Enfoque
Reducción por fases con búsqueda (IDA* y tablas de cota propias, sin
dependencias): centros, emparejado de aristas, corrección de paridad y 3x3 por
dos fases (`src/js/quick/two-phase.js`). Métrica: cada botón de la app cuenta
un giro. Se muestra como "la más corta encontrada" con la cota demostrada.

## Tareas
- [x] **R1** Solucionador por reducción del 4x4 integrado en `quickSolve`
  (fuente `reduction`), con pruebas y en el Docker. Ruta: delegada (algoritmo
  nuevo en varios archivos).
- [x] **R2** Interfaz: el 4x4 muestra y ejecuta la solución; fusión a `main` y
  publicación en Pages.

## Verificación
`node tests/verify-quick.mjs` y las demás suites de `AGENTS.md`; distribución
de longitudes y tiempos sobre mezclas al azar de 40 giros.

## Evidencia
- **R1** (2026-10-07). `src/js/quick/reduction4.js`, integrado en `quickSolve`
  (fuente `reduction`, 4000 ms: 30% búsqueda exacta, el resto reducción).
  Tablas en frío: modelo 40 ms, centros 0,6 s, biblioteca de 38 700 macros
  0,3 s, más las de dos fases (0,5 s, ya existentes); 8,8 MB en total. Largo
  (`verify-quick --long4 30`, 30 mezclas de 40 botones, 4000 ms): longitud
  mínima 53, mediana 61, máxima 80; tiempo 3,4 a 3,8 s; todas con replay
  armado, amarillo arriba y verde al frente. Un solo intento (sin variantes):
  mediana 75. Etapas medias: centros 14, emparejado 28, 3x3 19. Sin errores en
  257 casos extra (armado, solo rotaciones, paridades OLL y PLL, mezclas cortas).
  `verify-quick` 2249/0 (15 s), `verify-algorithms` 180/0, `verify-solver 60 8`
  278/0, `verify-last-layer all --sample 300` 5064/0, `verify-editor 80 15`
  2944/0, `verify-registry` 40/0, `docker build -t rubik-spa .` OK. Navegador
  (Chrome real): mezcla de 40 giros, el rápido tarda 3,5 s, muestra "entre 7 y
  72 giros", anima hasta armar, la caja de giros se desplaza sola, sin errores
  de consola. Limitación: el arranque en frío sin pasar el cursor por el botón
  suma ~1,3 s de tablas al primer cálculo.
- **R2** (2026-10-07). Verificación del coordinador sobre `accfb33`:
  `verify-quick` 2249/0; `--long4 10` con 4000 ms: longitud 56 a 72, mediana
  61, 3,1 a 3,8 s, todas armadas. Fusionado a `main` y publicado en Pages.
