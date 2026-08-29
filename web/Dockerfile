# --- Bauen ---------------------------------------------------------------
FROM node:22-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY build.mjs index.html sw.js ./
COPY src ./src
RUN npm run build

# Ship the basemap fonts and sprites with the image so the page needs no
# third-party servers.
RUN curl -fsSL https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.tar.gz \
      -o /tmp/assets.tar.gz \
    && mkdir -p /tmp/assets \
    && tar -xzf /tmp/assets.tar.gz -C /tmp/assets --strip-components=1 \
    && cp -r /tmp/assets/fonts dist/fonts \
    && mkdir -p dist/sprites \
    && cp /tmp/assets/sprites/v4/light.json dist/sprites/light.json \
    && cp /tmp/assets/sprites/v4/light.png  dist/sprites/light.png \
    && cp /tmp/assets/sprites/v4/light@2x.json dist/sprites/light@2x.json \
    && cp /tmp/assets/sprites/v4/light@2x.png  dist/sprites/light@2x.png \
    && cp /tmp/assets/sprites/v4/dark.json  dist/sprites/dark.json \
    && cp /tmp/assets/sprites/v4/dark.png   dist/sprites/dark.png \
    && cp /tmp/assets/sprites/v4/dark@2x.json dist/sprites/dark@2x.json \
    && cp /tmp/assets/sprites/v4/dark@2x.png  dist/sprites/dark@2x.png \
    && rm -rf /tmp/assets /tmp/assets.tar.gz

# --- Ausliefern ----------------------------------------------------------
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
