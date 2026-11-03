CREATE TABLE "turnstile"."configuration_audit" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"action" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"changed_fields" text[] NOT NULL,
	"revision_before" integer,
	"revision_after" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	CONSTRAINT "configuration_audit_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "audit_actor_bound" CHECK ("turnstile"."configuration_audit"."actor_kind" IN ('user', 'operator') AND "turnstile"."configuration_audit"."actor_id" ~ '^[A-Za-z0-9_-]{1,200}$'),
	CONSTRAINT "audit_action" CHECK ("turnstile"."configuration_audit"."action" IN ('initialized', 'profile_saved', 'unit_created', 'unit_renamed', 'unit_deleted', 'setup_completed', 'access_changed')),
	CONSTRAINT "audit_fields" CHECK (cardinality("turnstile"."configuration_audit"."changed_fields") <= 6 AND "turnstile"."configuration_audit"."changed_fields" <@ ARRAY['name','timeZone','type','parentId','completion','permissions']::text[]),
	CONSTRAINT "audit_revisions" CHECK (("turnstile"."configuration_audit"."revision_before" IS NULL OR "turnstile"."configuration_audit"."revision_before" >= 0) AND "turnstile"."configuration_audit"."revision_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "turnstile"."configuration_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."configuration_create_receipt" (
	"tenant_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT statement_timestamp() + interval '24 hours' NOT NULL,
	CONSTRAINT "configuration_create_receipt_tenant_id_key_pk" PRIMARY KEY("tenant_id","key"),
	CONSTRAINT "receipt_actor_bound" CHECK ("turnstile"."configuration_create_receipt"."actor_id" ~ '^[A-Za-z0-9_-]{1,200}$'),
	CONSTRAINT "receipt_fingerprint_bound" CHECK ("turnstile"."configuration_create_receipt"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "receipt_window" CHECK ("turnstile"."configuration_create_receipt"."expires_at" = "turnstile"."configuration_create_receipt"."created_at" + interval '24 hours')
);
--> statement-breakpoint
ALTER TABLE "turnstile"."configuration_create_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."organization_configuration" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"name" text,
	"time_zone" text,
	"root_id" uuid,
	"requirement_version" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	CONSTRAINT "configuration_revision_bound" CHECK ("turnstile"."organization_configuration"."revision" >= 0 AND "turnstile"."organization_configuration"."revision" <= 2147483647),
	CONSTRAINT "configuration_name_bound" CHECK ("turnstile"."organization_configuration"."name" IS NULL OR char_length("turnstile"."organization_configuration"."name") BETWEEN 1 AND 160),
	CONSTRAINT "configuration_zone_bound" CHECK ("turnstile"."organization_configuration"."time_zone" IS NULL OR (octet_length("turnstile"."organization_configuration"."time_zone") = char_length("turnstile"."organization_configuration"."time_zone") AND char_length("turnstile"."organization_configuration"."time_zone") BETWEEN 1 AND 100)),
	CONSTRAINT "configuration_root_pair" CHECK (("turnstile"."organization_configuration"."name" IS NULL) = ("turnstile"."organization_configuration"."root_id" IS NULL)),
	CONSTRAINT "configuration_version" CHECK ("turnstile"."organization_configuration"."requirement_version" = 1),
	CONSTRAINT "configuration_completion" CHECK (("turnstile"."organization_configuration"."completed_at" IS NULL AND "turnstile"."organization_configuration"."completed_by" IS NULL) OR ("turnstile"."organization_configuration"."completed_at" IS NOT NULL AND "turnstile"."organization_configuration"."completed_by" IS NOT NULL AND "turnstile"."organization_configuration"."completed_by" ~ '^[A-Za-z0-9_-]{1,200}$' AND "turnstile"."organization_configuration"."name" IS NOT NULL AND "turnstile"."organization_configuration"."time_zone" IS NOT NULL AND "turnstile"."organization_configuration"."root_id" IS NOT NULL AND "turnstile"."organization_configuration"."revision" > 0))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."organization_configuration" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."organization_unit" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"type" text NOT NULL,
	"parent_id" uuid,
	"name" text,
	"name_key" text,
	CONSTRAINT "organization_unit_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "unit_type" CHECK ("turnstile"."organization_unit"."type" IN ('organization', 'site', 'department')),
	CONSTRAINT "unit_shape" CHECK (("turnstile"."organization_unit"."type" = 'organization' AND "turnstile"."organization_unit"."parent_id" IS NULL AND "turnstile"."organization_unit"."name" IS NULL AND "turnstile"."organization_unit"."name_key" IS NULL) OR ("turnstile"."organization_unit"."type" IN ('site', 'department') AND "turnstile"."organization_unit"."parent_id" IS NOT NULL AND "turnstile"."organization_unit"."parent_id" <> "turnstile"."organization_unit"."id" AND "turnstile"."organization_unit"."name" IS NOT NULL AND char_length("turnstile"."organization_unit"."name") BETWEEN 1 AND 120 AND "turnstile"."organization_unit"."name_key" IS NOT NULL AND char_length("turnstile"."organization_unit"."name_key") BETWEEN 1 AND 240))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."organization_unit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnstile"."configuration_audit" ADD CONSTRAINT "configuration_audit_tenant_id_organization_configuration_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."organization_configuration"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."configuration_create_receipt" ADD CONSTRAINT "configuration_create_receipt_tenant_id_organization_configuration_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."organization_configuration"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."organization_configuration" ADD CONSTRAINT "organization_configuration_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."organization_configuration" ADD CONSTRAINT "configuration_root_fk" FOREIGN KEY ("tenant_id","root_id") REFERENCES "turnstile"."organization_unit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."organization_unit" ADD CONSTRAINT "organization_unit_tenant_id_organization_configuration_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."organization_configuration"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."organization_unit" ADD CONSTRAINT "organization_unit_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "turnstile"."organization_unit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "configuration_audit_time_idx" ON "turnstile"."configuration_audit" USING btree ("tenant_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "configuration_receipt_expiry_idx" ON "turnstile"."configuration_create_receipt" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_one_root_idx" ON "turnstile"."organization_unit" USING btree ("tenant_id") WHERE "turnstile"."organization_unit"."type" = 'organization';--> statement-breakpoint
CREATE UNIQUE INDEX "organization_sibling_name_idx" ON "turnstile"."organization_unit" USING btree ("tenant_id","parent_id","name_key" COLLATE "C");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."configuration_audit" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."configuration_audit"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."configuration_audit"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "operator_tenant" ON "turnstile"."configuration_create_receipt" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator" USING ("turnstile"."configuration_create_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."configuration_create_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_read" ON "turnstile"."configuration_create_receipt" AS PERMISSIVE FOR SELECT TO "thaarei_turnstile_runtime" USING ("turnstile"."configuration_create_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_insert" ON "turnstile"."configuration_create_receipt" AS PERMISSIVE FOR INSERT TO "thaarei_turnstile_runtime" WITH CHECK ("turnstile"."configuration_create_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_expired_delete" ON "turnstile"."configuration_create_receipt" AS PERMISSIVE FOR DELETE TO "thaarei_turnstile_runtime" USING ("turnstile"."configuration_create_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid AND "turnstile"."configuration_create_receipt"."expires_at" <= statement_timestamp());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."organization_configuration" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."organization_configuration"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."organization_configuration"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."organization_unit" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."organization_unit"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."organization_unit"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);