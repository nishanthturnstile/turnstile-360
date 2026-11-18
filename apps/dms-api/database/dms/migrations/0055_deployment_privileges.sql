ALTER TABLE dms.deployment_control FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dms.deployment_control FROM PUBLIC;
GRANT SELECT ON dms.deployment_control TO thaarei_dms_runtime,thaarei_dms_coordinator,thaarei_dms_operator;
GRANT INSERT (tenant_id) ON dms.deployment_control TO thaarei_dms_coordinator;
GRANT UPDATE (binding,decision,marker_digest,quarantined,credential_metadata) ON dms.deployment_control TO thaarei_dms_coordinator;
DO $$ DECLARE tid uuid; BEGIN
 SELECT tenant_id INTO tid FROM dms.installation WHERE singleton=1;
 IF tid IS NOT NULL THEN
  PERFORM set_config('app.tenant_id',tid::text,true);
  INSERT INTO dms.deployment_control(tenant_id) VALUES(tid) ON CONFLICT DO NOTHING;
 END IF;
END $$;
CREATE FUNCTION dms.deployment_clock() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,dms AS $$
DECLARE tid uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; r dms.deployment_control; stamp bigint:=floor(extract(epoch FROM clock_timestamp()));
BEGIN
 SELECT * INTO r FROM dms.deployment_control WHERE tenant_id=tid FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF r.decision IS NOT NULL THEN
  UPDATE dms.deployment_control SET quarantined=quarantined OR stamp<(decision->>'lastTime')::bigint,
   decision=jsonb_set(decision,'{lastTime}',to_jsonb(greatest(stamp,(decision->>'lastTime')::bigint)))
   WHERE tenant_id=tid RETURNING * INTO r;
 END IF;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION dms.deployment_quarantine() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,dms AS $$
 UPDATE dms.deployment_control SET quarantined=true WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid;
$$;
REVOKE ALL ON FUNCTION dms.deployment_clock(),dms.deployment_quarantine() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dms.deployment_clock(),dms.deployment_quarantine() TO thaarei_dms_runtime,thaarei_dms_coordinator;
-- Row-share locking requires UPDATE privilege. Keep runtime read-only and expose only
-- a tenant-bound security-definer lock/read, rather than granting a mutable decision column.
CREATE FUNCTION dms.deployment_read() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,dms AS $$
DECLARE r dms.deployment_control;
BEGIN
 SELECT * INTO r FROM dms.deployment_control WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION dms.deployment_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dms.deployment_read() TO thaarei_dms_runtime,thaarei_dms_coordinator,thaarei_dms_operator;
