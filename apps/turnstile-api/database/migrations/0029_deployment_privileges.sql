GRANT USAGE ON SCHEMA turnstile TO thaarei_turnstile_reporter;
GRANT SELECT ON turnstile.installation TO thaarei_turnstile_reporter;
ALTER TABLE turnstile.deployment_control FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.deployment_control FROM PUBLIC;
GRANT SELECT ON turnstile.deployment_control TO thaarei_turnstile_runtime,thaarei_turnstile_reporter;
GRANT UPDATE (binding,decision,marker_digest,quarantined,credential_metadata) ON turnstile.deployment_control TO thaarei_turnstile_reporter;
CREATE FUNCTION turnstile.deployment_clock() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,turnstile AS $$
DECLARE tid uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; r turnstile.deployment_control; stamp bigint:=floor(extract(epoch FROM clock_timestamp()));
BEGIN
 SELECT * INTO r FROM turnstile.deployment_control WHERE tenant_id=tid FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF r.decision IS NOT NULL THEN
  UPDATE turnstile.deployment_control SET quarantined=quarantined OR stamp<(decision->>'lastTime')::bigint,
   decision=jsonb_set(decision,'{lastTime}',to_jsonb(greatest(stamp,(decision->>'lastTime')::bigint)))
   WHERE tenant_id=tid RETURNING * INTO r;
 END IF;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION turnstile.deployment_quarantine() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,turnstile AS $$
 UPDATE turnstile.deployment_control SET quarantined=true WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid;
$$;
REVOKE ALL ON FUNCTION turnstile.deployment_clock(),turnstile.deployment_quarantine() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.deployment_clock(),turnstile.deployment_quarantine() TO thaarei_turnstile_runtime,thaarei_turnstile_reporter;
-- Row-share locking requires UPDATE privilege. Keep runtime read-only and expose only
-- a tenant-bound security-definer lock/read, rather than granting a mutable decision column.
CREATE FUNCTION turnstile.deployment_read() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,turnstile AS $$
DECLARE r turnstile.deployment_control;
BEGIN
 SELECT * INTO r FROM turnstile.deployment_control WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION turnstile.deployment_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.deployment_read() TO thaarei_turnstile_runtime,thaarei_turnstile_reporter;

ALTER TABLE turnstile.deployment_clock_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.deployment_clock_state FROM PUBLIC;
GRANT SELECT ON turnstile.deployment_clock_state TO thaarei_turnstile_runtime,thaarei_turnstile_reporter;
GRANT INSERT (tenant_id), UPDATE (last_time,quarantined) ON turnstile.deployment_clock_state TO thaarei_turnstile_reporter;
CREATE OR REPLACE FUNCTION turnstile.deployment_clock() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,turnstile AS $$
DECLARE tid uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid; r turnstile.deployment_control; c turnstile.deployment_clock_state; stamp bigint:=floor(extract(epoch FROM clock_timestamp()));
BEGIN
 INSERT INTO turnstile.deployment_clock_state(tenant_id) VALUES(tid) ON CONFLICT DO NOTHING;
 UPDATE turnstile.deployment_clock_state SET quarantined=quarantined OR stamp<last_time,last_time=greatest(stamp,last_time) WHERE tenant_id=tid RETURNING * INTO c;
 SELECT * INTO r FROM turnstile.deployment_control WHERE tenant_id=tid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN to_jsonb(r)||jsonb_build_object('quarantined',r.quarantined OR c.quarantined,'decision',CASE WHEN r.decision IS NULL THEN NULL ELSE jsonb_set(r.decision,'{lastTime}',to_jsonb(greatest(c.last_time,(r.decision->>'lastTime')::bigint))) END);
END $$;
CREATE OR REPLACE FUNCTION turnstile.deployment_quarantine() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,turnstile AS $$
 INSERT INTO turnstile.deployment_clock_state(tenant_id,quarantined) VALUES(nullif(current_setting('app.tenant_id',true),'')::uuid,true) ON CONFLICT(tenant_id) DO UPDATE SET quarantined=true;
$$;
CREATE OR REPLACE FUNCTION turnstile.deployment_read() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,turnstile AS $$
DECLARE r turnstile.deployment_control; c turnstile.deployment_clock_state;
BEGIN
 SELECT * INTO r FROM turnstile.deployment_control WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO c FROM turnstile.deployment_clock_state WHERE tenant_id=r.tenant_id;
 RETURN to_jsonb(r)||jsonb_build_object('quarantined',r.quarantined OR coalesce(c.quarantined,false),'decision',CASE WHEN r.decision IS NULL THEN NULL ELSE jsonb_set(r.decision,'{lastTime}',to_jsonb(greatest(coalesce(c.last_time,0),(r.decision->>'lastTime')::bigint))) END);
END $$;

GRANT EXECUTE ON FUNCTION turnstile.deployment_clock(),turnstile.deployment_quarantine() TO thaarei_turnstile_runtime;

CREATE FUNCTION turnstile.deployment_summary() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,turnstile AS $$
 SELECT jsonb_build_object('activeMembers',count(*) FILTER (WHERE status='active')) FROM turnstile.access_member WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid;
$$;
REVOKE ALL ON FUNCTION turnstile.deployment_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.deployment_summary() TO thaarei_turnstile_reporter;
