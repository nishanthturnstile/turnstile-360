CREATE TABLE "turnstile"."deployment_clock_state" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_time" bigint DEFAULT 0 NOT NULL,
	"quarantined" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "turnstile"."deployment_clock_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."deployment_control" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"local_installation_id" uuid NOT NULL,
	"binding" jsonb,
	"decision" jsonb,
	"marker_digest" text,
	"quarantined" boolean DEFAULT false NOT NULL,
	"credential_metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "turnstile"."deployment_control" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnstile"."deployment_clock_state" ADD CONSTRAINT "deployment_clock_state_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."deployment_control" ADD CONSTRAINT "deployment_control_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "maintenance" ON "turnstile"."deployment_clock_state" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "turnstile"."deployment_clock_state" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_reporter" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_read" ON "turnstile"."deployment_clock_state" AS PERMISSIVE FOR SELECT TO "thaarei_turnstile_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "turnstile"."deployment_control" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "turnstile"."deployment_control" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_reporter" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_read" ON "turnstile"."deployment_control" AS PERMISSIVE FOR SELECT TO "thaarei_turnstile_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);