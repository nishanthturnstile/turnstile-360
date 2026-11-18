CREATE TABLE "dms"."deployment_usage" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"epoch" uuid DEFAULT gen_random_uuid() NOT NULL,
	"bound_epoch" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_documents" bigint DEFAULT 0 NOT NULL,
	"published_versions" bigint DEFAULT 0 NOT NULL,
	"completed_processing_jobs" bigint DEFAULT 0 NOT NULL,
	"overflow" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dms"."deployment_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."deployment_usage_event" (
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "deployment_usage_event_tenant_id_kind_subject_id_pk" PRIMARY KEY("tenant_id","kind","subject_id")
);
--> statement-breakpoint
ALTER TABLE "dms"."deployment_usage_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."deployment_usage" ADD CONSTRAINT "deployment_usage_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."deployment_usage_event" ADD CONSTRAINT "deployment_usage_event_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."deployment_usage" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."deployment_usage_event" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);