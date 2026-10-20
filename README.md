# Avito Automation

Telegram Mini App and a TypeScript modular monolith for safe Avito order, inventory, DataMatrix, return, and operations workflows.

The Mini App uses Vue 3, Vite, Vuetify 4, and TanStack Query for server-owned state. Pinia is intentionally deferred until the UI has complex client-owned state that does not belong in PostgreSQL or API query caches.

## Requirements

- Node.js 24 LTS or newer
- pnpm 11
- Docker with Compose

## Local start

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm install
DATABASE_URL=postgresql://avito:avito@localhost:5432/avito pnpm db:migrate
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

## Telegram bot and Mini App

Register a bot with [BotFather](https://t.me/BotFather) using `/newbot`.
Save its token only in the ignored root `.env`. Existing credentials in that file must be preserved.

For a local test:

1. Start Docker Desktop, then `docker compose up -d --wait postgres redis`.
2. Apply migrations using the database URL shown above.
3. Obtain a public HTTPS tunnel to port 5173, for example `ssh -T -R 80:127.0.0.1:5173 nokey@localhost.run`.
4. Set `TELEGRAM_MODE=polling`, `TELEGRAM_BOT_TOKEN`, `MINI_APP_URL=https://your-tunnel-host`, `MINI_APP_ORIGIN=https://your-tunnel-host`, and `MINI_APP_TUNNEL_HOST=your-tunnel-host` in `.env`. Leave `VITE_API_BASE_URL` empty so `/api` uses the same origin through Vite's proxy.
5. Run `pnpm telegram:setup`, then `pnpm dev`. Keep both the tunnel and development processes running.
6. Open the bot in Telegram. `/start` and `/app` show an inline button; the menu button also opens the Mini App. `/id` reports the user's numeric ID in a private chat.
7. Grant the intended owner access explicitly with `pnpm telegram:owner <numeric-user-id>`. Reopen the Mini App. There is no automatic first-user signup.

A temporary tunnel may change its hostname when restarted. Update `.env`, restart `pnpm dev`, and rerun `pnpm telegram:setup` when that happens. Run one polling instance per bot. Stop with Ctrl+C.

For production, build the Mini App and serve its `dist` through HTTPS with `/api` and `/webhooks/telegram` routed to Fastify. Set `NODE_ENV=production`, `TELEGRAM_MODE=webhook`, the public `MINI_APP_URL` and `MINI_APP_ORIGIN`, and `TELEGRAM_WEBHOOK_URL=https://your-domain/webhooks/telegram`. Generate a random `TELEGRAM_WEBHOOK_SECRET` containing only letters, digits, `_` and `-`. Start API and worker separately, then run `pnpm telegram:setup`. Do not expose the Vite development server for permanent use.

Telegram initData signatures and age are checked on the backend, followed by the local active-user allowlist. The UI reports pending, expired and forbidden access. The warehouse supports scanned intake and stock browsing. Orders and shifts remain disabled placeholders.

Webhook duplicate suppression in Redis covers transport replies only. It is disposable and does not provide exactly-once message delivery. Future business mutations must use PostgreSQL durable operations.

Telegram contracts verified 2026-10-19 against [Mini Apps](https://core.telegram.org/bots/webapps) and [Bot API](https://core.telegram.org/bots/api). Tests mock bot replies; actual chat behavior still needs a check from the owner's Telegram client.

For a managed local connection, use `pnpm dev:telegram` instead of running the SSH tunnel and `pnpm dev` separately. It reconnects after tunnel failure and updates the Mini App URL, local processes and bot menu together. Run only one instance. Old message buttons retain the old URL: send `/app` again after reconnecting. The terminal and Mac must stay running.

Set optional `TELEGRAM_SETUP_CHAT_ID` to the owner's private chat ID to read back that chat's menu after setup. `/start`, `/app` and ordinary text also refresh the current chat menu before replying.

## Backend architecture

All business behavior lives in `packages/domain/src/<feature>`: scenarios, checks, state policies, dependency contracts and colocated tests. Current features are `auth`, `users`, `inventory` and `operations`, exported through `@avito/domain`. There is no backend application layer. Keep new warehouse/order scenarios in domain feature modules; extract separate rule files only for actual reuse.

Backend contains `http/`, `telegram/` and `jobs/` adapters, `infrastructure/` implementations, `bootstrap/` dependency wiring and the local `config/` module. Entry points and command names are unchanged. Bootstrap injects concrete storage, identity verification, scheduling and provider functions into domain scenarios; domain imports no backend modules, SQL, SDKs or Node runtime APIs. Internally domain uses relative imports instead of importing its own package barrel.

SQL and transactions remain in `packages/database`; PostgreSQL constraints/triggers retain atomic integrity protection. ESLint enforces domain independence and keeps concrete persistence out of transports. See section 10.1 of `PROJECT_SPEC.md` for the structure and dependency direction.

## Deploy Mini App to GitHub Pages

Run `npm run deploy` from the repository root or `apps/mini-app`. The `predeploy` command builds the Mini App with base `/avito-automatization/`; `deploy` publishes `dist` to the `gh-pages` branch of `origin` using the installed `gh-pages` CLI. Deployment does not require a global pnpm executable after workspace dependencies are installed.

Set the public HTTPS backend address in root `.env` as `VITE_API_BASE_URL`. Git push access and a configured Git name/email are required. If the repository name changes, update the `--base` argument in the Mini App's `predeploy` command.

After the first deploy, select **Settings → Pages → Deploy from a branch → gh-pages → / (root)** on GitHub. The expected site URL is `https://wireside.github.io/avito-automatization/`.

Once the site is reachable, set backend `MINI_APP_URL=https://wireside.github.io/avito-automatization/` and `MINI_APP_ORIGIN=https://wireside.github.io`, restart the backend and run `pnpm telegram:setup`. Backend, bot and database hosting remain separate. Stop the local `pnpm dev:telegram` helper when switching the bot to Pages, since that helper manages a temporary development URL.

## Warehouse database model

The database schema is split into `packages/database/src/schema/` modules, re-exported through the existing `schema.ts` entry point. Migrations `0001_warehouse_model.sql` and `0002_inventory_guards.sql` add catalog/GTIN/unit identity, reusable photos, supplier documents and purchase-cost revisions, inventory receipts and counts, per-unit reservations, shipments/returns, CHZ operation records and append-only history.

`stock_balances` is a SQL view; do not update it. Unit position changes require an `inventory_operations` header and an `inventory_movements` row. Receipts and handovers have deferred consistency checks: post all related units/movements or reservation consumption in one transaction. Unknown cost has no selected price revision, rather than a zero price. See section 11 of `PROJECT_SPEC.md` for table roles, transaction order and current limitations.

Apply committed migrations through `pnpm db:migrate` using an explicitly selected database. The schema and scanned-intake transactions are verified on an isolated PostgreSQL 17 database. Marketplace, EDI and CHZ providers remain disconnected.

## SHTANISHKIN interface

The responsive Mini App follows the dark SHTANISHKIN design, with blue actions, green receipt confirmations, mobile cards/bottom navigation and a desktop sidebar/table layout. Theme colors and runtime sizes live in `apps/mini-app/src/design/tokens.ts`; Vuetify defaults in `src/plugins/vuetify.ts`; typography, radii and component sizing in `src/styles/settings.scss`. Use Vuetify props/utilities before adding component CSS. Inter and the original Figma SVGs are bundled locally.

The **Приёмка** tab accepts USB or camera scans. **Остатки** reads persisted backend stock, with search, pagination and per-unit receipt details. **Эта сессия** shows safe scan results from this open session; its counter is not a server-wide daily total. Reloading clears that session list, while accepted stock remains in PostgreSQL. Green confirmation appears after the backend accepts a scan; duplicates do not increase the intake counter. Other modules remain disabled until their backend workflows exist.

On desktop, the camera icon opens this device's camera. **Сканировать телефоном** explains how to open the same bot on a phone; shared stock refreshes automatically, without pretending a remote camera/pairing API exists.

## Scanned warehouse intake

Open the Mini App from the bot with an authorized user. OWNER, ADMIN and WAREHOUSE can receive stock; ACCOUNTANT and VIEWER can browse it. Every inventory request verifies signed Telegram initData and the current active-user allowlist again; the server derives the actor from that session.

1. Apply migrations (including `0003_intake_location.sql`, which creates `MAIN` / `RECEIVING`).
2. Configure server-only `MARKING_ENCRYPTION_KEY` (32 random bytes, canonical base64) and `MARKING_ENCRYPTION_KEY_ID`. Generate the key with the command in `.env.example`; keep it in ignored `.env` or a secret store and back it up. Keep old keys by ID when rotating; do not overwrite the only copy while stored markings still need decryption. Without a key, browsing works but receiving returns 503; there is no plaintext fallback.
3. In **Склад → Приёмка → Добавить товар**, use the rear camera (HTTPS and camera permission required), or focus the scanner field and scan with a 2D USB keyboard scanner. Configure GS1 DataMatrix, ASCII GS (or Ctrl+]) separators and Enter/Tab suffix. Use the correct keyboard layout; unsupported/lossy codes are refused. A plain EAN/GTIN or screenshot of a product list is insufficient.
4. Wait for confirmation. The list shows quantities grouped by variant/GTIN, and by the existing product mapping when present. Search supports GTIN/name/article/size/color; expand a variant to inspect its masked per-unit identities and receipt references.

The implemented profile is clothing `01` + GTIN14 + `21` + serial13 + GS + `91` + key4 + GS + `92` + signature44, per the [official CHZ format explanation](https://markirovka.ru/knowledge/tovarnye-gruppy/legkaya-promishlennost/sostav-koda-markirovki-legprom). AIM `]d2`, an initial GS1 FNC1 rendered as GS, and the keyboard suffix are recognized framing; raw received text is encrypted unchanged. Camera decoding uses [ZXing Browser](https://github.com/zxing-js/browser). Structure and checksum validation do not verify authenticity in CHZ.

One successful new scan atomically creates a posted one-unit receipt, cost layer with unknown price, marked unit, inbound QUARANTINE movement and scan/event history. A new GTIN creates an UNRESOLVED variant; known GTIN reuses the catalog. Source enrichment, manual catalog mapping, model grouping across unknown GTINs and purchase-cost lookup await a connected verified source. Existing model links are displayed without heuristic grouping.

Full marking text is encrypted with AES-256-GCM (versioned nonce/tag/ciphertext envelope, AAD binds key ID and identity hash). It is never returned by stock endpoints. Serial identity is deduplicated by SHA-256 of parsed GTIN+serial, independently of framing/crypto tail. Advisory locks serialize retries and resolution per GTIN; unique constraints remain the final barrier. A repeated physical scan records DUPLICATE without a movement. A network retry reuses the same request UUID and original outcome; changing that request's input returns 409. A known unit in a sold/other state is reported as already recorded, never received again through this path.

The UI sends queued scans sequentially, retains an ambiguous failed request in memory for explicit retry, clears completed payloads and refreshes Query-owned server state. The in-memory queue does not survive closing/reloading: rescan a code if its result is uncertain; server deduplication is durable. No raw marking is stored in localStorage. Camera scanning stops after one detection, on close, on backgrounding and on unmount. Stock is refreshed after receipt, on refocus and every 15 seconds.

API: `GET /api/v1/inventory?search=&offset=0&limit=40`, `GET /api/v1/inventory/variants/:id/units?offset=0`, `POST /api/v1/inventory/receipts/scan` with `{requestId, raw, scannerProfile}`. Send `Authorization: tma <signed initData>`. Responses use `Cache-Control: no-store`. The scope is one default warehouse; no reservation, shipment, return, release from quarantine, Avito write or CHZ mutation is performed.

Run unit/HTTP tests with `pnpm test`, browser tests with `pnpm test:e2e`. For real database intake tests, migrate a **fresh disposable database**, then run `RUN_INVENTORY_TESTS=true DATABASE_URL=... pnpm exec vitest run packages/database/src/inventory.test.ts`. Drop that test database afterward: immutable history is intentionally not deleted by the suite. Do not run this suite on operational stock.

## HTTP API for frontend integration

The Fastify API is wired to the existing domain scenarios in `bootstrap/api.ts`; it is not a mock server. Start local PostgreSQL/Redis, apply migrations as above, then run `TELEGRAM_MODE=disabled pnpm dev:api` to run HTTP without starting bot polling. The server listens on `HOST` / `PORT` (default `0.0.0.0:3000`). Signed Telegram authentication still needs the configured bot token and an active local user. The worker is not required for these warehouse endpoints.

The machine-readable OpenAPI 3.1 contract is public at `GET /api/v1/openapi.json`, for example `http://localhost:3000/api/v1/openapi.json`. Import it into Postman/Insomnia or use it to generate a client. `packages/contracts` exports the same request/response Zod schemas and inferred TypeScript DTOs used by the server. There is no separate hand-maintained schema snapshot. Existing Mini App paths and successful response fields remain compatible.

| Method | Path                                             | Purpose                                                               | Success                            |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------- |
| POST   | `/api/v1/auth/telegram/verify`                   | `{initData}` → current `{user: {id, telegramId, displayName, roles}}` | 200                                |
| GET    | `/api/v1/inventory?search=&offset=0&limit=40`    | Warehouse totals and paginated variants                               | 200                                |
| GET    | `/api/v1/inventory/variants/{id}/units?offset=0` | Up to 20 masked units with receipt references                         | 200                                |
| POST   | `/api/v1/inventory/receipts/scan`                | Receive one unit using `{requestId, raw, scannerProfile}`             | 201 new unit; 200 duplicate/replay |

`GET /health/live` and `GET /health/ready` remain available for process/dependency checks. Their health response is separate from business API DTOs. Telegram webhook endpoints are internal integration transport and are not part of this frontend contract.

Every protected request sends `Authorization: tma <Telegram.WebApp.initData>`. The verify endpoint is optional for displaying the current user; it does not issue a new token. Keep sending the original signed initData. The server checks its age/signature and reloads active user/roles on every request, so revocation takes effect immediately. Never use `initDataUnsafe` or a client-selected actor ID. On 401 reopen the Mini App to obtain a new signed session; 403 means the current user/role lacks access.

Read roles: OWNER, ADMIN, WAREHOUSE, ACCOUNTANT, VIEWER. Intake roles: OWNER, ADMIN, WAREHOUSE. CORS allows the configured `MINI_APP_ORIGIN`, `Authorization` and `Content-Type`; it exposes `x-correlation-id` to browser code. Set the exact frontend origin (scheme + host + port); do not enable wildcard origins as an auth workaround. API responses use `Cache-Control: no-store`.

`search` has at most 120 characters; `offset` is 0..1,000,000, `limit` is 1..100 (default 40). Warehouse `totals` always cover the entire warehouse, while filtering/pagination apply to `items`. If a variant page has `hasMore: true`, increment offset by limit; for units increment by 20. A valid but unknown variant UUID returns an empty units page. Group variants by non-null `productId`; keep unmapped variants separate.

The scan body uses a UUID `requestId`, unmodified `raw` (1..512 characters), and `scannerProfile` equal to `camera-gs1-v1` or `keyboard-gs1-v1`. The request body limit is 4096 bytes; the auth body limit is 32768 bytes. JSON preserves GS as `\u001d`; pass `JSON.stringify` the actual string rather than replacing separators with literal backslash text. Unknown body/query fields are rejected. Do not send `actorUserId`, warehouse quantities, legal status or a target physical state: the server derives these.

A new physical scan gets a new UUID. Retrying an uncertain request keeps the same UUID, exact raw string, profile and user; its response preserves the original outcome with `replayed: true`. Reusing the UUID with a different payload returns 409. Scanning an already recorded GTIN+serial under a fresh UUID returns `outcome: "DUPLICATE"`, `replayed: false` and adds no stock. Even an existing unit outside the warehouse is not received again through this route. Only a committed new unit returns 201. `unit` in the response contains the current masked identity/state and receipt reference; refetch stock afterward for current totals.

Minimal frontend call using workspace contracts:

```ts
import {
  apiErrorResponseSchema,
  inventoryScanResponseSchema,
  type InventoryScanRequest,
} from '@avito/contracts';

async function receiveScan(
  apiBase: string,
  initData: string,
  command: InventoryScanRequest,
) {
  const response = await fetch(`${apiBase}/api/v1/inventory/receipts/scan`, {
    method: 'POST',
    headers: {
      authorization: `tma ${initData}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = apiErrorResponseSchema.parse(body);
    // Display message; use code for UI branches and requestId for support.
    throw new Error(`${error.message} (${error.requestId})`);
  }
  return inventoryScanResponseSchema.parse(body);
}

