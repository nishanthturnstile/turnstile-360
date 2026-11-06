CREATE TABLE "dms"."upload_batch" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"state" text DEFAULT 'OPEN' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_owner_identity" UNIQUE("tenant_id","application_id","id"),
	CONSTRAINT "batch_state" CHECK ("dms"."upload_batch"."state" IN ('OPEN','CLOSED','CANCELLED','EXPIRED'))
);
--> statement-breakpoint
ALTER TABLE "dms"."upload_batch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."upload_batch_item" (
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"operation" text NOT NULL,
	"descriptor" jsonb NOT NULL,
	"state" text DEFAULT 'UNSTARTED' NOT NULL,
	"upload_id" uuid,
	"admission_error" text,
	CONSTRAINT "batch_item_identity" UNIQUE("tenant_id","application_id","batch_id","item_id"),
	CONSTRAINT "batch_item_ordinal" UNIQUE("batch_id","ordinal"),
	CONSTRAINT "batch_item_upload" UNIQUE("upload_id"),
	CONSTRAINT "batch_item_bounds" CHECK ("dms"."upload_batch_item"."item_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "dms"."upload_batch_item"."ordinal" BETWEEN 0 AND 99 AND "dms"."upload_batch_item"."operation" IN ('create','new-version') AND jsonb_typeof("dms"."upload_batch_item"."descriptor")='object' AND octet_length("dms"."upload_batch_item"."descriptor"::text)<=32768 AND "dms"."upload_batch_item"."state" IN ('UNSTARTED','BOUND','CLOSED','CANCELLED','EXPIRED') AND (("dms"."upload_batch_item"."state"='BOUND')=("dms"."upload_batch_item"."upload_id" IS NOT NULL)) AND ("dms"."upload_batch_item"."admission_error" IS NULL OR "dms"."upload_batch_item"."admission_error" IN ('POLICY_DENIED','CAPACITY_EXCEEDED','CAPACITY_UNAVAILABLE','OPERATION_DENIED','REVISION_CONFLICT')))
);
--> statement-breakpoint
ALTER TABLE "dms"."upload_batch_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."upload_batch_slot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dms"."upload_batch_slot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."upload_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"namespace" text NOT NULL,
	"key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"batch_id" uuid,
	"upload_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "upload_operation_receipt" UNIQUE("tenant_id","application_id","namespace","key_hash"),
	CONSTRAINT "upload_receipt_bounds" CHECK (length("dms"."upload_receipt"."key_hash")=64 AND length("dms"."upload_receipt"."request_hash")=64 AND "dms"."upload_receipt"."namespace" IN ('batch.create','batch.close','upload.complete') AND (("dms"."upload_receipt"."batch_id" IS NULL)<>("dms"."upload_receipt"."upload_id" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "dms"."upload_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."upload_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"staging_id" uuid NOT NULL,
	"descriptor" jsonb NOT NULL,
	"batch_id" uuid,
	"item_id" text,
	"upload_state" text DEFAULT 'INITIATED' NOT NULL,
	"completion_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_session_staging_id_unique" UNIQUE("staging_id"),
	CONSTRAINT "session_owner_identity" UNIQUE("tenant_id","application_id","id"),
	CONSTRAINT "session_bounds" CHECK ("dms"."upload_session"."upload_state" IN ('INITIATED','EXPIRED','CANCELLED','FAILED') AND jsonb_typeof("dms"."upload_session"."descriptor")='object' AND octet_length("dms"."upload_session"."descriptor"::text)<=32768 AND (("dms"."upload_session"."batch_id" IS NULL)=("dms"."upload_session"."item_id" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."audit_event" DROP CONSTRAINT "audit_application_resource";--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" DROP CONSTRAINT "outbox_kind";--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "dms"."upload_admission" ADD CONSTRAINT "admission_owner_identity" UNIQUE("tenant_id","application_id","id");--> statement-breakpoint
ALTER TABLE "dms"."upload_batch" ADD CONSTRAINT "upload_batch_tenant_id_application_id_application_registration_tenant_id_id_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "dms"."application_registration"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."upload_batch_item" ADD CONSTRAINT "upload_batch_item_tenant_id_application_id_batch_id_upload_batch_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","batch_id") REFERENCES "dms"."upload_batch"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."upload_batch_item" ADD CONSTRAINT "upload_batch_item_tenant_id_application_id_upload_id_upload_admission_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","upload_id") REFERENCES "dms"."upload_admission"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."upload_batch_slot" ADD CONSTRAINT "upload_batch_slot_tenant_id_application_id_id_upload_batch_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","id") REFERENCES "dms"."upload_batch"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."upload_receipt" ADD CONSTRAINT "upload_receipt_tenant_id_application_id_batch_id_upload_batch_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","batch_id") REFERENCES "dms"."upload_batch"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."upload_receipt" ADD CONSTRAINT "upload_receipt_tenant_id_application_id_upload_id_upload_session_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","upload_id") REFERENCES "dms"."upload_session"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD CONSTRAINT "upload_session_tenant_id_application_id_id_upload_admission_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","id") REFERENCES "dms"."upload_admission"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD CONSTRAINT "upload_session_tenant_id_application_id_batch_id_item_id_upload_batch_item_tenant_id_application_id_batch_id_item_id_fk" FOREIGN KEY ("tenant_id","application_id","batch_id","item_id") REFERENCES "dms"."upload_batch_item"("tenant_id","application_id","batch_id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_open_expiry_idx" ON "dms"."upload_batch" USING btree ("tenant_id","state","expires_at");--> statement-breakpoint
CREATE INDEX "batch_slot_capacity_idx" ON "dms"."upload_batch_slot" USING btree ("tenant_id","active","expires_at");--> statement-breakpoint
CREATE INDEX "upload_receipt_expiry_idx" ON "dms"."upload_receipt" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "session_recovery_idx" ON "dms"."upload_session" USING btree ("tenant_id","upload_state","created_at");--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD CONSTRAINT "audit_event_tenant_id_application_id_batch_id_upload_batch_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","batch_id") REFERENCES "dms"."upload_batch"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD CONSTRAINT "audit_application_resource" CHECK (("dms"."audit_event"."resource_type"='application' AND "dms"."audit_event"."resource_id"="dms"."audit_event"."application_id" AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."batch_id" IS NULL AND "dms"."audit_event"."action"='application.enrolled' AND "dms"."audit_event"."actor_kind"='machine') OR ("dms"."audit_event"."resource_type"='document' AND "dms"."audit_event"."document_id" IS NOT NULL AND "dms"."audit_event"."batch_id" IS NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."document_id" AND "dms"."audit_event"."action" IN ('document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired') AND "dms"."audit_event"."actor_kind" IN ('machine','coordinator')) OR ("dms"."audit_event"."resource_type"='upload-batch' AND "dms"."audit_event"."batch_id" IS NOT NULL AND "dms"."audit_event"."document_id" IS NULL AND "dms"."audit_event"."resource_id"="dms"."audit_event"."batch_id" AND "dms"."audit_event"."action" IN ('batch.created','batch.closed','batch.cancelled','batch.expired') AND "dms"."audit_event"."actor_kind"='machine'));--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" ADD CONSTRAINT "outbox_kind" CHECK ("dms"."outbox_intent"."kind" IN ('application.enrolled','document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired','batch.created','batch.closed','batch.cancelled','batch.expired'));--> statement-breakpoint
CREATE POLICY "runtime_owner" ON "dms"."upload_batch" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."upload_batch" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_read" ON "dms"."upload_batch" AS PERMISSIVE FOR SELECT TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."upload_batch" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "runtime_owner" ON "dms"."upload_batch_item" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."upload_batch_item" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_read" ON "dms"."upload_batch_item" AS PERMISSIVE FOR SELECT TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."upload_batch_item" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "runtime_read" ON "dms"."upload_batch_slot" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_insert" ON "dms"."upload_batch_slot" AS PERMISSIVE FOR INSERT TO "thaarei_dms_runtime" WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_update" ON "dms"."upload_batch_slot" AS PERMISSIVE FOR UPDATE TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."upload_batch_slot" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_owner" ON "dms"."upload_receipt" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."upload_receipt" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_read" ON "dms"."upload_receipt" AS PERMISSIVE FOR SELECT TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."upload_receipt" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "runtime_owner" ON "dms"."upload_session" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."upload_session" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_read" ON "dms"."upload_session" AS PERMISSIVE FOR SELECT TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."upload_session" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));