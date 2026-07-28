BEGIN;

ALTER TABLE "upload_sessions"
ADD COLUMN "requested_file_name" TEXT,
ADD COLUMN "conflict_target_node_id" TEXT,
ADD COLUMN "conflict_target_object_key" TEXT;

UPDATE "upload_sessions"
SET "requested_file_name" = "file_name"
WHERE "requested_file_name" IS NULL;

ALTER TABLE "upload_sessions"
ALTER COLUMN "requested_file_name" SET NOT NULL;

COMMIT;
