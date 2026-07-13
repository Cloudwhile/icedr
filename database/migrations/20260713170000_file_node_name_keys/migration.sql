ALTER TABLE "file_nodes"
ADD COLUMN "directory_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN "owner_scope_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN "name_key" TEXT NOT NULL DEFAULT '';

UPDATE "file_nodes"
SET
  "directory_key" = COALESCE("parent_node_id", ''),
  "owner_scope_key" = CASE
    WHEN "space_scope" = 'personal' THEN COALESCE("owner_user_id", '')
    ELSE ''
  END,
  "name_key" = CASE
    WHEN "archived_at" IS NULL THEN 'legacy:' || "id"
    ELSE 'archived:' || "id"
  END;

ALTER TABLE "file_nodes"
ALTER COLUMN "directory_key" DROP DEFAULT,
ALTER COLUMN "owner_scope_key" DROP DEFAULT,
ALTER COLUMN "name_key" DROP DEFAULT;

CREATE UNIQUE INDEX "file_nodes_scope_directory_name_key"
ON "file_nodes"(
  "workspace_id",
  "space_scope",
  "owner_scope_key",
  "directory_key",
  "name_key"
);
