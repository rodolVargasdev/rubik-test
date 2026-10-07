# Stage 1: verify every guide algorithm by simulation. If a case does not
# start where the text says, the build stops here.
FROM node:24.21.0-alpine AS verify
WORKDIR /app
COPY src ./src
COPY tests ./tests
RUN node tests/verify-algorithms.mjs && node tests/verify-solver.mjs 60 8 && node tests/verify-last-layer.mjs all --sample 300

# Stage 2: serve the static SPA.
FROM nginx:1.30.5-alpine
# Pull patched Alpine packages: the base image lags behind security fixes.
# The optional modules are never loaded by this config; removing them also
# removes libxml2, libxslt, libgd and expat, which carry unpatched advisories.
RUN apk upgrade --no-cache  && apk del --no-cache nginx-module-xslt nginx-module-image-filter nginx-module-njs nginx-module-geoip nginx-module-acme
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=verify /app/src /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
