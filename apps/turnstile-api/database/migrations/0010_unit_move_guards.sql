-- ONB-RD04: only parent_id is newly writable; all tenant/identity/type restrictions stay.
GRANT UPDATE (parent_id) ON turnstile.organization_unit TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION turnstile.guard_organization_unit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  configuration turnstile.organization_configuration%ROWTYPE;
  parent_type text;
  parent_depth integer;
  subtree_height integer;
  cycle_found boolean;
  rooted boolean;
BEGIN
  -- API/operator writers acquire this before unit rows. Direct SQL retains the same guard.
  SELECT * INTO configuration FROM turnstile.organization_configuration
    WHERE tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuration context required' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR (OLD.type = 'organization' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
      RAISE EXCEPTION 'Unit identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN RETURN NEW; END IF;
  ELSIF (SELECT count(*) FROM turnstile.organization_unit WHERE tenant_id = NEW.tenant_id) >= 500 THEN
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
  -- Bounded ancestor reads reject self/descendant targets and disconnected/cyclic paths.
  WITH RECURSIVE ancestry AS (
    SELECT id, parent_id, 1 AS depth FROM turnstile.organization_unit
      WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_id
    UNION ALL
    SELECT u.id, u.parent_id, a.depth + 1 FROM turnstile.organization_unit u
      JOIN ancestry a ON u.id = a.parent_id
      WHERE u.tenant_id = NEW.tenant_id AND a.depth < 8
  ) SELECT max(depth), bool_or(id = NEW.id),
      bool_or(id = configuration.root_id AND parent_id IS NULL)
    INTO parent_depth, cycle_found, rooted FROM ancestry;
  IF cycle_found OR rooted IS NOT TRUE THEN
    RAISE EXCEPTION 'Unit cycle or ancestry rejected' USING ERRCODE = '23514';
  END IF;
  -- For inserts the new node is not in the table yet, so its height is one.
  WITH RECURSIVE subtree AS (
    SELECT id, 1 AS height FROM turnstile.organization_unit
      WHERE tenant_id = NEW.tenant_id AND id = NEW.id
    UNION ALL
    SELECT u.id, s.height + 1 FROM turnstile.organization_unit u
      JOIN subtree s ON u.parent_id = s.id
      WHERE u.tenant_id = NEW.tenant_id AND s.height < 8
  ) SELECT coalesce(max(height), 1) INTO subtree_height FROM subtree;
  IF parent_depth + subtree_height > 8 THEN
    RAISE EXCEPTION 'Unit subtree depth reached' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND configuration.requirement_version = 2
     AND configuration.completed_at IS NOT NULL AND OLD.parent_id = configuration.root_id
     AND NEW.parent_id <> configuration.root_id AND NOT EXISTS (
       SELECT 1 FROM turnstile.organization_unit
       WHERE tenant_id = NEW.tenant_id AND parent_id = configuration.root_id
         AND type IN ('site', 'department') AND id <> OLD.id
     ) THEN
    RAISE EXCEPTION 'First operational unit required'
      USING ERRCODE = '23514', CONSTRAINT = 'configuration_first_unit';
  END IF;
  RETURN NEW;
END $$;
