ALTER TABLE "file_nodes"
ADD COLUMN "checksum_algorithm" TEXT,
ADD COLUMN "checksum_value" TEXT,
ADD COLUMN "integrity_status" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN "last_verified_at" TIMESTAMPTZ,
ADD COLUMN "verification_failure_code" TEXT;

ALTER TABLE "file_versions"
ADD COLUMN "checksum_algorithm" TEXT,
ADD COLUMN "checksum_value" TEXT,
ADD COLUMN "integrity_status" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN "last_verified_at" TIMESTAMPTZ,
ADD COLUMN "verification_failure_code" TEXT;
