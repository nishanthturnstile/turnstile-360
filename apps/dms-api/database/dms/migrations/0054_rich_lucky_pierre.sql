CREATE TABLE "dms"."deployment_control" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"local_installation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"binding" jsonb,
	"decision" jsonb,
	"marker_digest" text,
	"quarantined" boolean DEFAULT false NOT NULL,
	"credential_metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "dms"."deployment_control" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."deployment_control" ADD CONSTRAINT "deployment_control_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."deployment_control" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."deployment_control" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "runtime_read" ON "dms"."deployment_control" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."deployment_control" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);