-- AlterTable
ALTER TABLE "users" ADD COLUMN     "storage_quota_bytes" BIGINT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "default_user_quota_bytes" BIGINT,
ADD COLUMN     "quota_bytes" BIGINT;

-- AlterTable
ALTER TABLE "file_nodes" ADD COLUMN     "archived_by" TEXT,
ADD COLUMN     "original_parent_node_id" TEXT,
ADD COLUMN     "original_path" TEXT,
ADD COLUMN     "owner_user_id" TEXT;

-- CreateTable
CREATE TABLE "file_policy_settings" (
    "setting_key" TEXT NOT NULL,
    "trash_retention_days" INTEGER NOT NULL DEFAULT 30,
    "version_retention_count" INTEGER NOT NULL DEFAULT 20,
    "version_retention_days" INTEGER NOT NULL DEFAULT 180,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_policy_settings_pkey" PRIMARY KEY ("setting_key")
);

-- CreateTable
CREATE TABLE "file_versions" (
    "id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_versions_node_id_idx" ON "file_versions"("node_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_node_id_version_number_key" ON "file_versions"("node_id", "version_number");

-- CreateIndex
CREATE INDEX "file_nodes_owner_user_id_idx" ON "file_nodes"("owner_user_id");

-- AddForeignKey
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "file_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
