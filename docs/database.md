# ICEDR Database

ICEDR currently uses PostgreSQL through the `pg` package. Tables are created by repository startup hooks in `backend/src/modules/*` and `backend/src/database`.

Current persisted areas:

- auth settings, users, user metadata, identities, sessions, password resets, passkeys, OAuth states, and OAuth exchange codes.
- workspaces and workspace share settings.
- file nodes, preview artifacts, and file download intents.
- share links and audit events.
- storage settings and transfer tasks.
- generic settings records for bootstrap, site, OAuth, passkey, mail, and database verification state.

`database/schema.prisma` is present as the recommended schema entry point, but Prisma migrations are not active yet. Until that changes, update the repository initialization SQL together with any future migration file.
