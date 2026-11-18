CREATE TABLE "dms"."processing_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"lifecycle_generation" integer NOT NULL,
	"profile" text NOT NULL,
	"source_sha256" text NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"accepted_stage_id" uuid,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"key_hash" text,
	"request_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "processing_run_tenant" UNIQUE("tenant_id","id"),
	CONSTRAINT "processing_run_version_identity" UNIQUE("tenant_id","application_id","upload_id","id"),
	CONSTRAINT "processing_run_number" UNIQUE("tenant_id","version_id","number"),
	CONSTRAINT "processing_run_receipt" UNIQUE("tenant_id","actor_kind","actor_id","version_id","key_hash"),
	CONSTRAINT "processing_run_bounds" CHECK ("dms"."processing_run"."number">0 AND "dms"."processing_run"."lifecycle_generation" BETWEEN 1 AND 2147483646 AND "dms"."processing_run"."profile" IN ('searchable','structured') AND "dms"."processing_run"."source_sha256" ~ '^[a-f0-9]{64}$' AND "dms"."processing_run"."state" IN ('QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','UNSUPPORTED','CANCELLED') AND "dms"."processing_run"."actor_kind" IN ('machine','operator','coordinator') AND length("dms"."processing_run"."actor_id") BETWEEN 1 AND 200 AND ("dms"."processing_run"."key_hash" IS NULL OR "dms"."processing_run"."key_hash" ~ '^[a-f0-9]{64}$') AND ("dms"."processing_run"."request_hash" IS NULL OR "dms"."processing_run"."request_hash" ~ '^[a-f0-9]{64}$') AND (NOT "dms"."processing_run"."active" OR ("dms"."processing_run"."accepted_stage_id" IS NOT NULL AND "dms"."processing_run"."state" IN ('SUCCEEDED','PARTIAL'))))
);
--> statement-breakpoint
ALTER TABLE "dms"."processing_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."work_job" DROP CONSTRAINT "work_job_source";--> statement-breakpoint
ALTER TABLE "dms"."audit_event" DROP CONSTRAINT "audit_application_resource";--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" DROP CONSTRAINT "outbox_kind";--> statement-breakpoint
ALTER TABLE "dms"."work_job" ADD COLUMN "processing_run_id" uuid;--> statement-breakpoint
ALTER TABLE "dms"."processing_run" ADD CONSTRAINT "processing_run_tenant_id_application_id_document_id_version_id_document_version_tenant_id_application_id_document_id_id_fk" FOREIGN KEY ("tenant_id","application_id","document_id","version_id") REFERENCES "dms"."document_version"("tenant_id","application_id","document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."processing_run" ADD CONSTRAINT "processing_run_tenant_id_application_id_upload_id_upload_admission_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","upload_id") REFERENCES "dms"."upload_admission"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "processing_one_active" ON "dms"."processing_run" USING btree ("tenant_id","version_id") WHERE "dms"."processing_run"."active";--> statement-breakpoint
CREATE INDEX "processing_history" ON "dms"."processing_run" USING btree ("tenant_id","document_id","version_id","number");--> statement-breakpoint
ALTER TABLE "dms"."work_job" ADD CONSTRAINT "work_job_tenant_id_application_id_upload_id_processing_run_id_processing_run_tenant_id_application_id_upload_id_id_fk" FOREIGN KEY ("tenant_id","application_id","upload_id","processing_run_id") REFERENCES "dms"."processing_run"("tenant_id","application_id","upload_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_job_legacy_source" ON "dms"."work_job" USING btree ("tenant_id","upload_id","task") WHERE "dms"."work_job"."processing_run_id" IS NULL;--> statement-breakpoint
ALTER TABLE "dms"."work_job" ADD CONSTRAINT "work_job_run_source" UNIQUE("tenant_id","upload_id","task","processing_run_id");--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD CONSTRAINT "audit_application_resource" CHECK (("dms"."audit_event"."resource_type"='application' AND "dms"."audit_event"."resource_id"="dms"."audit_event"."application_id" AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."batch_id" IS NULL AND "dms"."audit_event"."action"='application.enrolled' AND "dms"."audit_event"."actor_kind"='machine') OR ("dms"."audit_event"."resource_type"='document' AND "dms"."audit_event"."document_id" IS NOT NULL AND "dms"."audit_event"."batch_id" IS NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."document_id" AND "dms"."audit_event"."action" IN ('document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired','upload.object-verified','upload.failed','work.queued','work.completed','work.recovered','work.cancelled','security.assessed','security.invalidated','document.published','document.download-authorized','document.soft-deleted','document.logical-restored','processing.requested','processing.promoted','processing.content-authorized','document.permissions-changed','document.version-restored','document.metadata-updated','document.reference-linked','document.reference-unlinked') AND "dms"."audit_event"."actor_kind" IN ('machine','coordinator','operator')) OR ("dms"."audit_event"."resource_type"='upload-batch' AND "dms"."audit_event"."batch_id" IS NOT NULL AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."batch_id" AND "dms"."audit_event"."action" IN ('batch.created','batch.closed','batch.cancelled','batch.expired') AND "dms"."audit_event"."actor_kind" IN ('machine','coordinator')));--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" ADD CONSTRAINT "outbox_kind" CHECK ("dms"."outbox_intent"."kind" IN ('application.enrolled','document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired','upload.object-verified','upload.failed','work.queued','work.completed','work.recovered','work.cancelled','security.assessed','security.invalidated','document.published','document.download-authorized','document.soft-deleted','document.logical-restored','processing.requested','processing.promoted','processing.content-authorized','document.permissions-changed','document.version-restored','document.metadata-updated','document.reference-linked','document.reference-unlinked','batch.created','batch.closed','batch.cancelled','batch.expired'));--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."processing_run" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."processing_run" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "reader" ON "dms"."processing_run" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND dms.has_document_right(document_id,'READ') AND EXISTS(SELECT 1 FROM dms.document d WHERE d.id=document_id AND d.lifecycle='ACTIVE'));--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."processing_run" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=processing_run.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL));