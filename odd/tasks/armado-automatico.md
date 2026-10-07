# armado-automatico: armar el cubo desde cualquier estado

## Objetivo
Botón "Armado automático" en la vista de notación que arma el 3x3 o el 4x4
desde el estado en que el usuario lo dejó, con el método de la guía, narrando
paso y algoritmo, con velocidad elegible y explicando cada paso omitido.

## Tareas
- [x] T1 solver.js (3x3 por capas, 4x4 por reducción con paridades) y tests/verify-solver.mjs.
- [x] T2 Worker y UI: botón, velocidad, narración, lista de pasos, Detener.
- [x] T3 Docker corre también la verificación del solucionador; documentación.

## Evidencia
- `node tests/verify-solver.mjs 300 40` -> 1366 comprobaciones, 0 fallas
  (2026-10-06); promedio 174 giros en 3x3 y 311 en 4x4.
- La primera versión fallaba en 9 de 30 mezclas de 4x4 (últimas aristas con
  mitades a la misma altura); se corrigió con una preparación más profunda.
- `rotateVec` consumía el 55 % del tiempo; con la fórmula directa el caso
  difícil del 4x4 bajó de 4 a 8 s a cerca de 1 s.
- Navegador (Chrome con DevTools): 3x3 con M, E, S, x, y mezclados queda armado
  y orientado; 4x4 con r, u, f, Rw, Uw, Fw queda armado y muestra las dos
  paridades y un paso omitido con motivo; Detener devuelve el control.
