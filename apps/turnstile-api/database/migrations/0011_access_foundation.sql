CREATE TABLE "turnstile"."access_assignment" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_kind" text NOT NULL,
	"include_children" boolean NOT NULL,
	"scope_key" text NOT NULL,
	CONSTRAINT "access_assignment_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "access_assignment_scope" CHECK (("turnstile"."access_assignment"."scope_kind" = 'company' AND NOT "turnstile"."access_assignment"."include_children" AND "turnstile"."access_assignment"."scope_key" = 'company') OR ("turnstile"."access_assignment"."scope_kind" = 'units' AND char_length("turnstile"."access_assignment"."scope_key") BETWEEN 43 AND 600))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."access_assignment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."access_audit" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"action" text NOT NULL,
	"subject_id" uuid,
	"subject_user_id" text,
	"revision_before" integer NOT NULL,
	"revision_after" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	CONSTRAINT "access_audit_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "access_audit_actor" CHECK ("turnstile"."access_audit"."actor_kind" IN ('operator','user') AND "turnstile"."access_audit"."actor_id" ~ '^[A-Za-z0-9_-]{1,200}$'),
	CONSTRAINT "access_audit_subject" CHECK ("turnstile"."access_audit"."subject_user_id" IS NULL OR "turnstile"."access_audit"."subject_user_id" ~ '^[A-Za-z0-9_-]{1,200}$'),
	CONSTRAINT "access_audit_action" CHECK ("turnstile"."access_audit"."action" IN ('legacy_imported','legacy_replaced','legacy_retired','administrator_bootstrapped','administrator_handed_over','member_assignments_changed','member_suspended','member_reactivated','role_created','role_details_changed','role_permissions_changed','role_deleted')),
	CONSTRAINT "access_audit_operator" CHECK ("turnstile"."access_audit"."action" NOT IN ('legacy_imported','legacy_replaced','administrator_bootstrapped','administrator_handed_over') OR "turnstile"."access_audit"."actor_kind" = 'operator'),
	CONSTRAINT "access_audit_revisions" CHECK ("turnstile"."access_audit"."revision_before" >= 0 AND "turnstile"."access_audit"."revision_after"::bigint = "turnstile"."access_audit"."revision_before"::bigint + 1)
);
--> statement-breakpoint
ALTER TABLE "turnstile"."access_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."access_command_receipt" (
	"tenant_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"key" uuid NOT NULL,
	"operation" text NOT NULL,
	"digest" text NOT NULL,
	"subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT statement_timestamp() + interval '24 hours' NOT NULL,
	CONSTRAINT "access_command_receipt_tenant_id_actor_id_key_pk" PRIMARY KEY("tenant_id","actor_id","key"),
	CONSTRAINT "access_receipt_actor" CHECK ("turnstile"."access_command_receipt"."actor_id" ~ '^[A-Za-z0-9_-]{1,200}$'),
	CONSTRAINT "access_receipt_digest" CHECK ("turnstile"."access_command_receipt"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "access_receipt_operation" CHECK ("turnstile"."access_command_receipt"."operation" IN ('legacy.replace','legacy.retire','administrator.bootstrap','administrator.handover','member.assignments','member.suspend','member.reactivate','role.create','role.patch','role.delete','invitation.issue','invitation.resend','invitation.cancel','invitation.reapprove')),
	CONSTRAINT "access_receipt_window" CHECK ("turnstile"."access_command_receipt"."expires_at" = "turnstile"."access_command_receipt"."created_at" + interval '24 hours')
);
--> statement-breakpoint
ALTER TABLE "turnstile"."access_command_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."access_context" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"model_version" integer DEFAULT 1 NOT NULL,
	"public_writes_enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"initialized_by" text NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	CONSTRAINT "access_model_version" CHECK ("turnstile"."access_context"."model_version" = 1 AND NOT "turnstile"."access_context"."public_writes_enabled"),
	CONSTRAINT "access_revision" CHECK ("turnstile"."access_context"."revision" BETWEEN 0 AND 2147483647),
	CONSTRAINT "access_initializer" CHECK ("turnstile"."access_context"."initialized_by" ~ '^[A-Za-z0-9_-]{1,200}$')
);
--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."access_impact_receipt" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"command_digest" text NOT NULL,
	"actor_fingerprint" text NOT NULL,
	"access_revision" integer NOT NULL,
	"organization_revision" integer,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT statement_timestamp() + interval '5 minutes' NOT NULL,
	CONSTRAINT "access_impact_receipt_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "access_impact_actor" CHECK ("turnstile"."access_impact_receipt"."actor_id" ~ '^[A-Za-z0-9_-]{1,200}$'),
	CONSTRAINT "access_impact_digests" CHECK ("turnstile"."access_impact_receipt"."token_hash" ~ '^[0-9a-f]{64}$' AND "turnstile"."access_impact_receipt"."command_digest" ~ '^[0-9a-f]{64}$' AND "turnstile"."access_impact_receipt"."actor_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "access_impact_revisions" CHECK ("turnstile"."access_impact_receipt"."access_revision" >= 0 AND ("turnstile"."access_impact_receipt"."organization_revision" IS NULL OR "turnstile"."access_impact_receipt"."organization_revision" >= 0)),
	CONSTRAINT "access_impact_window" CHECK ("turnstile"."access_impact_receipt"."expires_at" = "turnstile"."access_impact_receipt"."created_at" + interval '5 minutes')
);
--> statement-breakpoint
ALTER TABLE "turnstile"."access_impact_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."access_legacy_source" (
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"permissions" text[] NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"imported_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	CONSTRAINT "access_legacy_source_tenant_id_member_id_pk" PRIMARY KEY("tenant_id","member_id"),
	CONSTRAINT "access_legacy_version" CHECK ("turnstile"."access_legacy_source"."version" BETWEEN 1 AND 2147483647),
	CONSTRAINT "access_legacy_permissions" CHECK (cardinality("turnstile"."access_legacy_source"."permissions") <= 3 AND array_position("turnstile"."access_legacy_source"."permissions",NULL) IS NULL AND "turnstile"."access_legacy_source"."permissions" <@ ARRAY['turnstile:access','turnstile:dms:capabilities:read','turnstile:configuration:manage']::text[])
);
--> statement-breakpoint
ALTER TABLE "turnstile"."access_legacy_source" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."access_member" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "access_member_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "access_member_subject" CHECK ("turnstile"."access_member"."user_id" ~ '^[A-Za-z0-9_-]{1,200}$'),
	CONSTRAINT "access_member_version" CHECK ("turnstile"."access_member"."version" BETWEEN 1 AND 2147483647),
	CONSTRAINT "access_member_status" CHECK ("turnstile"."access_member"."status" IN ('active','suspended'))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."access_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."access_role" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"system_key" text,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"permission_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "access_role_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "access_role_version" CHECK ("turnstile"."access_role"."version" BETWEEN 1 AND 2147483647 AND "turnstile"."access_role"."permission_version" BETWEEN 1 AND "turnstile"."access_role"."version"),
	CONSTRAINT "access_role_system" CHECK ("turnstile"."access_role"."system_key" IS NULL OR "turnstile"."access_role"."system_key" IN ('workspace_administrator','configuration_manager','unit_manager','member')),
	CONSTRAINT "access_role_name" CHECK (char_length("turnstile"."access_role"."name") BETWEEN 1 AND 80 AND char_length("turnstile"."access_role"."name_key") BETWEEN 1 AND 160),
	CONSTRAINT "access_role_description" CHECK ("turnstile"."access_role"."description" IS NULL OR char_length("turnstile"."access_role"."description") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "turnstile"."access_role" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."access_role_permission" (
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "access_role_permission_tenant_id_role_id_permission_pk" PRIMARY KEY("tenant_id","role_id","permission"),
	CONSTRAINT "access_permission_catalog" CHECK ("turnstile"."access_role_permission"."permission" IN ('turnstile:access','turnstile:dms:capabilities:read','turnstile:configuration:manage','turnstile:people:manage','turnstile:roles:manage','turnstile:units:read','turnstile:units:manage'))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."access_role_permission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."access_scope_anchor" (
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	CONSTRAINT "access_scope_anchor_tenant_id_assignment_id_unit_id_pk" PRIMARY KEY("tenant_id","assignment_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "turnstile"."access_scope_anchor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnstile"."access_assignment" ADD CONSTRAINT "access_assignment_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_assignment" ADD CONSTRAINT "access_assignment_tenant_id_member_id_access_member_tenant_id_id_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "turnstile"."access_member"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_assignment" ADD CONSTRAINT "access_assignment_tenant_id_role_id_access_role_tenant_id_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "turnstile"."access_role"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_audit" ADD CONSTRAINT "access_audit_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_command_receipt" ADD CONSTRAINT "access_command_receipt_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ADD CONSTRAINT "access_context_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_impact_receipt" ADD CONSTRAINT "access_impact_receipt_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_legacy_source" ADD CONSTRAINT "access_legacy_source_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_legacy_source" ADD CONSTRAINT "access_legacy_source_tenant_id_member_id_access_member_tenant_id_id_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "turnstile"."access_member"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_member" ADD CONSTRAINT "access_member_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_role" ADD CONSTRAINT "access_role_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_role_permission" ADD CONSTRAINT "access_role_permission_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_role_permission" ADD CONSTRAINT "access_role_permission_tenant_id_role_id_access_role_tenant_id_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "turnstile"."access_role"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_scope_anchor" ADD CONSTRAINT "access_scope_anchor_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_scope_anchor" ADD CONSTRAINT "access_scope_anchor_tenant_id_assignment_id_access_assignment_tenant_id_id_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "turnstile"."access_assignment"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."access_scope_anchor" ADD CONSTRAINT "access_scope_anchor_tenant_id_unit_id_organization_unit_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "turnstile"."organization_unit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_assignment_scope_idx" ON "turnstile"."access_assignment" USING btree ("tenant_id","member_id","role_id","scope_key");--> statement-breakpoint
CREATE INDEX "access_assignment_role_idx" ON "turnstile"."access_assignment" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE INDEX "access_audit_time_idx" ON "turnstile"."access_audit" USING btree ("tenant_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "access_receipt_expiry_idx" ON "turnstile"."access_command_receipt" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "access_impact_token_idx" ON "turnstile"."access_impact_receipt" USING btree ("tenant_id","token_hash");--> statement-breakpoint
CREATE INDEX "access_impact_expiry_idx" ON "turnstile"."access_impact_receipt" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "access_legacy_source_id_idx" ON "turnstile"."access_legacy_source" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_member_subject_idx" ON "turnstile"."access_member" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_role_name_idx" ON "turnstile"."access_role" USING btree ("tenant_id","name_key" COLLATE "C");--> statement-breakpoint
CREATE UNIQUE INDEX "access_role_system_idx" ON "turnstile"."access_role" USING btree ("tenant_id","system_key");--> statement-breakpoint
CREATE INDEX "access_scope_unit_idx" ON "turnstile"."access_scope_anchor" USING btree ("tenant_id","unit_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."access_assignment" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."access_assignment"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."access_assignment"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."access_audit" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."access_audit"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."access_audit"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."access_command_receipt" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."access_command_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."access_command_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."access_context" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."access_context"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."access_context"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."access_impact_receipt" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."access_impact_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."access_impact_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."access_legacy_source" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."access_legacy_source"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."access_legacy_source"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."access_member" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."access_member"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."access_member"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."access_role" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."access_role"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."access_role"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."access_role_permission" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."access_role_permission"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."access_role_permission"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."access_scope_anchor" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."access_scope_anchor"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."access_scope_anchor"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);