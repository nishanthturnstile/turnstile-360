-- Runtime may lock the fixed installation/configuration/access context, never
-- write feature state or obtain the owner's general table/DDL privileges.
CREATE FUNCTION turnstile.lock_access_context(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF target IS NULL OR target IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN
    RAISE EXCEPTION 'Fixed tenant context required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM turnstile.installation WHERE tenant_id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixed installation required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM turnstile.organization_configuration WHERE tenant_id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configuration initialization required' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM turnstile.access_context WHERE tenant_id = target AND model_version = 1
    AND NOT public_writes_enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical access initialization required' USING ERRCODE = '23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION turnstile.lock_access_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.lock_access_context(uuid) TO thaarei_turnstile_runtime;
