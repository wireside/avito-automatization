[![CI](https://github.com/wireside/avito-automatization/actions/workflows/ci.yml/badge.svg)](https://github.com/wireside/avito-automatization/actions/workflows/ci.yml)
[![pages-build-deployment](https://github.com/wireside/avito-automatization/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/wireside/avito-automatization/actions/workflows/pages/pages-build-deployment)

# Avito Automation

Telegram Mini App and a TypeScript modular monolith for safe Avito order, inventory, DataMatrix, return, and operations workflows.

The Mini App uses Vue 3, Vite, Vuetify 4, and TanStack Query for server-owned state. Pinia is intentionally deferred until the UI has complex client-owned state that does not belong in PostgreSQL or API query caches.

## Requirements

- Node.js 24 LTS or newer
- pnpm 11
- Docker with Compose

## Local start

```bash
test -f .env || cp .env.example .env
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

## GitHub Actions deployment to the development VPS

The `CI` workflow verifies pull requests. After a successful push to `main` (or a manual run on `main`), it builds an amd64 backend image and the Pages Mini App. A dedicated deployment job transfers the compressed image over SSH to `/opt/avito-dev`, verifies its checksum and Git revision, backs up PostgreSQL, stops the worker, runs migrations once, replaces the API, checks readiness, and starts/checks the worker. Pages is published only after the backend deployment and its public HTTPS check succeed. The frontend and backend must remain compatible during this sequential release; deployment is not atomic across both hosts.

The workflow starts deploying only after repository variable `VPS_DEPLOY_ENABLED` is set to `true`. Before then, CI still runs. Main-branch workflow runs are serialized without cancelling an active deployment. PRs never receive deployment credentials. Backend images travel as short-lived Actions artifacts; no Docker registry or registry PAT is required. Application secrets remain in the existing VPS `.env` and are never copied into GitHub or the frontend build.

### One-time VPS and GitHub configuration

Keep the working `/opt/avito-dev/compose.yaml`, `/opt/avito-dev/compose.override.yaml`, `.env`, Nginx and TLS configuration. The Compose services must be named `api`, `worker`, `migrate`, `postgres`, `redis`; all three backend services must use `avito-backend:dev`. PostgreSQL database/user are `avito`. The deployment script does not replace these files, run Telegram setup again, recreate stateful services, or remove volumes. It requires an existing API container for rollback. Ubuntu needs `python3`, `curl`, `gzip`, `sha256sum` and `flock`, in addition to Docker Compose.

1. On the Mac, generate a separate **CI-only** SSH key with no passphrase:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/avito_github_actions -C "avito-github-actions" -N ""
   cat ~/.ssh/avito_github_actions.pub
   ```

2. In the already authenticated root SSH session on the VPS, prepare `authorized_keys`:

   ```bash
   install -d -m 700 /root/.ssh
   touch /root/.ssh/authorized_keys
   chmod 600 /root/.ssh/authorized_keys
   TERM=xterm-256color nano /root/.ssh/authorized_keys
   ```

   Append one line containing `restrict ` followed by the entire new public key, preserving existing keys. `restrict` disables PTY and forwarding, while allowing the SSH commands and SCP needed for deployment. This key still permits root commands; use it only for this repository and protect its GitHub environment. Your interactive Mac key/password is not used by CI. Do not disable your current login method while setting this up.

3. Get the server's public host key **from that authenticated VPS session**, rather than trusting an unverified `ssh-keyscan` result:

   ```bash
   printf '177.203.58.144 '
   cat /etc/ssh/ssh_host_ed25519_key.pub
   ```

   Copy the resulting single line (`177.203.58.144 ssh-ed25519 AAAA...`) for `VPS_KNOWN_HOSTS`. If changing SSH to a nonstandard port, the first field must instead be `[177.203.58.144]:PORT`.

4. On GitHub, open **Settings → Environments**, create `vps-development`, and restrict deployment branches to `main`. Add this environment secret:

   | Secret        | Value                                                                                |
   | ------------- | ------------------------------------------------------------------------------------ |
   | `VPS_SSH_KEY` | The entire private key from `~/.ssh/avito_github_actions`, including BEGIN/END lines |

   To copy the private key on Mac without printing it: `pbcopy < ~/.ssh/avito_github_actions`. Do not paste it into chat, issues, or the repository.

5. In **Settings → Secrets and variables → Actions → Variables**, add repository variables:

   | Variable             | Value                                                                                               |
   | -------------------- | --------------------------------------------------------------------------------------------------- |
   | `VPS_HOST`           | `177.203.58.144`                                                                                    |
   | `VPS_KNOWN_HOSTS`    | The host-key line obtained above                                                                    |
   | `VPS_USER`           | Optional; defaults to `root`                                                                        |
   | `VPS_PORT`           | Optional; defaults to `22`                                                                          |
   | `VPS_HEALTH_URL`     | Optional; defaults to `https://177-203-58-144.sslip.io/health/ready`                                |
   | `VITE_API_BASE_URL`  | Optional; defaults to `https://177-203-58-144.sslip.io`; public build configuration, never a secret |
   | `VPS_DEPLOY_ENABLED` | Set to `true` **last**, when SSH, Pages and committed deployment files are ready                    |

   Do not add bot tokens, database passwords, the marking encryption key, or the whole `.env` to GitHub. VPS host keys are public but their integrity matters: the workflow enforces `StrictHostKeyChecking=yes`.

6. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions** instead of publishing the `gh-pages` branch. Restrict the `github-pages` environment to `main`. The workflow uses GitHub's built-in token with job-scoped Pages permissions; do not create a PAT. Stop using `npm run deploy` for routine releases after switching to Actions.

7. Commit the intended application code together with `.github/workflows/ci.yml`, `deploy/`, `.dockerignore`, `apps/backend/Dockerfile` and the compiled-migrator configuration in `packages/database/tsconfig.build.json`. Review all existing local changes rather than committing them blindly. Push to `main`, or use **Actions → CI → Run workflow → main**. The default CI workflow must pass before either deployment starts.

### Failure handling and data

Each deployment writes a private, consistent `pg_dump` archive to `/opt/avito-dev/backups/pre-deploy-ci-RUN-ATTEMPT.dump` before migrations. These are **local pre-deploy recovery copies**, not offsite or continuous backups. Monitor disk space and move needed backups to separate storage; there is no automatic deletion policy for database backups.

On migration failure, the old API remains running and the old worker restarts. If the new API fails readiness or the worker stops/restarts during startup, the script attempts to restore the previous application image. The workflow remains failed even if that recovery succeeds. Detailed migration errors remain in the private `/opt/avito-dev/.incoming/RUN-ATTEMPT/migration.log` on the VPS. Database migrations are never reversed or restored automatically. Keep them backward compatible with the old API; a destructive/incompatible migration requires a separately planned release. The worker pauses and the API briefly restarts during deployment, so this is not zero-downtime hosting.

Current and previous successful images retain the `avito-backend:dev` and `avito-backend:previous` aliases. Successfully imported upload archives are removed. The script only attempts to remove an older previous image created by this pipeline, without force; unrelated Docker images and all volumes are preserved. Worker verification checks the process/image/restart count, not completion of business jobs. A failed public HTTPS check blocks Pages publication and requires inspecting Nginx/TLS/networking; it does not automatically revert an otherwise healthy local backend.

For a manual code rollback on the VPS, first ensure the old version is compatible with the current schema, then run:

```bash
cd /opt/avito-dev
docker tag avito-backend:previous avito-backend:dev
docker compose up -d --no-deps --force-recreate api worker
curl --fail https://177-203-58-144.sslip.io/health/ready
```

Sources: [GitHub environment deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Railway backend deployment

Railway runs two services from this repository: `api` (Fastify + Telegram webhook) and `worker` (BullMQ). PostgreSQL and Redis are separate private services. The Mini App continues to be published to GitHub Pages.

Both application services use the repository root `/` as their Root Directory, not `apps/backend`: the backend needs the workspace packages and root lockfile. Set `RAILWAY_DOCKERFILE_PATH=apps/backend/Dockerfile` on both services. The Dockerfile builds only the backend dependency graph with Node.js 24 and pnpm 11.19.0, then copies production dependencies and compiled JavaScript into an unprivileged runtime image. `.dockerignore` excludes local environment files and signing material.

Connect both services to `wireside/avito-automatization`, branch `main`. Enable **Wait for CI** so a failed GitHub Actions workflow prevents deployment. Use these service settings:

| Setting                   | `api`                                    | `worker`                           |
| ------------------------- | ---------------------------------------- | ---------------------------------- |
| Start Command             | `node apps/backend/dist/api.js`          | `node apps/backend/dist/worker.js` |
| Pre-deploy Command        | `node packages/database/dist/migrate.js` | empty                              |
| Healthcheck Path          | `/health/ready`                          | empty (no HTTP listener)           |
| Healthcheck Timeout       | 120 seconds                              | default                            |
| Restart Policy            | On Failure                               | On Failure                         |
| Replicas                  | 1 initially                              | 1 initially                        |
| Public Networking         | Generate Domain                          | disabled                           |
| Serverless / App Sleeping | disabled                                 | disabled                           |

Leave the Build Command empty: the Dockerfile performs the build. Watch Paths on both services should include `/apps/backend/**`, `/packages/**`, `/package.json`, `/pnpm-lock.yaml`, `/pnpm-workspace.yaml`, `/tsconfig.base.json`, and `/.dockerignore`. Frontend-only changes then do not rebuild the backend. Changes to the lockfile still rebuild both services.

### Variables

Create services named `Postgres` and `Redis` before adding these reference variables to **both** application services:

```dotenv
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
NODE_ENV=production
RAILWAY_DOCKERFILE_PATH=apps/backend/Dockerfile
LOG_LEVEL=info
```

Use private database/Redis addresses, with no public TCP proxy required. If the resource names differ, select the corresponding variables through Railway's reference picker. Let Railway provide `PORT`; the API already listens on `HOST=0.0.0.0` and that port.

Set these additional variables on **api**:

```dotenv
TELEGRAM_MODE=webhook
MINI_APP_ORIGIN=https://wireside.github.io
MINI_APP_URL=https://wireside.github.io/avito-automatization/
TELEGRAM_WEBHOOK_URL=https://YOUR_API_DOMAIN/webhooks/telegram
MARKING_ENCRYPTION_KEY_ID=production-v1
```

Add secret values directly in Railway: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `MARKING_ENCRYPTION_KEY`, and the relevant `CHZ_NATIONAL_CATALOG_API_KEY`, `AVITO_API_CLIENT_ID`, `AVITO_API_CLIENT_SECRET`. Do not copy the whole development `.env`. Generate a webhook secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. For a new database, generate the marking encryption key using the command in `.env.example` and back it up securely. When moving existing encrypted inventory, retain its original encryption key and key ID instead of generating a replacement.

Set `TELEGRAM_MODE=disabled` on **worker**. It does not receive bot updates and currently needs no bot token. Configure future provider credentials on the worker only when its adapters actually use them. Keep staging and production databases, Redis services, and Telegram bots separate.

### First release

1. Add the Docker/deployment changes to GitHub along with the intended application changes. Railway builds committed code, not local uncommitted files.
2. Provision PostgreSQL and Redis. Enable PostgreSQL volume backups before storing production inventory. A fresh database does not contain existing local stock or users; migrate existing data explicitly if required, preserving the encryption key.
3. Deploy `api` first. Its pre-deploy command applies committed SQL migrations; a failure must stop the release. Check `https://YOUR_API_DOMAIN/health/ready` returns HTTP 200. The migrations directory is included in the image and does not require a TypeScript runtime.
4. Deploy `worker` after the API migrations have succeeded. Look for `Integration worker started` in its logs.
5. Stop local polling for the same bot. In the **deployed api container** using Railway SSH, run `node apps/backend/dist/cli/telegram-setup.js` once. This sets the webhook and verifies Telegram's configuration. Do not put this command in every container startup: routine restarts should not rewrite bot settings. If initial owner access is needed, explicitly run `node apps/backend/dist/cli/telegram-owner.js YOUR_NUMERIC_TELEGRAM_ID` in that same container.
6. Publish the existing Pages frontend once against the stable backend URL: `VITE_API_BASE_URL=https://YOUR_API_DOMAIN npm run deploy`. This command is run locally at the repository root. Reopen the Mini App and verify an authenticated read. Subsequent backend deployments keep that URL.

For routine application changes, push to `main`: CI passes, Railway builds both services, the API migration step runs, and API traffic switches after readiness succeeds. The worker has no HTTP healthcheck; inspect its startup and failure logs. Railway deployment healthchecks do not provide continuous uptime monitoring.

Migrations must remain compatible with the running API and worker during rollout. Use additive migrations before switching code; remove old schema only after all processes have moved. For an incompatible change, pause worker deployment/processing and release in a controlled order. Independent service autodeploys do not guarantee API/worker sequencing. Do not run migrations concurrently in the worker, and never use schema push in production.

For an application rollback, redeploy the previous successful image through Railway deployment history. Database migrations are not rolled back automatically; restore code only when it is compatible with the current schema.

### Local image check

From the repository root:

```bash
docker build -f apps/backend/Dockerfile -t avito-backend .
```

The same image supports API, worker, migrations and Telegram setup through the commands above. Application secrets are runtime variables; they are not Docker build arguments.

Railway references: [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [GitHub autodeploys and Wait for CI](https://docs.railway.com/deployments/github-autodeploys), [pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command), [healthchecks](https://docs.railway.com/deployments/healthchecks).

## Telegram bot and Mini App

Register a bot with [BotFather](https://t.me/BotFather) using `/newbot`.
Save its token only in the ignored root `.env`. Existing credentials in that file must be preserved.

For a local test with the Mini App on GitHub Pages:

1. Start Docker Desktop, then `docker compose up -d --wait postgres redis`.
2. Apply migrations using the explicitly selected database URL shown above.
3. Set permanent `TELEGRAM_MODE=polling`, `TELEGRAM_BOT_TOKEN`, `MINI_APP_URL=https://wireside.github.io/avito-automatization/` and optional `TELEGRAM_SETUP_CHAT_ID` in the existing `.env` once.
4. Run `npm run dev:telegram`. It starts API/bot, worker and the public HTTPS API tunnel without editing `.env`.
5. In another terminal run the printed `VITE_API_BASE_URL=https://... npm run deploy` command. This publishes the frontend with the current API tunnel address.
6. Open the bot in Telegram. `/start` and `/app` show an inline button; the menu button also opens the Mini App. `/id` reports the user's numeric ID in a private chat.
7. Grant the intended owner access explicitly with `pnpm telegram:owner <numeric-user-id>` if needed. Reopen the Mini App. There is no automatic first-user signup.

Keep the helper terminal running. A temporary API tunnel may change hostname after reconnecting; repeat frontend deployment with the newly printed URL. The Pages Mini App URL stays unchanged. Run one polling instance per bot. Stop with Ctrl+C.

For production, build the Mini App and serve its `dist` through HTTPS with `/api` and `/webhooks/telegram` routed to Fastify. Set `NODE_ENV=production`, `TELEGRAM_MODE=webhook`, the public `MINI_APP_URL` and `MINI_APP_ORIGIN`, and `TELEGRAM_WEBHOOK_URL=https://your-domain/webhooks/telegram`. Generate a random `TELEGRAM_WEBHOOK_SECRET` containing only letters, digits, `_` and `-`. Start API and worker separately, then run `pnpm telegram:setup`. Do not expose the Vite development server for permanent use.

Telegram initData signatures and age are checked on the backend, followed by the local active-user allowlist. The UI reports pending, expired and forbidden access. The warehouse supports scanned intake and stock browsing. Orders and shifts remain disabled placeholders.

Webhook duplicate suppression in Redis covers transport replies only. It is disposable and does not provide exactly-once message delivery. Future business mutations must use PostgreSQL durable operations.

Telegram contracts verified 2026-10-19 against [Mini Apps](https://core.telegram.org/bots/webapps) and [Bot API](https://core.telegram.org/bots/api). Tests mock bot replies; actual chat behavior still needs a check from the owner's Telegram client.

For a GitHub Pages Mini App with a local backend, use `npm run dev:telegram`. This builds workspace packages, starts API/bot and worker, opens an HTTPS tunnel directly to the API port and updates the Telegram menu to the configured `MINI_APP_URL`. It never edits `.env` or other configuration files. The exact frontend origin is passed to the API process for CORS. Run one instance per bot and leave its terminal open.

After the helper reports API readiness, run its printed `VITE_API_BASE_URL=https://... npm run deploy` command in a second terminal. The value is used only for that build and is embedded in the published frontend; it is not saved to `.env`. If the tunnel reconnects with a new hostname, repeat deployment with the new printed URL. GitHub Pages hosts the frontend; the Mac still runs API, bot, database and worker. Close/reopen Mini App after publication. Old Telegram message buttons retain their URL.

Set optional `TELEGRAM_SETUP_CHAT_ID` to the owner's private chat ID to read back that chat's menu after setup. `/start`, `/app` and ordinary text also refresh the current chat menu before replying.

## Chestny ZNAK provider reference

All six PDFs from the user-supplied `API_CHZ.zip` (1881 pages) are preserved with SHA-256 checksums and reviewed for this project in [docs/chz/README.md](docs/chz/README.md). Start with [catalog and receipts](docs/chz/catalog-and-receipts.md) for GTIN-based product names, article, size and color; procurement cost needs a specific supplier document, not a National Catalog card. Lookup must work for each scanned GTIN, not a hardcoded example model. Existing PostgreSQL catalog data is reused across future receipts; catalog-backed scanning completes local warehouse intake immediately; it does not sign an EDI transfer or fabricate legal CHZ observations.

[CHZ Swagger references](docs/openapi/chz/README.md) cover 180 distinct current operations and 18 deprecated routes/variants, with source text, PDF locations and an explicit schema-completeness label. They are reconstructed from PDFs, **not official complete typed contracts**: only 17 operations have additional typed subsets. See [coverage and limitations](docs/chz/source-review.md) before generating clients or implementing an adapter. National Catalog, True API and SUZ have separate credentials; Saby API is not supplied in this archive. Local validation/rebuild instructions do not read `.env` or call provider accounts.

Scanned intake now uses a read-only National Catalog adapter as described below; EDI, True API legal operations and SUZ remain future adapters. The application's own `/api/v1/openapi.json` remains a separate contract.

### Product attributes during scanned intake

Set `CHZ_NATIONAL_CATALOG_API_KEY` once in the existing root `.env` and restart the API. Do not copy `.env.example` over your credentials. `CHZ_NATIONAL_CATALOG_ENVIRONMENT=production` is the default; use `sandbox` only with a sandbox key. Optional `CHZ_NATIONAL_CATALOG_TIMEOUT_MS` is 500..10000 (default 5000). These are server-only settings, never `VITE_*`. This key is not a True API token and does not require a signing USB token for this read-only lookup.

For each scan the API parses that scan's GTIN, resolves a saved variant or reads `GET /v3/product`, matches its consumer-unit identifier, and saves name, manufacturer article, color, size/size system, composition and source evidence in the receipt transaction. The result and receipt journal immediately show the saved attributes, for example `Брюки ZZ-8 белый XL`; no model, size or GTIN is hardcoded. Previously created untouched `Товар <GTIN>` placeholders can be enriched on the next scan, including a duplicate or retry, without another inbound movement. Existing manually filled/verified/mapped/archived cards are not overwritten; repeated receipts use saved metadata without another provider call. Distinct GTINs are not merged into a model by article alone.

The lookup has a bounded timeout/body size, in-flight deduplication, a bounded cache and quota/429 cooldown. It sends only GTIN. A matching card immediately completes intake into AVAILABLE; optional missing/conflicting attributes stay null without a review stage. Missing/unavailable/ambiguous catalog data creates no new stock and returns a typed error. A stored card is reused; existing receipt replays and duplicate identities remain idempotent during provider outages.

No schema migration is needed: `product_variants` and append-only `catalog_attribute_sources` already store these attributes and provenance. Enrichment does not provide purchase cost, sign an UPD, check legal ownership, make goods sellable, or call MoySklad/True API/SUZ. Purchase cost remains unknown until a supplier document is connected. The rest of the warehouse/order workflows are unchanged.

The read-only product lookup was checked with the locally configured key on 2026-10-27. This confirms that sample response, not completeness of every card or access to legal operations. Tests also cover provider failures, conflicts, duplicate/replayed scans, atomic persistence on isolated PostgreSQL, and mobile/desktop intake rendering.

## Backend architecture

All business behavior lives in `packages/domain/src/<feature>`: scenarios, checks, state policies, dependency contracts and colocated tests. Current features are `auth`, `users`, `inventory` and `operations`, exported through `@avito/domain`. There is no backend application layer. Keep new warehouse/order scenarios in domain feature modules; extract separate rule files only for actual reuse.

Backend contains `http/`, `telegram/` and `jobs/` adapters, `infrastructure/` implementations, `bootstrap/` dependency wiring and the local `config/` module. Entry points and command names are unchanged. Bootstrap injects concrete storage, identity verification, scheduling and provider functions into domain scenarios; domain imports no backend modules, SQL, SDKs or Node runtime APIs. Internally domain uses relative imports instead of importing its own package barrel.

SQL and transactions remain in `packages/database`; PostgreSQL constraints/triggers retain atomic integrity protection. ESLint enforces domain independence and keeps concrete persistence out of transports. See section 10.1 of `PROJECT_SPEC.md` for the structure and dependency direction.

## Deploy Mini App to GitHub Pages

Run `npm run deploy` from the repository root or `apps/mini-app`. The `predeploy` command builds the Mini App with base `/avito-automatization/`; `deploy` publishes `dist` to the `gh-pages` branch of `origin` using the installed `gh-pages` CLI. Deployment does not require a global pnpm executable after workspace dependencies are installed.

For a temporary backend tunnel, pass `VITE_API_BASE_URL=https://your-api-tunnel npm run deploy`; this does not edit `.env`. For a permanent backend, you can save its public HTTPS origin in root `.env` as `VITE_API_BASE_URL`. Git push access and a configured Git name/email are required. If the repository name changes, update the `--base` argument in the Mini App's `predeploy` command.

After the first deploy, select **Settings → Pages → Deploy from a branch → gh-pages → / (root)** on GitHub. The expected site URL is `https://wireside.github.io/avito-automatization/`.

Once the site is reachable, set backend `MINI_APP_URL=https://wireside.github.io/avito-automatization/` and `MINI_APP_ORIGIN=https://wireside.github.io`, restart the backend and run `pnpm telegram:setup`. Backend, bot and database hosting remain separate. The `npm run dev:telegram` helper keeps the configured Pages URL and creates a temporary API tunnel only.

## Warehouse database model

The database schema is split into `packages/database/src/schema/` modules, re-exported through the existing `schema.ts` entry point. Migrations `0001_warehouse_model.sql` and `0002_inventory_guards.sql` add catalog/GTIN/unit identity, reusable photos, supplier documents and purchase-cost revisions, inventory receipts and counts, per-unit reservations, shipments/returns, CHZ operation records and append-only history.

`stock_balances` is a SQL view; do not update it. Unit position changes require an `inventory_operations` header and an `inventory_movements` row. Receipts and handovers have deferred consistency checks: post all related units/movements or reservation consumption in one transaction. Unknown cost has no selected price revision, rather than a zero price. See section 11 of `PROJECT_SPEC.md` for table roles, transaction order and current limitations.

Apply committed migrations through `pnpm db:migrate` using an explicitly selected database. The schema and scanned-intake transactions are verified on an isolated PostgreSQL 17 database. Only read-only National Catalog enrichment is connected; marketplace, EDI and CHZ legal submission remain disconnected.

## SHTANISHKIN interface

The responsive Mini App follows the dark SHTANISHKIN design, with blue actions, green receipt confirmations, mobile cards/bottom navigation and a desktop sidebar/table layout. Order numbers are shown in full with `№`; listing photos keep the design thumbnail slot, with the local illustration as fallback. Telegram header/background/bottom-bar colors are synchronized on startup, activation and theme changes through supported SDK methods; native iOS Liquid Glass buttons remain client-controlled. Theme colors and runtime sizes live in `apps/mini-app/src/design/tokens.ts`; Vuetify defaults in `src/plugins/vuetify.ts`; typography, radii and component sizing in `src/styles/settings.scss`. Use Vuetify props/utilities before adding component CSS. Inter and the original Figma SVGs are bundled locally.

The **Приёмка** tab accepts USB or camera scans. **Остатки** reads persisted backend stock, with search, pagination and per-unit receipt details. **Эта сессия** shows safe scan results from this open session; its counter is not a server-wide daily total. Reloading clears that session list, while accepted stock remains in PostgreSQL. Green confirmation appears after the backend accepts a scan; duplicates do not increase the intake counter. Other modules remain disabled until their backend workflows exist.

On desktop, the camera icon opens this device's camera. **Сканировать телефоном** explains how to open the same bot on a phone; shared stock refreshes automatically, without pretending a remote camera/pairing API exists.

## Scanned warehouse intake

Open the Mini App from the bot with an authorized user. OWNER, ADMIN and WAREHOUSE can receive stock; ACCOUNTANT and VIEWER can browse it. Every inventory request verifies signed Telegram initData and the current active-user allowlist again; the server derives the actor from that session.

1. Apply migrations (including `0004_intake_without_review.sql`, which adds `MAIN` / `STOCK` and removes catalog approval state).
2. Configure server-only `MARKING_ENCRYPTION_KEY` (32 random bytes, canonical base64) and `MARKING_ENCRYPTION_KEY_ID`. Generate the key with the command in `.env.example`; keep it in ignored `.env` or a secret store and back it up. Keep old keys by ID when rotating; do not overwrite the only copy while stored markings still need decryption. Without a key, browsing works but receiving returns 503; there is no plaintext fallback.
3. In **Склад → Приёмка → Добавить товар**, use the rear camera (HTTPS and camera permission required), or focus the scanner field and scan with a 2D USB keyboard scanner. Configure GS1 DataMatrix, ASCII GS (or Ctrl+]) separators and Enter/Tab suffix. Use the correct keyboard layout; unsupported/lossy codes are refused. A plain EAN/GTIN or screenshot of a product list is insufficient.
4. Wait for confirmation. The list shows quantities grouped by variant/GTIN, and by the existing product mapping when present. Search supports GTIN/name/article/size/color; expand a variant to inspect its masked per-unit identities and receipt references.

The implemented profile is clothing `01` + GTIN14 + `21` + serial13 + GS + `91` + key4 + GS + `92` + signature44, per the [official CHZ format explanation](https://markirovka.ru/knowledge/tovarnye-gruppy/legkaya-promishlennost/sostav-koda-markirovki-legprom). AIM `]d2`, an initial GS1 FNC1 rendered as GS, and the keyboard suffix are recognized framing; raw received text is encrypted unchanged. Camera decoding uses [ZXing Browser](https://github.com/zxing-js/browser). Structure and checksum validation do not verify authenticity in CHZ.

One successful new scan atomically creates a posted one-unit receipt, cost layer with unknown price, marked unit, inbound AVAILABLE movement and scan/event history. A matching National Catalog card is required (stored source evidence for this exact GTIN is reused). There is no human review state, default intake quarantine or separate approval action. Optional missing attributes do not block receipt. Missing/unavailable/ambiguous cards return an error without a placeholder receipt. Model grouping across unknown GTINs is not guessed.

Full marking text is encrypted with AES-256-GCM (versioned nonce/tag/ciphertext envelope, AAD binds key ID and identity hash). It is never returned by stock endpoints. Serial identity is deduplicated by SHA-256 of parsed GTIN+serial, independently of framing/crypto tail. Advisory locks serialize retries and resolution per GTIN; unique constraints remain the final barrier. A repeated physical scan records DUPLICATE without a movement. A network retry reuses the same request UUID and original outcome; changing that request's input returns 409. A known unit in a sold/other state is reported as already recorded, never received again through this path.

The UI sends queued scans sequentially, retains an ambiguous failed request in memory for explicit retry, clears completed payloads and refreshes Query-owned server state. The in-memory queue does not survive closing/reloading: rescan a code if its result is uncertain; server deduplication is durable. No raw marking is stored in localStorage. Camera scanning stops after one detection, on close, on backgrounding and on unmount. Stock is refreshed after receipt, on refocus and every 15 seconds.

API: `GET /api/v1/inventory?search=&offset=0&limit=40`, `GET /api/v1/inventory/variants/:id/units?offset=0`, `POST /api/v1/inventory/receipts/scan` with `{requestId, raw, scannerProfile}`. Send `Authorization: tma <signed initData>`. Responses use `Cache-Control: no-store`. The scope is one default warehouse; no reservation, shipment, return, Avito write or legal CHZ mutation is performed.

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

### Avito orders: read-only integration

Set the existing server-only `AVITO_API_CLIENT_ID` and `AVITO_API_CLIENT_SECRET` in `.env`. The same Telegram authentication protects these routes:

- `GET /api/v1/orders?page=1&limit=20&status=in_transit` — live provider page (limit 1–20, optional status), `hasMore`, `fetchedAt`, `mode: "read_only"`.
- `GET /api/v1/orders/{id}` — current order, items, status, confirmation/shipping deadlines, carrier and tracking number. IDs are strings; amounts are integer kopecks or null.
- `POST /api/v1/orders/{id}/confirm` — intentionally returns 409 `ORDER_ACTIONS_DISABLED` to OWNER/ADMIN/WAREHOUSE, without calling Avito. Other roles receive 403. There is no production write switch in this slice.

The Mini App **Заказы** module reads these routes, refreshes every 30 seconds while open, supports provider status filters/pagination and clearly labels page-local search. Errors preserve and label the last observed response. Confirmation, packing, marking and PDF creation are disabled. No CHZ calls, local order import, stock reservations/movements or new migrations occur. Read-only status observation is separate from the future warehouse shipment workflow.

Only OAuth token acquisition uses POST externally; orders use GET on the fixed Avito host. Listing thumbnails use the order item’s `chatId`, the account self endpoint and read-only Messenger chat context, matching its listing ID before exposing only an HTTPS Avito image URL. Main photos are cached for 10 minutes (unavailable photos for 1 minute), with at most 20 candidate listings per response and the same account read budget. Missing Messenger access never blocks order display. The consumed contract subset in `docs/openapi/avito/messenger-photo.openapi.json` was verified with an authenticated read on 2026-10-30; it is not a complete official OpenAPI export. A shared Redis rolling budget limits order reads to 60/minute/account; timeouts, 401 token refresh and 429 cooldown are bounded. Provider personal contact/address data are omitted from our DTOs. Missing configuration/access and provider failures produce safe `AVITO_*` errors. Do not enable real mutations merely by replacing the disabled endpoint with a direct provider call: use the durable operations flow first.

`GET /health/live` and `GET /health/ready` remain available for process/dependency checks. Their health response is separate from business API DTOs. Telegram webhook endpoints are internal integration transport and are not part of this frontend contract.

Every protected request sends `Authorization: tma <Telegram.WebApp.initData>`. The verify endpoint is optional for displaying the current user; it does not issue a new token. Keep sending the original signed initData. The server checks its age/signature and reloads active user/roles on every request, so revocation takes effect immediately. Never use `initDataUnsafe` or a client-selected actor ID. On 401 reopen the Mini App to obtain a new signed session; 403 means the current user/role lacks access.

Read roles: OWNER, ADMIN, WAREHOUSE, ACCOUNTANT, VIEWER. Intake roles: OWNER, ADMIN, WAREHOUSE. CORS allows the configured `MINI_APP_ORIGIN`, `Authorization` and `Content-Type`; it exposes `x-correlation-id` to browser code. Set the exact frontend origin (scheme + host + port); do not enable wildcard origins as an auth workaround. API responses use `Cache-Control: no-store`.

`search` has at most 120 characters; `offset` is 0..1,000,000, `limit` is 1..100 (default 40). Warehouse `totals` always cover the entire warehouse, while filtering/pagination apply to `items`. If a variant page has `hasMore: true`, increment offset by limit; for units increment by 20. A valid but unknown variant UUID returns an empty units page. Group variants by non-null `productId`; keep unmapped variants separate.

The scan body uses a UUID `requestId`, unmodified `raw` (1..512 characters), and `scannerProfile` equal to `camera-gs1-v1` or `keyboard-gs1-v1`. The request body limit is 4096 bytes; the auth body limit is 32768 bytes. JSON preserves GS as `\u001d`; pass `JSON.stringify` the actual string rather than replacing separators with literal backslash text. Unknown body/query fields are rejected. Do not send `actorUserId`, warehouse quantities, legal status or a target physical state: the server derives these.

A new physical scan gets a new UUID. Retrying an uncertain request keeps the same UUID, exact raw string, profile and user; its response preserves the original outcome with `replayed: true`. Reusing the UUID with a different payload returns 409. Scanning an already recorded GTIN+serial under a fresh UUID returns `outcome: "DUPLICATE"`, `replayed: false` and adds no stock. Even an existing unit outside the warehouse is not received again through this route. Only a committed new unit returns 201. `unit` in the response contains the saved attributes, current masked identity/state and receipt reference; no reviewStatus/catalogStatus/catalogLookup workflow fields are exposed; refetch stock afterward for current totals.

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

| Status    | Codes / frontend action                                                                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400       | `INVALID_REQUEST`, `INVALID_JSON`: correct the parameters/JSON                                                                                                                                                                    |
| 401       | `UNAUTHORIZED`, `MALFORMED`, `INVALID_SIGNATURE`, `EXPIRED`, `TELEGRAM_USER_MISSING`: obtain a valid Telegram session                                                                                                             |
| 403       | `USER_NOT_ALLOWED`, `FORBIDDEN`: request access or the appropriate role                                                                                                                                                           |
| 404       | `NOT_FOUND`: check the route; an empty units page is not a route error                                                                                                                                                            |
| 409       | `IDEMPOTENCY_CONFLICT`, `CATALOG_ARCHIVED`, `CATALOG_AMBIGUOUS`: resolve the conflict; do not blindly repeat                                                                                                                      |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE`: fix the body size/content type                                                                                                                                                    |
| 422       | `INVALID_MARKING`, `INVALID_GTIN`, `CATALOG_NOT_FOUND`: rescan/check scanner settings                                                                                                                                             |
| 500       | `INTERNAL_ERROR`: result may be uncertain; retain the scan UUID for a retry                                                                                                                                                       |
| 503       | `TELEGRAM_NOT_CONFIGURED`, `INVENTORY_NOT_CONFIGURED`, `MARKING_STORAGE_NOT_CONFIGURED`, `WAREHOUSE_UNAVAILABLE`, `CATALOG_UNAVAILABLE`, `CATALOG_NOT_CONFIGURED`: configuration/destination unavailable; retain any pending scan |

## Local development and checking GitHub Pages

Existing `.env` is user-owned: dev commands read it and never rewrite it. Put permanent local credentials/settings there once. Shell assignments override settings only for one command. Do not copy `.env.example` over an existing `.env`.

1. Start Docker Desktop, run `docker compose up -d --wait postgres redis`, install dependencies with `pnpm install --frozen-lockfile` when needed.
2. Apply migrations with an explicitly selected database, for example `DATABASE_URL=postgresql://avito:avito@localhost:5432/avito npm run db:migrate`. Both `db:migrate` and `db:generate` build the database package's workspace dependencies first, so a fresh checkout does not need pre-existing `domain/dist`. CI uses the same command, rather than relying on a later `verify` build.
3. For browser-only UI development, run `TELEGRAM_MODE=disabled VITE_API_BASE_URL= npm run dev` and open `http://localhost:5173`. Vite proxies `/api` to local Fastify. Telegram-protected actions still require signed initData; opening the URL directly does not authenticate the browser.
4. For Telegram + hosted Mini App, configure `MINI_APP_URL=https://wireside.github.io/avito-automatization/`, `TELEGRAM_MODE=polling`, bot token and optional private setup chat ID in `.env`; then run `npm run dev:telegram`. No Vite frontend/tunnel is needed for this mode: the frontend comes from Pages, HTTPS tunnel points to the local API.
5. In another terminal run the exact `VITE_API_BASE_URL=... npm run deploy` printed by the helper. Wait for Pages publication, open the bot, send `/app`, and reopen Mini App. The published JS contacts the API tunnel; Fastify validates Telegram initData and local roles before returning stock. The worker handles background operations and is started by the helper.
6. `https://<tunnel>/health/ready` checks PostgreSQL/Redis; `/api/v1/openapi.json` exposes the API contract. A 401 for an unsigned inventory request is expected. Authenticated warehouse responses should be 200; no CORS wildcard or auth bypass is used.

Stop with Ctrl+C. The tunnel has a temporary lifetime and no production uptime guarantee. If the Mac sleeps or its terminal stops, the Pages UI can load but API actions will fail until the backend/tunnel is restored. A different tunnel hostname requires a new frontend build because Vite settings are compiled into JavaScript. For permanent use, replace the tunnel with a stable HTTPS backend and deploy once with that address. For stock intake configure a backed-up persistent `MARKING_ENCRYPTION_KEY`; the dev helper never generates or replaces it.

Migration `0004_intake_without_review.sql` removes the obsolete products/variants review columns and enum. Archived records keep `archived_at`. It creates a separate SELLABLE `STOCK` location and updates receipt guards/availability. Untouched catalog-backed legacy intake is completed with append-only SYSTEM correction movements; returns, defects and uncatalogued legacy records are not silently released. A later rescan can enrich and complete an untouched legacy placeholder without adding a second unit. Legal observations are never fabricated by this migration.
