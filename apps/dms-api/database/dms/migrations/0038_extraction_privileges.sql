ALTER TABLE "dms"."work_attempt" ADD CONSTRAINT "work_attempt_tenant_identity" UNIQUE("tenant_id","job_id","id","generation");
--> statement-breakpoint
ALTER TABLE "dms"."extraction_stage" ADD CONSTRAINT "extraction_stage_tenant_id_job_id_attempt_id_generation_work_attempt_tenant_id_job_id_id_generation_fk" FOREIGN KEY ("tenant_id","job_id","attempt_id","generation") REFERENCES "dms"."work_attempt"("tenant_id","job_id","id","generation") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE dms.extraction_stage FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dms.extraction_stage FROM PUBLIC, thaarei_dms_runtime, thaarei_dms_operator;
GRANT SELECT, INSERT ON dms.extraction_stage TO thaarei_dms_coordinator;
GRANT UPDATE (state,manifest) ON dms.extraction_stage TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (artifact_bytes) ON dms.admission_tenant_usage,dms.admission_application_usage TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE FUNCTION dms.extraction_status(target uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN a.profile='secure-only' THEN 'NOT_SCHEDULED' WHEN j.id IS NULL THEN CASE WHEN s.upload_state IN ('FAILED','CANCELLED','EXPIRED') THEN 'CANCELLED' ELSE 'WAITING_FOR_SECURITY' END WHEN j.state='RETRY_WAIT' THEN 'QUEUED' WHEN j.state='SUCCEEDED' THEN coalesce((SELECT e.manifest->>'status' FROM dms.extraction_stage e WHERE e.tenant_id=a.tenant_id AND e.job_id=j.id AND e.generation=j.generation AND e.state='ACCEPTED' ORDER BY e.created_at DESC LIMIT 1),'FAILED') ELSE j.state END
 FROM dms.upload_admission a JOIN dms.document d ON d.id=a.document_id AND d.tenant_id=a.tenant_id JOIN dms.upload_session s ON s.id=a.id AND s.tenant_id=a.tenant_id LEFT JOIN dms.work_job j ON j.tenant_id=a.tenant_id AND j.upload_id=a.id AND j.task='document.extract' AND j.lifecycle_generation=d.lifecycle_generation
 WHERE a.id=target AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND d.lifecycle='ACTIVE' AND (dms.has_document_right(d.id,'READ') OR (current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=a.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL)))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.extraction_status(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.extraction_status(uuid) TO thaarei_dms_runtime,thaarei_dms_operator;
--> statement-breakpoint
CREATE FUNCTION dms.fence_extraction_stage() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.state='ACCEPTED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Accepted extraction evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.fence_extraction_stage() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER fence_extraction_stage BEFORE UPDATE ON dms.extraction_stage FOR EACH ROW EXECUTE FUNCTION dms.fence_extraction_stage();
