# SHTANISHKIN

[![CI/CD](https://github.com/wireside/avito-automatization/actions/workflows/cicd.yml/badge.svg)](https://github.com/wireside/avito-automatization/actions/workflows/cicd.yml)

Telegram Mini App для продажи маркированной одежды через Авито Доставку: приёмка по DataMatrix, резервирование, упаковка, отгрузка и возвраты. Backend работает с API Авито и Честного знака; документы подписывает Windows-агент с КриптоПро и УКЭП владельца. Входящие УПД подписываются отдельно в Saby.

Один TypeScript-монорепозиторий, отдельные процессы API и worker. PostgreSQL хранит складской учёт и операции, Redis/BullMQ исполняет фоновые задания.

## Стек

Для разработки нужны **Node.js 24+**, **pnpm 11.19.0** и **Docker с Compose v2**. Версии библиотек ниже — из [pnpm-lock.yaml](pnpm-lock.yaml); образы БД — из [docker-compose.yml](docker-compose.yml).

| Часть            | Инструменты и версии                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| Язык             | TypeScript 5.9.3                                                        |
| Backend          | Fastify 5.12.5, Telegraf 4.16.3, Zod 4.6.5, Pino 9.14.0                 |
| Frontend         | Vue 3.5.43, Vite 7.3.6, Vuetify 4.3.0, TanStack Vue Query 5.104.0       |
| Данные и очередь | PostgreSQL 17, Drizzle ORM 0.44.7 / Kit 0.31.11, Redis 8, BullMQ 5.81.5 |
| Тесты            | Vitest 3.2.7, Playwright 1.63.0, Testcontainers 11.14.0                 |

## Локальный запуск

Из корня репозитория:

```bash
test -f .env || cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d --wait postgres redis
DATABASE_URL=postgresql://avito:avito@localhost:5432/avito pnpm db:migrate
pnpm dev
```

Compose запускает PostgreSQL и Redis; `pnpm dev` — API, worker и Vite. В существующей `.env` проверьте `DATABASE_URL` и `REDIS_URL`: для локального Compose значения приведены в [.env.example](.env.example). CLI миграций получает `DATABASE_URL` из окружения, а API, worker и Vite читают корневую `.env`.

- Mini App: [localhost:5173](http://localhost:5173).
- API: [localhost:3000](http://localhost:3000).
- Готовность PostgreSQL/Redis: [/health/ready](http://localhost:3000/health/ready).

### Окружение и доступы

Все переменные перечислены в [.env.example](.env.example), проверка конфигурации — в [config/index.ts](apps/backend/src/config/index.ts).

- **Telegram:** по умолчанию `TELEGRAM_MODE=disabled`. Для входа в Mini App нужен `TELEGRAM_BOT_TOKEN` и подписанная Telegram-сессия; открытие страницы в браузере не даёт доступ к защищённому API.
- **Авито:** `AVITO_API_CLIENT_ID` и `AVITO_API_CLIENT_SECRET` для чтения заказов.
- **Приёмка:** `CHZ_NATIONAL_CATALOG_API_KEY` для поиска по GTIN и `MARKING_ENCRYPTION_KEY` для хранения маркировок. Ключ — 32 случайных байта в Base64; создайте его один раз и сохраните вместе с `MARKING_ENCRYPTION_KEY_ID`.
- **Отправка:** `AVITO_WRITES_ENABLED` и `CHZ_DOCUMENT_SUBMISSION_ENABLED` по умолчанию выключены. Прямой канал ЧЗ — `CHZ_SUBMISSION_MODE=DIRECT_TRUE_API`; настройка Windows описана в [README подписанта](apps/local-signer/README.md).

Создание ключа для нового окружения:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Сохраните результат в `.env` как `MARKING_ENCRYPTION_KEY`. API и worker используют одинаковые настройки и ключи. В `VITE_*` попадают только публичные значения; `VITE_API_BASE_URL` можно оставить пустым для локального Vite-прокси.

### Разработка в Telegram

Используйте отдельного бота разработки. Задайте `TELEGRAM_MODE=polling`, `TELEGRAM_BOT_TOKEN` и HTTPS `MINI_APP_URL` опубликованного frontend. Запустите `pnpm dev:telegram` вместо `pnpm dev`: команда поднимает API/worker, открывает HTTPS-туннель, настраивает меню бота и печатает команду публикации frontend с адресом API. Нужен SSH-клиент; `.env` не переписывается.

Первоначальная выдача роли владельца:

```bash
pnpm telegram:owner <числовой_Telegram_ID>
```

После выдачи прав переоткройте Mini App.

## HTTP API

[OpenAPI 3.1](http://localhost:3000/api/v1/openapi.json) формируется из Zod-схем в [packages/contracts](packages/contracts/src/openapi.ts). Маршруты, схемы, авторизация, ошибки и правила повторов описаны в спецификации.

Для просмотра в [Swagger UI](https://swagger.io/docs/open-source-tools/swagger-ui/usage/installation/) после запуска API:

```bash
curl --fail --silent --show-error http://localhost:3000/api/v1/openapi.json \
  -o /tmp/avito-openapi.json
docker run --rm -p 127.0.0.1:8080:8080 \
  --mount type=bind,source=/tmp/avito-openapi.json,target=/spec/openapi.json,readonly \
  -e SWAGGER_JSON=/spec/openapi.json \
  -e SUPPORTED_SUBMIT_METHODS='[]' \
  docker.swagger.io/swaggerapi/swagger-ui
```

Откройте [localhost:8080](http://localhost:8080). Это просмотр сохранённой спецификации без отправки запросов; после изменения контрактов скачайте JSON заново.

## Проверки

```bash
pnpm verify                            # форматирование, lint, типы, unit/HTTP-тесты, сборка
pnpm exec playwright install chromium
pnpm test:e2e                          # после сборки frontend
```

Тесты PostgreSQL требуют отдельных чистых баз. Переменные `RUN_*_TESTS`, миграции и команды запуска приведены в [CI workflow](.github/workflows/cicd.yml). Проверки Windows-агента — в [его README](apps/local-signer/README.md).

## Структура и документация

- `apps/backend` — HTTP, Telegram, worker и адаптеры интеграций; `apps/mini-app` — Vue; `apps/local-signer` — Windows-агент.
- `packages/domain` — бизнес-сценарии и правила; `packages/database` — SQL и миграции; `packages/contracts` — DTO, Zod и OpenAPI.
- `packages/integrations`, `queue`, `observability` — клиенты провайдеров, фоновые задания и логирование.

[Спецификация проекта](PROJECT_SPEC.md) · [Экраны и сценарии](docs/marking-pipeline-frontend.md) · [Контракты Авито](docs/openapi/avito/index.json) · [Контракты ЧЗ](docs/chz/README.md) · [Развёртывание](docs/deployment.md)
