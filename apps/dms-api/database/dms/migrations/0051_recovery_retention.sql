-- Referenced version/security/artifact rows and disposal tombstones are never pruned.
-- Failed/unsupported work remains available for diagnosis; no implicit acknowledgement.
CREATE OR REPLACE FUNCTION dms.prune_work_history() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid uuid=nullif(current_setting('app.tenant_id',true),'')::uuid; ids uuid[]; events integer; jobs integer; receipts integer=0; n integer; attempts integer; batches integer; audit integer; keys integer;
BEGIN
 IF session_user<>'thaarei_dms_operator' OR NOT dms.recovery_open() OR NOT EXISTS(SELECT 1 FROM dms.operator_authorization WHERE tenant_id=tid AND subject_id=current_setting('app.actor_id',true) AND revoked_at IS NULL) THEN RAISE insufficient_privilege; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('dms-lifecycle:'||tid,0));
 SELECT array_agg(id) INTO ids FROM (SELECT j.id FROM dms.work_job j WHERE j.tenant_id=tid AND j.state IN('SUCCEEDED','CANCELLED') AND j.updated_at<clock_timestamp()-interval '90 days' AND j.processing_run_id IS NULL AND NOT EXISTS(SELECT 1 FROM dms.extraction_stage e WHERE e.job_id=j.id) AND NOT EXISTS(SELECT 1 FROM dms.security_candidate c WHERE c.upload_id=j.upload_id) ORDER BY j.id LIMIT 100 FOR UPDATE SKIP LOCKED) t;
 DELETE FROM dms.work_attempt WHERE job_id=ANY(ids); DELETE FROM dms.work_dispatch WHERE job_id=ANY(ids); DELETE FROM dms.work_job WHERE id=ANY(ids); GET DIAGNOSTICS jobs=ROW_COUNT;
 DELETE FROM dms.work_dispatch x WHERE x.id IN(SELECT d.id FROM dms.work_dispatch d JOIN dms.work_job j ON j.id=d.job_id WHERE d.tenant_id=tid AND j.state IN('SUCCEEDED','FAILED','UNSUPPORTED','CANCELLED') AND d.created_at<clock_timestamp()-interval '7 days' ORDER BY d.created_at,d.id LIMIT 100);
 DELETE FROM dms.work_attempt a WHERE a.id IN(SELECT x.id FROM dms.work_attempt x JOIN dms.work_job j ON j.id=x.job_id WHERE x.tenant_id=tid AND x.state='SUCCEEDED' AND j.state='SUCCEEDED' AND x.finished_at<clock_timestamp()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM dms.extraction_stage e WHERE e.attempt_id=x.id) AND NOT EXISTS(SELECT 1 FROM dms.security_candidate c WHERE c.upload_id=j.upload_id) ORDER BY x.finished_at,x.id LIMIT 100); GET DIAGNOSTICS attempts=ROW_COUNT;
 DELETE FROM dms.upload_receipt WHERE id IN(SELECT id FROM dms.upload_receipt WHERE tenant_id=tid AND expires_at<clock_timestamp()-interval '1 day' ORDER BY expires_at,id LIMIT 100); GET DIAGNOSTICS n=ROW_COUNT; receipts=receipts+n;
 DELETE FROM dms.lifecycle_receipt WHERE id IN(SELECT id FROM dms.lifecycle_receipt WHERE tenant_id=tid AND expires_at<clock_timestamp()-interval '1 day' ORDER BY expires_at,id LIMIT 100); GET DIAGNOSTICS n=ROW_COUNT; receipts=receipts+n;
 DELETE FROM dms.enrollment_receipt WHERE id IN(SELECT id FROM dms.enrollment_receipt WHERE tenant_id=tid AND expires_at<clock_timestamp()-interval '1 day' ORDER BY expires_at,id LIMIT 100); GET DIAGNOSTICS n=ROW_COUNT; receipts=receipts+n;
 DELETE FROM dms.enrollment_key k WHERE k.id IN(SELECT e.id FROM dms.enrollment_key e WHERE e.tenant_id=tid AND e.expires_at<clock_timestamp()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM dms.enrollment_receipt r WHERE r.enrollment_key_id=e.id) ORDER BY e.expires_at,e.id LIMIT 100); GET DIAGNOSTICS keys=ROW_COUNT;
 -- Audit/outbox entries are identifier-only history, not authoritative dispatch.
 -- Retain disposal events while their physical decision is incomplete.
 SELECT array_agg(id) INTO ids FROM (SELECT a.id FROM dms.audit_event a WHERE a.tenant_id=tid AND a.created_at<clock_timestamp()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM dms.disposal_intent i WHERE i.tenant_id=tid AND i.application_id=a.application_id AND i.state<>'COMPLETE') ORDER BY a.created_at,a.id LIMIT 1000) old;
 DELETE FROM dms.outbox_intent WHERE tenant_id=tid AND audit_id=ANY(ids);
 DELETE FROM dms.audit_event WHERE tenant_id=tid AND id=ANY(ids); GET DIAGNOSTICS audit=ROW_COUNT;
 -- Batch bindings still referenced by a session/audit/receipt remain provenance.
 SELECT array_agg(id) INTO ids FROM (SELECT b.id FROM dms.upload_batch b WHERE b.tenant_id=tid AND b.state IN('CLOSED','CANCELLED','EXPIRED') AND b.expires_at<clock_timestamp()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM dms.upload_session s WHERE s.batch_id=b.id) AND NOT EXISTS(SELECT 1 FROM dms.upload_receipt r WHERE r.batch_id=b.id) AND NOT EXISTS(SELECT 1 FROM dms.audit_event a WHERE a.batch_id=b.id) ORDER BY b.expires_at,b.id LIMIT 20 FOR UPDATE SKIP LOCKED) old;
 DELETE FROM dms.upload_batch_slot WHERE id=ANY(ids); DELETE FROM dms.upload_batch_item WHERE batch_id=ANY(ids); DELETE FROM dms.upload_batch WHERE id=ANY(ids); GET DIAGNOSTICS batches=ROW_COUNT;
 DELETE FROM dms.security_event WHERE id IN(SELECT id FROM dms.security_event WHERE tenant_id=tid AND created_at<clock_timestamp()-interval '90 days' ORDER BY created_at,id LIMIT 1000); GET DIAGNOSTICS events=ROW_COUNT;
 RETURN jsonb_build_object('jobs',jobs,'securityEvents',events,'successfulAttempts',attempts,'receipts',receipts,'batches',batches,'auditEvents',audit,'enrollmentKeys',keys);
END $$;
