# ICEDR Architecture

ICEDR is a Node.js monorepo with a Vite frontend and a NestJS backend.

## Structure

- `frontend/`: Vite React application. The SPA entry is `src/main.tsx`, reusable UI lives under `src/components`, feature code under `src/features`, and shared client utilities under `src/lib`.
- `backend/`: NestJS API. Business modules live under `src/modules`; cross-cutting code lives under `src/common`, configuration under `src/config`, and database access under `src/database`.
- `database/`: database planning and migration entry point. The current runtime still creates PostgreSQL tables from Nest repositories during module startup.
- `deploy/`: Docker Compose, Dockerfiles, and optional Nginx config.

## Module Mapping

- `modules/auth`: local auth, OAuth, passkeys, sessions, and identity configuration.
- `modules/files`: file node listing, upload intents, preview intents, and download intents.
- `modules/shares`: external share links, visitor sessions, access codes, normalized download policy decisions, and share audit records.
- `modules/storage`: S3/MinIO/local storage profile, presigned URLs, and storage settings.
- `modules/downloads`: transfer tasks, queue status, and worker-facing endpoints.
- `modules/logs`: audit event queries.
- `modules/admin`: setup, site settings, mail settings, workspace settings, and health checks.

## Notes

The backend keeps Nest feature modules grouped by domain instead of splitting every controller, service, DTO, and repository into global folders. That keeps related behavior close while still matching the recommended `src/modules/*` structure.
