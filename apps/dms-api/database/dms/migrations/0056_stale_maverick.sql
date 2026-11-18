CREATE TABLE "dms"."deployment_clock_state" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_time" bigint DEFAULT 0 NOT NULL,
	"quarantined" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dms"."deployment_clock_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."deployment_clock_state" ADD CONSTRAINT "deployment_clock_state_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."deployment_clock_state" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."deployment_clock_state" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_read" ON "dms"."deployment_clock_state" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);