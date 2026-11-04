-- Runtime retains read-only Access tables. These fixed, tenant-bound commands
-- expose only structure receipts and one audited revision advance, never grants.
CREATE FUNCTION turnstile.save_structure_command(target uuid, actor text, command_key uuid,
  command_operation text, command_digest text, subject uuid, org_revision integer, access_revision integer, scope_parent uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE current_access integer; current_org integer;
BEGIN
  PERFORM turnstile.lock_access_context(target);
  SELECT revision INTO current_access FROM turnstile.access_context WHERE tenant_id = target;
  SELECT revision INTO current_org FROM turnstile.organization_configuration WHERE tenant_id = target;
  IF command_operation NOT IN ('unit.create','unit.rename','unit.delete','unit.move')
    OR subject IS NULL OR org_revision IS DISTINCT FROM current_org
    OR access_revision IS NULL OR NOT (access_revision = current_access OR
      (command_operation = 'unit.move' AND access_revision::bigint = current_access::bigint + 1)) THEN
    RAISE EXCEPTION 'Structure receipt rejected' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM turnstile.access_member WHERE tenant_id = target AND user_id = actor AND status = 'active') THEN
    RAISE EXCEPTION 'Active actor required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM turnstile.access_command_receipt WHERE tenant_id = target AND actor_id = actor
    AND key = command_key AND expires_at <= statement_timestamp();
  IF EXISTS (SELECT 1 FROM turnstile.configuration_create_receipt WHERE tenant_id=target AND actor_id=actor AND key=command_key AND expires_at>statement_timestamp()) THEN
    RAISE EXCEPTION 'Command key already used' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM turnstile.access_command_receipt WHERE tenant_id = target) >= 10000 THEN
    RAISE EXCEPTION 'Receipt capacity reached' USING ERRCODE = '54000';
  END IF;
  INSERT INTO turnstile.access_command_receipt
    (tenant_id,actor_id,key,operation,digest,subject_id,organization_revision_after,access_revision_after,scope_parent_id)
    VALUES (target,actor,command_key,command_operation,command_digest,subject,org_revision,access_revision,scope_parent);
END $$;
REVOKE ALL ON FUNCTION turnstile.save_structure_command(uuid,text,uuid,text,text,uuid,integer,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.save_structure_command(uuid,text,uuid,text,text,uuid,integer,integer,uuid) TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.save_structure_impact(target uuid, actor text, proof_id uuid,
  token_digest text, command_digest text, actor_fingerprint text, access_revision integer, org_revision integer)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE expires timestamptz;
BEGIN
  PERFORM turnstile.lock_access_context(target);
  IF NOT EXISTS (SELECT 1 FROM turnstile.access_context WHERE tenant_id = target AND revision = access_revision)
    OR NOT EXISTS (SELECT 1 FROM turnstile.organization_configuration WHERE tenant_id = target AND revision = org_revision)
    OR NOT EXISTS (SELECT 1 FROM turnstile.access_member WHERE tenant_id = target AND user_id = actor AND status = 'active') THEN
    RAISE EXCEPTION 'Impact context rejected' USING ERRCODE = '23514';
  END IF;
  DELETE FROM turnstile.access_impact_receipt WHERE tenant_id = target AND id IN
    (SELECT id FROM turnstile.access_impact_receipt WHERE tenant_id = target AND expires_at <= statement_timestamp()
      ORDER BY expires_at,id LIMIT 1000);
  IF (SELECT count(*) FROM turnstile.access_impact_receipt WHERE tenant_id = target) >= 1000 THEN
    RAISE EXCEPTION 'Impact capacity reached' USING ERRCODE = '54000';
  END IF;
  INSERT INTO turnstile.access_impact_receipt
    (tenant_id,id,actor_id,token_hash,command_digest,actor_fingerprint,access_revision,organization_revision)
    VALUES(target,proof_id,actor,token_digest,command_digest,actor_fingerprint,access_revision,org_revision)
    RETURNING expires_at INTO expires;
  RETURN expires;
END $$;
REVOKE ALL ON FUNCTION turnstile.save_structure_impact(uuid,text,uuid,text,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.save_structure_impact(uuid,text,uuid,text,text,text,integer,integer) TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.commit_structure_access(target uuid, actor text, command_key uuid, request uuid,
  expected_access integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE receipt turnstile.access_command_receipt%ROWTYPE;
BEGIN
  PERFORM turnstile.lock_access_context(target);
  SELECT * INTO receipt FROM turnstile.access_command_receipt WHERE tenant_id = target
    AND actor_id = actor AND key = command_key AND operation = 'unit.move' AND expires_at > statement_timestamp();
  IF NOT FOUND OR receipt.access_revision_after::bigint IS DISTINCT FROM expected_access::bigint + 1
    OR receipt.organization_revision_after IS DISTINCT FROM
      (SELECT revision FROM turnstile.organization_configuration WHERE tenant_id = target)
    OR expected_access >= 2147483647 THEN
    RAISE EXCEPTION 'Move revision rejected' USING ERRCODE = '23514';
  END IF;
  UPDATE turnstile.access_context SET revision = revision + 1 WHERE tenant_id = target AND revision = expected_access;
  IF NOT FOUND THEN RAISE EXCEPTION 'Access revision changed' USING ERRCODE = '40001'; END IF;
  INSERT INTO turnstile.access_audit
    (tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,revision_before,revision_after)
    VALUES(target,gen_random_uuid(),'user',actor,request,'unit_coverage_changed',receipt.subject_id,expected_access,expected_access+1);
  RETURN expected_access + 1;
END $$;
REVOKE ALL ON FUNCTION turnstile.commit_structure_access(uuid,text,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.commit_structure_access(uuid,text,uuid,uuid,integer) TO thaarei_turnstile_runtime;
