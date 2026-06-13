ALTER TABLE "file_nodes"
  ADD COLUMN "space_scope" TEXT NOT NULL DEFAULT 'workspace';

CREATE INDEX "file_nodes_workspace_id_space_scope_idx"
  ON "file_nodes"("workspace_id", "space_scope");

ALTER TABLE "upload_sessions"
  ADD COLUMN "space_scope" TEXT NOT NULL DEFAULT 'workspace';
