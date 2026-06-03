# ICEDR Deployment

Docker Compose lives at `deploy/docker-compose.yml`.

```bash
copy .env.production.example .env.production
# Edit .env.production before starting the stack.
docker compose --env-file .env.production -f deploy/docker-compose.yml up --build
```

Compose starts PostgreSQL, Redis, MinIO, the Nest API, the Vite-built frontend, and an Nginx edge proxy. The edge proxy listens on `13000` and forwards `/api/health` to the API.

For local development, `pnpm.cmd infra:up` also applies `deploy/docker-compose.dev.yml`, which binds PostgreSQL, Redis, MinIO S3, and MinIO console to `127.0.0.1` only. Do not use that dev override for production hosts.

## Public Access Boundary

| Service | Public by default | Internal address | Recommended public route |
| --- | --- | --- | --- |
| `edge` | Yes, `localhost:13000` | `edge:80` | Web, API, and signed object URLs |
| `web` | No | `web:13000` | `/` through `edge` |
| `api` | No | `api:13001` | `/api/` through `edge` |
| `minio` S3 API | No | `minio:9000` | `/objects/` through `edge` when signed URLs are needed |
| `minio` console | No | `minio:9001` | Private admin network only |
| `postgres` | No | `postgres:5432` | Private network only |
| `redis` | No | `redis:6379` | Private network only |

Use `S3_ENDPOINT=http://minio:9000` for backend-to-MinIO traffic inside Compose. Use `S3_PUBLIC_ENDPOINT=https://your-drive-host.example/objects` when browser-visible upload or download URLs should pass through the edge proxy instead of exposing MinIO directly.

The sample Nginx config in `deploy/nginx/default.conf` routes:

- `/` to the web frontend.
- `/api/` to the Nest API.
- `/objects/` to the MinIO S3 API for signed object URLs.

Do not publish PostgreSQL, Redis, the API container, or MinIO console directly in production. If you need operational access, bind them to a private interface, VPN, bastion, or another restricted network path.

When the API runs with `NODE_ENV=production` or `APP_ENV=production`, startup validates the production environment before binding the HTTP port. Missing PostgreSQL, Redis, S3, CORS, public URL, or SMTP variables fail startup with the specific variable names. Development-only values such as `ALLOW_DEV_MEMORY_STORE=true`, `SEED_DEMO_DATA=true`, and `SHARE_EMAIL_PROVIDER=dev-log` are rejected in production.

Dockerfiles live in:

- `deploy/docker/frontend.Dockerfile`
- `deploy/docker/backend.Dockerfile`

The optional Nginx config in `deploy/nginx/default.conf` proxies `/api` and `/api/docs` to the backend and all other traffic to the frontend.
