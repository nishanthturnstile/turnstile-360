-- Reviewed UM-I03 access foundation. No import/identity selection at migration or startup.
-- Public feature writers remain closed. Runtime reads are tenant bound; audit is append only.
ALTER TABLE turnstile.access_context FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.access_member FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.access_legacy_source FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.access_role FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.access_role_permission FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.access_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.access_scope_anchor FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.access_command_receipt FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.access_impact_receipt FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.access_audit FORCE ROW LEVEL SECURITY;
GRANT SELECT ON turnstile.access_context, turnstile.access_member,
  turnstile.access_legacy_source, turnstile.access_role, turnstile.access_role_permission,
  turnstile.access_assignment, turnstile.access_scope_anchor, turnstile.access_command_receipt,
  turnstile.access_impact_receipt TO thaarei_turnstile_runtime;
GRANT INSERT ON turnstile.access_audit TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.guard_access_inventory() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE target uuid;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  PERFORM 1 FROM turnstile.installation WHERE tenant_id = target FOR UPDATE;
  IF EXISTS (SELECT 1 FROM turnstile.access_context WHERE tenant_id = target) THEN
    RAISE EXCEPTION 'Legacy inventory is read only after access import' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION turnstile.guard_access_inventory() FROM PUBLIC;
CREATE TRIGGER access_inventory_guard BEFORE INSERT OR UPDATE OR DELETE ON turnstile.user_access
  FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_inventory();
--> statement-breakpoint
CREATE FUNCTION turnstile.guard_access_role() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD.system_key IS NOT NULL THEN
      RAISE EXCEPTION 'System role is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id
      OR NEW.system_key IS DISTINCT FROM OLD.system_key
      OR NEW.version::bigint <> OLD.version::bigint + 1
      OR NEW.permission_version NOT IN (OLD.permission_version, OLD.permission_version + 1) THEN
      RAISE EXCEPTION 'Role identity or version rejected' USING ERRCODE = '23514';
    END IF;
  ELSE
    PERFORM 1 FROM turnstile.access_context WHERE tenant_id = NEW.tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Access import required' USING ERRCODE = '23514'; END IF;
    IF (SELECT count(*) FROM turnstile.access_role WHERE tenant_id = NEW.tenant_id) >= 128 THEN
      RAISE EXCEPTION 'Role limit reached' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION turnstile.guard_access_role() FROM PUBLIC;
CREATE TRIGGER access_role_guard BEFORE INSERT OR UPDATE OR DELETE ON turnstile.access_role
  FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_role();
