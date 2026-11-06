CREATE TABLE "dms"."security_assessment_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state" text NOT NULL,
	"sha256" text,
	"evidence" jsonb,
	"assessed_at" timestamp with time zone,
	CONSTRAINT "assessment_history_generation" UNIQUE("tenant_id","candidate_id","generation"),
	CONSTRAINT "assessment_history_bounds" CHECK ("dms"."security_assessment_history"."generation" BETWEEN 0 AND 2147483646 AND "dms"."security_assessment_history"."state" IN ('COPYING','PENDING','PASSED','REJECTED','INCONCLUSIVE','INVALIDATED') AND ("dms"."security_assessment_history"."sha256" IS NULL OR "dms"."security_assessment_history"."sha256" ~ '^[a-f0-9]{64}$') AND ("dms"."security_assessment_history"."evidence" IS NULL OR octet_length("dms"."security_assessment_history"."evidence"::text)<=8192))
);
--> statement-breakpoint
ALTER TABLE "dms"."security_assessment_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."lifecycle_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"expected_revision" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lifecycle_receipt_key" UNIQUE("tenant_id","actor_kind","actor_id","document_id","key_hash"),
	CONSTRAINT "lifecycle_receipt_bounds" CHECK ("dms"."lifecycle_receipt"."actor_kind" IN ('machine','operator') AND length("dms"."lifecycle_receipt"."actor_id") BETWEEN 1 AND 200 AND length("dms"."lifecycle_receipt"."key_hash")=64 AND "dms"."lifecycle_receipt"."expected_revision" ~ '^[1-9][0-9]{0,14}$')
);
--> statement-breakpoint
ALTER TABLE "dms"."lifecycle_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."lifecycle_restore" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"failure_code" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_restore_version" UNIQUE("tenant_id","version_id","generation"),
	CONSTRAINT "lifecycle_restore_bounds" CHECK ("dms"."lifecycle_restore"."generation" BETWEEN 1 AND 2147483646 AND "dms"."lifecycle_restore"."state" IN ('PENDING','SCANNING','COMPLETE','FAILED','OBSOLETE') AND ("dms"."lifecycle_restore"."failure_code" IS NULL OR "dms"."lifecycle_restore"."failure_code" IN ('OBJECT_UNAVAILABLE','INTEGRITY_MISMATCH','SECURITY_ASSESSMENT_FAILED','POLICY_DENIED','CAPACITY_UNAVAILABLE')))
);
--> statement-breakpoint
ALTER TABLE "dms"."lifecycle_restore" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."work_attempt" DROP CONSTRAINT "work_execution_identity";--> statement-breakpoint
ALTER TABLE "dms"."audit_event" DROP CONSTRAINT "audit_application_resource";--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" DROP CONSTRAINT "outbox_kind";--> statement-breakpoint
ALTER TABLE "dms"."document" DROP CONSTRAINT "document_baseline";--> statement-breakpoint
ALTER TABLE "dms"."upload_admission" ADD COLUMN "lifecycle_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dms"."upload_admission" ADD COLUMN "reassessment_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dms"."document" ADD COLUMN "lifecycle_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dms"."document" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dms"."document" ADD COLUMN "restore_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dms"."document" ADD COLUMN "restored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dms"."document_version" ADD COLUMN "lifecycle_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dms"."work_job" ADD COLUMN "lifecycle_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dms"."security_candidate" ADD COLUMN "expected_sha256" text;--> statement-breakpoint
ALTER TABLE "dms"."security_assessment_history" ADD CONSTRAINT "security_assessment_history_tenant_id_application_id_candidate_id_security_candidate_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","candidate_id") REFERENCES "dms"."security_candidate"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."lifecycle_receipt" ADD CONSTRAINT "lifecycle_receipt_tenant_id_application_id_document_id_document_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","document_id") REFERENCES "dms"."document"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."lifecycle_restore" ADD CONSTRAINT "lifecycle_restore_tenant_id_application_id_document_id_version_id_document_version_tenant_id_application_id_document_id_id_fk" FOREIGN KEY ("tenant_id","application_id","document_id","version_id") REFERENCES "dms"."document_version"("tenant_id","application_id","document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."lifecycle_restore" ADD CONSTRAINT "lifecycle_restore_tenant_id_application_id_upload_id_upload_admission_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","upload_id") REFERENCES "dms"."upload_admission"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lifecycle_restore_pending" ON "dms"."lifecycle_restore" USING btree ("tenant_id","state","next_attempt_at","id");--> statement-breakpoint
CREATE INDEX "lifecycle_restore_document" ON "dms"."lifecycle_restore" USING btree ("tenant_id","document_id","generation");--> statement-breakpoint
CREATE INDEX "admission_document_idx" ON "dms"."upload_admission" USING btree ("tenant_id","document_id","id");--> statement-breakpoint
ALTER TABLE "dms"."work_attempt" ADD CONSTRAINT "work_execution_identity" UNIQUE("tenant_id","job_id","generation","execution");--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD CONSTRAINT "audit_application_resource" CHECK (("dms"."audit_event"."resource_type"='application' AND "dms"."audit_event"."resource_id"="dms"."audit_event"."application_id" AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."batch_id" IS NULL AND "dms"."audit_event"."action"='application.enrolled' AND "dms"."audit_event"."actor_kind"='machine') OR ("dms"."audit_event"."resource_type"='document' AND "dms"."audit_event"."document_id" IS NOT NULL AND "dms"."audit_event"."batch_id" IS NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."document_id" AND "dms"."audit_event"."action" IN ('document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired','upload.object-verified','upload.failed','work.queued','work.completed','work.recovered','work.cancelled','security.assessed','security.invalidated','document.published','document.download-authorized','document.soft-deleted','document.logical-restored','document.permissions-changed','document.version-restored','document.metadata-updated','document.reference-linked','document.reference-unlinked') AND "dms"."audit_event"."actor_kind" IN ('machine','coordinator','operator')) OR ("dms"."audit_event"."resource_type"='upload-batch' AND "dms"."audit_event"."batch_id" IS NOT NULL AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."batch_id" AND "dms"."audit_event"."action" IN ('batch.created','batch.closed','batch.cancelled','batch.expired') AND "dms"."audit_event"."actor_kind" IN ('machine','coordinator')));--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" ADD CONSTRAINT "outbox_kind" CHECK ("dms"."outbox_intent"."kind" IN ('application.enrolled','document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired','upload.object-verified','upload.failed','work.queued','work.completed','work.recovered','work.cancelled','security.assessed','security.invalidated','document.published','document.download-authorized','document.soft-deleted','document.logical-restored','document.permissions-changed','document.version-restored','document.metadata-updated','document.reference-linked','document.reference-unlinked','batch.created','batch.closed','batch.cancelled','batch.expired'));--> statement-breakpoint
ALTER TABLE "dms"."document" ADD CONSTRAINT "document_baseline" CHECK ("dms"."document"."lifecycle" IN ('ACTIVE','SOFT_DELETED','PURGING','PURGED') AND "dms"."document"."lifecycle_generation" BETWEEN 1 AND 2147483646 AND ("dms"."document"."lifecycle"='ACTIVE' OR ("dms"."document"."deleted_at" IS NOT NULL AND "dms"."document"."restore_deadline"="dms"."document"."deleted_at"+interval '30 days')) AND "dms"."document"."revision" BETWEEN 1 AND 999999999999999 AND "dms"."document"."next_version">0);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."security_assessment_history" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "owner_read" ON "dms"."security_assessment_history" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."security_assessment_history" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND subject_id=current_setting('app.actor_id',true) AND revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "coordinator_insert" ON "dms"."security_assessment_history" AS PERMISSIVE FOR INSERT TO "thaarei_dms_coordinator" WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_read" ON "dms"."security_assessment_history" AS PERMISSIVE FOR SELECT TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."lifecycle_receipt" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "owner_read" ON "dms"."lifecycle_receipt" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."lifecycle_receipt" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND subject_id=current_setting('app.actor_id',true) AND revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."lifecycle_restore" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "owner_read" ON "dms"."lifecycle_restore" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."lifecycle_restore" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND subject_id=current_setting('app.actor_id',true) AND revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."lifecycle_restore" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);