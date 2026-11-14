-- A queued request must sample the clock after acquiring the durable clock row.
-- Sampling before the wait can mistake another legitimate writer's newer floor for
-- a clock rollback. Preserve the existing quarantine, ownership, RLS and ACLs.
CREATE OR REPLACE FUNCTION turnstile.deployment_clock() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,turnstile AS $$
DECLARE
  tid uuid:=nullif(current_setting('app.tenant_id',true),'')::uuid;
  r turnstile.deployment_control;
  c turnstile.deployment_clock_state;
  stamp bigint;
BEGIN
  INSERT INTO turnstile.deployment_clock_state(tenant_id) VALUES(tid) ON CONFLICT DO NOTHING;
  SELECT * INTO c FROM turnstile.deployment_clock_state WHERE tenant_id=tid FOR UPDATE;
  stamp:=floor(extract(epoch FROM clock_timestamp()));
  UPDATE turnstile.deployment_clock_state
    SET quarantined=c.quarantined OR stamp<c.last_time,last_time=greatest(stamp,c.last_time)
    WHERE tenant_id=tid RETURNING * INTO c;
  SELECT * INTO r FROM turnstile.deployment_control WHERE tenant_id=tid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(r)||jsonb_build_object('quarantined',r.quarantined OR c.quarantined,
    'decision',CASE WHEN r.decision IS NULL THEN NULL ELSE jsonb_set(r.decision,'{lastTime}',
    to_jsonb(greatest(c.last_time,(r.decision->>'lastTime')::bigint))) END);
END $$;
