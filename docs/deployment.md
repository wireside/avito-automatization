# Развёртывание

API, worker, PostgreSQL и Redis размещаются на VPS в `/opt/avito-dev`; Mini App — на GitHub Pages. Релиз запускает [CI/CD](../.github/workflows/cicd.yml) при пуше в `main`. Pages публикуется после успешного обновления backend.

## Настройка GitHub Actions

1. На VPS нужны Docker Compose, Python 3, `curl`, `gzip`, `sha256sum`, `flock`, Nginx и TLS. Рабочий Compose содержит `api`, `worker`, `migrate`, `postgres`, `redis`; backend-сервисы используют образ `avito-backend:dev`.
2. Создайте environment `vps-development` с доступом из `main`. Добавьте секрет `VPS_SSH_KEY` с отдельным ключом CI и установите его публичную часть на VPS. Скрипт поддерживает root-доступ; такой ключ даёт полномочия root.
3. Задайте Actions variables: `VPS_HOST`, `VPS_KNOWN_HOSTS`, `VPS_HEALTH_URL`, `VITE_API_BASE_URL`; при необходимости `VPS_USER` (по умолчанию `root`) и `VPS_PORT` (`22`). Host key возьмите из доверенной серверной сессии. Затем включите `VPS_DEPLOY_ENABLED=true`.
4. В Pages выберите Source → GitHub Actions; для environment `github-pages` разрешите `main`.

На VPS сохраняются собственные `.env`, `compose.yaml`, overrides, тома и Nginx/TLS. CI их не заменяет. Корневой Compose репозитория предназначен для локальных PostgreSQL/Redis.

## Окружение сервера

API и worker получают одинаковые настройки через `env_file` или `environment`. Поля перечислены в [`.env.example`](../.env.example).

- `MINI_APP_URL` — полный HTTPS URL Pages с путём репозитория; `MINI_APP_ORIGIN` — только origin для CORS.
- `VITE_API_BASE_URL` — публичный URL backend, встраиваемый в frontend при сборке.
- `PUBLIC_API_URL` — HTTPS origin backend для подписанта и этикеток.
- `TELEGRAM_MODE=webhook`, `TELEGRAM_WEBHOOK_URL` и `TELEGRAM_WEBHOOK_SECRET` — доставка обновлений боту. `TELEGRAM_BOT_TOKEN` нужен обоим процессам. После первоначальной настройки или смены адресов выполните `pnpm telegram:setup` из настроенного checkout.
- Для подключения Windows через `/signer`: `SIGNER_TELEGRAM_ENROLLMENT_ENABLED=true`, `PUBLIC_API_URL`, токен бота и ключ шифрования. [Установка агента](../apps/local-signer/README.md).

Ключ `MARKING_ENCRYPTION_KEY` и его ID сохраняются при обновлениях. Резервируйте БД и ключ вне VPS. Включение отправок Авито и документов ЧЗ выполняется отдельно после проверки реальных прав аккаунтов и Windows-подписи.

Если для True API нужен HTTP CONNECT-прокси, задайте `CHZ_PROXY_ENABLED=true` и `CHZ_PROXY_URL` обоим процессам. URL — HTTP(S) origin без credentials, пути и query. Доступ к прокси ограничивается IP сервера и назначением ЧЗ.

Для Авито задайте `AVITO_PROXY_ENABLED=true` и `AVITO_PROXY_URL` в том же формате обоим процессам. На прокси разрешите `CONNECT api.avito.ru:443` только с IP сервера приложения. Настройки прокси Авито и ЧЗ независимы. Через прокси Авито идут получение токена, чтение заказов, действия продавца, маркировки и скачивание этикеток. TLS проверяется до Авито, а при сбое прокси прямого повтора нет. После включения сначала проверьте чтение заказа. Запросы к другим интеграциям используют их собственные настройки.

После изменения серверной `.env` пересоздайте процессы:

```bash
cd /opt/avito-dev
docker compose up -d --force-recreate api worker
```

В существующем VPS override может использоваться `TELEGRAM_API_IPV4` / `extra_hosts` для `api.telegram.org`. Сохраняйте override при деплое; актуальность адреса проверяется отдельно с включённой проверкой TLS.

## Обновление и восстановление

CI собирает `linux/amd64`-образ, проверяет checksum и ревизию, сохраняет `pg_dump`, останавливает worker, применяет миграции, обновляет API и запускает worker. Соседние версии приложения должны быть совместимы: обновление backend и frontend последовательное.

После перезагрузки VPS:

```bash
cd /opt/avito-dev
docker compose up -d postgres redis api worker
docker compose ps
curl --fail https://<публичный-хост-API>/health/ready
```

Миграции и перенастройка Telegram при обычном рестарте не нужны. Если релиз не прошёл, скрипт пытается вернуть предыдущий код, но схема БД остаётся новой. Ручное восстановление `avito-backend:previous` требует совместимой схемы. Бэкапы в `/opt/avito-dev/backups` находятся на том же VPS; для восстановления при потере сервера нужна внешняя копия.
