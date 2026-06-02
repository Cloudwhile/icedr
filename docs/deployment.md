# ICEDR Deployment

Docker Compose lives at `deploy/docker-compose.yml`.

```bash
copy .env.production.example .env.production
# Edit .env.production before starting the stack.
docker compose --env-file .env.production -f deploy/docker-compose.yml up --build
```

Compose starts PostgreSQL, Redis, MinIO, the Nest API, and the Vite-built frontend. The frontend listens on `13000`; the API listens on `13001` and exposes `/api/health`.

When the API runs with `NODE_ENV=production` or `APP_ENV=production`, startup validates the production environment before binding the HTTP port. Missing PostgreSQL, Redis, S3, CORS, public URL, or SMTP variables fail startup with the specific variable names. Development-only values such as `ALLOW_DEV_MEMORY_STORE=true`, `SEED_DEMO_DATA=true`, and `SHARE_EMAIL_PROVIDER=dev-log` are rejected in production.

Dockerfiles live in:

- `deploy/docker/frontend.Dockerfile`
- `deploy/docker/backend.Dockerfile`

The optional Nginx config in `deploy/nginx/default.conf` proxies `/api` and `/api/docs` to the backend and all other traffic to the frontend.
