# ---- build -----------------------------------------------------------------
FROM node:22-slim AS build

WORKDIR /app

# Build toolchain for better-sqlite3 when no prebuilt binary matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    TOKENRING_HOST=0.0.0.0 \
    TOKENRING_PORT=4000 \
    TOKENRING_DATA_DIR=/data

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

# The database and the generated master key live here — mount a volume.
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.TOKENRING_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/main.js"]
