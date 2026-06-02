# ICEDR Database

ICEDR uses PostgreSQL with Prisma as the authoritative schema, migration, and runtime database entry point. `PrismaService` is available globally from `backend/src/database`, and the old hand-written `pg` `DatabaseService` adapter has been removed from backend runtime modules.

Current persisted areas:

- auth settings, users, user metadata, identities, sessions, password resets, passkeys, OAuth states, and OAuth exchange codes.
- workspaces and workspace share settings.
- file nodes, preview artifacts, and file download intents.
- share links and audit events.
- storage settings, upload sessions, transfer tasks, and blob reconcile tasks.
- generic settings records for bootstrap, site, OAuth, passkey, mail, and database verification state.

Authoritative Prisma artifacts:

- `database/schema.prisma` defines the persisted tables and generated client.
- `database/migrations/20260602170000_init_prisma/migration.sql` is the current baseline migration.
- `prisma.config.ts` configures Prisma 7 CLI commands and derives the PostgreSQL URL from `DATABASE_URL` or the existing `DATABASE_*` environment variables.
- `backend/src/database/prisma.service.ts` creates Prisma Client through the PostgreSQL driver adapter.
- `backend/src/database/database.module.ts` exports Prisma as the single database adapter for Nest modules.

Useful backend commands:

- `pnpm --filter backend prisma:generate`
- `pnpm --filter backend prisma:migrate:status`
- `pnpm --filter backend prisma:migrate:deploy`

New tables and structural changes should be modeled in Prisma schema and migrations first. Runtime repositories should use `PrismaService`; raw SQL should be limited to compatibility paths that cannot be expressed cleanly through Prisma Client.
