CREATE TABLE IF NOT EXISTS "setup_operations" (
  "operation_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "payload_fingerprint" TEXT NOT NULL,
  "claim_token_hash" TEXT,
  "claimed_at" TIMESTAMPTZ,
  "claim_expires_at" TIMESTAMPTZ,
  "irreversible_started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "failed_at" TIMESTAMPTZ,
  "failure_code" TEXT,
  "failure_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "setup_operations_pkey" PRIMARY KEY ("operation_key")
);

CREATE INDEX IF NOT EXISTS "setup_operations_status_claim_expires_at_idx"
ON "setup_operations"("status", "claim_expires_at");
