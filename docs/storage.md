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
