ALTER TABLE dms.recovery_state FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.backup_catalog FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.disposal_intent FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.recovery_state,dms.backup_catalog,dms.disposal_intent FROM PUBLIC,thaarei_dms_runtime,thaarei_dms_operator,thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT ON dms.recovery_state TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT SELECT ON dms.recovery_state,dms.backup_catalog,dms.disposal_intent TO thaarei_dms_operator,thaarei_dms_coordinator;
--> statement-breakpoint
CREATE FUNCTION dms.recovery_open() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid; previous text; result boolean;
BEGIN
 SELECT tenant_id INTO t FROM dms.installation WHERE singleton=1;
 previous=current_setting('app.tenant_id',true);
 IF t IS NULL OR (coalesce(previous,'')<>'' AND previous<>t::text) THEN RETURN false; END IF;
 PERFORM set_config('app.tenant_id',t::text,true);
 SELECT NOT EXISTS(SELECT 1 FROM dms.recovery_state WHERE tenant_id=t AND state='CLOSED') INTO result;
 PERFORM set_config('app.tenant_id',coalesce(previous,''),true);
 RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.recovery_open() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.recovery_open() TO thaarei_dms_runtime,thaarei_dms_coordinator,thaarei_dms_operator;
--> statement-breakpoint
CREATE FUNCTION dms.disposal_horizon(deadline timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT deadline IS NOT NULL AND deadline+interval '9 days'<=clock_timestamp()
 AND EXISTS(SELECT 1 FROM dms.backup_catalog b WHERE b.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND b.confirmed_off_host AND b.expires_at>clock_timestamp() AND b.recovery_point>=clock_timestamp()-interval '1 day')
 AND NOT EXISTS(SELECT 1 FROM dms.backup_catalog b WHERE b.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND b.expires_at>clock_timestamp() AND b.recovery_point<=deadline)
$$;
--> statement-breakpoint
CREATE FUNCTION dms.disposal_eligible(area text,app uuid,obj uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid=nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF area='staging' THEN
  RETURN EXISTS(SELECT 1 FROM dms.upload_session s JOIN dms.upload_admission a ON a.id=s.id WHERE s.tenant_id=t AND s.application_id=app AND s.staging_id=obj AND a.storage_mode='UPLOAD' AND s.upload_state IN ('COMPLETED','FAILED','CANCELLED','EXPIRED') AND a.state<>'RESERVED' AND greatest(a.expires_at,coalesce(a.capability_expires_at,a.expires_at))+interval '1 day 60 seconds'<clock_timestamp()
  AND NOT EXISTS(SELECT 1 FROM dms.work_job j WHERE j.upload_id=a.id AND j.state IN ('QUEUED','RUNNING','RETRY_WAIT')));
 ELSIF area='originals' THEN
  RETURN EXISTS(SELECT 1 FROM dms.security_candidate c WHERE c.tenant_id=t AND c.application_id=app AND c.object_id=obj)
   AND NOT EXISTS(SELECT 1 FROM dms.security_candidate c JOIN dms.upload_admission a ON a.id=c.upload_id JOIN dms.document d ON d.id=a.document_id WHERE c.tenant_id=t AND c.application_id=app AND c.object_id=obj AND (d.lifecycle NOT IN ('PURGING','PURGED') OR NOT dms.disposal_horizon(d.restore_deadline)))
   AND NOT EXISTS(SELECT 1 FROM dms.binary_restore r JOIN dms.security_candidate c ON c.id=r.source_candidate_id JOIN dms.upload_admission a ON a.id=r.id JOIN dms.document d ON d.id=a.document_id WHERE r.tenant_id=t AND r.application_id=app AND c.object_id=obj AND (d.lifecycle NOT IN ('PURGING','PURGED') OR NOT dms.disposal_horizon(d.restore_deadline)));
 ELSIF area='artifacts' THEN
  RETURN EXISTS(SELECT 1 FROM dms.extraction_stage e JOIN dms.work_job j ON j.id=e.job_id JOIN dms.upload_admission a ON a.id=j.upload_id JOIN dms.document d ON d.id=a.document_id WHERE e.tenant_id=t AND j.application_id=app AND e.object_id=obj
   AND e.capability_expires_at+interval '1 day 60 seconds'<clock_timestamp() AND j.state NOT IN ('QUEUED','RUNNING','RETRY_WAIT')
   AND (e.state='ISSUED' OR (d.lifecycle IN ('PURGING','PURGED') AND dms.disposal_horizon(d.restore_deadline))))
  AND NOT EXISTS(SELECT 1 FROM dms.extraction_stage e JOIN dms.work_job j ON j.id=e.job_id JOIN dms.upload_admission a ON a.id=j.upload_id JOIN dms.document d ON d.id=a.document_id WHERE e.tenant_id=t AND j.application_id=app AND e.object_id=obj AND (j.state IN ('QUEUED','RUNNING','RETRY_WAIT') OR e.capability_expires_at+interval '1 day 60 seconds'>=clock_timestamp() OR (e.state='ACCEPTED' AND (d.lifecycle NOT IN ('PURGING','PURGED') OR NOT dms.disposal_horizon(d.restore_deadline)))));
 END IF;
 RETURN false;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.disposal_horizon(timestamptz),dms.disposal_eligible(text,uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.disposal_eligible(text,uuid,uuid) TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE FUNCTION dms.request_disposal(target uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid=nullif(current_setting('app.tenant_id',true),'')::uuid; actor text=current_setting('app.actor_id',true); d dms.document; n integer=0; r record; event uuid;
BEGIN
 IF session_user<>'thaarei_dms_operator' OR NOT EXISTS(SELECT 1 FROM dms.operator_authorization WHERE tenant_id=t AND subject_id=actor AND revoked_at IS NULL) THEN RAISE insufficient_privilege; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('dms-lifecycle:'||t::text,0));
 IF NOT dms.recovery_open() THEN RAISE insufficient_privilege; END IF;
 IF target IS NOT NULL THEN
  SELECT * INTO d FROM dms.document WHERE id=target AND tenant_id=t FOR UPDATE;
  IF NOT FOUND OR d.lifecycle NOT IN ('SOFT_DELETED','PURGING','PURGED') OR NOT dms.disposal_horizon(d.restore_deadline) THEN RAISE EXCEPTION 'Disposal policy or recovery horizon blocks request'; END IF;
  IF d.lifecycle='SOFT_DELETED' THEN
   UPDATE dms.document SET lifecycle='PURGING',revision=revision+1 WHERE id=d.id;
   event=gen_random_uuid();
   INSERT INTO dms.audit_event(id,tenant_id,application_id,document_id,resource_id,resource_type,action,actor_kind,actor_id) VALUES(event,t,d.application_id,d.id,d.id,'document','disposal.requested','operator',actor);
   INSERT INTO dms.outbox_intent(id,tenant_id,application_id,audit_id,kind) VALUES(gen_random_uuid(),t,d.application_id,event,'disposal.requested');
  END IF;
 END IF;
 FOR r IN
  SELECT * FROM (
   SELECT 'staging'::text AS area,s.application_id,s.staging_id AS object_id FROM dms.upload_session s JOIN dms.upload_admission a ON a.id=s.id WHERE s.tenant_id=t AND a.storage_mode='UPLOAD' AND (target IS NULL OR a.document_id=target)
   UNION SELECT 'originals',c.application_id,c.object_id FROM dms.security_candidate c JOIN dms.upload_admission a ON a.id=c.upload_id WHERE c.tenant_id=t AND target IS NOT NULL AND a.document_id=target
   UNION SELECT 'artifacts',j.application_id,e.object_id FROM dms.extraction_stage e JOIN dms.work_job j ON j.id=e.job_id JOIN dms.upload_admission a ON a.id=j.upload_id WHERE e.tenant_id=t AND (target IS NULL OR a.document_id=target)
  ) refs WHERE dms.disposal_eligible(refs.area,refs.application_id,refs.object_id) AND NOT EXISTS(SELECT 1 FROM dms.disposal_intent i WHERE i.tenant_id=t AND i.application_id=refs.application_id AND i.area=refs.area AND i.object_id=refs.object_id)
  ORDER BY area,application_id,object_id LIMIT 100
 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('dms-object:'||t||':'||r.application_id||':'||r.area||':'||r.object_id,0));
  IF dms.disposal_eligible(r.area,r.application_id,r.object_id) THEN
   INSERT INTO dms.disposal_intent(id,tenant_id,application_id,area,object_id,requested_by) VALUES(gen_random_uuid(),t,r.application_id,r.area,r.object_id,actor) ON CONFLICT DO NOTHING;
   FOR d IN SELECT DISTINCT doc.* FROM dms.document doc JOIN dms.upload_admission a ON a.document_id=doc.id WHERE doc.tenant_id=t AND doc.application_id=r.application_id AND (
    (r.area='staging' AND EXISTS(SELECT 1 FROM dms.upload_session ss WHERE ss.id=a.id AND ss.staging_id=r.object_id)) OR
    (r.area='originals' AND EXISTS(SELECT 1 FROM dms.security_candidate cc WHERE cc.upload_id=a.id AND cc.object_id=r.object_id)) OR
    (r.area='artifacts' AND EXISTS(SELECT 1 FROM dms.work_job jj JOIN dms.extraction_stage ee ON ee.job_id=jj.id WHERE jj.upload_id=a.id AND ee.object_id=r.object_id)))
   LOOP
    event=gen_random_uuid();
    INSERT INTO dms.audit_event(id,tenant_id,application_id,document_id,resource_id,resource_type,action,actor_kind,actor_id) VALUES(event,t,r.application_id,d.id,d.id,'document','disposal.requested','operator',actor);
    INSERT INTO dms.outbox_intent(id,tenant_id,application_id,audit_id,kind) VALUES(gen_random_uuid(),t,r.application_id,event,'disposal.requested');
   END LOOP;
   n=n+1;
  END IF;
 END LOOP;
 RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.request_disposal(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.request_disposal(uuid) TO thaarei_dms_operator;
--> statement-breakpoint
CREATE FUNCTION dms.guard_disposed_reference() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE obj uuid; app uuid;
BEGIN
 IF TG_TABLE_NAME='security_candidate' THEN obj=NEW.object_id; app=NEW.application_id;
 ELSE SELECT object_id,application_id INTO obj,app FROM dms.security_candidate WHERE id=NEW.source_candidate_id AND tenant_id=NEW.tenant_id; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dms-object:'||NEW.tenant_id||':'||app||':originals:'||obj,0));
 IF EXISTS(SELECT 1 FROM dms.disposal_intent WHERE tenant_id=NEW.tenant_id AND application_id=app AND area='originals' AND object_id=obj) THEN RAISE EXCEPTION 'Object disposal has begun'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER disposed_candidate_reference BEFORE INSERT ON dms.security_candidate FOR EACH ROW EXECUTE FUNCTION dms.guard_disposed_reference();
--> statement-breakpoint
CREATE TRIGGER disposed_restore_reference BEFORE INSERT ON dms.binary_restore FOR EACH ROW EXECUTE FUNCTION dms.guard_disposed_reference();
--> statement-breakpoint
GRANT INSERT,UPDATE ON dms.disposal_intent TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE POLICY coordinator_write ON dms.disposal_intent FOR ALL TO thaarei_dms_coordinator USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
CREATE FUNCTION dms.finish_disposal(target uuid, lease uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i dms.disposal_intent; t uuid=nullif(current_setting('app.tenant_id',true),'')::uuid; staged bigint=0; original bigint=0; artifact bigint=0; reserved bigint=0; r record; event uuid;
BEGIN
 IF session_user<>'thaarei_dms_coordinator' OR NOT dms.recovery_open() THEN RAISE insufficient_privilege; END IF;
 SELECT * INTO i FROM dms.disposal_intent WHERE id=target AND tenant_id=t;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM dms.admission_tenant_usage WHERE tenant_id=t FOR UPDATE;
 PERFORM 1 FROM dms.admission_application_usage WHERE tenant_id=t AND application_id=i.application_id FOR UPDATE;
 SELECT * INTO i FROM dms.disposal_intent WHERE id=target AND tenant_id=t FOR UPDATE;
 IF i.state='COMPLETE' THEN RETURN true; END IF;
 IF i.state<>'DELETING' OR i.lease_id<>lease OR NOT dms.disposal_eligible(i.area,i.application_id,i.object_id) THEN RETURN false; END IF;
 IF i.area='staging' THEN
  SELECT coalesce(sum(a.staging_bytes),0) INTO staged FROM dms.upload_admission a JOIN dms.upload_session s ON s.id=a.id WHERE s.tenant_id=t AND s.application_id=i.application_id AND s.staging_id=i.object_id;
  UPDATE dms.upload_admission SET staging_bytes=0 WHERE tenant_id=t AND id IN(SELECT id FROM dms.upload_session WHERE tenant_id=t AND application_id=i.application_id AND staging_id=i.object_id);
 ELSIF i.area='originals' THEN
  SELECT coalesce(sum(a.original_bytes),0) INTO original FROM dms.upload_admission a JOIN dms.security_candidate c ON c.upload_id=a.id WHERE c.tenant_id=t AND c.application_id=i.application_id AND c.object_id=i.object_id;
  UPDATE dms.upload_admission SET original_bytes=0 WHERE tenant_id=t AND id IN(SELECT upload_id FROM dms.security_candidate WHERE tenant_id=t AND application_id=i.application_id AND object_id=i.object_id);
 ELSE
  SELECT coalesce(sum(e.size) FILTER(WHERE e.state='ACCEPTED'),0),coalesce(sum(e.size) FILTER(WHERE e.state='ISSUED'),0) INTO artifact,reserved FROM dms.extraction_stage e JOIN dms.work_job j ON j.id=e.job_id WHERE e.tenant_id=t AND j.application_id=i.application_id AND e.object_id=i.object_id;
 END IF;
 UPDATE dms.admission_tenant_usage SET staging_bytes=staging_bytes-staged,original_bytes=original_bytes-original,artifact_bytes=artifact_bytes-artifact,reserved_storage=reserved_storage-reserved WHERE tenant_id=t;
 UPDATE dms.admission_application_usage SET staging_bytes=staging_bytes-staged,original_bytes=original_bytes-original,artifact_bytes=artifact_bytes-artifact,reserved_storage=reserved_storage-reserved WHERE tenant_id=t AND application_id=i.application_id;
 UPDATE dms.disposal_intent SET state='COMPLETE',completed_at=clock_timestamp(),lease_until=NULL WHERE id=i.id;
 FOR r IN SELECT DISTINCT a.document_id FROM dms.upload_admission a WHERE a.tenant_id=t AND a.application_id=i.application_id AND (
 (i.area='staging' AND EXISTS(SELECT 1 FROM dms.upload_session s WHERE s.id=a.id AND s.staging_id=i.object_id)) OR
 (i.area='originals' AND EXISTS(SELECT 1 FROM dms.security_candidate c WHERE c.upload_id=a.id AND c.object_id=i.object_id)) OR
 (i.area='artifacts' AND EXISTS(SELECT 1 FROM dms.work_job j JOIN dms.extraction_stage e ON e.job_id=j.id WHERE j.upload_id=a.id AND e.object_id=i.object_id))) LOOP
  event=gen_random_uuid();
  INSERT INTO dms.audit_event(id,tenant_id,application_id,document_id,resource_id,resource_type,action,actor_kind,actor_id) VALUES(event,t,i.application_id,r.document_id,r.document_id,'document','disposal.completed','coordinator','thaarei_dms_coordinator');
  INSERT INTO dms.outbox_intent(id,tenant_id,application_id,audit_id,kind) VALUES(gen_random_uuid(),t,i.application_id,event,'disposal.completed');
 END LOOP;
 RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.finish_disposal(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.finish_disposal(uuid,uuid) TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE FUNCTION dms.complete_purged_documents() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid=nullif(current_setting('app.tenant_id',true),'')::uuid; d record; n integer=0; event uuid;
BEGIN
 IF session_user<>'thaarei_dms_coordinator' OR NOT dms.recovery_open() THEN RAISE insufficient_privilege; END IF;
 FOR d IN SELECT id,application_id FROM dms.document x WHERE x.tenant_id=t AND x.lifecycle='PURGING'
 AND NOT EXISTS(SELECT 1 FROM (
  SELECT 'staging'::text area,s.staging_id obj FROM dms.upload_admission a JOIN dms.upload_session s ON s.id=a.id WHERE a.document_id=x.id AND a.storage_mode='UPLOAD'
  UNION SELECT 'originals',c.object_id FROM dms.upload_admission a JOIN dms.security_candidate c ON c.upload_id=a.id WHERE a.document_id=x.id
  UNION SELECT 'artifacts',e.object_id FROM dms.upload_admission a JOIN dms.work_job j ON j.upload_id=a.id JOIN dms.extraction_stage e ON e.job_id=j.id WHERE a.document_id=x.id
 ) refs WHERE NOT EXISTS(SELECT 1 FROM dms.disposal_intent i WHERE i.tenant_id=t AND i.application_id=x.application_id AND i.area=refs.area AND i.object_id=refs.obj AND i.state='COMPLETE')) ORDER BY id LIMIT 20 FOR UPDATE LOOP
  UPDATE dms.document SET lifecycle='PURGED',revision=revision+1 WHERE id=d.id;
  DELETE FROM dms.search_chunk WHERE stage_id IN(SELECT g.stage_id FROM dms.search_generation g JOIN dms.extraction_stage e ON e.id=g.stage_id JOIN dms.work_job j ON j.id=e.job_id JOIN dms.upload_admission a ON a.id=j.upload_id WHERE a.document_id=d.id);
  event=gen_random_uuid();
  INSERT INTO dms.audit_event(id,tenant_id,application_id,document_id,resource_id,resource_type,action,actor_kind,actor_id) VALUES(event,t,d.application_id,d.id,d.id,'document','document.purged','coordinator','thaarei_dms_coordinator');
  INSERT INTO dms.outbox_intent(id,tenant_id,application_id,audit_id,kind) VALUES(gen_random_uuid(),t,d.application_id,event,'document.purged');
  n=n+1;
 END LOOP;
 RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.complete_purged_documents() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.complete_purged_documents() TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT INSERT,UPDATE ON dms.backup_catalog TO thaarei_dms_operator;
--> statement-breakpoint
CREATE POLICY operator_backup_write ON dms.backup_catalog FOR ALL TO thaarei_dms_operator USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=backup_catalog.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL)) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=backup_catalog.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL));
--> statement-breakpoint
CREATE POLICY operator_recovery_evidence ON dms.security_event FOR INSERT TO thaarei_dms_operator WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND actor_kind='operator' AND actor_id=current_setting('app.actor_id',true) AND action IN ('backup.authorize','backup.register','backup.inspect','recovery.open','disposal.request','disposal.inspect') AND outcome='success' AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=security_event.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL));
--> statement-breakpoint
CREATE FUNCTION dms.protect_backup_catalog() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('dms-lifecycle:'||NEW.tenant_id::text,0));
 IF dms.recovery_open() AND (TG_OP='INSERT' OR NEW.expires_at>OLD.expires_at) AND EXISTS(SELECT 1 FROM dms.document WHERE tenant_id=NEW.tenant_id AND lifecycle IN ('PURGING','PURGED') AND restore_deadline>=NEW.recovery_point) THEN RAISE EXCEPTION 'A recovery horizon cannot cross an existing disposal decision'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.tenant_id,NEW.recovery_point,NEW.repository_id) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.recovery_point,OLD.repository_id) OR NEW.expires_at<OLD.expires_at OR (OLD.manifest_sha256 IS NOT NULL AND (NEW.manifest_sha256,NEW.confirmed_off_host,NEW.bytes,NEW.verified_at) IS DISTINCT FROM (OLD.manifest_sha256,OLD.confirmed_off_host,OLD.bytes,OLD.verified_at))) THEN RAISE EXCEPTION 'Backup identity is immutable; pending proof can be sealed once and retention cannot be shortened'; END IF;
 IF NEW.recovery_point>clock_timestamp()+interval '60 seconds' THEN RAISE EXCEPTION 'Future recovery point'; END IF;
 RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER backup_catalog_immutable BEFORE INSERT OR UPDATE ON dms.backup_catalog FOR EACH ROW EXECUTE FUNCTION dms.protect_backup_catalog();
--> statement-breakpoint
CREATE FUNCTION dms.open_recovery(target uuid, digest text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t uuid=nullif(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
 IF session_user<>'thaarei_dms_operator' OR NOT EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=t AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL) THEN RAISE insufficient_privilege; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('dms-lifecycle:'||t,0));
 UPDATE dms.recovery_state SET state='OPEN',opened_at=clock_timestamp() WHERE tenant_id=t AND backup_id=target AND manifest_sha256=digest AND verified_at IS NOT NULL;
 RETURN FOUND;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.open_recovery(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.open_recovery(uuid,text) TO thaarei_dms_operator;