// Create once for a scan. Keep this object for a network retry.
const command: InventoryScanRequest = {
  requestId: crypto.randomUUID(),
  raw: scannerResult, // no trim(), separator replacement or console logging
  scannerProfile: 'keyboard-gs1-v1',
};
// await receiveScan(API_BASE, window.Telegram.WebApp.initData, command);
```

API errors have one shape:

```json
{
  "ok": false,
  "code": "IDEMPOTENCY_CONFLICT",
  "message": "Этот UUID запроса уже использован с другими данными скана.",
  "requestId": "req-7"
}
```

The error `requestId` equals `x-correlation-id` and identifies this HTTP attempt; it is separate from the scan UUID in the request body. Clients should branch on stable `code`, not message wording. Unexpected exceptions and failed response validation return generic 500 without stack traces, SQL, raw markings or initData. Successful responses are validated and restricted to the DTO fields.

| Status    | Codes / frontend action                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400       | `INVALID_REQUEST`, `INVALID_JSON`: correct the parameters/JSON                                                                                                                   |
| 401       | `UNAUTHORIZED`, `MALFORMED`, `INVALID_SIGNATURE`, `EXPIRED`, `TELEGRAM_USER_MISSING`: obtain a valid Telegram session                                                            |
| 403       | `USER_NOT_ALLOWED`, `FORBIDDEN`: request access or the appropriate role                                                                                                          |
| 404       | `NOT_FOUND`: check the route; an empty units page is not a route error                                                                                                           |
| 409       | `IDEMPOTENCY_CONFLICT`, `CATALOG_ARCHIVED`: resolve the conflict; do not blindly repeat                                                                                          |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE`: fix the body size/content type                                                                                                   |
| 422       | `INVALID_MARKING`, `INVALID_GTIN`: rescan/check scanner settings                                                                                                                 |
| 500       | `INTERNAL_ERROR`: result may be uncertain; retain the scan UUID for a retry                                                                                                      |
| 503       | `TELEGRAM_NOT_CONFIGURED`, `INVENTORY_NOT_CONFIGURED`, `MARKING_STORAGE_NOT_CONFIGURED`, `WAREHOUSE_UNAVAILABLE`: configuration/destination unavailable; retain any pending scan |
