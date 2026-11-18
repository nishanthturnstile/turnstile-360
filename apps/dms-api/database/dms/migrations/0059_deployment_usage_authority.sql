ALTER TABLE dms.deployment_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE dms.deployment_usage_event FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dms.deployment_usage,dms.deployment_usage_event FROM PUBLIC,thaarei_dms_runtime,thaarei_dms_coordinator,thaarei_dms_operator;
ALTER TABLE dms.deployment_usage ADD CONSTRAINT deployment_usage_bounds CHECK (published_documents BETWEEN 0 AND 9007199254740991 AND published_versions BETWEEN 0 AND 9007199254740991 AND completed_processing_jobs BETWEEN 0 AND 9007199254740991);
ALTER TABLE dms.deployment_usage_event ADD CONSTRAINT deployment_usage_kind CHECK(kind IN('document','version','processing'));
CREATE FUNCTION dms.ensure_deployment_usage() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid uuid=nullif(current_setting('app.tenant_id',true),'')::uuid; current_epoch uuid; old_epoch uuid;
BEGIN
 SELECT (decision->>'epoch')::uuid INTO current_epoch FROM dms.deployment_control WHERE tenant_id=tid;
 INSERT INTO dms.deployment_usage(tenant_id,bound_epoch) VALUES(tid,current_epoch) ON CONFLICT DO NOTHING;
 SELECT bound_epoch INTO old_epoch FROM dms.deployment_usage WHERE tenant_id=tid FOR UPDATE;
 IF current_epoch IS NOT NULL AND old_epoch IS NOT NULL AND current_epoch<>old_epoch THEN
  UPDATE dms.deployment_usage SET epoch=gen_random_uuid(),bound_epoch=current_epoch,started_at=clock_timestamp(),published_documents=0,published_versions=0,completed_processing_jobs=0,overflow=false WHERE tenant_id=tid;
 ELSIF old_epoch IS NULL AND current_epoch IS NOT NULL THEN UPDATE dms.deployment_usage SET bound_epoch=current_epoch WHERE tenant_id=tid;
 END IF;
END $$;
REVOKE ALL ON FUNCTION dms.ensure_deployment_usage() FROM PUBLIC;
CREATE FUNCTION dms.capture_deployment_usage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid uuid=nullif(current_setting('app.tenant_id',true),'')::uuid; inserted integer;
BEGIN
 IF NEW.tenant_id<>tid THEN RAISE EXCEPTION 'Usage tenant mismatch' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='document_version' THEN
  IF NEW.availability<>'AVAILABLE' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.availability='AVAILABLE' THEN RETURN NEW; END IF;
 ELSE
  IF NEW.state<>'SUCCEEDED' OR NEW.task='document.scan' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.state='SUCCEEDED' THEN RETURN NEW; END IF;
 END IF;
 PERFORM dms.ensure_deployment_usage();
 IF TG_TABLE_NAME='document_version' THEN
  INSERT INTO dms.deployment_usage_event VALUES(tid,'version',NEW.id) ON CONFLICT DO NOTHING; GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted>0 THEN UPDATE dms.deployment_usage SET overflow=overflow OR published_versions=9007199254740991,published_versions=least(9007199254740991,published_versions+1) WHERE tenant_id=tid; END IF;
  INSERT INTO dms.deployment_usage_event VALUES(tid,'document',NEW.document_id) ON CONFLICT DO NOTHING; GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted>0 THEN UPDATE dms.deployment_usage SET overflow=overflow OR published_documents=9007199254740991,published_documents=least(9007199254740991,published_documents+1) WHERE tenant_id=tid; END IF;
 ELSE
  INSERT INTO dms.deployment_usage_event VALUES(tid,'processing',NEW.id) ON CONFLICT DO NOTHING; GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted>0 THEN UPDATE dms.deployment_usage SET overflow=overflow OR completed_processing_jobs=9007199254740991,completed_processing_jobs=least(9007199254740991,completed_processing_jobs+1) WHERE tenant_id=tid; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION dms.capture_deployment_usage() FROM PUBLIC;
-- Existing committed data establishes a baseline, not fabricated historical totals.
DO $$ DECLARE tid uuid; BEGIN
 SELECT tenant_id INTO tid FROM dms.installation WHERE singleton=1;
 IF tid IS NOT NULL THEN
  PERFORM set_config('app.tenant_id',tid::text,true);PERFORM dms.ensure_deployment_usage();
  INSERT INTO dms.deployment_usage_event SELECT tid,'version',id FROM dms.document_version WHERE tenant_id=tid AND availability='AVAILABLE' ON CONFLICT DO NOTHING;
  INSERT INTO dms.deployment_usage_event SELECT DISTINCT tid,'document',document_id FROM dms.document_version WHERE tenant_id=tid AND availability='AVAILABLE' ON CONFLICT DO NOTHING;
  INSERT INTO dms.deployment_usage_event SELECT tid,'processing',id FROM dms.work_job WHERE tenant_id=tid AND state='SUCCEEDED' AND task<>'document.scan' ON CONFLICT DO NOTHING;
 END IF;
END $$;
CREATE TRIGGER deployment_version_usage AFTER INSERT OR UPDATE OF availability ON dms.document_version FOR EACH ROW EXECUTE FUNCTION dms.capture_deployment_usage();
CREATE TRIGGER deployment_processing_usage AFTER INSERT OR UPDATE OF state ON dms.work_job FOR EACH ROW EXECUTE FUNCTION dms.capture_deployment_usage();
CREATE FUNCTION dms.deployment_usage_snapshot() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid uuid=nullif(current_setting('app.tenant_id',true),'')::uuid; u dms.deployment_usage; documents bigint; originals bigint;
BEGIN
 PERFORM dms.ensure_deployment_usage();
 SELECT * INTO u FROM dms.deployment_usage WHERE tenant_id=tid;
 SELECT count(*) INTO documents FROM dms.document WHERE tenant_id=tid AND lifecycle='ACTIVE' AND current_version_id IS NOT NULL;
 SELECT original_bytes INTO originals FROM dms.admission_tenant_usage WHERE tenant_id=tid;
 RETURN jsonb_build_object('activeDocuments',documents,'retainedOriginalBytes',CASE WHEN originals<=9007199254740991 THEN originals ELSE NULL END,'counters',jsonb_build_object('epoch',u.epoch,'startedAt',to_char(u.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'publishedDocuments',CASE WHEN u.overflow THEN NULL ELSE u.published_documents END,'publishedVersions',CASE WHEN u.overflow THEN NULL ELSE u.published_versions END,'completedProcessingJobs',CASE WHEN u.overflow THEN NULL ELSE u.completed_processing_jobs END));
END $$;
REVOKE ALL ON FUNCTION dms.deployment_usage_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dms.deployment_usage_snapshot() TO thaarei_dms_coordinator;
