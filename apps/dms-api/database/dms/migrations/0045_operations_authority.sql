ALTER TABLE dms.service_observation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dms.service_observation FROM PUBLIC,thaarei_dms_runtime;
GRANT SELECT,INSERT,UPDATE ON dms.service_observation TO thaarei_dms_coordinator;
GRANT SELECT ON dms.service_observation TO thaarei_dms_operator;
--> statement-breakpoint
CREATE FUNCTION dms.operations_snapshot() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid uuid=nullif(current_setting('app.tenant_id',true),'')::uuid; stamp timestamptz=clock_timestamp(); components jsonb; apps jsonb; alerts jsonb='[]'; pending bigint; failed bigint; oldest numeric; outbox bigint; oldest_outbox numeric; fresh boolean; storage_free bigint; scratch_free bigint; services_ok boolean; signature_ok boolean; backup_time timestamptz;
BEGIN
 IF NOT (session_user='thaarei_dms_coordinator' OR (session_user='thaarei_dms_operator' AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization WHERE tenant_id=tid AND subject_id=current_setting('app.actor_id',true) AND revoked_at IS NULL))) THEN RAISE EXCEPTION 'Private operations authority required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('component',s.component,'state',s.state,'observedAt',to_char(s.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'evidenceAt',to_char(s.evidence_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'fresh',s.observed_at>stamp-interval '90 seconds' AND (s.identity_id IS NULL OR EXISTS(SELECT 1 FROM dms.work_identity i WHERE i.id=s.identity_id AND i.tenant_id=tid AND i.enabled AND i.role=s.component)),'failures',s.failures) ORDER BY s.component),'[]') INTO components FROM dms.service_observation s WHERE s.tenant_id=tid;
 SELECT count(*)=5 AND bool_and((x->>'fresh')::boolean AND x->>'state'='ready') INTO services_ok FROM jsonb_array_elements(components) x WHERE x->>'component'<>'backup';
 SELECT evidence_at>stamp-interval '48 hours' AND evidence_at<=stamp+interval '1 minute' INTO signature_ok FROM dms.service_observation WHERE tenant_id=tid AND component='scanner';
 SELECT evidence_at INTO backup_time FROM dms.service_observation WHERE tenant_id=tid AND component='backup';
 SELECT count(*) FILTER(WHERE state IN('QUEUED','RUNNING','RETRY_WAIT')),count(*) FILTER(WHERE state IN('FAILED','UNSUPPORTED')),coalesce(greatest(0,extract(epoch FROM stamp-min(created_at) FILTER(WHERE state IN('QUEUED','RUNNING','RETRY_WAIT')))),0) INTO pending,failed,oldest FROM dms.work_job WHERE tenant_id=tid;
 SELECT coalesce(jsonb_agg(jsonb_build_object('applicationId',application_id,'pending',n,'oldestSeconds',age) ORDER BY age DESC,application_id),'[]') INTO apps FROM (SELECT application_id,count(*) n,greatest(0,extract(epoch FROM stamp-min(created_at))) age FROM dms.work_job WHERE tenant_id=tid AND state IN('QUEUED','RUNNING','RETRY_WAIT') GROUP BY application_id ORDER BY age DESC,application_id LIMIT 32)t;
 SELECT count(*),coalesce(greatest(0,extract(epoch FROM stamp-min(d.next_publish_at))),0) INTO outbox,oldest_outbox FROM dms.work_dispatch d JOIN dms.work_job j ON j.id=d.job_id AND j.generation=d.generation WHERE d.tenant_id=tid AND j.state IN('QUEUED','RUNNING','RETRY_WAIT') AND d.state IN('READY','LEASED');
 SELECT observed_at>stamp-interval '30 seconds' AND observed_at<=stamp,storage_free_bytes,scratch_free_bytes INTO fresh,storage_free,scratch_free FROM dms.admission_capacity WHERE tenant_id=tid;
 IF NOT coalesce(services_ok,false) THEN alerts=alerts||'"COMPONENT_UNAVAILABLE"'::jsonb; END IF;
 IF NOT coalesce(signature_ok,false) THEN alerts=alerts||'"SIGNATURE_STALE"'::jsonb; END IF;
 IF NOT coalesce(fresh,false) THEN alerts=alerts||'"CAPACITY_STALE"'::jsonb; END IF;
 IF coalesce(storage_free,0)<52428800 THEN alerts=alerts||'"STORAGE_LOW"'::jsonb; END IF;
 IF coalesce(scratch_free,0)<268435456 THEN alerts=alerts||'"SCRATCH_LOW"'::jsonb; END IF;
 IF backup_time IS NULL THEN alerts=alerts||'"BACKUP_UNREPORTED"'::jsonb; ELSIF backup_time<stamp-interval '24 hours' THEN alerts=alerts||'"BACKUP_LAG"'::jsonb; END IF;
 IF oldest>300 THEN alerts=alerts||'"BACKLOG_AGE"'::jsonb; END IF;
 IF oldest_outbox>120 THEN alerts=alerts||'"OUTBOX_AGE"'::jsonb; END IF;
 IF failed>0 THEN alerts=alerts||'"TERMINAL_FAILURES"'::jsonb; END IF;
 IF EXISTS(SELECT 1 FROM dms.service_observation WHERE tenant_id=tid AND component='coordinator' AND failures>=3) THEN alerts=alerts||'"RECONCILIATION_FAILURES"'::jsonb; END IF;
 RETURN jsonb_build_object('version',1,'observedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'processingReady',coalesce(services_ok AND signature_ok AND fresh AND storage_free>=52428800 AND scratch_free>=268435456,false),'components',components,'backlog',jsonb_build_object('pending',pending,'failed',failed,'oldestSeconds',oldest,'outbox',outbox,'oldestOutboxSeconds',oldest_outbox,'applications',apps),'capacity',jsonb_build_object('fresh',coalesce(fresh,false),'storageFreeBytes',coalesce(storage_free,0),'scratchFreeBytes',coalesce(scratch_free,0)),'alerts',alerts);
END $$;
REVOKE ALL ON FUNCTION dms.operations_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dms.operations_snapshot() TO thaarei_dms_coordinator,thaarei_dms_operator;
--> statement-breakpoint
CREATE FUNCTION dms.report_backup(completed timestamptz,manifest_hash text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid uuid=nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF session_user<>'thaarei_dms_operator' OR NOT EXISTS(SELECT 1 FROM dms.operator_authorization WHERE tenant_id=tid AND subject_id=current_setting('app.actor_id',true) AND revoked_at IS NULL) OR completed>clock_timestamp()+interval '1 minute' OR completed<clock_timestamp()-interval '30 days' OR manifest_hash IS NULL OR manifest_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Backup report rejected' USING ERRCODE='42501'; END IF;
 INSERT INTO dms.service_observation(tenant_id,component,state,evidence_at,evidence_hash) VALUES(tid,'backup','ready',completed,manifest_hash) ON CONFLICT(tenant_id,component) DO UPDATE SET observed_at=clock_timestamp(),evidence_at=EXCLUDED.evidence_at,evidence_hash=EXCLUDED.evidence_hash;
END $$;
REVOKE ALL ON FUNCTION dms.report_backup(timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dms.report_backup(timestamptz,text) TO thaarei_dms_operator;
--> statement-breakpoint
CREATE FUNCTION dms.prune_work_history() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid uuid=nullif(current_setting('app.tenant_id',true),'')::uuid; ids uuid[]; events integer; jobs integer;
BEGIN
 IF session_user<>'thaarei_dms_operator' OR NOT EXISTS(SELECT 1 FROM dms.operator_authorization WHERE tenant_id=tid AND subject_id=current_setting('app.actor_id',true) AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Retention authority required' USING ERRCODE='42501'; END IF;
 SELECT array_agg(id) INTO ids FROM (SELECT j.id FROM dms.work_job j WHERE j.tenant_id=tid AND j.state IN('SUCCEEDED','FAILED','CANCELLED','UNSUPPORTED') AND j.updated_at<clock_timestamp()-interval '90 days' AND j.processing_run_id IS NULL AND NOT EXISTS(SELECT 1 FROM dms.extraction_stage e WHERE e.job_id=j.id) AND NOT EXISTS(SELECT 1 FROM dms.security_candidate c WHERE c.upload_id=j.upload_id) ORDER BY j.id LIMIT 100 FOR UPDATE SKIP LOCKED) t;
 DELETE FROM dms.work_attempt WHERE job_id=ANY(ids); DELETE FROM dms.work_dispatch WHERE job_id=ANY(ids); DELETE FROM dms.work_job WHERE id=ANY(ids); GET DIAGNOSTICS jobs=ROW_COUNT;
 DELETE FROM dms.security_event WHERE id IN(SELECT id FROM dms.security_event WHERE tenant_id=tid AND created_at<clock_timestamp()-interval '90 days' ORDER BY created_at,id LIMIT 1000); GET DIAGNOSTICS events=ROW_COUNT;
 RETURN jsonb_build_object('jobs',jobs,'securityEvents',events);
END $$;
REVOKE ALL ON FUNCTION dms.prune_work_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dms.prune_work_history() TO thaarei_dms_operator;
--> statement-breakpoint
CREATE POLICY operator_operations_evidence ON dms.security_event FOR INSERT TO thaarei_dms_operator WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND actor_kind='operator' AND actor_id=current_setting('app.actor_id',true) AND action IN('operator.operations.inspect','operator.operations.backup.report','operator.operations.prune','authority.keys.inspect','authority.keys.stage','authority.keys.activate') AND outcome='success' AND EXISTS(SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=security_event.tenant_id AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));
