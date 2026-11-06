CREATE TABLE "dms"."work_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"execution" integer NOT NULL,
	"client_id" text NOT NULL,
	"lease_hash" text NOT NULL,
	"state" text DEFAULT 'RUNNING' NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"result_hash" text,
	"result_code" text,
	"retry_after" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "work_execution_identity" UNIQUE("tenant_id","job_id","execution"),
	CONSTRAINT "attempt_bounds" CHECK ("dms"."work_attempt"."execution" BETWEEN 1 AND 3 AND "dms"."work_attempt"."state" IN ('RUNNING','RETRY','SUCCEEDED','FAILED','UNSUPPORTED','LOST','CANCELLED') AND length("dms"."work_attempt"."lease_hash")=64 AND "dms"."work_attempt"."lease_expires_at"<="dms"."work_attempt"."deadline" AND "dms"."work_attempt"."deadline"<="dms"."work_attempt"."started_at"+interval '10 minutes' AND ("dms"."work_attempt"."result_hash" IS NULL OR length("dms"."work_attempt"."result_hash")=64) AND ("dms"."work_attempt"."retry_after" IS NULL OR "dms"."work_attempt"."retry_after" BETWEEN 1 AND 60))
);
--> statement-breakpoint
ALTER TABLE "dms"."work_attempt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."work_dispatch" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"task" text NOT NULL,
	"state" text DEFAULT 'READY' NOT NULL,
	"delivery_hash" text,
	"delivery_client" text,
	"delivery_until" timestamp with time zone,
	"next_publish_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_dispatch_generation" UNIQUE("tenant_id","job_id","generation"),
	CONSTRAINT "work_dispatch_identity" UNIQUE("tenant_id","job_id","id","generation"),
	CONSTRAINT "dispatch_bounds" CHECK ("dms"."work_dispatch"."generation">0 AND "dms"."work_dispatch"."task" IN ('document.scan','document.extract','document.heavy') AND "dms"."work_dispatch"."state" IN ('READY','LEASED','DELIVERED','OBSOLETE') AND "dms"."work_dispatch"."failures">=0 AND ("dms"."work_dispatch"."delivery_hash" IS NULL OR length("dms"."work_dispatch"."delivery_hash")=64) AND ("dms"."work_dispatch"."last_error" IS NULL OR "dms"."work_dispatch"."last_error" IN ('UNROUTABLE','BROKER_UNAVAILABLE')))
);
--> statement-breakpoint
ALTER TABLE "dms"."work_dispatch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."work_identity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "work_client_identity" UNIQUE("tenant_id","issuer","client_id"),
	CONSTRAINT "work_identity_bounds" CHECK ("dms"."work_identity"."role" IN ('publisher','scanner','extractor','heavy') AND "dms"."work_identity"."client_id" ~ '^[A-Za-z0-9_-]{3,128}$' AND length("dms"."work_identity"."issuer") BETWEEN 1 AND 2048)
);
--> statement-breakpoint
ALTER TABLE "dms"."work_identity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."work_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"task" text NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"executions" integer DEFAULT 0 NOT NULL,
	"recoveries" integer DEFAULT 0 NOT NULL,
	"current_attempt_id" uuid,
	"budget_started_at" timestamp with time zone,
	"deadline" timestamp with time zone,
	"next_eligible_at" timestamp with time zone,
	"recover_at" timestamp with time zone,
	"result_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_job_source" UNIQUE("tenant_id","upload_id","task"),
	CONSTRAINT "work_job_tenant_identity" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_job_bounds" CHECK ("dms"."work_job"."task" IN ('document.scan','document.extract','document.heavy') AND "dms"."work_job"."state" IN ('QUEUED','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED','UNSUPPORTED','CANCELLED') AND "dms"."work_job"."generation">0 AND "dms"."work_job"."executions" BETWEEN 0 AND 3 AND "dms"."work_job"."recoveries" BETWEEN 0 AND 3 AND (("dms"."work_job"."deadline" IS NULL)=("dms"."work_job"."budget_started_at" IS NULL)) AND ("dms"."work_job"."deadline" IS NULL OR "dms"."work_job"."deadline"<="dms"."work_job"."budget_started_at"+interval '30 minutes') AND ("dms"."work_job"."result_code" IS NULL OR length("dms"."work_job"."result_code")<=64))
);
--> statement-breakpoint
ALTER TABLE "dms"."work_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."audit_event" DROP CONSTRAINT "audit_application_resource";--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" DROP CONSTRAINT "outbox_kind";--> statement-breakpoint
ALTER TABLE "dms"."upload_session" DROP CONSTRAINT "session_bounds";--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD COLUMN "discovery_token" uuid;--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD COLUMN "discovery_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD COLUMN "discovery_next_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD COLUMN "observed_etag" text;--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD COLUMN "observed_size" bigint;--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD COLUMN "observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "dms"."work_attempt" ADD CONSTRAINT "work_attempt_tenant_id_job_id_dispatch_id_generation_work_dispatch_tenant_id_job_id_id_generation_fk" FOREIGN KEY ("tenant_id","job_id","dispatch_id","generation") REFERENCES "dms"."work_dispatch"("tenant_id","job_id","id","generation") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."work_dispatch" ADD CONSTRAINT "work_dispatch_tenant_id_job_id_work_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "dms"."work_job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."work_identity" ADD CONSTRAINT "work_identity_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."work_job" ADD CONSTRAINT "work_job_tenant_id_application_id_upload_id_upload_admission_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","upload_id") REFERENCES "dms"."upload_admission"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_one_active_attempt" ON "dms"."work_attempt" USING btree ("tenant_id","job_id") WHERE "dms"."work_attempt"."state"='RUNNING';--> statement-breakpoint
CREATE INDEX "work_attempt_lease_idx" ON "dms"."work_attempt" USING btree ("tenant_id","state","lease_expires_at");--> statement-breakpoint
CREATE INDEX "work_dispatch_due_idx" ON "dms"."work_dispatch" USING btree ("tenant_id","state","next_publish_at","delivery_until");--> statement-breakpoint
CREATE INDEX "work_job_recovery_idx" ON "dms"."work_job" USING btree ("tenant_id","state","recover_at");--> statement-breakpoint
CREATE INDEX "session_discovery_due_idx" ON "dms"."upload_session" USING btree ("tenant_id","upload_state","discovery_next_at","discovery_until");--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD CONSTRAINT "audit_application_resource" CHECK (("dms"."audit_event"."resource_type"='application' AND "dms"."audit_event"."resource_id"="dms"."audit_event"."application_id" AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."batch_id" IS NULL AND "dms"."audit_event"."action"='application.enrolled' AND "dms"."audit_event"."actor_kind"='machine') OR ("dms"."audit_event"."resource_type"='document' AND "dms"."audit_event"."document_id" IS NOT NULL AND "dms"."audit_event"."batch_id" IS NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."document_id" AND "dms"."audit_event"."action" IN ('document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired','upload.object-verified','upload.failed','work.queued','work.completed','work.recovered','work.cancelled') AND "dms"."audit_event"."actor_kind" IN ('machine','coordinator')) OR ("dms"."audit_event"."resource_type"='upload-batch' AND "dms"."audit_event"."batch_id" IS NOT NULL AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."batch_id" AND "dms"."audit_event"."action" IN ('batch.created','batch.closed','batch.cancelled','batch.expired') AND "dms"."audit_event"."actor_kind"='machine'));--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" ADD CONSTRAINT "outbox_kind" CHECK ("dms"."outbox_intent"."kind" IN ('application.enrolled','document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired','upload.object-verified','upload.failed','work.queued','work.completed','work.recovered','work.cancelled','batch.created','batch.closed','batch.cancelled','batch.expired'));--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD CONSTRAINT "session_observation_bounds" CHECK (("dms"."upload_session"."observed_size" IS NULL OR "dms"."upload_session"."observed_size" BETWEEN 0 AND 1125899906842624) AND ("dms"."upload_session"."observed_etag" IS NULL OR length("dms"."upload_session"."observed_etag") BETWEEN 1 AND 256) AND ("dms"."upload_session"."failure_code" IS NULL OR "dms"."upload_session"."failure_code" IN ('SIZE_MISMATCH','CONTENT_TYPE_MISMATCH')));--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD CONSTRAINT "session_bounds" CHECK ("dms"."upload_session"."upload_state" IN ('INITIATED','OBJECT_VERIFIED','EXPIRED','CANCELLED','FAILED') AND jsonb_typeof("dms"."upload_session"."descriptor")='object' AND octet_length("dms"."upload_session"."descriptor"::text)<=32768 AND (("dms"."upload_session"."batch_id" IS NULL)=("dms"."upload_session"."item_id" IS NULL)));--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."work_attempt" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."work_attempt" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."work_attempt" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."work_dispatch" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."work_dispatch" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."work_dispatch" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."work_identity" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."work_identity" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."work_identity" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "operator_write" ON "dms"."work_identity" AS PERMISSIVE FOR ALL TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL)) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."work_job" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."work_job" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."work_job" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));