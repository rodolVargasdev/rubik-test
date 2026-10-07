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
- [ ] **R1** Solucionador por reducción del 4x4 integrado en `quickSolve`
  (fuente `reduction`), con pruebas y en el Docker. Ruta: delegada (algoritmo
  nuevo en varios archivos).
- [ ] **R2** Interfaz: el 4x4 muestra y ejecuta la solución; fusión a `main` y
  publicación en Pages.

## Verificación
`node tests/verify-quick.mjs` y las demás suites de `AGENTS.md`; distribución
de longitudes y tiempos sobre mezclas al azar de 40 giros.

## Evidencia
