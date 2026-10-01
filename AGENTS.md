# Project instructions

Use the global `$avito-marking-automation` skill for every design, implementation, review, migration, test, or documentation task in this repository.

Read `PROJECT_SPEC.md` before making architectural or domain changes. Treat it as the current product specification.

Core constraints:

- Build a Telegram Mini App and custom backend for Avito order processing, local inventory, DataMatrix workflows, returns, team operations, preliminary finance, and analytics.
- Keep a TypeScript modular monolith in one pnpm workspace with separate API and worker processes.
- Use Fastify, Telegraf, Vue 3/Vite, TanStack Query for Vue, PostgreSQL, Drizzle ORM/Kit, Redis, BullMQ, Zod, Pino, Vitest, Testcontainers, and Playwright. Add Pinia only when complex client-owned state appears; do not duplicate server state there.
- Treat PostgreSQL as the source of truth for catalog, variants, warehouses, receipts, cost layers, reservations, inventory movements, product units, returns, shifts, and durable operations.
- Treat Avito as the source of truth for orders, delivery, available actions, accepted marketplace markings, and only the financial facts its API or reports actually provide.
- Treat Chestny ZNAK as the source of truth for the legal state of each CIS.
- Keep order state, physical inventory state, Avito marking state, and CHZ state independent.
- Model stock through immutable movements plus reservations. Never patch an inventory balance without an auditable movement or reconciliation result.
- Preserve DataMatrix ASCII GS separators. Never trim or lossily normalize a CIS, and never log a full CIS.
- Make every external mutation idempotent, durable, retry-safe, and auditable. A successful HTTP status alone is not business completion.
- Keep Redis/BullMQ disposable. PostgreSQL owns pending operations, and recovery must re-enqueue them after queue loss.
- Activate exactly one CHZ submission mode after the integration spike. Never submit the same withdrawal or return through two channels.
- Keep UKЭП private keys and PINs out of the cloud backend; use a local signer only for `DIRECT_TRUE_API`.
- Do not add MoySklad to the required path or make it an inventory master without an explicit product decision, migration plan, and reconciliation design. Optional export/back-office adapters come after the local core works.
- Label financial metrics as preliminary when settlements, fees, delivery costs, returns, or cost attribution are incomplete. This product is not the accounting or tax ledger.
- Do not add a local cash-register application unless the fiscal model changes.
- Never perform live external mutations without explicit environment configuration and user authorization.

Implementation rules:

- Deliver one externally observable vertical slice at a time.
- Keep Telegraf thin; handlers call shared application use cases and contain no business rules or persistence logic.
- Put intended external side effects in `integration_operations` in the same transaction as the domain change; enqueue only `operationId` after commit.
- Use versioned, reviewed Drizzle SQL migrations. Do not use schema push in shared or production environments.
- Use mocks and sanitized fixtures when credentials are unavailable.
- Keep necessary architectural decisions directly in `PROJECT_SPEC.md` or the implementation. Do not create standalone ADRs for the MVP.
- Run typecheck, tests, and migrations against a clean database before declaring a slice complete.

Avito API contracts:

- Use the official snapshots listed in `docs/openapi/avito/index.json` when implementing or reviewing Avito integrations.
- Do not invent endpoints or fields that are absent from these contracts. Update the snapshot first when the official API changes.
- Confirm actual account access with safe probes and sanitized fixtures; a documented endpoint does not guarantee that the account can call it.
