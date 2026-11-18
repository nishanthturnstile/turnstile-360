CREATE FUNCTION dms.search_stage_visible(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM dms.processing_run r JOIN dms.document d ON d.id=r.document_id JOIN dms.application_registration reg ON reg.id=d.application_id JOIN dms.document_version v ON v.id=d.current_version_id JOIN dms.upload_admission a ON a.version_id=v.id JOIN dms.security_candidate c ON c.upload_id=a.id
 WHERE r.accepted_stage_id=target AND r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND r.active AND r.version_id=v.id AND r.lifecycle_generation=d.lifecycle_generation AND v.lifecycle_generation=d.lifecycle_generation AND d.lifecycle='ACTIVE' AND reg.status='active' AND v.availability='AVAILABLE' AND c.state='PASSED' AND c.sha256=r.source_sha256 AND c.evidence IS NOT NULL AND c.assessed_at IS NOT NULL AND (dms.has_document_right(d.id,'READ') OR (session_user='thaarei_dms_operator' AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=d.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL))))
$$;
REVOKE ALL ON FUNCTION dms.search_stage_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dms.search_stage_visible(uuid) TO thaarei_dms_runtime,thaarei_dms_operator;
--> statement-breakpoint
CREATE TABLE "dms"."search_chunk" (
	"stage_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"unit_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" jsonb NOT NULL,
	"text" text NOT NULL,
	"vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig,text)) STORED,
	CONSTRAINT "search_chunk_stage_id_ordinal_pk" PRIMARY KEY("stage_id","ordinal"),
	CONSTRAINT "search_chunk_bounds" CHECK ("dms"."search_chunk"."ordinal" BETWEEN 0 AND 8191 AND char_length("dms"."search_chunk"."text") BETWEEN 1 AND 4096 AND octet_length("dms"."search_chunk"."source"::text)<=4096 AND char_length("dms"."search_chunk"."unit_id")<=160)
);
--> statement-breakpoint
ALTER TABLE "dms"."search_chunk" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."search_generation" (
	"stage_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "search_generation_status" CHECK ("dms"."search_generation"."status" IN ('READY','PARTIAL'))
);
--> statement-breakpoint
ALTER TABLE "dms"."search_generation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."extraction_stage" ADD CONSTRAINT "extraction_stage_tenant" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "dms"."search_chunk" ADD CONSTRAINT "search_chunk_stage_id_search_generation_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "dms"."search_generation"("stage_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."search_generation" ADD CONSTRAINT "search_generation_tenant_id_stage_id_extraction_stage_tenant_id_id_fk" FOREIGN KEY ("tenant_id","stage_id") REFERENCES "dms"."extraction_stage"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."search_generation" ADD CONSTRAINT "search_generation_tenant_id_run_id_processing_run_tenant_id_id_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "dms"."processing_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_chunk_vector" ON "dms"."search_chunk" USING gin ("vector");--> statement-breakpoint
CREATE INDEX "search_chunk_tenant" ON "dms"."search_chunk" USING btree ("tenant_id","stage_id");--> statement-breakpoint
CREATE INDEX "search_generation_run" ON "dms"."search_generation" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."search_chunk" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."search_chunk" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "reader" ON "dms"."search_chunk" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND dms.search_stage_visible(stage_id));--> statement-breakpoint
CREATE POLICY "maintenance" ON "dms"."search_generation" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "coordinator" ON "dms"."search_generation" AS PERMISSIVE FOR ALL TO "thaarei_dms_coordinator" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "reader" ON "dms"."search_generation" AS PERMISSIVE FOR SELECT TO "thaarei_dms_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND dms.search_stage_visible(stage_id));