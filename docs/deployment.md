# ICEDR Deployment

Docker Compose lives at `deploy/docker-compose.yml`.

```bash
docker compose -f deploy/docker-compose.yml up --build
```

Compose starts PostgreSQL, Redis, MinIO, the Nest API, and the Vite-built frontend. The frontend listens on `13000`; the API listens on `13001` and exposes `/api/health`.

Dockerfiles live in:

- `deploy/docker/frontend.Dockerfile`
- `deploy/docker/backend.Dockerfile`

The optional Nginx config in `deploy/nginx/default.conf` proxies `/api` and `/api/docs` to the backend and all other traffic to the frontend.
