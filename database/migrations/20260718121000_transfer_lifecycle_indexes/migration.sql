-- Keep each concurrent index in its own migration. Prisma sends a migration
-- containing multiple concurrent statements as one multi-command query, which
-- PostgreSQL rejects as an implicit transaction block. Use the recovery script
-- to remove an index left by an interrupted, unresolved migration before retry.

CREATE INDEX CONCURRENTLY "file_nodes_object_key_idx"
ON "file_nodes"("object_key");
