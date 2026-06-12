# ICEDR

<p align="center">
  <img src="frontend/public/ICEDR.png" alt="ICEDR" width="760" />
</p>

<p align="center">
  <a href=".github/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white" /></a>
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white" />
  <img alt="pnpm 10.18.1" src="https://img.shields.io/badge/pnpm-10.18.1-F69220?logo=pnpm&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827" />
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white" />
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white" />
</p>

ICEDR is a self-hostable workspace drive for file management, preview, sharing, and operational audit. It ships as a Node.js monorepo with a React frontend, a NestJS backend, Prisma-backed persistence, object storage support, and container packaging for the application code.

## Features

- Workspace file management with upload, download, preview, trash, version, and quota workflows.
- External sharing with link policies, email verification, authenticated account access, preview controls, and download limits.
- Administrative panels for system status, storage, identity, sharing policy, and audit records.
- Structured audit events for workspace users, signed-in accounts, visitors, and system activity.
- SQLite-first local persistence with optional production database and object storage integrations.
- Local development defaults that can run with demo data while infrastructure is being wired up.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `frontend` | Vite, React, HeroUI, Tailwind CSS, and Playwright smoke tests. |
| `backend` | NestJS API, authentication, sharing, storage, settings, and audit modules. |
| `database` | Prisma schema, SQLite schema variant, migrations, and seed entry point. |
| `deploy` | Docker image and Compose packaging configuration. |
| `docs` | VitePress documentation source, deployment guide, and release reference. |
| `scripts` | Release, checksum, and binary packaging utilities. |

## Requirements

- Node.js 24
- pnpm 10.18.1
- Docker, when building container images

## Quick Start

```bash
cp .env.example .env
pnpm install
pnpm dev:api
pnpm dev:app
```

The frontend is served at `http://localhost:13000`. The API is served at `http://localhost:13001/api`.

The browser client uses same-origin `/api` by default. During local development, Vite proxies `/api` to the backend configured by `API_HOST` and `API_PORT`, so frontend code does not need to embed a development backend origin.

The local environment file enables development-only defaults such as demo data, an in-memory fallback, and the development mail logger. These settings are intended for local work only.

## Common Commands

```bash
pnpm install
pnpm lint
pnpm build
pnpm docs:build
pnpm test
pnpm test:e2e
pnpm package:binary
pnpm docker:build
```

Useful package-scoped commands:

```bash
pnpm --filter frontend build
pnpm --filter frontend test
pnpm --filter frontend test:e2e
pnpm --filter backend build
pnpm --filter backend test
pnpm --filter backend prisma:migrate:deploy
```

Install the Playwright browser once before running the end-to-end smoke suite locally:

```bash
pnpm --filter frontend exec playwright install --with-deps chromium
```

## Configuration

Start from `.env.example` for local development and `.env.production.example` for production. Production deployments should provide the public share URL, persistence, storage, cache, and SMTP values required by the selected runtime environment.

Fresh data directories open the first-run setup page. Setup starts with local SQLite and local file storage, and the database step lets administrators keep SQLite or switch to PostgreSQL before completing bootstrap. SMTP is optional during first-run setup; it can stay disabled and be configured later from the administrator settings.

The backend validates production configuration during startup. Missing values, malformed URLs or ports, development-only mail delivery, and common placeholder values cause startup to fail with clear variable names. SMTP values are required only when mail delivery is enabled.

External login should use the standard `oidc` provider profile for normal OIDC providers. The `icetowne-blog` profile remains available only for the legacy Blog OAuth shape.

Configuration reference lives in the VitePress documentation under `docs/reference/configuration.md`.

## Published Builds

The current pre-release is `v0.0.1-alpha.2`. Container images are published as `corecherry/icedr-po:<tag>` and `ghcr.io/cloudwhile/icedr-po:<tag>`. Use `0.0.1-alpha.2` as the Docker tag for this release.

Stable versions such as `v1.2.0` update the `latest` tag in both registries. Pre-release versions such as `v0.0.1-alpha.2`, `v1.2.0-alpha.1`, or `v1.2.0-beta.1` publish their own version tags but do not update `latest`.

### Minimal Docker Deployment

The Docker image contains the ICEDR web client and API in one container. Persist `/workspace/backend/data` to keep SQLite data, local files, setup state, and runtime metadata across upgrades:

```bash
mkdir -p /opt/icedr/data

docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  -e SMTP_ENABLED=false \
  corecherry/icedr-po:0.0.1-alpha.2
```

Open `http://localhost:13000`, or replace `localhost` with the server address. A fresh data directory opens the first-run setup page.

### Minimal Binary Deployment

Standalone binaries are attached to each GitHub Release. Artifact names follow the `icedr_VERSION_PLATFORM` convention. Release notes include generated download links, file sizes, `MD5SUMS.txt`, `SHA256SUMS.txt`, and `release-manifest.json`.

Linux x86_64 example:

```bash
mkdir -p /opt/icedr
cd /opt/icedr
chmod +x ./icedr_0.0.1-alpha.2_linux-x86_64
./icedr_0.0.1-alpha.2_linux-x86_64
```

Binary builds create `data` beside the executable by default. Set `ICEDR_DATA_DIR` only when the data directory must live elsewhere.

Deployment details live in the VitePress documentation:

- Docker: `docs/guide/docker.md`
- Binary: `docs/guide/binary.md`
- Configuration: `docs/reference/configuration.md`
- Releases and checksums: `docs/reference/releases.md`

## Release Versioning

Examples:

```text
v1.2.0
v0.0.1-alpha.2
v1.2.0-alpha.1
v1.2.0-beta.1
```

Tags that contain a pre-release marker after the version, such as `-alpha.1` or `-beta.1`, are published as GitHub prereleases. Stable tags update the Docker `latest` image tag; pre-release tags do not.

The ICEDR runtime normalizes `v`-prefixed tags for version comparison while keeping the standard tag form in system information. Pre-release builds can detect newer pre-release and stable releases; stable builds only treat stable releases as updates by default.

Each GitHub Release includes generated asset links, `MD5SUMS.txt`, `SHA256SUMS.txt`, and `release-manifest.json` so downloaded files can be checked for integrity and source.

## Verification Flow

1. Open `http://localhost:13000`.
2. Confirm that the drive loads from the API.
3. Upload a small file.
4. Create an external share for the file.
5. Open the generated `/share/s/:token` link.
6. Verify access through email or an authenticated account.
7. Download or preview the shared file.
8. Review the audit log for the share, verification, preview, and download activity.

## Documentation

- `pnpm docs:dev` starts the VitePress documentation locally.
- `pnpm docs:build` builds the documentation to `docs/.vitepress/dist`.
- `.github/workflows/pages.yml` deploys the documentation to GitHub Pages.
- Documentation source is under `docs`.
- `scripts/README.md`

## License

ICEDR is licensed under the Apache License 2.0. See `LICENSE` for details.
