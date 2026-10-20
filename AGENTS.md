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
- Keep order state, physical inventory state, Avito marking acceptance, CHZ legal state, and CHZ operation progress independent.
- Model catalog as manufacturer-scoped model → exact color/size/GTIN variant → unique marked unit. Preserve one unit identity across returns and resale; do not group by a name, image, or classification code alone.
- Prefer per-unit scanned receipt for new marked goods; unresolved identity/legal receipt stays in quarantine. Scanning does not accept an EDI transfer.
- Reserve availability at order intake. Packing, shipment, and delivery must not subtract the same unit/reservation twice; confirm Avito stock-write reservation semantics before implementation.
- Use explicit per-unit shipment preparation and handover. For the verified distance-sale document path, trigger CHZ around dispatch and enforce the legal deadline from dispatch; never wait for buyer receipt as the default trigger.
- Key CHZ withdrawals by unit and sale cycle so a returned unit can be sold again. Reconcile ambiguous or in-flight documents before compensating.
- Do not invent listing creation or size-variant support from Stock Management. Verify official publication contracts and exact order-to-size mapping.
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
- Keep Telegraf thin; handlers call shared domain scenarios and contain no business rules or persistence logic.
- Put intended external side effects in `integration_operations` in the same transaction as the domain change; enqueue only `operationId` after commit.
- Use versioned, reviewed Drizzle SQL migrations. Do not use schema push in shared or production environments.
- Use mocks and sanitized fixtures when credentials are unavailable.
- Keep necessary architectural decisions directly in `PROJECT_SPEC.md` or the implementation. Do not create standalone ADRs for the MVP.
- Run typecheck, tests, and migrations against a clean database before declaring a slice complete.

Avito API contracts:

- Use the official snapshots listed in `docs/openapi/avito/index.json` when implementing or reviewing Avito integrations.
- Do not invent endpoints or fields that are absent from these contracts. Update the snapshot first when the official API changes.
- Confirm actual account access with safe probes and sanitized fixtures; a documented endpoint does not guarantee that the account can call it.

Backend layers:

- Keep transport in `apps/backend/src/http`, `telegram`, and `jobs`; call domain scenarios from handlers.
- Keep all business scenarios, their dependency contracts, checks and rules together under `packages/domain/src/<feature>`. Do not reintroduce `backend/src/application` or another application layer. Use typed injected functions for I/O; do not import config, frameworks, concrete database/provider clients or backend infrastructure into domain.
- Group domain by feature (`auth`, `users`, `operations`, later inventory/orders/marking). Keep scenarios, rules and tests close to each other; extract a separate rules file only for real reuse. Import domain through `@avito/domain` from other packages and use relative imports internally to avoid self-barrel cycles.
- Keep SQL/transactions and atomic integrity guards in `packages/database`, and concrete backend adapters in `apps/backend/src/infrastructure`. Database guards remain necessary for concurrency and direct writes; derive shared TypeScript status lists from domain where possible.
- Wire dependencies and resource lifecycle in `bootstrap`; administrative CLI and development commands are separate composition roots.
- Keep config in the backend-local `config/` module. Preserve the layer import restrictions in ESLint and the architecture in section 10.1 of `PROJECT_SPEC.md`.
