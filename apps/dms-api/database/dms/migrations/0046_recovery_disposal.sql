CREATE TABLE "dms"."backup_catalog" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recovery_point" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"manifest_sha256" text NOT NULL,
	"repository_id" text NOT NULL,
	"bytes" bigint NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "backup_catalog_bounds" CHECK ("dms"."backup_catalog"."expires_at">="dms"."backup_catalog"."recovery_point"+interval '7 days' AND "dms"."backup_catalog"."manifest_sha256" ~ '^[a-f0-9]{64}$' AND "dms"."backup_catalog"."repository_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "dms"."backup_catalog"."bytes">0)
);
--> statement-breakpoint
ALTER TABLE "dms"."backup_catalog" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."disposal_intent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"area" text NOT NULL,
	"object_id" uuid NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "disposal_object_identity" UNIQUE("tenant_id","application_id","area","object_id"),
	CONSTRAINT "disposal_bounds" CHECK ("dms"."disposal_intent"."area" IN ('staging','originals','artifacts') AND "dms"."disposal_intent"."state" IN ('PENDING','DELETING','COMPLETE') AND length("dms"."disposal_intent"."requested_by") BETWEEN 1 AND 128 AND (("dms"."disposal_intent"."state"='COMPLETE')=("dms"."disposal_intent"."completed_at" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "dms"."disposal_intent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."recovery_state" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'OPEN' NOT NULL,
	"backup_id" uuid,
	"manifest_sha256" text,
	"verified_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	CONSTRAINT "recovery_state_bounds" CHECK ("dms"."recovery_state"."state" IN ('OPEN','CLOSED') AND ("dms"."recovery_state"."manifest_sha256" IS NULL OR "dms"."recovery_state"."manifest_sha256" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "dms"."recovery_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."backup_catalog" ADD CONSTRAINT "backup_catalog_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."disposal_intent" ADD CONSTRAINT "disposal_intent_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."recovery_state" ADD CONSTRAINT "recovery_state_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_recovery_horizon" ON "dms"."backup_catalog" USING btree ("tenant_id","expires_at","recovery_point");--> statement-breakpoint
CREATE INDEX "disposal_due" ON "dms"."disposal_intent" USING btree ("tenant_id","state","next_attempt_at","lease_until");--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."backup_catalog" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."backup_catalog" AS PERMISSIVE FOR SELECT TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator" ON "dms"."backup_catalog" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=tenant_id AND o.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."disposal_intent" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."disposal_intent" AS PERMISSIVE FOR SELECT TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator" ON "dms"."disposal_intent" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=tenant_id AND o.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."recovery_state" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."recovery_state" AS PERMISSIVE FOR SELECT TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator" ON "dms"."recovery_state" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=tenant_id AND o.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL));--> statement-breakpoint
CREATE POLICY "runtime" ON "dms"."recovery_state" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);