-- Additive lifecycle metadata keeps existing task rows readable while new code
-- writes the canonical transfer lifecycle. Prisma does not wrap PostgreSQL
-- migrations in one transaction, so every column addition and data backfill in
-- this migration is intentionally safe to run again after a partial failure.

-- AlterTable
ALTER TABLE "preview_artifacts"
ADD COLUMN IF NOT EXISTS "actor_user_id" TEXT,
ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "failure_code" TEXT;

-- AlterTable
ALTER TABLE "file_download_intents"
ADD COLUMN IF NOT EXISTS "actor_user_id" TEXT,
ADD COLUMN IF NOT EXISTS "claim_token" TEXT,
ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "failure_code" TEXT,
ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "share_download_intents"
ADD COLUMN IF NOT EXISTS "actor_user_id" TEXT,
ADD COLUMN IF NOT EXISTS "claim_token" TEXT,
ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "failure_code" TEXT,
ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "upload_sessions"
ADD COLUMN IF NOT EXISTS "node_id" TEXT,
ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "failure_code" TEXT,
ADD COLUMN IF NOT EXISTS "completion_token" TEXT,
ADD COLUMN IF NOT EXISTS "completion_started_at" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "storage_finalized_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "transfer_tasks"
ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "failure_code" TEXT;

-- AlterTable
-- Keep finished_at NOT NULL for rolling compatibility. Running tasks store
-- started_at as a sentinel and the API continues to expose finishedAt: null.
ALTER TABLE "blob_reconcile_tasks"
ADD COLUMN IF NOT EXISTS "actor_user_id" TEXT,
ADD COLUMN IF NOT EXISTS "failure_code" TEXT;

-- Canonicalize statuses written by older releases. Each UPDATE is restricted to
-- legacy values, which makes the backfill idempotent and prevents a retry from
-- touching rows already managed by the new lifecycle.
UPDATE "preview_artifacts"
SET
  "failure_code" = CASE
    WHEN "status" = 'unsupported' THEN 'PREVIEW_UNSUPPORTED'
    ELSE NULL
  END,
  "status" = CASE "status"
    WHEN 'queued' THEN 'pending'
    WHEN 'ready' THEN 'completed'
    WHEN 'unsupported' THEN 'failed'
    WHEN 'cancelled' THEN 'canceled'
    ELSE "status"
  END
WHERE "status" IN ('queued', 'ready', 'unsupported', 'cancelled');

UPDATE "upload_sessions"
SET
  "failure_code" = CASE
    WHEN "status" = 'unsupported' THEN 'UPLOAD_FAILED'
    ELSE NULL
  END,
  "status" = CASE "status"
    WHEN 'queued' THEN 'pending'
    WHEN 'ready' THEN 'completed'
    WHEN 'unsupported' THEN 'failed'
    WHEN 'cancelled' THEN 'canceled'
    ELSE "status"
  END
WHERE "status" IN ('queued', 'ready', 'unsupported', 'cancelled');

UPDATE "transfer_tasks"
SET
  "failure_code" = CASE
    WHEN "status" = 'unsupported' THEN 'TRANSFER_FAILED'
    ELSE NULL
  END,
  "status" = CASE "status"
    WHEN 'queued' THEN 'pending'
    WHEN 'ready' THEN 'completed'
    WHEN 'unsupported' THEN 'failed'
    WHEN 'cancelled' THEN 'canceled'
    ELSE "status"
  END
WHERE "status" IN ('queued', 'ready', 'unsupported', 'cancelled');

UPDATE "blob_reconcile_tasks"
SET
  "failure_code" = CASE
    WHEN "status" = 'unsupported' THEN 'STORAGE_RECONCILE_FAILED'
    ELSE NULL
  END,
  "status" = CASE "status"
    WHEN 'queued' THEN 'pending'
    WHEN 'ready' THEN 'completed'
    WHEN 'unsupported' THEN 'failed'
    WHEN 'cancelled' THEN 'canceled'
    ELSE "status"
  END
WHERE "status" IN ('queued', 'ready', 'unsupported', 'cancelled');

-- Restore the completed upload-to-node link for rows created before node_id
-- was persisted directly on upload_sessions.
UPDATE "upload_sessions" AS "session"
SET "node_id" = "task"."node_id"
FROM "transfer_tasks" AS "task"
WHERE "session"."node_id" IS NULL
  AND "session"."status" = 'completed'
  AND "session"."transfer_id" = "task"."id"
  AND "task"."node_id" IS NOT NULL;
