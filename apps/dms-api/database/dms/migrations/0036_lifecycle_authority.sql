ALTER TABLE dms.lifecycle_restore FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.lifecycle_receipt FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.security_assessment_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.lifecycle_restore,dms.lifecycle_receipt,dms.security_assessment_history FROM PUBLIC,thaarei_dms_runtime,thaarei_dms_operator,thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT ON dms.lifecycle_restore,dms.security_assessment_history TO thaarei_dms_runtime,thaarei_dms_operator,thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (state,failure_code,next_attempt_at) ON dms.lifecycle_restore TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT INSERT ON dms.security_assessment_history TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (lifecycle_generation) ON dms.document_version TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (lifecycle_generation,reassessment_until) ON dms.upload_admission TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (lifecycle_generation,budget_started_at,deadline) ON dms.work_job TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (expected_sha256) ON dms.security_candidate TO thaarei_dms_coordinator;
--> statement-breakpoint
UPDATE dms.security_candidate SET expected_sha256=sha256 WHERE evidence->>'outcome'='PASSED' AND sha256 IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION dms.controls_upload(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM dms.upload_admission a WHERE a.id=target AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND (a.application_id=nullif(current_setting('app.application_id',true),'')::uuid OR (a.reassessment_until IS NULL AND a.contributor_application_id=nullif(current_setting('app.application_id',true),'')::uuid)) AND dms.has_document_right(a.document_id,'ADD_VERSION')) $$;
--> statement-breakpoint
CREATE FUNCTION dms.change_document_lifecycle(target uuid, expected text, operation text, operation_key text, request_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d dms.document; p jsonb; stamp timestamptz; receipt dms.lifecycle_receipt; event_id uuid; who text; actor text; digest text;
BEGIN
 IF operation NOT IN ('delete','restore') OR expected !~ '^[1-9][0-9]{0,14}$' THEN RETURN 'INVALID_REQUEST'; END IF;
 who=current_setting('app.principal_kind',true); actor=current_setting('app.actor_id',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('dms-lifecycle:'||current_setting('app.tenant_id',true),0));
 PERFORM pg_advisory_xact_lock(hashtextextended('dms-original:'||current_setting('app.tenant_id',true)||':'||target::text,0));
 SELECT * INTO d FROM dms.document WHERE id=target AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid FOR UPDATE;
 IF NOT FOUND THEN RETURN 'DOCUMENT_NOT_FOUND'; END IF;
 IF NOT ((session_user='thaarei_dms_runtime' AND who='machine' AND d.application_id=nullif(current_setting('app.application_id',true),'')::uuid AND EXISTS(SELECT 1 FROM dms.application_registration r WHERE r.id=d.application_id AND r.tenant_id=d.tenant_id AND r.status='active' AND r.principal_kind='consumer' AND r.client_id=actor AND 'dms:documents:write'=ANY(r.scope_ceiling))) OR (session_user='thaarei_dms_operator' AND who='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=d.tenant_id AND oa.subject_id=actor AND oa.revoked_at IS NULL))) THEN RETURN 'DOCUMENT_NOT_FOUND'; END IF;
 stamp=clock_timestamp();
 IF operation='restore' THEN
  IF operation_key IS NULL OR operation_key !~ '^[A-Za-z0-9_-]{16,128}$' THEN RETURN 'INVALID_REQUEST'; END IF;
  digest=encode(sha256(convert_to(operation_key,'UTF8')),'hex');
  SELECT * INTO receipt FROM dms.lifecycle_receipt WHERE tenant_id=d.tenant_id AND document_id=d.id AND actor_kind=who AND actor_id=actor AND key_hash=digest;
  IF FOUND THEN
   IF receipt.expected_revision<>expected THEN RETURN 'IDEMPOTENCY_CONFLICT'; END IF;
   IF receipt.expires_at<=stamp THEN RETURN 'REPLAY_WINDOW_EXPIRED'; END IF;
   RETURN 'REPLAY';
  END IF;
 END IF;
 IF d.revision::text<>expected THEN RETURN 'REVISION_CONFLICT'; END IF;
 IF d.revision>=999999999999999 OR d.lifecycle_generation>=2147483646 THEN RETURN 'DOCUMENT_UNAVAILABLE'; END IF;
 IF operation='delete' THEN
  IF d.lifecycle<>'ACTIVE' THEN RETURN 'DOCUMENT_UNAVAILABLE'; END IF;
  UPDATE dms.document SET lifecycle='SOFT_DELETED',lifecycle_generation=lifecycle_generation+1,revision=revision+1,deleted_at=stamp,restore_deadline=stamp+interval '30 days',restored_at=NULL WHERE id=d.id;
  UPDATE dms.lifecycle_restore SET state='OBSOLETE' WHERE document_id=d.id AND state IN ('PENDING','SCANNING');
  UPDATE dms.upload_session SET upload_state='CANCELLED',discovery_token=NULL,discovery_until=NULL WHERE id IN(SELECT id FROM dms.upload_admission WHERE document_id=d.id) AND upload_state IN ('INITIATED','OBJECT_VERIFIED');
  UPDATE dms.work_attempt SET state='CANCELLED',finished_at=stamp WHERE job_id IN(SELECT j.id FROM dms.work_job j JOIN dms.upload_admission a ON a.id=j.upload_id WHERE a.document_id=d.id) AND state='RUNNING';
  UPDATE dms.work_dispatch SET state='OBSOLETE',delivery_hash=NULL,delivery_until=NULL WHERE job_id IN(SELECT j.id FROM dms.work_job j JOIN dms.upload_admission a ON a.id=j.upload_id WHERE a.document_id=d.id) AND state<>'OBSOLETE';
  UPDATE dms.work_job SET generation=generation+1,state=CASE WHEN state IN ('QUEUED','RUNNING','RETRY_WAIT') THEN 'CANCELLED' ELSE state END,current_attempt_id=NULL,recover_at=NULL,next_eligible_at=NULL,updated_at=stamp WHERE upload_id IN(SELECT id FROM dms.upload_admission WHERE document_id=d.id);
  UPDATE dms.document_version SET availability='UNAVAILABLE' WHERE document_id=d.id;
 ELSE
  IF d.lifecycle<>'SOFT_DELETED' THEN RETURN 'DOCUMENT_UNAVAILABLE'; END IF;
  IF d.restore_deadline IS NULL OR d.restore_deadline<=stamp THEN RETURN 'RESTORE_WINDOW_EXPIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM dms.application_registration WHERE id=d.application_id AND tenant_id=d.tenant_id AND status='active') THEN RETURN 'APPLICATION_DENIED'; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('dms-admission-policy:'||d.tenant_id::text,0));
  SELECT settings INTO p FROM dms.admission_policy WHERE tenant_id=d.tenant_id;
  IF p IS NULL OR NOT (p->>'enabled')::boolean THEN RETURN 'POLICY_DENIED'; END IF;
  UPDATE dms.document SET lifecycle='ACTIVE',lifecycle_generation=lifecycle_generation+1,revision=revision+1,restored_at=stamp WHERE id=d.id;
  INSERT INTO dms.lifecycle_restore(id,tenant_id,application_id,document_id,version_id,upload_id,generation)
   SELECT gen_random_uuid(),d.tenant_id,d.application_id,d.id,v.id,a.id,d.lifecycle_generation+1 FROM dms.document_version v JOIN dms.upload_admission a ON a.version_id=v.id JOIN dms.security_candidate c ON c.upload_id=a.id WHERE v.document_id=d.id AND c.expected_sha256 IS NOT NULL;
  INSERT INTO dms.lifecycle_receipt(id,tenant_id,application_id,document_id,actor_kind,actor_id,key_hash,expected_revision,expires_at) VALUES(gen_random_uuid(),d.tenant_id,d.application_id,d.id,who,actor,digest,expected,stamp+interval '24 hours');
 END IF;
 event_id=gen_random_uuid();
 INSERT INTO dms.audit_event(id,tenant_id,application_id,document_id,resource_id,resource_type,action,actor_kind,actor_id,request_id) VALUES(event_id,d.tenant_id,d.application_id,d.id,d.id,'document',CASE WHEN operation='delete' THEN 'document.soft-deleted' ELSE 'document.logical-restored' END,who,actor,request_id);
 INSERT INTO dms.outbox_intent(id,tenant_id,application_id,audit_id,kind) VALUES(gen_random_uuid(),d.tenant_id,d.application_id,event_id,CASE WHEN operation='delete' THEN 'document.soft-deleted' ELSE 'document.logical-restored' END);
 RETURN 'CHANGED';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.change_document_lifecycle(uuid,text,text,text,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.change_document_lifecycle(uuid,text,text,text,uuid) TO thaarei_dms_runtime,thaarei_dms_operator;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION dms.protect_security_candidate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user='thaarei_dms_migrator' THEN RETURN NEW; END IF;
 IF current_user='thaarei_dms_coordinator' AND NEW.state='PENDING' AND OLD.expected_sha256 IS NOT NULL AND NEW.expected_sha256=OLD.expected_sha256 AND NEW.sha256 IS NULL AND NEW.evidence IS NULL AND NEW.assessed_at IS NULL AND NEW.invalidation_generation=OLD.invalidation_generation+1 AND
 (NEW.id,NEW.tenant_id,NEW.application_id,NEW.upload_id,NEW.object_id,NEW.size,NEW.etag,NEW.created_at) IS NOT DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.application_id,OLD.upload_id,OLD.object_id,OLD.size,OLD.etag,OLD.created_at) AND
 EXISTS(SELECT 1 FROM dms.security_assessment_history h WHERE h.candidate_id=OLD.id AND h.generation=OLD.invalidation_generation AND (h.state,h.sha256,h.evidence,h.assessed_at) IS NOT DISTINCT FROM (OLD.state,OLD.sha256,OLD.evidence,OLD.assessed_at)) AND
 EXISTS(SELECT 1 FROM dms.lifecycle_restore q JOIN dms.document d ON d.id=q.document_id JOIN dms.upload_admission a ON a.id=q.upload_id WHERE q.upload_id=OLD.upload_id AND q.state='PENDING' AND q.generation=d.lifecycle_generation AND d.lifecycle='ACTIVE' AND a.lifecycle_generation<>d.lifecycle_generation) THEN RETURN NEW; END IF;
 IF (NEW.id,NEW.tenant_id,NEW.application_id,NEW.upload_id,NEW.object_id,NEW.size,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.application_id,OLD.upload_id,OLD.object_id,OLD.size,OLD.created_at) OR
 (OLD.state<>'COPYING' AND NEW.etag IS DISTINCT FROM OLD.etag) OR
 (NEW.expected_sha256 IS DISTINCT FROM OLD.expected_sha256 AND NOT(OLD.expected_sha256 IS NULL AND OLD.state='PENDING' AND NEW.state='PASSED' AND NEW.expected_sha256=NEW.sha256 AND NEW.evidence->>'outcome'='PASSED')) OR
 (OLD.state NOT IN ('COPYING','PENDING') AND (NEW.sha256,NEW.evidence,NEW.assessed_at) IS DISTINCT FROM (OLD.sha256,OLD.evidence,OLD.assessed_at)) OR
 (NEW.invalidation_generation<>OLD.invalidation_generation AND NOT ((NEW.state='INVALIDATED' OR (OLD.state='PENDING' AND NEW.state IN ('REJECTED','INCONCLUSIVE'))) AND NEW.invalidation_generation=OLD.invalidation_generation+1)) OR
 NOT (NEW.state=OLD.state OR (OLD.state='COPYING' AND NEW.state IN ('PENDING','INCONCLUSIVE','INVALIDATED')) OR (OLD.state='PENDING' AND NEW.state IN ('PASSED','REJECTED','INCONCLUSIVE','INVALIDATED')) OR (OLD.state IN ('PASSED','REJECTED','INCONCLUSIVE') AND NEW.state='INVALIDATED')) THEN RAISE EXCEPTION 'Immutable security candidate' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
GRANT UPDATE (completion_requested_at) ON dms.upload_session TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT (reassessment_until) ON dms.upload_admission TO thaarei_dms_operator;
