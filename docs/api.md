# ICEDR API

The backend serves all endpoints under `/api`.

Core endpoint groups:

- `/api/health`: service health and dependency status.
- `/api/auth`: local login, registration, password reset, session checks, OAuth, and passkeys.
- `/api/setup`: first-run setup status and completion.
- `/api/site/settings`: public and admin site settings.
- `/api/file-nodes`: file listing, upload completion, state changes, preview intents, and download intents.
- `/api/storage`: storage profile, local upload/download fallback, and storage settings.
- `/api/shares`: external link creation, visitor access, email verification, preview, and download flows.
- `/api/transfers`: upload/download transfer status.
- `/api/audit`: audit event listing.

Authentication and authorization boundaries are documented in
`docs/permissions.md`. Workspace control-plane endpoints require a bearer
session, while administrator endpoints such as audit records, storage settings,
site settings, identity settings, mail settings, and workspace share-policy
updates require administrator permission. Public share visitor flows remain
token-based.

Swagger is mounted at `/api/docs` by `backend/src/main.ts`.
