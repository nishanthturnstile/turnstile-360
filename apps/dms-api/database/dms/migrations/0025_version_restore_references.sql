CREATE TABLE "dms"."binary_restore" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"source_candidate_id" uuid NOT NULL,
	"source_generation" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restore_generation" CHECK ("dms"."binary_restore"."source_generation" BETWEEN 0 AND 2147483646)
);
--> statement-breakpoint
ALTER TABLE "dms"."binary_restore" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."security_candidate" DROP CONSTRAINT "candidate_object";--> statement-breakpoint
ALTER TABLE "dms"."upload_admission" DROP CONSTRAINT "admission_bounds";--> statement-breakpoint
ALTER TABLE "dms"."upload_admission" ADD COLUMN "storage_mode" text DEFAULT 'UPLOAD' NOT NULL;--> statement-breakpoint
ALTER TABLE "dms"."security_candidate" ADD COLUMN "invalidation_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dms"."security_candidate" ADD CONSTRAINT "candidate_owner_identity" UNIQUE("tenant_id","application_id","id");--> statement-breakpoint
ALTER TABLE "dms"."binary_restore" ADD CONSTRAINT "binary_restore_tenant_id_application_id_id_upload_admission_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","id") REFERENCES "dms"."upload_admission"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."binary_restore" ADD CONSTRAINT "binary_restore_tenant_id_application_id_source_candidate_id_security_candidate_tenant_id_application_id_id_fk" FOREIGN KEY ("tenant_id","application_id","source_candidate_id") REFERENCES "dms"."security_candidate"("tenant_id","application_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_object_refs" ON "dms"."security_candidate" USING btree ("tenant_id","object_id");--> statement-breakpoint
ALTER TABLE "dms"."upload_admission" ADD CONSTRAINT "admission_bounds" CHECK ("dms"."upload_admission"."storage_mode" IN ('UPLOAD','REUSE') AND ("dms"."upload_admission"."storage_mode"<>'REUSE' OR ("dms"."upload_admission"."reserved_storage"=0 AND "dms"."upload_admission"."staging_bytes"=0 AND "dms"."upload_admission"."original_bytes"=0 AND "dms"."upload_admission"."capability_expires_at" IS NULL)) AND "dms"."upload_admission"."size" BETWEEN 1 AND 52428800 AND "dms"."upload_admission"."reserved_storage">=0 AND "dms"."upload_admission"."reserved_scratch">=0 AND "dms"."upload_admission"."staging_bytes">=0 AND "dms"."upload_admission"."original_bytes">=0 AND "dms"."upload_admission"."state" IN ('RESERVED','RELEASED','SETTLED') AND "dms"."upload_admission"."profile" IN ('secure-only','searchable','structured') AND length("dms"."upload_admission"."request_hash")=64 AND length("dms"."upload_admission"."idempotency_hash")=64 AND ("dms"."upload_admission"."capability_expires_at" IS NULL OR "dms"."upload_admission"."capability_expires_at"<="dms"."upload_admission"."expires_at"));--> statement-breakpoint
ALTER TABLE "dms"."security_candidate" ADD CONSTRAINT "candidate_generation" CHECK ("dms"."security_candidate"."invalidation_generation" BETWEEN 0 AND 2147483646);--> statement-breakpoint
CREATE POLICY "runtime_owner" ON "dms"."binary_restore" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."binary_restore" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator_read" ON "dms"."binary_restore" AS PERMISSIVE FOR SELECT TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);