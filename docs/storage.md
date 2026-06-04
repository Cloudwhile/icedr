# ICEDR Storage Layout

ICEDR stores file bytes in one MinIO/S3 bucket or in local storage when distributed storage is disabled. Object keys are logical storage identifiers, not the visible drive folder tree.

Current permanent file object layout:

```text
workspaces/{workspaceId}/objects/original/{yyyy}/{mm}/{nonce}/{fileName}
```

Local storage uses the same layout with a `local/` prefix:

```text
local/workspaces/{workspaceId}/objects/original/{yyyy}/{mm}/{nonce}/{fileName}
```

Why this layout:

- `workspaces/{workspaceId}` keeps every workspace grouped in the bucket.
- `objects/original` leaves room for future `objects/preview`, `objects/version`, or other artifact groups.
- `{yyyy}/{mm}` prevents very large flat object listings.
- `{nonce}` avoids filename collisions.
- `{fileName}` keeps object inspection humane without coupling storage paths to drive folder moves or renames.

Compatibility:

- Legacy object keys under `uploads/{workspaceId}/...` and `local/uploads/{workspaceId}/...` remain valid for existing file records.
- Blob reconcile scans both the current and legacy workspace prefixes when a workspace filter is provided.
- New uploads should use the current `workspaces/.../objects/original/...` layout.

Versioned files:

- When a file is replaced by another upload at the same workspace path, or editable text content is saved, the previous object key is recorded in `file_versions` before the file node points at the new object.
- Historical versions keep their original object key, size, MIME type, version number, uploader, remark, and timestamp. They are not tied to the visible folder path, so later moves or renames do not invalidate version downloads.
- Restoring a version records the current object as a new historical version, then points the file node at the selected historical object.
- Version retention is controlled by `file_policy_settings.version_retention_count` and `file_policy_settings.version_retention_days`.

Trash and cleanup:

- Moving a file or folder to trash updates metadata on `file_nodes`; object bytes remain in storage until permanent deletion or automatic cleanup.
- Permanent deletion and trash cleanup remove current file objects and version objects for the deleted tree.
- Storage usage includes active file bytes, trash bytes, and version bytes so quota checks can reject uploads before object bytes are accepted.
- Storage usage breakdowns aggregate active file bytes by owner, parent directory, file type, and recent creation date for the system settings dashboard.
