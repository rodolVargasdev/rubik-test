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
- **Textos de la interfaz en español neutro**, sin voseo y sin tipografía de IA.

## Verificar
```bash
node tests/verify-algorithms.mjs
docker build -t rubik-spa .
```
