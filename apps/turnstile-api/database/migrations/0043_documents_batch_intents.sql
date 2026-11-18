ALTER TABLE "turnstile"."documents_intent" DROP CONSTRAINT "documents_intent_shape";--> statement-breakpoint
DROP INDEX "turnstile"."documents_intent_binding";--> statement-breakpoint
ALTER TABLE "turnstile"."documents_intent" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_intent_created_batch" ON "turnstile"."documents_intent" USING btree ("tenant_id","batch_id") WHERE kind='batch.create' AND state='RESOLVED';--> statement-breakpoint
CREATE INDEX "documents_intent_binding" ON "turnstile"."documents_intent" USING btree ("tenant_id","upload_id") WHERE kind IN ('upload.begin','version.begin','version.restore','batch.item') AND state='RESOLVED';--> statement-breakpoint
ALTER TABLE "turnstile"."documents_intent" ADD CONSTRAINT "documents_intent_shape" CHECK (
    length(actor_id) BETWEEN 1 AND 200 AND digest ~ '^[0-9a-f]{64}$'
    AND recovery_marker ~ '^[0-9a-f]{64}$' AND subject_key ~ '^[0-9a-f]{64}$'
    AND kind IN ('upload.begin','upload.complete','upload.refresh','upload.cancel','version.begin','version.restore','document.edit','reference.link','reference.unlink','batch.create','batch.item','batch.close','batch.cancel')
    AND state IN ('DRAFT','DISPATCHING','UNCERTAIN','RESOLVED','UNRESOLVED_REQUIRES_REVIEW','DISPOSED')
    AND (command IS NULL OR (jsonb_typeof(command)='object' AND octet_length(command::text)<=CASE WHEN kind='batch.create' THEN 409600 ELSE 40960 END))
    AND (state NOT IN ('DRAFT','DISPATCHING','UNCERTAIN') OR command IS NOT NULL)
    AND ((state='DISPATCHING') = (attempt_id IS NOT NULL AND lease_until IS NOT NULL))
    AND ((state IN ('RESOLVED','UNRESOLVED_REQUIRES_REVIEW','DISPOSED')) = (terminal_at IS NOT NULL))
    AND ((state IN ('RESOLVED','DISPOSED')) = (resolved_at IS NOT NULL))
    AND (kind NOT IN ('batch.item','batch.close','batch.cancel') OR batch_id IS NOT NULL)
    AND (kind NOT IN ('batch.create','batch.close','batch.cancel') OR upload_id IS NULL)
    AND (kind LIKE 'batch.%' OR batch_id IS NULL)
    AND (state<>'RESOLVED' OR CASE
      WHEN kind IN ('batch.create','batch.close','batch.cancel') THEN batch_id IS NOT NULL
      ELSE upload_id IS NOT NULL OR kind IN ('document.edit','reference.link','reference.unlink') END)
  );--> statement-breakpoint
GRANT INSERT (batch_id), UPDATE (batch_id) ON turnstile.documents_intent TO thaarei_turnstile_runtime;
