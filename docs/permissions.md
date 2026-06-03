# ICEDR Permissions

ICEDR separates the signed-in workspace panel from administrator-only controls.
The backend permission policy lives in
`backend/src/common/security/permission-policy.ts`, and controller checks should
call `AdminGuardService.requirePermission(...)` before touching protected data.

## Roles

- `owner`: reserved for a future workspace owner role. It currently mirrors the
  highest administrative capability in the matrix.
- `admin`: can use the workspace panel and administrator controls.
- `member`: can use the signed-in workspace panel, files, transfers, personal
  settings, and share-link workflows.
- `guest`: can only use public share flows governed by a share token and share
  access session.

## Matrix

| Resource | Action | owner | admin | member | guest |
| --- | --- | --- | --- | --- | --- |
| workspace | read | yes | yes | yes | no |
| workspace | write/manage | yes | yes | no | no |
| file | read/write/delete/download/share | yes | yes | yes | no |
| file | manage | yes | yes | no | no |
| share | read/write/delete | yes | yes | yes | no |
| share | download | yes | no | no | yes |
| share | manage | yes | yes | no | no |
| transfer | read/write/delete | yes | yes | yes | no |
| transfer | manage | yes | yes | no | no |
| audit | read/manage | yes | yes | no | no |
| settings | read/write/manage | yes | yes | no | no |
| storage | read | yes | yes | yes | no |
| storage | write/manage | yes | yes | no | no |
| user | read/write | yes | yes | yes | no |
| user | manage | yes | yes | no | no |

## Endpoint Boundary

Signed-in workspace endpoints require a valid bearer session:

- `/api/workspaces`
- `/api/file-nodes` control-plane endpoints, including listing, metadata,
  upload intents, upload completions, folder creation, rename, move, copy,
  content edits, state updates, preview intents, and download intents
- `/api/shares` creation, listing, and revocation
- `/api/transfers`
- `/api/storage/profile` and `/api/storage/usage`

Administrator endpoints require an admin permission:

- `/api/audit/events`
- `/api/site/settings` non-public routes
- `/api/site/settings/translations`
- `/api/identity/oauth/settings`
- `/api/auth/passkeys/settings`
- `/api/auth/settings` updates
- `/api/mail/settings`
- `/api/storage/settings`
- `/api/storage/settings/test`
- `/api/storage/reconcile`
- `/api/storage/reconcile/tasks`
- `/api/workspaces/:workspaceId/share-settings` updates

Public and setup endpoints remain outside the signed-in workspace boundary:

- `/api/site/settings/public`
- `/api/site/settings/public/translations`
- `/api/setup` first-run setup routes
- `/api/health`
- public `/api/shares/:token` visitor, verification, OAuth, preview, and
  download flows
- generated download and preview status URLs, which are controlled by intent IDs
  rather than a browser bearer header

Frontend navigation mirrors this boundary. Workspace members see the normal
drive, link, transfer, and user settings entries. Administrator-only activity
and external-share configuration routes are hidden or redirected unless the
current user has the `admin` role.
