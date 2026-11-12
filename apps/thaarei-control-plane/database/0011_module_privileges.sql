REVOKE ALL ON control_plane.module_code, control_plane.module_catalogue,
  control_plane.module_receipt, control_plane.module_audit FROM PUBLIC, control_plane_runtime;
GRANT SELECT ON control_plane.module_catalogue TO control_plane_runtime;
GRANT INSERT (id,source_id,digest,document) ON control_plane.module_catalogue TO control_plane_runtime;
GRANT SELECT, INSERT ON control_plane.module_code,
  control_plane.module_receipt, control_plane.module_audit TO control_plane_runtime;
GRANT UPDATE (document,digest,revision,status,proof_digest,key_id,published_at)
  ON control_plane.module_catalogue TO control_plane_runtime;

-- Released catalogues are immutable even to a runtime holding draft-update privileges.
CREATE FUNCTION control_plane.guard_module_catalogue() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.status = 'released' OR NEW.id <> OLD.id OR NEW.source_id <> OLD.source_id
    OR NEW.created_at <> OLD.created_at OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Immutable catalogue or invalid revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION control_plane.guard_module_catalogue() FROM PUBLIC;
CREATE TRIGGER module_catalogue_guard BEFORE UPDATE ON control_plane.module_catalogue
  FOR EACH ROW EXECUTE FUNCTION control_plane.guard_module_catalogue();