--> statement-breakpoint
-- Validate complete role definitions and assignment sets at commit, after permission/anchor inserts.
-- These are invoker functions with fully qualified names, never a runtime privilege escape.
CREATE FUNCTION turnstile.check_access_role() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE target uuid; target_role uuid; role_key text; role_name text; role_description text;
  actual text[]; expected text[]; expected_name text;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  IF TG_TABLE_NAME = 'access_role' THEN
    target_role := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_role := CASE WHEN TG_OP = 'DELETE' THEN OLD.role_id ELSE NEW.role_id END;
  END IF;
  SELECT system_key, name, description INTO role_key, role_name, role_description
    FROM turnstile.access_role WHERE tenant_id = target AND id = target_role;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(array_agg(permission ORDER BY permission COLLATE "C"),'{}'::text[]) INTO actual
    FROM turnstile.access_role_permission WHERE tenant_id = target AND role_id = target_role;
  IF NOT ('turnstile:access' = ANY(actual)) THEN
    RAISE EXCEPTION 'Role requires explicit shell access' USING ERRCODE = '23514';
  END IF;
  IF role_key IS NOT NULL THEN
    expected := ARRAY['turnstile:access']; expected_name := 'Member';
    IF role_key = 'unit_manager' THEN
      expected_name := 'Unit manager'; expected := expected || ARRAY['turnstile:units:read','turnstile:units:manage'];
    ELSIF role_key = 'configuration_manager' THEN
      expected_name := 'Configuration manager'; expected := expected || ARRAY['turnstile:configuration:manage','turnstile:units:read','turnstile:units:manage'];
    ELSIF role_key = 'workspace_administrator' THEN
      expected_name := 'Workspace administrator'; expected := expected || ARRAY['turnstile:configuration:manage','turnstile:people:manage','turnstile:roles:manage','turnstile:units:read','turnstile:units:manage'];
    END IF;
    IF NOT (actual @> expected AND actual <@ expected) OR role_name <> expected_name OR role_description IS NOT NULL THEN
      RAISE EXCEPTION 'System template rejected' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM turnstile.access_assignment a WHERE a.tenant_id = target
      AND a.role_id = target_role AND a.scope_kind = 'units') AND
    actual && ARRAY['turnstile:dms:capabilities:read','turnstile:configuration:manage','turnstile:people:manage','turnstile:roles:manage'] THEN
    RAISE EXCEPTION 'Company action requires company scope' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION turnstile.check_access_role() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER access_role_shape AFTER INSERT OR UPDATE ON turnstile.access_role
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.check_access_role();
CREATE CONSTRAINT TRIGGER access_role_permission_shape AFTER INSERT OR UPDATE OR DELETE ON turnstile.access_role_permission
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.check_access_role();
--> statement-breakpoint
CREATE FUNCTION turnstile.check_access_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE target uuid; assignment_id uuid; assignment turnstile.access_assignment; anchors uuid[];
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  IF TG_TABLE_NAME = 'access_assignment' THEN
    assignment_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    assignment_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.assignment_id ELSE NEW.assignment_id END;
  END IF;
  SELECT * INTO assignment FROM turnstile.access_assignment WHERE tenant_id = target AND id = assignment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(array_agg(unit_id ORDER BY unit_id),'{}'::uuid[]) INTO anchors
    FROM turnstile.access_scope_anchor WHERE tenant_id = target AND access_scope_anchor.assignment_id = assignment.id;
  IF (assignment.scope_kind = 'company' AND cardinality(anchors) <> 0) OR
    (assignment.scope_kind = 'units' AND (cardinality(anchors) NOT BETWEEN 1 AND 16 OR
      assignment.scope_key <> 'units:' || assignment.include_children::text || ':' || array_to_string(anchors,','))) THEN
    RAISE EXCEPTION 'Assignment scope rejected' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM turnstile.access_scope_anchor a JOIN turnstile.organization_unit u
    ON u.tenant_id = a.tenant_id AND u.id = a.unit_id
    WHERE a.tenant_id = target AND a.assignment_id = assignment.id AND u.type = 'organization') THEN
    RAISE EXCEPTION 'Organization is not a unit anchor' USING ERRCODE = '23514';
  END IF;
  IF assignment.scope_kind = 'units' AND EXISTS (SELECT 1 FROM turnstile.access_role_permission
    WHERE tenant_id = target AND role_id = assignment.role_id AND permission IN
      ('turnstile:dms:capabilities:read','turnstile:configuration:manage','turnstile:people:manage','turnstile:roles:manage')) THEN
    RAISE EXCEPTION 'Company action requires company scope' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM turnstile.access_assignment WHERE tenant_id = target AND member_id = assignment.member_id) > 32 OR
    (SELECT count(*) FROM turnstile.access_scope_anchor s JOIN turnstile.access_assignment a
      ON a.tenant_id = s.tenant_id AND a.id = s.assignment_id
      WHERE a.tenant_id = target AND a.member_id = assignment.member_id) > 64 THEN
    RAISE EXCEPTION 'Membership assignment limit reached' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION turnstile.check_access_assignment() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER access_assignment_shape AFTER INSERT OR UPDATE ON turnstile.access_assignment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.check_access_assignment();
CREATE CONSTRAINT TRIGGER access_anchor_shape AFTER INSERT OR UPDATE OR DELETE ON turnstile.access_scope_anchor
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.check_access_assignment();
--> statement-breakpoint
-- Prevent key moves from evading the old row's deferred validation. Receipts and
-- audit remain immutable even for the operator; bounded maintenance only deletes.
CREATE FUNCTION turnstile.guard_access_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE mutable text[];
BEGIN
  mutable := CASE TG_TABLE_NAME
    WHEN 'access_context' THEN ARRAY['revision']
    WHEN 'access_member' THEN ARRAY['version','status']
    WHEN 'access_legacy_source' THEN ARRAY['version','permissions','retired']
    ELSE ARRAY[]::text[] END;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'Access identity/history is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'access_context' THEN
    IF NEW.revision::bigint <> OLD.revision::bigint + 1 THEN
      RAISE EXCEPTION 'Access revision rejected' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME IN ('access_member','access_legacy_source') THEN
    IF NEW.version::bigint <> OLD.version::bigint + 1 THEN
      RAISE EXCEPTION 'Access version rejected' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'access_legacy_source' THEN
      IF OLD.retired AND NOT NEW.retired THEN
        RAISE EXCEPTION 'Retired legacy source cannot be restored' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION turnstile.guard_access_update() FROM PUBLIC;
CREATE TRIGGER access_context_update BEFORE UPDATE ON turnstile.access_context FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_update();
CREATE TRIGGER access_member_update BEFORE UPDATE ON turnstile.access_member FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_update();
CREATE TRIGGER access_legacy_update BEFORE UPDATE ON turnstile.access_legacy_source FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_update();
CREATE TRIGGER access_assignment_update BEFORE UPDATE ON turnstile.access_assignment FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_update();
CREATE TRIGGER access_anchor_update BEFORE UPDATE ON turnstile.access_scope_anchor FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_update();
CREATE TRIGGER access_permission_update BEFORE UPDATE ON turnstile.access_role_permission FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_update();
CREATE TRIGGER access_receipt_update BEFORE UPDATE ON turnstile.access_command_receipt FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_update();
CREATE TRIGGER access_impact_update BEFORE UPDATE ON turnstile.access_impact_receipt FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_update();
CREATE TRIGGER access_audit_update BEFORE UPDATE ON turnstile.access_audit FOR EACH ROW EXECUTE FUNCTION turnstile.guard_access_update();
