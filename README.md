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

## Docker Compose Deployment

```bash
docker compose -f deploy/docker-compose.yml up --build
```

Compose starts:

- `postgres` on `localhost:5432`
- `redis` on `localhost:6379`
- `minio` on `localhost:9000`, console on `localhost:9001`
- `api` on `localhost:13001`
- `web` on `localhost:13000`

The `minio-init` service creates the `icedr-drive` bucket automatically. The API health endpoint is available at `http://localhost:13001/api/health`.

## Production Environment

When `NODE_ENV=production` or `APP_ENV=production`, ICEDR refuses to boot without the production dependencies it needs. Provide at least:

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
S3_ENDPOINT=https://s3.example.com
S3_REGION=us-east-1
S3_BUCKET=icedr-drive
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
PUBLIC_SHARE_BASE_URL=https://drive.example.com/share/s
SHARE_EMAIL_PROVIDER=your-provider
```

Do not set `ALLOW_DEV_MEMORY_STORE=true` or `SEED_DEMO_DATA=true` in production. Production file nodes and share links must come from PostgreSQL, and uploaded objects must exist in S3 or MinIO.

## Verification Flow

1. Open `http://localhost:13000`.
2. Confirm the drive loads from the API. In an empty production database, the file list should be empty rather than showing demo files.
3. Upload a small file.
4. Select it and create an external share.
5. Open the generated `/share/s/:token` link.
6. Authenticate with email verification. In `dev-log` mode, the code is recorded in audit events for tests and local debugging.
7. Download the file and check the Audit view for share, download, and matched policy events.

External shares resolve one download policy for anonymous visitors, email-verified visitors, and authenticated account visitors. That policy controls wait time, speed hints, domain or allowlist requirements, and per-link download limits; each access session and download intent carries the policy decision that was applied.

Short-lived email codes, access sessions, preview intents, and download intents are process-local in this first deployable version. Restarting the API invalidates those temporary tokens, but persisted share links remain in PostgreSQL.

## Quality Gates

```bash
pnpm.cmd lint
pnpm.cmd build
pnpm.cmd test
```

Use `pnpm.cmd` on Windows PowerShell if script execution policy blocks `pnpm.ps1`.
