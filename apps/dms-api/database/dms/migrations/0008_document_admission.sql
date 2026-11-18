CREATE TABLE "dms"."upload_admission" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"idempotency_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"policy_revision" bigint NOT NULL,
	"profile" text NOT NULL,
	"size" bigint NOT NULL,
	"state" text DEFAULT 'RESERVED' NOT NULL,
	"work_released" boolean DEFAULT false NOT NULL,
	"reserved_storage" bigint NOT NULL,
	"reserved_scratch" bigint NOT NULL,
	"staging_bytes" bigint DEFAULT 0 NOT NULL,
	"original_bytes" bigint DEFAULT 0 NOT NULL,
	"capability_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_receipt_identity" UNIQUE("tenant_id","application_id","idempotency_hash"),
	CONSTRAINT "admission_bounds" CHECK ("dms"."upload_admission"."size" BETWEEN 1 AND 52428800 AND "dms"."upload_admission"."reserved_storage">=0 AND "dms"."upload_admission"."reserved_scratch">=0 AND "dms"."upload_admission"."staging_bytes">=0 AND "dms"."upload_admission"."original_bytes">=0 AND "dms"."upload_admission"."state" IN ('RESERVED','RELEASED','SETTLED') AND "dms"."upload_admission"."profile" IN ('secure-only','searchable','structured') AND length("dms"."upload_admission"."request_hash")=64 AND length("dms"."upload_admission"."idempotency_hash")=64 AND ("dms"."upload_admission"."capability_expires_at" IS NULL OR "dms"."upload_admission"."capability_expires_at"<="dms"."upload_admission"."expires_at"))
);
--> statement-breakpoint
ALTER TABLE "dms"."upload_admission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."admission_capacity" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"shared_device" boolean DEFAULT false NOT NULL,
	"storage_free_bytes" bigint NOT NULL,
	"scratch_free_bytes" bigint NOT NULL,
	"used_at_observation" bigint NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_bounds" CHECK ("dms"."admission_capacity"."storage_free_bytes">=0 AND "dms"."admission_capacity"."scratch_free_bytes">=0 AND "dms"."admission_capacity"."used_at_observation">=0)
);
--> statement-breakpoint
ALTER TABLE "dms"."admission_capacity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."admission_policy" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_policy_bounds" CHECK ("dms"."admission_policy"."revision" BETWEEN 1 AND 999999999999999 AND jsonb_typeof("dms"."admission_policy"."settings")='object' AND octet_length("dms"."admission_policy"."settings"::text)<=16384)
);
--> statement-breakpoint
ALTER TABLE "dms"."admission_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."admission_application_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"reserved_storage" bigint DEFAULT 0 NOT NULL,
	"reserved_scratch" bigint DEFAULT 0 NOT NULL,
	"staging_bytes" bigint DEFAULT 0 NOT NULL,
	"original_bytes" bigint DEFAULT 0 NOT NULL,
	"artifact_bytes" bigint DEFAULT 0 NOT NULL,
	"retained_bytes" bigint DEFAULT 0 NOT NULL,
	"active" integer DEFAULT 0 NOT NULL,
	"queued" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "application_usage_identity" UNIQUE("tenant_id","application_id"),
	CONSTRAINT "usage_nonnegative" CHECK (reserved_storage>=0 AND reserved_scratch>=0 AND staging_bytes>=0 AND original_bytes>=0 AND artifact_bytes>=0 AND retained_bytes>=0 AND active>=0 AND queued>=0)
);
--> statement-breakpoint
ALTER TABLE "dms"."admission_application_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"lifecycle" text DEFAULT 'ACTIVE' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"next_version" integer DEFAULT 1 NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_owner_identity" UNIQUE("tenant_id","application_id","id"),
	CONSTRAINT "document_baseline" CHECK ("dms"."document"."lifecycle"='ACTIVE' AND "dms"."document"."current_version_id" IS NULL AND "dms"."document"."revision" BETWEEN 1 AND 999999999999999 AND "dms"."document"."next_version">0),
	CONSTRAINT "document_labels" CHECK (length("dms"."document"."title") BETWEEN 1 AND 240 AND octet_length("dms"."document"."title") BETWEEN 1 AND 960 AND length("dms"."document"."file_name") BETWEEN 1 AND 255 AND octet_length("dms"."document"."file_name") BETWEEN 1 AND 1020 AND "dms"."document"."title" !~ '[[:cntrl:]]' AND "dms"."document"."file_name" !~ '[[:cntrl:]]' AND position('/' in "dms"."document"."file_name")=0 AND position(chr(92) in "dms"."document"."file_name")=0),
	CONSTRAINT "document_metadata" CHECK (jsonb_typeof("dms"."document"."metadata")='object' AND octet_length("dms"."document"."metadata"::text)<=32768)
);
--> statement-breakpoint
ALTER TABLE "dms"."document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."document_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"availability" text DEFAULT 'PENDING' NOT NULL,
	"size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"file_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "version_owner_identity" UNIQUE("tenant_id","application_id","document_id","id"),
	CONSTRAINT "document_version_number" UNIQUE("tenant_id","document_id","number"),
	CONSTRAINT "version_baseline" CHECK ("dms"."document_version"."number">0 AND "dms"."document_version"."availability"='PENDING' AND "dms"."document_version"."size" BETWEEN 1 AND 52428800 AND length("dms"."document_version"."content_type") BETWEEN 3 AND 100 AND length("dms"."document_version"."file_name") BETWEEN 1 AND 255)
);
--> statement-breakpoint
ALTER TABLE "dms"."document_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."admission_tenant_usage" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"reserved_storage" bigint DEFAULT 0 NOT NULL,
	"reserved_scratch" bigint DEFAULT 0 NOT NULL,
	"staging_bytes" bigint DEFAULT 0 NOT NULL,
	"original_bytes" bigint DEFAULT 0 NOT NULL,
	"artifact_bytes" bigint DEFAULT 0 NOT NULL,
	"retained_bytes" bigint DEFAULT 0 NOT NULL,
	"active" integer DEFAULT 0 NOT NULL,
	"queued" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_nonnegative" CHECK (reserved_storage>=0 AND reserved_scratch>=0 AND staging_bytes>=0 AND original_bytes>=0 AND artifact_bytes>=0 AND retained_bytes>=0 AND active>=0 AND queued>=0)
);
--> statement-breakpoint
ALTER TABLE "dms"."admission_tenant_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."audit_event" DROP CONSTRAINT "audit_application_resource";--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" DROP CONSTRAINT "outbox_kind";--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD COLUMN "actor_kind" text DEFAULT 'machine' NOT NULL;--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "dms"."upload_admission" ADD CONSTRAINT "upload_admission_tenant_id_application_id_document_id_version_id_document_version_tenant_id_application_id_document_id_id_fk" FOREIGN KEY ("tenant_id","application_id","document_id","version_id") REFERENCES "dms"."document_version"("tenant_id","application_id","document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."admission_capacity" ADD CONSTRAINT "admission_capacity_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."admission_policy" ADD CONSTRAINT "admission_policy_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."admission_application_usage" ADD CONSTRAINT "admission_application_usage_tenant_id_application_id_application_registration_tenant_id_id_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "dms"."application_registration"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."document" ADD CONSTRAINT "document_tenant_id_application_id_application_registration_tenant_id_id_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "dms"."application_registration"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."document_version" ADD CONSTRAINT "document_version_tenant_id_application_id_document_id_document_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","document_id") REFERENCES "dms"."document"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."admission_tenant_usage" ADD CONSTRAINT "admission_tenant_usage_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_expiry_idx" ON "dms"."upload_admission" USING btree ("tenant_id","state","expires_at");--> statement-breakpoint
CREATE INDEX "document_owner_page_idx" ON "dms"."document" USING btree ("tenant_id","application_id","created_at","id");--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD CONSTRAINT "audit_event_tenant_id_application_id_document_id_document_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","document_id") REFERENCES "dms"."document"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_document_page_idx" ON "dms"."audit_event" USING btree ("tenant_id","application_id","document_id","created_at","id");--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD CONSTRAINT "audit_application_resource" CHECK (("dms"."audit_event"."resource_type"='application' AND "dms"."audit_event"."resource_id"="dms"."audit_event"."application_id" AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."action"='application.enrolled' AND "dms"."audit_event"."actor_kind"='machine') OR ("dms"."audit_event"."resource_type"='document' AND "dms"."audit_event"."document_id" IS NOT NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."document_id" AND "dms"."audit_event"."action" IN ('document.admitted','admission.reconciled') AND "dms"."audit_event"."actor_kind" IN ('machine','coordinator')));--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" ADD CONSTRAINT "outbox_kind" CHECK ("dms"."outbox_intent"."kind" IN ('application.enrolled','document.admitted','admission.reconciled'));--> statement-breakpoint
CREATE POLICY "coordinator_insert" ON "dms"."audit_event" AS PERMISSIVE FOR INSERT TO "thaarei_dms_coordinator" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND actor_kind='coordinator' AND actor_id='thaarei_dms_coordinator');--> statement-breakpoint
CREATE POLICY "coordinator_insert" ON "dms"."outbox_intent" AS PERMISSIVE FOR INSERT TO "thaarei_dms_coordinator" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_owner" ON "dms"."upload_admission" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."upload_admission" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_tenant" ON "dms"."upload_admission" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."upload_admission" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "runtime_tenant" ON "dms"."admission_capacity" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."admission_capacity" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_tenant" ON "dms"."admission_capacity" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_tenant" ON "dms"."admission_capacity" AS PERMISSIVE FOR ALL TO "thaarei_dms_operator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL)) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "runtime_tenant" ON "dms"."admission_policy" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."admission_policy" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_tenant" ON "dms"."admission_policy" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_tenant" ON "dms"."admission_policy" AS PERMISSIVE FOR ALL TO "thaarei_dms_operator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL)) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "runtime_owner" ON "dms"."admission_application_usage" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."admission_application_usage" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_tenant" ON "dms"."admission_application_usage" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."admission_application_usage" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "runtime_owner" ON "dms"."document" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."document" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_tenant" ON "dms"."document" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."document" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "runtime_owner" ON "dms"."document_version" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."document_version" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_tenant" ON "dms"."document_version" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."document_version" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "runtime_tenant" ON "dms"."admission_tenant_usage" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."admission_tenant_usage" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_tenant" ON "dms"."admission_tenant_usage" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_tenant" ON "dms"."admission_tenant_usage" AS PERMISSIVE FOR ALL TO "thaarei_dms_operator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL)) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
ALTER POLICY "machine_insert" ON "dms"."audit_event" TO thaarei_dms_runtime WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true) = 'machine' AND application_id = nullif(current_setting('app.application_id',true),'')::uuid AND actor_kind='machine' AND actor_id = current_setting('app.actor_id',true));