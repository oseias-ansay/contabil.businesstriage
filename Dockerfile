# ════════════════════════════════════════════════════════════════════
#  Triage Contábil — imagem de produção (Next.js)
#  Roda como usuário sem privilégios ("node"), com o sistema de arquivos
#  somente leitura (ver compose.yml).
# ════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_ROOT_DOMAIN=contabil.businesstriage.com.br
ENV NEXT_PUBLIC_ROOT_DOMAIN=$NEXT_PUBLIC_ROOT_DOMAIN NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error && npm cache clean --force

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOST=0.0.0.0 PORT=3200 UPLOAD_DIR=/data/uploads
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json next.config.mjs tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN mkdir -p /data/uploads /app/.next/cache && chown node:node /data/uploads /app/.next/cache
USER node
EXPOSE 3200
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3200/api/health >/dev/null || exit 1
# Aplica migrations + RLS + regras contábeis (idempotente) e sobe o servidor
CMD ["sh", "-c", "node node_modules/.bin/tsx src/db/migrate.ts && exec node node_modules/.bin/next start -p 3200 -H 0.0.0.0"]
