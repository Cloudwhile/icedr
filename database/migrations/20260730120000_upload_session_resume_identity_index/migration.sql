CREATE UNIQUE INDEX CONCURRENTLY "upload_sessions_resume_identity_active_idx"
ON "upload_sessions" (
  "workspace_id",
  "space_scope",
  (COALESCE("owner_user_id", '')),
  "resume_key"
)
WHERE "resume_key" IS NOT NULL
  AND "status" IN ('running', 'paused', 'failed');
