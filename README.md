# ICEDR

ICEDR is a workspace file drive built as a Node.js monorepo:

- `frontend`: Vite, React, HeroUI web client
- `backend`: NestJS API organized under `src/modules`
- `database`: schema and migration entry point
- `deploy`: Docker Compose, Dockerfiles, and optional Nginx config
- `docs`: architecture, API, database, and deployment notes

## Local Development

```bash
copy .env.example .env
pnpm.cmd install
pnpm.cmd infra:up
pnpm.cmd dev:api
pnpm.cmd dev:app
```

The frontend runs at `http://localhost:13000`. The API runs at `http://localhost:13001/api`.

For local development, `.env.example` enables:

- `ALLOW_DEV_MEMORY_STORE=true`
- `SEED_DEMO_DATA=true`
- `SHARE_EMAIL_PROVIDER=dev-log`

Those settings allow the app to boot with demo data while the database or email provider is still being wired up. They are not production settings.

`pnpm.cmd infra:up` starts only PostgreSQL, Redis, and MinIO for local development, with ports bound to `127.0.0.1`.

## Docker Compose Deployment

```bash
copy .env.production.example .env.production
# Edit .env.production before starting the stack.
docker compose --env-file .env.production -f deploy/docker-compose.yml up --build
```

Compose starts:

- `edge` on `localhost:13000`
- `web`, `api`, `postgres`, `redis`, and `minio` inside the Docker network

The `minio-init` service creates the configured bucket automatically. The API health endpoint is available through the edge proxy at `http://localhost:13000/api/health`.

For production, publish only the edge proxy or your own gateway. PostgreSQL, Redis, the Nest API, MinIO S3 API, and the MinIO console should stay on the internal network. The default Nginx sample proxies `/` to the web client, `/api/` to the Nest API, and `/objects/` to MinIO for signed object URLs.

## Production Environment

When `NODE_ENV=production` or `APP_ENV=production`, ICEDR refuses to boot without the production dependencies it needs. Start from `.env.production.example`, replace every placeholder, and provide at least:

```bash
NODE_ENV=production
APP_ENV=production
VITE_API_BASE_URL=https://api.example.com/api
API_PUBLIC_BASE_URL=https://api.example.com/api
API_HOST=0.0.0.0
API_PORT=13001
API_CORS_ORIGIN=https://drive.example.com
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_DBNAME=icedr
DATABASE_USER=user
DATABASE_PASSWORD=password
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DBNAME=0
REDIS_USER=
REDIS_PASSWORD=
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://drive.example.com/objects
S3_REGION=us-east-1
S3_BUCKET=icedr-drive
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
PUBLIC_SHARE_BASE_URL=https://drive.example.com/share/s
SHARE_EMAIL_PROVIDER=smtp
SMTP_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_FROM_EMAIL=noreply@example.com
```

Do not set `ALLOW_DEV_MEMORY_STORE=true`, `SEED_DEMO_DATA=true`, or `SHARE_EMAIL_PROVIDER=dev-log` in production. Production file nodes and share links must come from PostgreSQL, uploaded objects must exist in S3 or MinIO, and mail delivery must use SMTP.

The backend validates production environment variables during startup. Missing required values, disabled SMTP delivery, malformed URLs or ports, `dev-log`, and obvious placeholder values such as `...`, `replace-me`, `your-provider`, or `example.com` cause startup to fail with the specific variable names in the error message.

## Verification Flow

1. Open `http://localhost:13000`.
2. Confirm the drive loads from the API. In an empty production database, the file list should be empty rather than showing demo files.
3. Upload a small file.
4. Select it and create an external share.
5. Open the generated `/share/s/:token` link.
6. Authenticate with email verification. In `dev-log` mode, the code is recorded in audit events for tests and local debugging.
7. Download the file and check the Audit view for share, download, and matched policy events.

External shares resolve one download policy for anonymous visitors, email-verified visitors, and authenticated account visitors. That policy controls wait time, speed hints, domain or allowlist requirements, and per-link download limits; each access session and download intent carries the policy decision that was applied.

Short-lived email codes, access sessions, preview intents, and download intents are persisted with TTLs in PostgreSQL. API restarts and multiple API instances can continue validating unexpired share access state from the shared database.

## Quality Gates

```bash
pnpm.cmd lint
pnpm.cmd build
pnpm.cmd test
```

Use `pnpm.cmd` on Windows PowerShell if script execution policy blocks `pnpm.ps1`.
