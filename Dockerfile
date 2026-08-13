# syntax=docker/dockerfile:1

# ============================================================
# QARA Musobaqa — production obrazi
#
# Uch bosqichli: bogʻliqliklar → build → ishga tushirish.
# Yakuniy obrazda dev bogʻliqliklar ham, manba kodi ham yoʻq —
# faqat `.next/standalone`.
# ============================================================

FROM node:24-alpine AS deps
WORKDIR /app
# @node-rs/argon2 tayyor binar bilan keladi, lekin ba'zi paketlarga
# libc mosligi kerak
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci


FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build paytida baza kerak emas, lekin `lib/env.ts` DATABASE_URL ni
# talab qiladi — soxta qiymat beramiz, ishga tushirishda haqiqiysi keladi.
ENV DATABASE_URL="postgres://build:build@127.0.0.1:5432/build"
ENV SESSION_SECRET="build-only-secret-not-used-at-runtime-000"
ENV ADMIN_PASSWORD="build"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Qaysi commit yigʻilgani — /api/version orqali koʻrinadi.
# Deploy'dan keyin CI shu qiymatni tekshiradi.
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV BUILD_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

RUN apk add --no-cache postgresql18-client tini \
  && addgroup -g 1001 -S nodejs \
  && adduser -u 1001 -S nextjs -G nodejs

# Standalone paket
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migratsiya va seed ALOHIDA `tools` xizmatida (builder bosqichi)
# ishlaydi — bu yerda tsx va dev bogʻliqliklar kerak emas.

RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads
VOLUME ["/app/uploads"]

USER nextjs
EXPOSE 3000

# tini — PID 1 sifatida signallarni toʻgʻri uzatadi, konteyner
# «docker stop» da 10 soniya kutib turmaydi
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
