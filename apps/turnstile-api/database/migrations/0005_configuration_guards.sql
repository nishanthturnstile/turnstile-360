-- Reviewed ONB-I03 privileges, forced tenant policies and structural invariants.
-- No SECURITY DEFINER, public bootstrap, access writer or cross-schema capability.
ALTER TABLE turnstile.organization_configuration FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.organization_unit FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.configuration_create_receipt FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.configuration_audit FORCE ROW LEVEL SECURITY;
GRANT SELECT ON turnstile.organization_configuration, turnstile.organization_unit TO thaarei_turnstile_runtime;
GRANT UPDATE (revision, name, time_zone, root_id, completed_at, completed_by) ON turnstile.organization_configuration TO thaarei_turnstile_runtime;
GRANT INSERT, DELETE ON turnstile.organization_unit TO thaarei_turnstile_runtime;
GRANT UPDATE (name, name_key) ON turnstile.organization_unit TO thaarei_turnstile_runtime;
GRANT SELECT, INSERT, DELETE ON turnstile.configuration_create_receipt TO thaarei_turnstile_runtime;
GRANT INSERT ON turnstile.configuration_audit TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.guard_configuration_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.requirement_version IS DISTINCT FROM OLD.requirement_version
     OR (OLD.root_id IS NOT NULL AND NEW.root_id IS DISTINCT FROM OLD.root_id)
     OR (OLD.name IS NOT NULL AND NEW.name IS NULL)
     OR (OLD.time_zone IS NOT NULL AND NEW.time_zone IS NULL)
     OR (OLD.completed_at IS NOT NULL AND
       (NEW.completed_at IS DISTINCT FROM OLD.completed_at OR NEW.completed_by IS DISTINCT FROM OLD.completed_by))
     OR NEW.revision::bigint <> OLD.revision::bigint + 1 THEN
    RAISE EXCEPTION 'Configuration invariant rejected' USING ERRCODE = '23514';
  END IF;
  IF NEW.root_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM turnstile.organization_unit
    WHERE tenant_id = NEW.tenant_id AND id = NEW.root_id AND type = 'organization'
  ) THEN
    RAISE EXCEPTION 'Configuration root rejected' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION turnstile.guard_configuration_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.guard_configuration_update() TO thaarei_turnstile_runtime;
CREATE TRIGGER configuration_update_guard BEFORE UPDATE ON turnstile.organization_configuration
FOR EACH ROW EXECUTE FUNCTION turnstile.guard_configuration_update();
--> statement-breakpoint
CREATE FUNCTION turnstile.guard_organization_unit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE parent_type text; parent_depth integer;
BEGIN
  -- Every writer uses the same context lock before touching units or local grants.
  PERFORM 1 FROM turnstile.organization_configuration WHERE tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuration context required' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.type IS DISTINCT FROM OLD.type OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
      RAISE EXCEPTION 'Unit identity is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM turnstile.organization_unit WHERE tenant_id = NEW.tenant_id) >= 500 THEN
    RAISE EXCEPTION 'Unit limit reached' USING ERRCODE = '23514';
  END IF;
  IF NEW.type = 'organization' THEN RETURN NEW; END IF;
  SELECT type INTO parent_type FROM turnstile.organization_unit
    WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent not available' USING ERRCODE = '23503';
  END IF;
  IF NEW.type = 'site' AND parent_type <> 'organization' THEN
    RAISE EXCEPTION 'Site parent rejected' USING ERRCODE = '23514';
  END IF;
  WITH RECURSIVE ancestry AS (
    SELECT id, parent_id, 1 AS depth FROM turnstile.organization_unit
      WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_id
    UNION ALL
    SELECT u.id, u.parent_id, a.depth + 1 FROM turnstile.organization_unit u
      JOIN ancestry a ON u.id = a.parent_id WHERE u.tenant_id = NEW.tenant_id AND a.depth < 8
  ) SELECT max(depth) INTO parent_depth FROM ancestry;
  IF parent_depth >= 8 THEN
    RAISE EXCEPTION 'Unit depth reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION turnstile.guard_organization_unit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.guard_organization_unit() TO thaarei_turnstile_runtime;
CREATE TRIGGER organization_unit_guard BEFORE INSERT OR UPDATE ON turnstile.organization_unit
FOR EACH ROW EXECUTE FUNCTION turnstile.guard_organization_unit();
