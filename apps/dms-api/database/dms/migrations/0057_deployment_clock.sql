ALTER TABLE dms.deployment_clock_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dms.deployment_clock_state FROM PUBLIC;
GRANT SELECT ON dms.deployment_clock_state TO thaarei_dms_runtime,thaarei_dms_coordinator;
GRANT INSERT (tenant_id), UPDATE (last_time,quarantined) ON dms.deployment_clock_state TO thaarei_dms_coordinator;
CREATE OR REPLACE FUNCTION dms.deployment_clock() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,dms AS $$
DECLARE tid uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; r dms.deployment_control; c dms.deployment_clock_state; stamp bigint:=floor(extract(epoch FROM clock_timestamp()));
BEGIN
 INSERT INTO dms.deployment_clock_state(tenant_id) VALUES(tid) ON CONFLICT DO NOTHING;
 UPDATE dms.deployment_clock_state SET quarantined=quarantined OR stamp<last_time,last_time=greatest(stamp,last_time) WHERE tenant_id=tid RETURNING * INTO c;
 SELECT * INTO r FROM dms.deployment_control WHERE tenant_id=tid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN to_jsonb(r)||jsonb_build_object('quarantined',r.quarantined OR c.quarantined,'decision',CASE WHEN r.decision IS NULL THEN NULL ELSE jsonb_set(r.decision,'{lastTime}',to_jsonb(greatest(c.last_time,(r.decision->>'lastTime')::bigint))) END);
END $$;
CREATE OR REPLACE FUNCTION dms.deployment_quarantine() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,dms AS $$
 INSERT INTO dms.deployment_clock_state(tenant_id,quarantined) VALUES(nullif(current_setting('app.tenant_id',true),'')::uuid,true) ON CONFLICT(tenant_id) DO UPDATE SET quarantined=true;
$$;
CREATE OR REPLACE FUNCTION dms.deployment_read() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,dms AS $$
DECLARE r dms.deployment_control; c dms.deployment_clock_state;
BEGIN
 SELECT * INTO r FROM dms.deployment_control WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO c FROM dms.deployment_clock_state WHERE tenant_id=r.tenant_id;
 RETURN to_jsonb(r)||jsonb_build_object('quarantined',r.quarantined OR coalesce(c.quarantined,false),'decision',CASE WHEN r.decision IS NULL THEN NULL ELSE jsonb_set(r.decision,'{lastTime}',to_jsonb(greatest(coalesce(c.last_time,0),(r.decision->>'lastTime')::bigint))) END);
END $$;

GRANT EXECUTE ON FUNCTION dms.deployment_clock(),dms.deployment_quarantine() TO thaarei_dms_operator;
