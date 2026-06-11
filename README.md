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
| `docs` | Architecture, storage, identity provider, and deployment notes. |
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

The local environment file enables development-only defaults such as demo data, an in-memory fallback, and the development mail logger. These settings are intended for local work only.

## Common Commands

```bash
pnpm install
pnpm lint
pnpm build
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

Start from `.env.example` for local development and `.env.production.example` for production. Production deployments should provide the public API, share URL, persistence, storage, cache, and SMTP values required by the selected runtime environment.

The backend validates production configuration during startup. Missing values, malformed URLs or ports, disabled SMTP delivery, development mail delivery, and common placeholder values cause startup to fail with clear variable names.

External login should use the standard `oidc` provider profile for normal OIDC providers. The `icetowne-blog` profile remains available only for the legacy Blog OAuth shape. See `docs/identity-providers.md` for provider mapping details.

## Docker Packaging

```bash
cp .env.production.example .env.production
docker build -f deploy/Dockerfile -t icedr-po .
```

The Docker image packages the ICEDR web client and API together. Runtime services such as persistence, cache, object storage, and mail delivery should be supplied by the target environment rather than described as part of the project image build.

The included Compose file follows the same boundary and only runs the ICEDR application services:

```bash
pnpm docker:build
pnpm docker:up
pnpm docker:down
```

## Binary Packaging

ICEDR can build standalone Node.js SEA binaries for supported platforms:

```bash
pnpm package:binary
```

Release artifacts follow the `icedr_VERSION_PLATFORM` naming convention. Release automation generates checksums and combines release notes with artifact integrity information.

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

- `docs/storage.md`
- `docs/identity-providers.md`
- `scripts/README.md`

## License

ICEDR is licensed under the Apache License 2.0. See `LICENSE` for details.
