# Cubo paso a paso

Guía visual en 3D para armar el cubo de Rubik:

- **3x3 por capas**: 8 pasos y 6 algoritmos cortos.
- **4x4 por reducción**: centros, aristas, resolver como 3x3 y los dos casos de paridad.
- **Por qué**: animaciones que explican por qué estos métodos son los que conviene aprender.

Cada caso se reproduce giro a giro, con una flecha que marca el giro, las piezas
que no importan en gris y la pieza protagonista resaltada.

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
```

Simula cada caso de la guía y comprueba que el estado inicial es la situación
descrita en el texto (por ejemplo: "tres pétalos y la arista abajo con el blanco
de lado") y que el algoritmo llega al objetivo. Incluye contrapruebas que
demuestran que las guardas detectan un algoritmo roto.

## Estructura

| ruta | qué contiene |
|---|---|
| `src/js/cube-core.js` | modelo lógico NxN del cubo, sin dependencias |
| `src/js/viewer.js` | escena three.js, animación de giros, flechas y máscaras |
| `src/js/content.js` | pasos, casos y algoritmos de la guía |
| `src/js/app.js` | SPA: rutas, vistas y reproductor |
| `tests/verify-algorithms.mjs` | verificación por simulación |
| `docs/STACK_TECNOLOGICO.md` | dependencias y versiones fijadas |
