CREATE TABLE "dms"."extraction_stage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"object_id" uuid NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"state" text DEFAULT 'ISSUED' NOT NULL,
	"manifest" jsonb,
	"capability_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_attempt_output" UNIQUE("tenant_id","attempt_id"),
	CONSTRAINT "extraction_stage_bounds" CHECK ("dms"."extraction_stage"."generation">0 AND "dms"."extraction_stage"."size" BETWEEN 1 AND 26214400 AND "dms"."extraction_stage"."sha256" ~ '^[a-f0-9]{64}$' AND "dms"."extraction_stage"."state" IN ('ISSUED','ACCEPTED') AND ("dms"."extraction_stage"."manifest" IS NULL OR octet_length("dms"."extraction_stage"."manifest"::text)<=8192) AND ("dms"."extraction_stage"."state"<>'ACCEPTED' OR "dms"."extraction_stage"."manifest" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "dms"."extraction_stage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."extraction_stage" ADD CONSTRAINT "extraction_stage_tenant_id_job_id_work_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "dms"."work_job"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extraction_job_generation" ON "dms"."extraction_stage" USING btree ("tenant_id","job_id","generation");--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."extraction_stage" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."extraction_stage" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);