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
- **Textos de la interfaz en español neutro**, sin voseo y sin tipografía de IA.

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
# Corrida larga y exhaustiva (62 208 + 248 832 estados; unos 6 min con 20 hilos), aparte del build:
node tests/verify-last-layer.mjs all
docker build -t rubik-spa .
```
