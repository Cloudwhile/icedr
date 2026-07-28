BEGIN;

ALTER TABLE "upload_sessions"
ADD COLUMN "requested_file_name" TEXT,
ADD COLUMN "conflict_target_node_id" TEXT,
ADD COLUMN "conflict_target_object_key" TEXT;

COMMIT;
