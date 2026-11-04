CREATE TABLE "turnstile"."invitation" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"email" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"state" text NOT NULL,
	"approver_id" text NOT NULL,
	"approval_id" uuid,
	"assignments" jsonb NOT NULL,
	"recovery_epoch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" text,
	CONSTRAINT "invitation_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "invitation_state" CHECK ("turnstile"."invitation"."state" IN ('pending','needs_reapproval','accepted','cancelled','expired')),
	CONSTRAINT "invitation_versions" CHECK ("turnstile"."invitation"."version" BETWEEN 1 AND 2147483647 AND "turnstile"."invitation"."generation" BETWEEN 1 AND 2147483647),
	CONSTRAINT "invitation_email" CHECK ("turnstile"."invitation"."email"=lower("turnstile"."invitation"."email") AND length("turnstile"."invitation"."email") BETWEEN 3 AND 254),
	CONSTRAINT "invitation_approval" CHECK (("turnstile"."invitation"."state" IN ('pending','accepted'))=("turnstile"."invitation"."approval_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."invitation_audit" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	CONSTRAINT "invitation_audit_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "invitation_audit_actions" CHECK ("turnstile"."invitation_audit"."action" IN ('issued','resent','reapproved','cancelled','expired','invalidated','smtp_accepted','delivery_failed','delivery_unknown')),
	CONSTRAINT "invitation_audit_actor" CHECK ("turnstile"."invitation_audit"."actor_kind" IN ('user','system') AND ("turnstile"."invitation_audit"."actor_kind"='system' OR "turnstile"."invitation_audit"."actor_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."invitation_delivery" (
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" text,
	"recovery_epoch" text NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"outcome_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "invitation_delivery_tenant_id_invitation_id_generation_pk" PRIMARY KEY("tenant_id","invitation_id","generation"),
	CONSTRAINT "invitation_delivery_state" CHECK ("turnstile"."invitation_delivery"."state" IN ('queued','sending','smtp_accepted','failed','unknown')),
	CONSTRAINT "invitation_delivery_attempts" CHECK ("turnstile"."invitation_delivery"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "invitation_delivery_payload" CHECK (("turnstile"."invitation_delivery"."state" IN ('queued','sending'))=("turnstile"."invitation_delivery"."payload" IS NOT NULL)),
	CONSTRAINT "invitation_delivery_lease" CHECK ("turnstile"."invitation_delivery"."state"<>'sending' OR ("turnstile"."invitation_delivery"."lease_id" IS NOT NULL AND "turnstile"."invitation_delivery"."lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."invitation_generation" (
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"id" uuid NOT NULL,
	"email" text NOT NULL,
	"approver_id" text NOT NULL,
	"approval" jsonb NOT NULL,
	"assignments" jsonb NOT NULL,
	"credential_hash" text NOT NULL,
	"recovery_epoch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	CONSTRAINT "invitation_generation_tenant_id_invitation_id_generation_pk" PRIMARY KEY("tenant_id","invitation_id","generation")
);
--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_generation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."invitation_operation" (
	"tenant_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"key" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"identity_operation_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"digest" text NOT NULL,
	"state" text DEFAULT 'preparing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT statement_timestamp()+interval '24 hours' NOT NULL,
	CONSTRAINT "invitation_operation_tenant_id_actor_id_key_pk" PRIMARY KEY("tenant_id","actor_id","key"),
	CONSTRAINT "invitation_operation_state" CHECK ("turnstile"."invitation_operation"."state" IN ('preparing','completed'))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_operation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."invitation_rate" (
	"tenant_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"window" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "invitation_rate_tenant_id_actor_window_pk" PRIMARY KEY("tenant_id","actor","window")
);
--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_rate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."invitation_reference" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"role_id" uuid,
	"unit_id" uuid,
	CONSTRAINT "invitation_reference_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "invitation_reference_kind" CHECK (("turnstile"."invitation_reference"."role_id" IS NULL)<>("turnstile"."invitation_reference"."unit_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_reference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnstile"."access_audit" DROP CONSTRAINT "access_audit_action";--> statement-breakpoint
ALTER TABLE "turnstile"."invitation" ADD CONSTRAINT "invitation_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_audit" ADD CONSTRAINT "invitation_audit_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_delivery" ADD CONSTRAINT "invitation_delivery_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_delivery" ADD CONSTRAINT "invitation_delivery_tenant_id_invitation_id_generation_invitation_generation_tenant_id_invitation_id_generation_fk" FOREIGN KEY ("tenant_id","invitation_id","generation") REFERENCES "turnstile"."invitation_generation"("tenant_id","invitation_id","generation") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_generation" ADD CONSTRAINT "invitation_generation_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_generation" ADD CONSTRAINT "invitation_generation_owner_fk" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "turnstile"."invitation"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_operation" ADD CONSTRAINT "invitation_operation_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_rate" ADD CONSTRAINT "invitation_rate_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_reference" ADD CONSTRAINT "invitation_reference_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_reference" ADD CONSTRAINT "invitation_reference_tenant_id_invitation_id_invitation_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "turnstile"."invitation"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_reference" ADD CONSTRAINT "invitation_reference_tenant_id_role_id_access_role_tenant_id_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "turnstile"."access_role"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_reference" ADD CONSTRAINT "invitation_reference_tenant_id_unit_id_organization_unit_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "turnstile"."organization_unit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_actionable_email_idx" ON "turnstile"."invitation" USING btree ("tenant_id","email") WHERE "turnstile"."invitation"."state" IN ('pending','needs_reapproval');--> statement-breakpoint
CREATE INDEX "invitation_expiry_idx" ON "turnstile"."invitation" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "invitation_audit_retention_idx" ON "turnstile"."invitation_audit" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "invitation_delivery_claim_idx" ON "turnstile"."invitation_delivery" USING btree ("tenant_id","state","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_credential_idx" ON "turnstile"."invitation_generation" USING btree ("tenant_id","credential_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_identity_operation_idx" ON "turnstile"."invitation_operation" USING btree ("tenant_id","identity_operation_id");--> statement-breakpoint
CREATE INDEX "invitation_operation_expiry_idx" ON "turnstile"."invitation_operation" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "invitation_reference_invitation_idx" ON "turnstile"."invitation_reference" USING btree ("tenant_id","invitation_id");--> statement-breakpoint
CREATE INDEX "invitation_reference_role_idx" ON "turnstile"."invitation_reference" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE INDEX "invitation_reference_unit_idx" ON "turnstile"."invitation_reference" USING btree ("tenant_id","unit_id");--> statement-breakpoint
ALTER TABLE "turnstile"."access_audit" ADD CONSTRAINT "access_audit_action" CHECK ("turnstile"."access_audit"."action" IN ('legacy_imported','legacy_replaced','legacy_retired','administrator_bootstrapped','administrator_handed_over','member_assignments_changed','member_suspended','member_reactivated','role_created','role_details_changed','role_permissions_changed','role_deleted','unit_coverage_changed','invitation_changed'));--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."invitation" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."invitation"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("turnstile"."invitation"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."invitation_audit" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."invitation_audit"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("turnstile"."invitation_audit"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."invitation_delivery" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."invitation_delivery"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("turnstile"."invitation_delivery"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."invitation_generation" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."invitation_generation"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("turnstile"."invitation_generation"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."invitation_operation" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."invitation_operation"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("turnstile"."invitation_operation"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."invitation_rate" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."invitation_rate"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("turnstile"."invitation_rate"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."invitation_reference" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."invitation_reference"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("turnstile"."invitation_reference"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid);