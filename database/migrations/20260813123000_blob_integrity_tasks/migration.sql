ALTER TABLE "file_nodes"
ADD COLUMN "integrity_acknowledged_at" TIMESTAMPTZ,
ADD COLUMN "integrity_acknowledged_by" TEXT;

ALTER TABLE "file_versions"
ADD COLUMN "integrity_acknowledged_at" TIMESTAMPTZ,
ADD COLUMN "integrity_acknowledged_by" TEXT;

CREATE TABLE "blob_integrity_tasks" (
  "active_key" TEXT,
  "id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "status" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "workspace_id" TEXT,
  "mode" TEXT NOT NULL,
  "target" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "batch_size" INTEGER NOT NULL,
  "concurrency" INTEGER NOT NULL,
  "bandwidth_limit_bytes_per_second" BIGINT,
  "max_attempts" INTEGER NOT NULL,
  "progress" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "cursor" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "retry_of_task_id" TEXT,
  "retry_result_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "lease_key" TEXT,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMPTZ,
  "failure_code" TEXT,
  "failure_message" TEXT,
  "snapshot_at" TIMESTAMPTZ NOT NULL,
  "target_count" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ,
  "finished_at" TIMESTAMPTZ,

  CONSTRAINT "blob_integrity_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "blob_integrity_results" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "source_result_id" TEXT,
  "workspace_id" TEXT NOT NULL,
  "node_id" TEXT,
  "version_id" TEXT,
  "target_key" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "expected_hash" TEXT,
  "actual_hash" TEXT,
  "expected_size_bytes" BIGINT,
  "size_bytes" BIGINT,
  "bytes_read" BIGINT NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "error_code" TEXT,
  "error_message" TEXT,
  "checked_at" TIMESTAMPTZ NOT NULL,
  "acknowledged_at" TIMESTAMPTZ,
  "acknowledged_by" TEXT,

  CONSTRAINT "blob_integrity_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "blob_integrity_results_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "blob_integrity_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "blob_integrity_tasks_lease_key_key"
ON "blob_integrity_tasks"("lease_key");

CREATE UNIQUE INDEX "blob_integrity_tasks_active_key_key"
ON "blob_integrity_tasks"("active_key");

CREATE INDEX "blob_integrity_tasks_created_at_idx"
ON "blob_integrity_tasks"("created_at");

CREATE INDEX "blob_integrity_tasks_status_created_at_idx"
ON "blob_integrity_tasks"("status", "created_at");

CREATE INDEX "blob_integrity_tasks_status_lease_expires_at_idx"
ON "blob_integrity_tasks"("status", "lease_expires_at");

CREATE INDEX "blob_integrity_tasks_workspace_created_at_idx"
ON "blob_integrity_tasks"("workspace_id", "created_at");

CREATE INDEX "blob_integrity_tasks_retry_of_task_id_idx"
ON "blob_integrity_tasks"("retry_of_task_id");

CREATE UNIQUE INDEX "blob_integrity_results_task_target_key"
ON "blob_integrity_results"("task_id", "target_key");

CREATE INDEX "blob_integrity_results_task_status_checked_at_idx"
ON "blob_integrity_results"("task_id", "status", "checked_at");

CREATE INDEX "blob_integrity_results_workspace_node_idx"
ON "blob_integrity_results"("workspace_id", "node_id");

CREATE INDEX "blob_integrity_results_source_result_id_idx"
ON "blob_integrity_results"("source_result_id");
