# syntax=docker/dockerfile:1.7

FROM node:20-slim AS base

ENV NPM_CONFIG_LEGACY_PEER_DEPS=true \
    ONNXRUNTIME_NODE_INSTALL_CUDA=skip

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci --legacy-peer-deps; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

RUN if [ -d node_modules/onnxruntime-node/bin/napi-v6 ]; then \
      find node_modules/onnxruntime-node/bin/napi-v6/ -mindepth 1 -maxdepth 1 ! -name 'linux' -exec rm -rf {} +; \
    fi

FROM base AS worker-deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
# The generic worker can execute inline autopilot and case-memory fallbacks when
# queue mode is disabled. Its bundled webhook handler therefore needs the same
# runtime AI dependencies as worker-ai; omitting them makes an inbound WhatsApp
# message fail with `Cannot find module 'genkit'`.
RUN node -e "const fs=require('node:fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8')); const names=['bullmq','ioredis','pg','@huggingface/transformers','genkit','@genkit-ai/compat-oai','@genkit-ai/googleai','@google/generative-ai','@modelcontextprotocol/sdk','zod','next','react','react-dom','postcss','@supabase/ssr','@supabase/supabase-js','clsx','tailwind-merge','date-fns','date-fns-tz','uuid','fluent-ffmpeg','ffmpeg-static','ffprobe-static','@aws-sdk/client-s3','@aws-sdk/s3-request-presigner','openai','@opentelemetry/api']; const deps=Object.fromEntries(names.map((name)=>{ const version=lock.packages?.['node_modules/'+name]?.version ?? pkg.dependencies?.[name]; if(!version){ throw new Error('Missing worker dependency: '+name); } return [name, version]; })); fs.writeFileSync('package.json', JSON.stringify({ name: 'dialogy-worker-runtime', private: true, dependencies: deps, overrides: pkg.overrides || {} }, null, 2)); fs.unlinkSync('package-lock.json');"
RUN npm install --package-lock-only --legacy-peer-deps
RUN npm ci --omit=dev --legacy-peer-deps

FROM base AS worker-ai-deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
RUN node -e "const fs=require('node:fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8')); const names=['bullmq','ioredis','pg','@huggingface/transformers','genkit','@genkit-ai/compat-oai','@genkit-ai/googleai','@google/generative-ai','@modelcontextprotocol/sdk','zod','next','react','react-dom','postcss','@supabase/ssr','@supabase/supabase-js','clsx','tailwind-merge','date-fns','date-fns-tz','uuid','fluent-ffmpeg','ffmpeg-static','ffprobe-static','@aws-sdk/client-s3','@aws-sdk/s3-request-presigner','openai','@opentelemetry/api']; const deps=Object.fromEntries(names.map((name)=>{ const version=lock.packages?.['node_modules/'+name]?.version ?? pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]; if(!version){ throw new Error('Missing worker-ai dependency: '+name); } return [name, version]; })); fs.writeFileSync('package.json', JSON.stringify({ name: 'dialogy-worker-ai-runtime', private: true, dependencies: deps, overrides: pkg.overrides || {} }, null, 2)); fs.unlinkSync('package-lock.json');"
RUN npm install --package-lock-only --legacy-peer-deps
RUN npm ci --omit=dev --legacy-peer-deps

RUN if [ -d node_modules/onnxruntime-node/bin/napi-v6 ]; then \
      find node_modules/onnxruntime-node/bin/napi-v6/ -mindepth 1 -maxdepth 1 ! -name 'linux' -exec rm -rf {} +; \
    fi

FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN --mount=type=secret,id=dotenv,target=/app/.env if grep -Eq '^[[:space:]]*model[[:space:]]+' prisma/schema.prisma; then npx prisma generate; else echo "No Prisma models found, skipping prisma generate"; fi

RUN --mount=type=secret,id=dotenv,target=/app/.env \
  if [ -f yarn.lock ]; then yarn run build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \
  else echo "Lockfile not found." && exit 1; \
  fi

RUN --mount=type=secret,id=dotenv,target=/app/.env npm run worker:build
RUN --mount=type=secret,id=dotenv,target=/app/.env npm run worker:ai:build
RUN --mount=type=secret,id=dotenv,target=/app/.env npm run worker:campaign:build
RUN --mount=type=secret,id=dotenv,target=/app/.env npm run worker:meta-relay:build
RUN rm -f .next/standalone/.env .next/standalone/.env.*

FROM base AS runtime-base
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM runtime-base AS runner

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 9045

ENV PORT=9045
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

FROM runtime-base AS worker-runner

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

COPY --from=worker-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker.js ./dist/worker.js
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker-campaign.js ./dist/worker-campaign.js
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker-meta-relay.js ./dist/worker-meta-relay.js

RUN node -e "require('fluent-ffmpeg'); require('ffmpeg-static'); require('ffprobe-static')" \
    && ffmpeg -version \
    && ffprobe -version

USER nextjs

CMD ["node", "dist/worker.js"]

FROM runtime-base AS worker-ai-runner

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

COPY --from=worker-ai-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker-ai.js ./dist/worker-ai.js

RUN node -e "require('fluent-ffmpeg'); require('ffmpeg-static'); require('ffprobe-static')" \
    && ffmpeg -version \
    && ffprobe -version

USER nextjs

CMD ["node", "dist/worker-ai.js"]
