# ── Etapa 1: build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

COPY . .

# Genera el cliente de Prisma en /app/generated/prisma
RUN npx prisma generate

# ── Etapa 2: producción ──────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Dependencias nativas + Chromium para Puppeteer
RUN apk add --no-cache \
  python3 make g++ \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ca-certificates \
  ttf-freefont

# Puppeteer usará el Chromium del sistema, no descargará el propio
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm install --omit=dev

# El cliente Prisma va a generated/ (según output del schema)
COPY --from=builder /app/generated ./generated

# Copia código fuente
COPY . .

RUN mkdir -p /app/uploads /app/recursos /app/sesiones

EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npx tsx src/index.ts"]
