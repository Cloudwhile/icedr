# ICEDR Database

ICEDR uses PostgreSQL with Prisma as the authoritative schema, migration, and runtime database entry point. `PrismaService` is available globally from `backend/src/database`, and the old hand-written `pg` `DatabaseService` adapter has been removed from backend runtime modules.

Current persisted areas:

- auth settings, users, user metadata, identities, sessions, password resets, passkeys, OAuth states, and OAuth exchange codes.
- workspaces, workspace share settings, workspace quotas, and default member quotas.
- file nodes, file lifecycle policy, file versions, preview artifacts, and file download intents.
- share links, share email codes, share access sessions, share download intents, and audit events.
- storage settings, upload sessions, transfer tasks, and blob reconcile tasks.
- generic settings records for bootstrap, site, OAuth, passkey, mail, and database verification state.

Authoritative Prisma artifacts:

- `database/schema.prisma` defines the persisted tables and generated client.
- `database/migrations/20260602170000_init_prisma/migration.sql` is the current baseline migration.
- `database/migrations/20260603203000_add_file_lifecycle_features/migration.sql` is generated from the Prisma schema diff and adds file lifecycle, version, quota, and owner-user columns/tables. Existing applied migrations are not edited.
- `prisma.config.ts` configures Prisma 7 CLI commands and derives the PostgreSQL URL from `DATABASE_URL` or the existing `DATABASE_*` environment variables.
- `backend/src/database/prisma.service.ts` creates Prisma Client through the PostgreSQL driver adapter.
- `backend/src/database/database.module.ts` exports Prisma as the single database adapter for Nest modules.

Useful backend commands:

- `pnpm --filter backend prisma:generate`
- `pnpm --filter backend prisma:prepare`
- `pnpm --filter backend prisma:migrate:status`
- `pnpm --filter backend prisma:migrate:deploy`

Backend start scripts run `prisma:prepare` before binding the API process, so the Prisma Client is regenerated and pending migrations are deployed before repositories access new columns or tables. If Prisma reports `P3005` for an existing ICEDR database that predates Prisma Migrate history, `prisma:prepare` first verifies the expected baseline tables and records only `20260602170000_init_prisma` as applied before running `migrate deploy` again. Later migrations are still applied normally and are not marked as applied without execution.

New tables and structural changes should be modeled in Prisma schema and migrations first. Runtime repositories should use `PrismaService`; raw SQL should be limited to compatibility paths that cannot be expressed cleanly through Prisma Client.

File lifecycle additions:

- `file_nodes.archived_at` marks nodes in the trash. Trash entries retain `archived_by`, `original_parent_node_id`, and `original_path` so the UI can show deletion context and restore to the original location.
- Folder trash operations keep the child tree in place, so restoring or permanently deleting a folder operates on the stored hierarchy.
- `file_policy_settings` stores trash retention days and version retention limits. Cleanup deletes expired trash records and their version objects.
- `file_versions` stores historical file objects with version number, object key, size, MIME type, uploader, remark, and creation time.
- `file_nodes.owner_user_id`, `workspaces.quota_bytes`, `workspaces.default_user_quota_bytes`, and `users.storage_quota_bytes` provide the database basis for workspace, inherited member, and independent member quota enforcement.

Audit coverage:

- Trash archive, restore, permanent delete, cleanup, batch archive/restore/move/download, search, quota refusal, version creation/download/restore, and quota updates are written through the audit event repository.
