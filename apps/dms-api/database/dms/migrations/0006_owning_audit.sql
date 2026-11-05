CREATE TABLE "dms"."audit_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"asserted_human" text,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_tenant_identity" UNIQUE("tenant_id","application_id","id"),
	CONSTRAINT "audit_application_resource" CHECK ("dms"."audit_event"."resource_type" = 'application' AND "dms"."audit_event"."resource_id" = "dms"."audit_event"."application_id" AND "dms"."audit_event"."action" = 'application.enrolled'),
	CONSTRAINT "audit_actor_bounds" CHECK (length("dms"."audit_event"."actor_id") BETWEEN 1 AND 200 AND ("dms"."audit_event"."asserted_human" IS NULL OR "dms"."audit_event"."asserted_human" ~ '^[A-Za-z0-9_.:@-]{1,128}$'))
);
--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."outbox_intent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_audit_identity" UNIQUE("tenant_id","audit_id"),
	CONSTRAINT "outbox_kind" CHECK ("dms"."outbox_intent"."kind" = 'application.enrolled')
);
--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."audit_event" ADD CONSTRAINT "audit_event_tenant_id_application_id_application_registration_tenant_id_id_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "dms"."application_registration"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" ADD CONSTRAINT "outbox_intent_tenant_id_application_id_audit_id_audit_event_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","audit_id") REFERENCES "dms"."audit_event"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."outbox_intent" ADD CONSTRAINT "outbox_intent_tenant_id_application_id_application_registration_tenant_id_id_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "dms"."application_registration"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_application_page_idx" ON "dms"."audit_event" USING btree ("tenant_id","application_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_operator_page_idx" ON "dms"."audit_event" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "dms"."outbox_intent" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE POLICY "machine_read" ON "dms"."audit_event" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true) = 'machine' AND application_id = nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "machine_insert" ON "dms"."audit_event" AS PERMISSIVE FOR INSERT TO "thaarei_dms_runtime" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true) = 'machine' AND application_id = nullif(current_setting('app.application_id',true),'')::uuid AND actor_id = current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."audit_event" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true) = 'operator' AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id = audit_event.tenant_id AND oa.subject_id = current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."audit_event" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "machine_insert" ON "dms"."outbox_intent" AS PERMISSIVE FOR INSERT TO "thaarei_dms_runtime" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true) = 'machine' AND application_id = nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_read" ON "dms"."outbox_intent" AS PERMISSIVE FOR SELECT TO "thaarei_dms_coordinator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."outbox_intent" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);