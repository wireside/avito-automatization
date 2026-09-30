# Project instructions

Use the global `$avito-marking-automation` skill for every design, implementation, review, migration, or test task in this repository.

Read `PROJECT_SPEC.md` before making architectural or domain changes. Treat it as the current product specification.

Core constraints:

- Keep a modular monolith with separate API and worker processes.
- Use TypeScript, Fastify, Telegraf, React/Vite, PostgreSQL, Drizzle ORM/Kit, Redis, and BullMQ.
- Keep one pnpm monorepo. Run backend API and worker as separate processes; keep Telegraf as an adapter inside the backend rather than a separate service or repository.
- Treat Avito, MoySklad, and Chestny ZNAK as separate sources of truth.
- Preserve DataMatrix ASCII GS separators and never log a full CIS.
- Make every external mutation idempotent and auditable.
- Keep PostgreSQL as the durable operation store; Redis is never the business source of truth.
- Activate exactly one CHZ submission mode after an integration spike.
- Do not add a local cash-register application to the architecture unless the fiscal model changes.
- Never perform live external mutations without explicit environment configuration and user authorization.

Implement one vertical slice at a time and keep mocks/fixtures available when external credentials are absent.
