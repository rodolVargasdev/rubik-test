# rubik-spa: guía visual para armar el cubo 3x3 y el 4x4

## Objetivo
SPA con animaciones 3D (three.js) que enseña paso a paso, de forma replicable,
el método por capas para el 3x3 y el método de reducción para el 4x4, y que
explica con animaciones por qué son los métodos indicados para aprender.

## Restricciones
- Textos en español neutro, sin voseo y sin tipografía vetada (rayas, flechas,
  comillas curvas, puntos medios, elipsis de un carácter).
- Toda dependencia se registra en docs/STACK_TECNOLOGICO.md con versión fija.
- Docker primero: imagen nginx que sirve los estáticos.
- Ningún algoritmo entra a la guía sin verificarse por simulación (tests/).

## Tareas
- [x] T1 Motor lógico NxN (cube-core.js) y verificación por simulación de cada algoritmo y caso.
- [x] T2 Visor three.js: cubo NxN, animación de giros, flecha de giro, máscaras de piezas.
- [x] T3 Contenido: pasos 3x3 (por capas) y 4x4 (reducción) con casos verificados.
- [x] T4 SPA: inicio, notación interactiva, guía 3x3, guía 4x4, por qué.
- [x] T5 Docker, stack tecnológico, verificación visual en navegador.

## TDD
Modo: apagado (no hay configuración previa). Se corren pruebas funcionales con
`node tests/verify-algorithms.mjs`.

## Ruta
Directa en línea: un solo escritor; el dominio está claro.

## Evidencia
- T1: `node tests/verify-algorithms.mjs` -> 159 comprobaciones correctas, 0 fallas
  (2026-10-06). La prueba detectó dos afirmaciones falsas del texto (Sune desde
  aristas opuestas; cuándo se forma la pareja en el 4x4) que se corrigieron.
- T2 a T4: revisión visual en el navegador: inicio, notación (flecha de cara y
  de cinturón), guía 3x3, guía 4x4, por qué; móvil 375 px sin desborde.
- T5: `docker build` corre la verificación dentro de la imagen; contraprueba con
  un algoritmo roto detiene el build; contenedor responde 200; Docker Scout sin
  paquetes vulnerables (2026-10-06).

## Pendiente
- CI: no existe todavía (regla: apagado antes de la versión 1).
- Revisión RDD: no se ejecutó.
