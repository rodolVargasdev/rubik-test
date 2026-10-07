# Cubo paso a paso

Guía visual en 3D para armar el cubo de Rubik:

- **3x3 por capas**: 8 pasos y 6 algoritmos cortos.
- **4x4 por reducción**: centros, aristas, resolver como 3x3 y los dos casos de paridad.
- **Por qué**: animaciones que explican por qué estos métodos son los que conviene aprender.

- **Armado automático** (en la notación y en las guías 3x3 y 4x4): arma el cubo desde el estado
  en que se dejó, con los mismos pasos de la guía; narra cada paso y algoritmo y
  explica por qué omite los pasos que no hacen falta.

Cada caso se reproduce giro a giro, con una flecha que marca el giro, las piezas
que no importan en gris y la pieza protagonista resaltada.

Publicado en https://rodolvargasdev.github.io/rubik-test/

## Publicar en GitHub Pages

Pages sirve la rama `gh-pages`, que contiene solo `src/` en la raíz. Antes de
publicar, corra las pruebas (Pages no pasa por el build de la imagen):

```bash
node tests/verify-algorithms.mjs && node tests/verify-solver.mjs 60 8
```

```bash
git push origin "$(git subtree split --prefix src)":gh-pages
```

## Arranque (vía principal: contenedor)

```bash
docker build -t rubik-spa .
docker run --rm -p 8080:8080 rubik-spa
```

Luego abra http://localhost:8080. El build corre antes la verificación de
todos los algoritmos; si un caso no arranca donde el texto dice, la imagen no
se construye.

## Atajo local (solo desarrollo)

```bash
python tools/dev_server.py 5173
```

Sirve `src/` sin caché en http://localhost:5173.

## Pruebas

```bash
node tests/verify-algorithms.mjs
node tests/verify-solver.mjs 300 40
```

Simula cada caso de la guía y comprueba que el estado inicial es la situación
descrita en el texto (por ejemplo: "tres pétalos y la arista abajo con el blanco
de lado") y que el algoritmo llega al objetivo. `verify-solver.mjs` arma
mezclas al azar (300 de 3x3 y 40 de 4x4 con los argumentos de arriba, incluidas
capas interiores y giros de todo el cubo) y comprueba que el cubo queda armado,
orientado y que cada paso omitido trae su motivo. Incluye contrapruebas que
demuestran que las guardas detectan un algoritmo roto.

## Estructura

| ruta | qué contiene |
|---|---|
| `src/js/cube-core.js` | modelo lógico NxN del cubo, sin dependencias |
| `src/js/viewer.js` | escena three.js, animación de giros, flechas y máscaras |
| `src/js/content.js` | pasos, casos y algoritmos de la guía |
| `src/js/solver.js` | solucionador didáctico 3x3 y 4x4 con narración |
| `src/js/solver-worker.js` | corre el solucionador sin congelar la página |
| `src/js/app.js` | SPA: rutas, vistas y reproductor |
| `tests/verify-algorithms.mjs` | verificación por simulación de la guía |
| `tests/verify-solver.mjs` | verificación del armado automático |
| `docs/STACK_TECNOLOGICO.md` | dependencias y versiones fijadas |
