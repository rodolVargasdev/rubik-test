# Stack tecnológico

Última revisión: 2026-10-06.

## Dependencias en tiempo de ejecución (navegador)

| dependencia | versión | para qué | alternativa descartada | auditoría |
|---|---|---|---|---|
| three.js (CDN jsDelivr) | 0.186.1 | escena 3D, animación de giros, controles de órbita, geometría redondeada y entorno de iluminación | Babylon.js: más pesado para una escena simple; CSS 3D: sin iluminación real ni sombras | OSV sin avisos para `three@0.186.1` (consulta del 2026-10-06) |
| Google Fonts: Bricolage Grotesque | servicio, sin versión | títulos y notación de giros | fuente del sistema: sin personalidad para los títulos | no aplica (hoja de estilos de fuentes) |
| Google Fonts: Atkinson Hyperlegible | servicio, sin versión | texto de lectura; diseñada para máxima legibilidad | Inter u otras sans genéricas: menos legibles en instrucciones largas | no aplica |

La SPA no usa npm: no hay `package.json` ni dependencias de compilación. Los
módulos de three.js se cargan con un `importmap` en `src/index.html`.

## Imágenes de contenedor

| imagen | versión | para qué | auditoría |
|---|---|---|---|
| node | 24.21.0-alpine | etapa de verificación de algoritmos durante el build | solo etapa intermedia; no viaja en la imagen final |
| nginx | 1.30.5-alpine | servir los estáticos | Docker Scout: sin paquetes vulnerables (2026-10-06) tras `apk upgrade` y retirar los módulos opcionales no usados |

### Aviso resuelto al construir

La imagen base `nginx:1.30.5-alpine` traía, al 2026-10-06, avisos HIGH en
expat, zlib, pcre2 y libxml2. `apk upgrade` corrige zlib, pcre2 y uno de expat.
libxml2 (CVE-2026-86140) y expat (CVE-2026-102633) no tenían parche en Alpine
3.24; ambos llegan solo por los módulos opcionales de nginx (xslt, image-filter,
njs, geoip, acme), que esta configuración no carga. El Dockerfile los retira y
con ellos se van esas librerías.

## Pendiente

- El CI todavía no existe. Cuando se cree, debe correr el build de la imagen
  (que ya incluye la verificación) y un escaneo de la imagen final, para que la
  auditoría no dependa de una corrida local.
