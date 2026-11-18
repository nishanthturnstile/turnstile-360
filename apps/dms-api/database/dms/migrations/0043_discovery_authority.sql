CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA dms;
--> statement-breakpoint
CREATE INDEX document_title_trigram ON dms.document USING gin(title dms.gin_trgm_ops);
CREATE INDEX document_filename_trigram ON dms.document USING gin(file_name dms.gin_trgm_ops);
CREATE INDEX document_category_filter ON dms.document ((metadata->>'category'));
CREATE INDEX document_status_filter ON dms.document ((metadata->>'status'));
--> statement-breakpoint
ALTER TABLE dms.search_generation FORCE ROW LEVEL SECURITY;
ALTER TABLE dms.search_chunk FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dms.search_generation,dms.search_chunk FROM PUBLIC,thaarei_dms_runtime;
GRANT SELECT ON dms.search_generation,dms.search_chunk TO thaarei_dms_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON dms.search_generation,dms.search_chunk TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE FUNCTION dms.processing_index_status(target uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN r.state IN('QUEUED','RUNNING') THEN 'PENDING' ELSE coalesce((SELECT g.status FROM dms.search_generation g WHERE g.stage_id=r.accepted_stage_id AND g.run_id=r.id),'NOT_INDEXED') END FROM dms.processing_run r WHERE r.id=target AND r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND (current_setting('app.principal_kind',true)='coordinator' OR dms.has_document_right(r.document_id,'READ') OR (current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=r.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL)))
$$;
REVOKE ALL ON FUNCTION dms.processing_index_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dms.processing_index_status(uuid) TO thaarei_dms_runtime,thaarei_dms_coordinator,thaarei_dms_operator;
