CREATE TABLE "dms"."service_observation" (
	"tenant_id" uuid NOT NULL,
	"component" text NOT NULL,
	"identity_id" uuid,
	"state" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence_at" timestamp with time zone,
	"evidence_hash" text,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "service_observation_tenant_id_component_pk" PRIMARY KEY("tenant_id","component"),
	CONSTRAINT "service_observation_bounds" CHECK ("dms"."service_observation"."component" IN ('coordinator','publisher','scanner','extractor','heavy','backup') AND "dms"."service_observation"."state" IN ('ready','degraded','stopping') AND "dms"."service_observation"."failures">=0 AND ("dms"."service_observation"."evidence_hash" IS NULL OR "dms"."service_observation"."evidence_hash" ~ '^[a-f0-9]{64}$') AND (("dms"."service_observation"."component" IN ('coordinator','backup'))=("dms"."service_observation"."identity_id" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "dms"."service_observation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."service_observation" ADD CONSTRAINT "service_observation_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."service_observation" ADD CONSTRAINT "service_observation_identity_id_work_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "dms"."work_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."service_observation" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."service_observation" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "operator_read" ON "dms"."service_observation" AS PERMISSIVE FOR SELECT TO "thaarei_dms_operator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=service_observation.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL));