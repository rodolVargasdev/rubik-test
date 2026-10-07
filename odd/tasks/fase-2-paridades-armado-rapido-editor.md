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

## Decisión pendiente

El trabajo cruza los umbrales de SDD (más de 5 archivos en varias capas,
requerimiento escrito, se retoma otro día). Se propuso entrar por SDD y el
usuario aún no lo decidió: preguntarlo al retomar, en una línea.

## Cómo verificar el estado actual

```bash
node tests/verify-algorithms.mjs
node tests/verify-solver.mjs 300 40
docker build -t rubik-spa .
```
