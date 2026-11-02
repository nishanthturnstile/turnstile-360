-- ONB-RD03: keep forced RLS and invoker-rights guards. Runtime never changes policy.
CREATE OR REPLACE FUNCTION turnstile.guard_configuration_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.requirement_version IS DISTINCT FROM OLD.requirement_version THEN
    -- The sole metadata-only upgrade, available only to the dedicated owning login.
    -- A caller-set GUC is not authority. All other columns must remain identical.
    IF current_user = 'thaarei_turnstile_migrator' AND session_user = current_user
       AND OLD.requirement_version = 1 AND NEW.requirement_version = 2
       AND OLD.completed_at IS NULL
       AND (to_jsonb(NEW) - 'requirement_version') = (to_jsonb(OLD) - 'requirement_version') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Configuration policy is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
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
  IF NEW.requirement_version = 2 AND NEW.completed_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM turnstile.organization_unit
    WHERE tenant_id = NEW.tenant_id AND parent_id = NEW.root_id AND type IN ('site', 'department')
  ) THEN
    RAISE EXCEPTION 'First operational unit required'
      USING ERRCODE = '23514', CONSTRAINT = 'configuration_first_unit';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION turnstile.guard_organization_unit_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE configuration turnstile.organization_configuration%ROWTYPE;
BEGIN
  SELECT * INTO configuration FROM turnstile.organization_configuration
    WHERE tenant_id = OLD.tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuration context required' USING ERRCODE = '23503';
  END IF;
  IF OLD.type = 'organization' THEN
    RAISE EXCEPTION 'Organization root is immutable' USING ERRCODE = '23514';
  END IF;
  IF configuration.requirement_version = 2 AND configuration.completed_at IS NOT NULL
     AND OLD.parent_id = configuration.root_id AND NOT EXISTS (
       SELECT 1 FROM turnstile.organization_unit
       WHERE tenant_id = OLD.tenant_id AND parent_id = configuration.root_id
         AND type IN ('site', 'department') AND id <> OLD.id
     ) THEN
    RAISE EXCEPTION 'First operational unit required'
      USING ERRCODE = '23514', CONSTRAINT = 'configuration_first_unit';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION turnstile.guard_organization_unit_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.guard_organization_unit_delete() TO thaarei_turnstile_runtime;
CREATE TRIGGER organization_unit_delete_guard BEFORE DELETE ON turnstile.organization_unit
FOR EACH ROW EXECUTE FUNCTION turnstile.guard_organization_unit_delete();
--> statement-breakpoint
-- One installed tenant only. Lock installation then configuration, as private writers do.
-- Fresh databases have no installation/context yet; never bootstrap them from migration.
DO $$
DECLARE installed uuid;
BEGIN
  IF current_user <> 'thaarei_turnstile_migrator' OR session_user <> current_user THEN
    RAISE EXCEPTION 'Dedicated product migrator required' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO installed FROM turnstile.installation WHERE singleton = 1 FOR UPDATE;
  IF FOUND THEN
    PERFORM set_config('app.tenant_id', installed::text, true);
    PERFORM 1 FROM turnstile.organization_configuration WHERE tenant_id = installed FOR UPDATE;
    UPDATE turnstile.organization_configuration SET requirement_version = 2
      WHERE tenant_id = installed AND requirement_version = 1 AND completed_at IS NULL;
  END IF;
END $$;
