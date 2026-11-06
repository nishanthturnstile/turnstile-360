ALTER TABLE dms.processing_run FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dms.processing_run FROM PUBLIC,thaarei_dms_runtime,thaarei_dms_operator,thaarei_dms_coordinator;
GRANT SELECT ON dms.processing_run TO thaarei_dms_runtime,thaarei_dms_operator,thaarei_dms_coordinator;
GRANT INSERT ON dms.processing_run TO thaarei_dms_coordinator;
GRANT UPDATE(state,active,accepted_stage_id,completed_at) ON dms.processing_run TO thaarei_dms_coordinator;
GRANT INSERT(processing_run_id) ON dms.work_job TO thaarei_dms_coordinator;
ALTER TABLE dms.processing_run ADD CONSTRAINT processing_accepted_stage FOREIGN KEY(accepted_stage_id) REFERENCES dms.extraction_stage(id);
--> statement-breakpoint
--> statement-breakpoint
-- Retain accepted pre-I16 evidence and pending jobs without rewriting artifact bytes.
INSERT INTO dms.processing_run(id,tenant_id,application_id,document_id,version_id,upload_id,number,lifecycle_generation,profile,source_sha256,state,active,accepted_stage_id,actor_kind,actor_id,expires_at,created_at,completed_at)
SELECT j.id,j.tenant_id,j.application_id,a.document_id,a.version_id,a.id,row_number() OVER(PARTITION BY a.version_id ORDER BY j.created_at,j.id)::integer,j.lifecycle_generation,a.profile,c.sha256,
CASE WHEN j.state='SUCCEEDED' THEN coalesce(e.manifest->>'status','FAILED') WHEN j.state='RETRY_WAIT' THEN 'QUEUED' ELSE j.state END,false,e.id,'coordinator','thaarei_dms_coordinator',coalesce(a.reassessment_until,a.expires_at),j.created_at,CASE WHEN j.state IN('SUCCEEDED','FAILED','CANCELLED','UNSUPPORTED') THEN j.updated_at END
FROM dms.work_job j JOIN dms.upload_admission a ON a.id=j.upload_id JOIN dms.security_candidate c ON c.upload_id=a.id
LEFT JOIN LATERAL(SELECT e.* FROM dms.extraction_stage e WHERE e.job_id=j.id AND e.generation=j.generation AND e.state='ACCEPTED' ORDER BY e.created_at DESC LIMIT 1)e ON true
WHERE j.task<>'document.scan' AND a.profile IN('searchable','structured') AND c.sha256 IS NOT NULL;
UPDATE dms.work_job j SET processing_run_id=j.id WHERE EXISTS(SELECT 1 FROM dms.processing_run r WHERE r.id=j.id);
UPDATE dms.processing_run r SET active=true WHERE r.accepted_stage_id IS NOT NULL AND r.state IN('SUCCEEDED','PARTIAL') AND NOT EXISTS(SELECT 1 FROM dms.processing_run newer WHERE newer.version_id=r.version_id AND newer.state IN('SUCCEEDED','PARTIAL') AND newer.accepted_stage_id IS NOT NULL AND newer.number>r.number);
--> statement-breakpoint
CREATE FUNCTION dms.request_processing(target uuid, version_target uuid, requested_profile text, operation_key text, operation_id uuid, request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d dms.document; v dms.document_version; a dms.upload_admission; c dms.security_candidate; p jsonb; u dms.admission_tenant_usage; au dms.admission_application_usage; cap dms.admission_capacity; prior dms.processing_run; who text; actor text; stamp timestamptz; digest text; job_id uuid; scratch bigint; task text; n integer;
BEGIN
 IF requested_profile NOT IN('searchable','structured') OR operation_key IS NULL OR operation_key !~ '^[A-Za-z0-9_-]{16,128}$' THEN RETURN jsonb_build_object('error','INVALID_REQUEST'); END IF;
 who=current_setting('app.principal_kind',true); actor=current_setting('app.actor_id',true);
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dms-lifecycle:'||current_setting('app.tenant_id',true),0));
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dms-admission-policy:'||current_setting('app.tenant_id',true),0));
 SELECT * INTO d FROM dms.document WHERE id=target AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','DOCUMENT_NOT_FOUND'); END IF;
 IF NOT ((session_user='thaarei_dms_runtime' AND who='machine' AND d.application_id=nullif(current_setting('app.application_id',true),'')::uuid AND EXISTS(SELECT 1 FROM dms.application_registration r WHERE r.id=d.application_id AND r.tenant_id=d.tenant_id AND r.status='active' AND r.principal_kind='consumer' AND r.client_id=actor AND 'dms:documents:write'=ANY(r.scope_ceiling))) OR (session_user='thaarei_dms_operator' AND who='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=d.tenant_id AND o.subject_id=actor AND o.revoked_at IS NULL))) THEN RETURN jsonb_build_object('error','DOCUMENT_NOT_FOUND'); END IF;
 PERFORM id FROM dms.application_registration WHERE id=d.application_id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','APPLICATION_DENIED'); END IF;
 SELECT * INTO u FROM dms.admission_tenant_usage WHERE tenant_id=d.tenant_id FOR UPDATE;
 SELECT * INTO au FROM dms.admission_application_usage WHERE tenant_id=d.tenant_id AND application_id=d.application_id FOR UPDATE;
 SELECT * INTO a FROM dms.upload_admission WHERE document_id=d.id AND version_id=version_target;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','VERSION_NOT_FOUND'); END IF;
 PERFORM id FROM dms.upload_session WHERE id=a.id FOR UPDATE;
 SELECT * INTO a FROM dms.upload_admission WHERE id=a.id FOR UPDATE;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dms-original:'||d.tenant_id::text||':'||d.id::text,0));
 SELECT * INTO d FROM dms.document WHERE id=target;
 SELECT * INTO v FROM dms.document_version WHERE id=version_target AND document_id=d.id;
 SELECT * INTO c FROM dms.security_candidate WHERE upload_id=a.id;
 IF d.lifecycle<>'ACTIVE' OR v.availability<>'AVAILABLE' OR v.lifecycle_generation<>d.lifecycle_generation OR c.state<>'PASSED' OR c.sha256 IS NULL OR c.evidence IS NULL OR c.assessed_at IS NULL THEN RETURN jsonb_build_object('error','DOCUMENT_UNAVAILABLE'); END IF;
 stamp=clock_timestamp(); digest=encode(sha256(convert_to(operation_key,'UTF8')),'hex');
 SELECT * INTO prior FROM dms.processing_run WHERE tenant_id=d.tenant_id AND version_id=v.id AND actor_kind=who AND actor_id=actor AND key_hash=digest;
 IF FOUND THEN
  IF prior.profile<>requested_profile THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  IF prior.expires_at<=stamp THEN RETURN jsonb_build_object('error','REPLAY_WINDOW_EXPIRED'); END IF;
  RETURN jsonb_build_object('id',prior.id,'replay',true);
 END IF;
 SELECT settings INTO p FROM dms.admission_policy WHERE tenant_id=d.tenant_id;
 IF p IS NULL OR NOT(p->>'enabled')::boolean OR NOT(p->'profiles' ? requested_profile) OR NOT(p->'contentTypes' ? v.content_type) OR v.size>(p->>'maxFileBytes')::bigint OR (requested_profile='structured' AND v.content_type NOT IN('application/pdf','image/jpeg','image/png','image/tiff','image/bmp','image/webp')) THEN RETURN jsonb_build_object('error','POLICY_DENIED'); END IF;
 IF EXISTS(SELECT 1 FROM dms.work_job WHERE upload_id=a.id AND state IN('QUEUED','RUNNING','RETRY_WAIT')) OR NOT a.work_released THEN RETURN jsonb_build_object('error','PROCESSING_IN_PROGRESS'); END IF;
 SELECT * INTO cap FROM dms.admission_capacity WHERE tenant_id=d.tenant_id;
 IF u.tenant_id IS NULL OR au.application_id IS NULL OR cap.observed_at IS NULL OR cap.observed_at>stamp OR cap.observed_at<=stamp-interval '30 seconds' THEN RETURN jsonb_build_object('error','CAPACITY_UNAVAILABLE'); END IF;
 scratch=268435456;
 IF u.queued>=(p->>'queuedWork')::integer OR au.queued>=least(25,(p->>'queuedWork')::integer) OR u.reserved_scratch+scratch>(p->>'scratchBudgetBytes')::bigint OR u.reserved_scratch+scratch>cap.scratch_free_bytes OR u.reserved_storage+u.staging_bytes+u.original_bytes+u.artifact_bytes>(p->>'storageBudgetBytes')::bigint OR au.reserved_storage+au.staging_bytes+au.original_bytes+au.artifact_bytes>(p->>'applicationBudgetBytes')::bigint OR (cap.shared_device AND u.reserved_storage+greatest(0,u.staging_bytes+u.original_bytes+u.artifact_bytes-cap.used_at_observation)+u.reserved_scratch+scratch>least(cap.storage_free_bytes,cap.scratch_free_bytes)) THEN RETURN jsonb_build_object('error','CAPACITY_EXCEEDED'); END IF;
 SELECT coalesce(max(number),0)+1 INTO n FROM dms.processing_run WHERE version_id=v.id;
 IF n>=2147483647 THEN RETURN jsonb_build_object('error','CAPACITY_EXCEEDED'); END IF;
 INSERT INTO dms.processing_run(id,tenant_id,application_id,document_id,version_id,upload_id,number,lifecycle_generation,profile,source_sha256,actor_kind,actor_id,key_hash,request_hash,expires_at) VALUES(operation_id,d.tenant_id,d.application_id,d.id,v.id,a.id,n,d.lifecycle_generation,requested_profile,c.sha256,who,actor,digest,encode(sha256(convert_to(requested_profile,'UTF8')),'hex'),stamp+interval '24 hours');
 UPDATE dms.admission_tenant_usage SET queued=queued+1,reserved_scratch=reserved_scratch+scratch WHERE tenant_id=d.tenant_id;
 UPDATE dms.admission_application_usage SET queued=queued+1,reserved_scratch=reserved_scratch+scratch WHERE application_id=d.application_id;
 UPDATE dms.upload_admission SET work_released=false,reserved_scratch=scratch WHERE id=a.id;
 task=CASE WHEN requested_profile='structured' OR v.content_type LIKE 'image/%' THEN 'document.heavy' ELSE 'document.extract' END;
 job_id=gen_random_uuid();
 INSERT INTO dms.work_job(id,tenant_id,application_id,upload_id,task,lifecycle_generation,processing_run_id) VALUES(job_id,d.tenant_id,d.application_id,a.id,task,d.lifecycle_generation,operation_id);
 INSERT INTO dms.work_dispatch(id,tenant_id,job_id,generation,task) VALUES(gen_random_uuid(),d.tenant_id,job_id,1,task);
 job_id=gen_random_uuid();
 INSERT INTO dms.audit_event(id,tenant_id,application_id,document_id,resource_id,resource_type,action,actor_kind,actor_id,request_id) VALUES(job_id,d.tenant_id,d.application_id,d.id,d.id,'document','processing.requested',who,actor,request_id);
 INSERT INTO dms.outbox_intent(id,tenant_id,application_id,audit_id,kind) VALUES(gen_random_uuid(),d.tenant_id,d.application_id,job_id,'processing.requested');
 RETURN jsonb_build_object('id',operation_id,'replay',false);
END $$;
REVOKE ALL ON FUNCTION dms.request_processing(uuid,uuid,text,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dms.request_processing(uuid,uuid,text,text,uuid,uuid) TO thaarei_dms_runtime,thaarei_dms_operator;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION dms.extraction_status(target uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(r.state,CASE WHEN a.profile='secure-only' THEN 'NOT_SCHEDULED' WHEN s.upload_state IN('FAILED','CANCELLED','EXPIRED') THEN 'CANCELLED' ELSE 'WAITING_FOR_SECURITY' END)
 FROM dms.upload_admission a JOIN dms.document d ON d.id=a.document_id AND d.tenant_id=a.tenant_id JOIN dms.upload_session s ON s.id=a.id
 LEFT JOIN LATERAL(SELECT r.state FROM dms.processing_run r WHERE r.upload_id=a.id AND r.lifecycle_generation=d.lifecycle_generation ORDER BY r.number DESC LIMIT 1)r ON true
 WHERE a.id=target AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND d.lifecycle='ACTIVE' AND (dms.has_document_right(d.id,'READ') OR (current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=a.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL)))
$$;
--> statement-breakpoint
CREATE FUNCTION dms.accepted_processing_artifact(target uuid) RETURNS TABLE(manifest jsonb,object_id uuid,size bigint,sha256 text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT e.manifest,e.object_id,e.size,e.sha256 FROM dms.processing_run r JOIN dms.extraction_stage e ON e.id=r.accepted_stage_id AND e.tenant_id=r.tenant_id AND e.state='ACCEPTED'
 JOIN dms.document d ON d.id=r.document_id AND d.tenant_id=r.tenant_id JOIN dms.document_version v ON v.id=r.version_id AND v.document_id=d.id JOIN dms.security_candidate c ON c.upload_id=r.upload_id
 WHERE r.id=target AND r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND d.lifecycle='ACTIVE' AND v.lifecycle_generation=d.lifecycle_generation AND v.availability='AVAILABLE' AND c.state='PASSED' AND c.sha256=r.source_sha256 AND c.evidence IS NOT NULL AND c.assessed_at IS NOT NULL AND (dms.has_document_right(d.id,'READ') OR (session_user='thaarei_dms_operator' AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=r.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL)))
$$;
REVOKE ALL ON FUNCTION dms.accepted_processing_artifact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dms.accepted_processing_artifact(uuid) TO thaarei_dms_runtime,thaarei_dms_operator;
--> statement-breakpoint
CREATE FUNCTION dms.fence_processing_run() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user='thaarei_dms_migrator' THEN RETURN NEW; END IF;
 IF (NEW.id,NEW.tenant_id,NEW.application_id,NEW.document_id,NEW.version_id,NEW.upload_id,NEW.number,NEW.lifecycle_generation,NEW.profile,NEW.source_sha256,NEW.actor_kind,NEW.actor_id,NEW.key_hash,NEW.request_hash,NEW.expires_at,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.application_id,OLD.document_id,OLD.version_id,OLD.upload_id,OLD.number,OLD.lifecycle_generation,OLD.profile,OLD.source_sha256,OLD.actor_kind,OLD.actor_id,OLD.key_hash,OLD.request_hash,OLD.expires_at,OLD.created_at) OR (OLD.state NOT IN('QUEUED','RUNNING') AND (NEW.state,NEW.accepted_stage_id,NEW.completed_at) IS DISTINCT FROM (OLD.state,OLD.accepted_stage_id,OLD.completed_at)) THEN RAISE EXCEPTION 'Immutable processing result' USING ERRCODE='23514'; END IF;
 IF NEW.accepted_stage_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dms.extraction_stage e JOIN dms.work_job j ON j.id=e.job_id WHERE e.id=NEW.accepted_stage_id AND e.tenant_id=NEW.tenant_id AND e.state='ACCEPTED' AND j.processing_run_id=NEW.id AND e.manifest->>'runId'=NEW.id::text AND e.manifest->>'documentId'=NEW.document_id::text AND e.manifest->>'versionId'=NEW.version_id::text AND e.manifest->>'profile'=NEW.profile AND e.manifest->>'sourceSha256'=NEW.source_sha256 AND (e.manifest->>'lifecycleGeneration')::integer=NEW.lifecycle_generation) THEN RAISE EXCEPTION 'Unbound processing result' USING ERRCODE='23514'; END IF;
 IF NEW.active AND NOT OLD.active AND NOT EXISTS(SELECT 1 FROM dms.document d JOIN dms.document_version v ON v.document_id=d.id JOIN dms.security_candidate c ON c.upload_id=NEW.upload_id JOIN dms.application_registration a ON a.id=d.application_id WHERE d.id=NEW.document_id AND d.tenant_id=NEW.tenant_id AND d.lifecycle='ACTIVE' AND d.lifecycle_generation=NEW.lifecycle_generation AND v.id=NEW.version_id AND v.lifecycle_generation=d.lifecycle_generation AND v.availability='AVAILABLE' AND c.state='PASSED' AND c.sha256=NEW.source_sha256 AND a.status='active' AND NOT EXISTS(SELECT 1 FROM dms.processing_run newer WHERE newer.version_id=NEW.version_id AND newer.number>NEW.number)) THEN RAISE EXCEPTION 'Ineligible processing promotion' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION dms.fence_processing_run() FROM PUBLIC;
CREATE TRIGGER fence_processing_run BEFORE UPDATE ON dms.processing_run FOR EACH ROW EXECUTE FUNCTION dms.fence_processing_run();
