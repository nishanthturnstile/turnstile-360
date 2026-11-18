ALTER TABLE "turnstile"."documents_intent" DROP CONSTRAINT "documents_intent_shape";--> statement-breakpoint
DROP INDEX "turnstile"."documents_intent_binding";--> statement-breakpoint
CREATE INDEX "documents_intent_binding" ON "turnstile"."documents_intent" USING btree ("tenant_id","upload_id") WHERE kind IN ('upload.begin','version.begin','version.restore') AND state='RESOLVED';--> statement-breakpoint
ALTER TABLE "turnstile"."documents_intent" ADD CONSTRAINT "documents_intent_shape" CHECK (
    length(actor_id) BETWEEN 1 AND 200 AND digest ~ '^[0-9a-f]{64}$'
    AND recovery_marker ~ '^[0-9a-f]{64}$' AND subject_key ~ '^[0-9a-f]{64}$'
    AND kind IN ('upload.begin','upload.complete','upload.refresh','upload.cancel','version.begin','version.restore','document.edit','reference.link','reference.unlink')
    AND state IN ('DRAFT','DISPATCHING','UNCERTAIN','RESOLVED','UNRESOLVED_REQUIRES_REVIEW','DISPOSED')
    AND (command IS NULL OR (jsonb_typeof(command)='object' AND octet_length(command::text)<=40960))
    AND (state NOT IN ('DRAFT','DISPATCHING','UNCERTAIN') OR command IS NOT NULL)
    AND ((state='DISPATCHING') = (attempt_id IS NOT NULL AND lease_until IS NOT NULL))
    AND ((state IN ('RESOLVED','UNRESOLVED_REQUIRES_REVIEW','DISPOSED')) = (terminal_at IS NOT NULL))
    AND ((state IN ('RESOLVED','DISPOSED')) = (resolved_at IS NOT NULL))
    AND (state<>'RESOLVED' OR upload_id IS NOT NULL OR kind IN ('document.edit','reference.link','reference.unlink'))
  );