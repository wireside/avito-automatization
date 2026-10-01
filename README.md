# Avito Automation

Telegram Mini App and a TypeScript modular monolith for safe Avito order, inventory, DataMatrix, return, and operations workflows.

The Mini App uses Vue 3, Vite, and TanStack Query for server-owned state. Pinia is intentionally deferred until the UI has complex client-owned state that does not belong in PostgreSQL or API query caches.

## Requirements

- Node.js 24 LTS or newer
- pnpm 11
- Docker with Compose

## Local start

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm install
pnpm db:migrate
pnpm dev
```

The Mini App is available at `http://localhost:5173`. API liveness and dependency readiness are exposed at `http://localhost:3000/health/live` and `http://localhost:3000/health/ready`.

Telegram credentials are optional for health checks. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` before enabling Telegram authentication or webhook delivery. Never commit credentials or raw CIS data.

## Commands

```bash
pnpm verify       # format, lint, typecheck, unit tests, build
pnpm db:generate  # generate a reviewed Drizzle SQL migration
pnpm db:migrate   # apply committed migrations
pnpm test:e2e     # run the Mini App Playwright smoke test
```

PostgreSQL is the durable source of truth. Redis/BullMQ only transports operation IDs; the worker recovery loop re-enqueues unfinished operations after Redis loss.
