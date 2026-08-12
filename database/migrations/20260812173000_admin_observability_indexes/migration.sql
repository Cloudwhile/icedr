CREATE INDEX "audit_events_workspace_created_at_idx"
ON "audit_events"("workspace_id", "created_at");

CREATE INDEX "audit_events_action_created_at_idx"
ON "audit_events"("action", "created_at");

CREATE INDEX "audit_events_actor_created_at_idx"
ON "audit_events"("actor", "created_at");

CREATE INDEX "blob_reconcile_tasks_started_at_idx"
ON "blob_reconcile_tasks"("started_at");
