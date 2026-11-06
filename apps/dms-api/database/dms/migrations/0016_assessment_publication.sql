CREATE TABLE "dms"."security_candidate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"etag" text NOT NULL,
	"size" bigint NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"sha256" text,
	"evidence" jsonb,
	"assessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_upload" UNIQUE("tenant_id","upload_id"),
	CONSTRAINT "candidate_object" UNIQUE("tenant_id","object_id"),
	CONSTRAINT "candidate_bounds" CHECK ("dms"."security_candidate"."size" BETWEEN 1 AND 52428800 AND length("dms"."security_candidate"."etag") BETWEEN 1 AND 130 AND "dms"."security_candidate"."state" IN ('PENDING','PASSED','REJECTED','INCONCLUSIVE','INVALIDATED') AND ("dms"."security_candidate"."sha256" IS NULL OR "dms"."security_candidate"."sha256" ~ '^[a-f0-9]{64}$') AND ("dms"."security_candidate"."evidence" IS NULL OR octet_length("dms"."security_candidate"."evidence"::text)<=8192) AND ("dms"."security_candidate"."state"<>'PASSED' OR ("dms"."security_candidate"."sha256" IS NOT NULL AND "dms"."security_candidate"."evidence" IS NOT NULL AND "dms"."security_candidate"."assessed_at" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "dms"."security_candidate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."audit_event" DROP CONSTRAINT "audit_application_resource";--> statement-breakpoint
ALTER TABLE "dms"."document" DROP CONSTRAINT "document_baseline";--> statement-breakpoint
ALTER TABLE "dms"."document_version" DROP CONSTRAINT "version_baseline";--> statement-breakpoint
ALTER TABLE "dms"."security_candidate" ADD CONSTRAINT "security_candidate_tenant_id_application_id_upload_id_upload_admission_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","upload_id") REFERENCES "dms"."upload_admission"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD CONSTRAINT "audit_application_resource" CHECK (("dms"."audit_event"."resource_type"='application' AND "dms"."audit_event"."resource_id"="dms"."audit_event"."application_id" AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."batch_id" IS NULL AND "dms"."audit_event"."action"='application.enrolled' AND "dms"."audit_event"."actor_kind"='machine') OR ("dms"."audit_event"."resource_type"='document' AND "dms"."audit_event"."document_id" IS NOT NULL AND "dms"."audit_event"."batch_id" IS NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."document_id" AND "dms"."audit_event"."action" IN ('document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired','upload.object-verified','upload.failed','work.queued','work.completed','work.recovered','work.cancelled','security.assessed','security.invalidated','document.published') AND "dms"."audit_event"."actor_kind" IN ('machine','coordinator')) OR ("dms"."audit_event"."resource_type"='upload-batch' AND "dms"."audit_event"."batch_id" IS NOT NULL AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."batch_id" AND "dms"."audit_event"."action" IN ('batch.created','batch.closed','batch.cancelled','batch.expired') AND "dms"."audit_event"."actor_kind" IN ('machine','coordinator')));--> statement-breakpoint
ALTER TABLE "dms"."document" ADD CONSTRAINT "document_baseline" CHECK ("dms"."document"."lifecycle"='ACTIVE' AND "dms"."document"."revision" BETWEEN 1 AND 999999999999999 AND "dms"."document"."next_version">0);--> statement-breakpoint
ALTER TABLE "dms"."document_version" ADD CONSTRAINT "version_baseline" CHECK ("dms"."document_version"."number">0 AND "dms"."document_version"."availability" IN ('PENDING','AVAILABLE','UNAVAILABLE') AND "dms"."document_version"."size" BETWEEN 1 AND 52428800 AND length("dms"."document_version"."content_type") BETWEEN 3 AND 100 AND length("dms"."document_version"."file_name") BETWEEN 1 AND 255);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."security_candidate" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."security_candidate" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_read" ON "dms"."security_candidate" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND application_id=nullif(current_setting('app.application_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine');