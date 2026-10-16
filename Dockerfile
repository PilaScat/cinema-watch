FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY scripts/build-css.mjs ./scripts/
COPY src ./src
RUN npm run build

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk add --no-cache libstdc++ \
  && mkdir -p /data \
  && chown 99:100 /data
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/PilaScat/cinema-watch" \
  org.opencontainers.image.description="Cacce ai biglietti UCI con la pianta della sala su Telegram" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.version="$VERSION"
ENV NODE_ENV=production \
  DATA_DIR=/data \
  PORT=8790 \
  APP_VERSION=$VERSION
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY assets ./assets
COPY package.json LICENSE ./
USER 99:100
EXPOSE 8790
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8790) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.js"]
