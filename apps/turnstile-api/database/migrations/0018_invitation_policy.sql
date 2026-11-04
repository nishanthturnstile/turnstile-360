-- Invitation-only commands preserve read-only runtime membership/role tables.
CREATE FUNCTION turnstile.reserve_invitation_command(target uuid, actor text, command_key uuid, command_operation text, command_digest text, subject uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM turnstile.lock_access_context(target);
 IF command_operation NOT IN ('invitation.issue','invitation.resend','invitation.reapprove','invitation.cancel') OR NOT EXISTS (SELECT 1 FROM turnstile.access_member WHERE tenant_id=target AND user_id=actor AND status='active') THEN RAISE EXCEPTION 'Invitation command denied' USING ERRCODE='42501'; END IF;
 IF EXISTS (SELECT 1 FROM turnstile.configuration_create_receipt WHERE tenant_id=target AND actor_id=actor AND key=command_key AND expires_at>statement_timestamp()) THEN RAISE EXCEPTION 'Command key used' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM turnstile.access_command_receipt WHERE tenant_id=target)>=10000 THEN RAISE EXCEPTION 'Receipt capacity' USING ERRCODE='54000'; END IF;
 DELETE FROM turnstile.access_command_receipt WHERE tenant_id=target AND actor_id=actor AND key=command_key AND expires_at<=statement_timestamp();
 INSERT INTO turnstile.access_command_receipt(tenant_id,actor_id,key,operation,digest,subject_id) VALUES(target,actor,command_key,command_operation,command_digest,subject);
END $$;
REVOKE ALL ON FUNCTION turnstile.reserve_invitation_command(uuid,text,uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.reserve_invitation_command(uuid,text,uuid,text,text,uuid) TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.commit_invitation_command(target uuid, actor text, command_key uuid, request uuid, expected_access integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM turnstile.lock_access_context(target);
 IF expected_access>=2147483647 OR NOT EXISTS (SELECT 1 FROM turnstile.access_command_receipt r JOIN turnstile.invitation_operation o ON o.tenant_id=r.tenant_id AND o.actor_id=r.actor_id AND o.key=r.key WHERE r.tenant_id=target AND r.actor_id=actor AND r.key=command_key AND r.operation=o.input->>'operation' AND r.digest=o.digest AND r.access_revision_after IS NULL AND o.state='completed' AND o.committed_at IS NULL AND r.expires_at>statement_timestamp()) THEN RAISE EXCEPTION 'Invitation receipt rejected' USING ERRCODE='23514'; END IF;
 UPDATE turnstile.access_context SET revision=revision+1 WHERE tenant_id=target AND revision=expected_access;
 IF NOT FOUND THEN RAISE EXCEPTION 'Access revision changed' USING ERRCODE='40001'; END IF;
 UPDATE turnstile.invitation_operation SET committed_at=statement_timestamp() WHERE tenant_id=target AND actor_id=actor AND key=command_key;
 INSERT INTO turnstile.access_audit(tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,revision_before,revision_after) SELECT target,gen_random_uuid(),'user',actor,request,'invitation_changed',invitation_id,expected_access,expected_access+1 FROM turnstile.invitation_operation WHERE tenant_id=target AND actor_id=actor AND key=command_key;
 RETURN expected_access+1;
END $$;
REVOKE ALL ON FUNCTION turnstile.commit_invitation_command(uuid,text,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.commit_invitation_command(uuid,text,uuid,uuid,integer) TO thaarei_turnstile_runtime;
--> statement-breakpoint
-- Same action/scope pairs and implications as Access.covers; no flattened union.
CREATE FUNCTION turnstile.invitation_approval_valid(target uuid, chosen uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 WITH RECURSIVE ancestry(id,ancestor,depth) AS (
  SELECT id,id,0 FROM turnstile.organization_unit WHERE tenant_id=target
  UNION ALL SELECT a.id,u.parent_id,a.depth+1 FROM ancestry a JOIN turnstile.organization_unit u ON u.tenant_id=target AND u.id=a.ancestor WHERE u.parent_id IS NOT NULL AND a.depth<8
 ), selected AS (SELECT * FROM turnstile.invitation WHERE tenant_id=target AND id=chosen AND state='pending'),
 actor AS (SELECT m.* FROM turnstile.access_member m JOIN selected i ON i.approver_id=m.user_id AND m.tenant_id=i.tenant_id WHERE m.status='active'),
 sources AS (
  SELECT a.scope_kind,a.include_children,ARRAY(SELECT unit_id FROM turnstile.access_scope_anchor s WHERE s.tenant_id=target AND s.assignment_id=a.id) AS anchors,ARRAY(SELECT permission FROM turnstile.access_role_permission p WHERE p.tenant_id=target AND p.role_id=a.role_id) AS permissions FROM turnstile.access_assignment a JOIN actor m ON m.tenant_id=a.tenant_id AND m.id=a.member_id
  UNION ALL SELECT 'company',false,ARRAY[]::uuid[],l.permissions FROM turnstile.access_legacy_source l JOIN actor m ON m.tenant_id=l.tenant_id AND m.id=l.member_id WHERE NOT l.retired
 ), abilities AS (
  SELECT s.*,p.action FROM sources s CROSS JOIN LATERAL unnest(s.permissions || CASE WHEN 'turnstile:configuration:manage'=ANY(s.permissions) THEN ARRAY['turnstile:units:manage','turnstile:units:read'] WHEN 'turnstile:units:manage'=ANY(s.permissions) THEN ARRAY['turnstile:units:read'] ELSE ARRAY[]::text[] END) p(action)
 ), wanted AS (SELECT a.value AS assignment,p.value AS permission FROM selected i CROSS JOIN LATERAL jsonb_array_elements(i.assignments) a CROSS JOIN LATERAL jsonb_array_elements_text(a.value->'role'->'permissions') p)
 SELECT EXISTS (SELECT 1 FROM actor) AND EXISTS(SELECT 1 FROM abilities WHERE action='turnstile:access') AND EXISTS(SELECT 1 FROM abilities WHERE action='turnstile:people:manage' AND scope_kind='company')
 AND NOT EXISTS(SELECT 1 FROM selected i CROSS JOIN LATERAL jsonb_array_elements(i.assignments) a WHERE NOT EXISTS(SELECT 1 FROM turnstile.access_role r WHERE r.tenant_id=target AND r.id=(a.value->'role'->>'id')::uuid AND r.permission_version=(a.value->'role'->>'permissionVersion')::int AND ARRAY(SELECT p.permission FROM turnstile.access_role_permission p WHERE p.tenant_id=target AND p.role_id=r.id ORDER BY p.permission)=ARRAY(SELECT value FROM jsonb_array_elements_text(a.value->'role'->'permissions') ORDER BY value)))
 AND NOT EXISTS(SELECT 1 FROM wanted w WHERE w.permission<>'turnstile:access' AND (
  CASE WHEN w.assignment->'scope'->>'kind'='company' THEN NOT EXISTS(SELECT 1 FROM abilities b WHERE b.action=w.permission AND b.scope_kind='company')
  ELSE EXISTS(SELECT 1 FROM jsonb_array_elements_text(w.assignment->'scope'->'unitIds') desired(id) WHERE NOT EXISTS(SELECT 1 FROM turnstile.organization_unit WHERE tenant_id=target AND id=desired.id::uuid) OR NOT EXISTS(SELECT 1 FROM abilities b WHERE b.action=w.permission AND (b.scope_kind='company' OR ((NOT (w.assignment->'scope'->>'includeChildren')::boolean OR b.include_children) AND EXISTS(SELECT 1 FROM unnest(b.anchors) anchor WHERE anchor=desired.id::uuid OR (b.include_children AND EXISTS(SELECT 1 FROM ancestry x WHERE x.id=desired.id::uuid AND x.ancestor=anchor))))))) END))
 AND NOT EXISTS(SELECT 1 FROM selected i CROSS JOIN LATERAL jsonb_array_elements(i.assignments) a WHERE a.value->'role'->>'systemKey'='workspace_administrator' AND NOT EXISTS(SELECT 1 FROM actor m JOIN turnstile.access_assignment x ON x.tenant_id=m.tenant_id AND x.member_id=m.id JOIN turnstile.access_role r ON r.tenant_id=x.tenant_id AND r.id=x.role_id WHERE x.scope_kind='company' AND r.system_key='workspace_administrator'));
$$;
REVOKE ALL ON FUNCTION turnstile.invitation_approval_valid(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.invitation_approval_valid(uuid,uuid) TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.invalidate_invitations(target uuid, chosen uuid[])
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;
BEGIN
 IF cardinality(chosen)>1000 THEN RAISE EXCEPTION 'Invitation impact capacity' USING ERRCODE='54000'; END IF;
 FOR r IN UPDATE turnstile.invitation SET state='needs_reapproval',version=version+1,generation=generation+1,approval_id=NULL,invalidated_at=statement_timestamp() WHERE tenant_id=target AND id=ANY(chosen) AND state='pending' RETURNING id,generation LOOP
  UPDATE turnstile.invitation_delivery SET state='failed',payload=NULL,outcome_at=statement_timestamp(),reason='stale_generation',lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=target AND invitation_id=r.id AND state IN ('queued','sending');
  INSERT INTO turnstile.invitation_audit(tenant_id,id,invitation_id,generation,actor_kind,action) VALUES(target,gen_random_uuid(),r.id,r.generation,'system','invalidated');
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION turnstile.invalidate_invitations(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.invalidate_invitations(uuid,uuid[]) TO thaarei_turnstile_runtime;
--> statement-breakpoint
-- Deferred constraints see the final effective grants, avoiding transient delete/reinsert invalidation.
CREATE FUNCTION turnstile.fence_invitation_approvals() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE chosen uuid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM turnstile.invitation WHERE tenant_id=coalesce(NEW.tenant_id,OLD.tenant_id) AND state='pending') THEN RETURN NULL; END IF;
 PERFORM turnstile.lock_access_context(coalesce(NEW.tenant_id,OLD.tenant_id));
 SELECT array_agg(id) INTO chosen FROM turnstile.invitation WHERE tenant_id=coalesce(NEW.tenant_id,OLD.tenant_id) AND state='pending' AND NOT turnstile.invitation_approval_valid(tenant_id,id);
 IF chosen IS NOT NULL THEN PERFORM turnstile.invalidate_invitations(coalesce(NEW.tenant_id,OLD.tenant_id),chosen); END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION turnstile.fence_invitation_approvals() FROM PUBLIC;

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invitation_fence AFTER INSERT OR UPDATE OR DELETE ON turnstile.access_member DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.fence_invitation_approvals();

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invitation_fence AFTER INSERT OR UPDATE OR DELETE ON turnstile.access_legacy_source DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.fence_invitation_approvals();

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invitation_fence AFTER INSERT OR UPDATE OR DELETE ON turnstile.access_assignment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.fence_invitation_approvals();

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invitation_fence AFTER INSERT OR UPDATE OR DELETE ON turnstile.access_scope_anchor DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.fence_invitation_approvals();

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invitation_fence AFTER INSERT OR UPDATE OR DELETE ON turnstile.access_role_permission DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.fence_invitation_approvals();

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invitation_fence AFTER INSERT OR UPDATE OR DELETE ON turnstile.access_role DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.fence_invitation_approvals();

--> statement-breakpoint
ALTER TABLE turnstile.invitation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.invitation FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON turnstile.invitation TO thaarei_turnstile_runtime;

--> statement-breakpoint
ALTER TABLE turnstile.invitation_generation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.invitation_generation FROM PUBLIC;
GRANT SELECT, INSERT ON turnstile.invitation_generation TO thaarei_turnstile_runtime;

--> statement-breakpoint
ALTER TABLE turnstile.invitation_reference FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.invitation_reference FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON turnstile.invitation_reference TO thaarei_turnstile_runtime;

--> statement-breakpoint
ALTER TABLE turnstile.invitation_delivery FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.invitation_delivery FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON turnstile.invitation_delivery TO thaarei_turnstile_runtime;

--> statement-breakpoint
ALTER TABLE turnstile.invitation_operation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.invitation_operation FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON turnstile.invitation_operation TO thaarei_turnstile_runtime;

--> statement-breakpoint
ALTER TABLE turnstile.invitation_rate FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.invitation_rate FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON turnstile.invitation_rate TO thaarei_turnstile_runtime;

--> statement-breakpoint
ALTER TABLE turnstile.invitation_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.invitation_audit FROM PUBLIC;
GRANT INSERT ON turnstile.invitation_audit TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.maintain_invitations(target uuid, epoch text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record; changed integer:=0; chosen uuid[];
BEGIN
 PERFORM turnstile.lock_access_context(target);
 IF epoch !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid recovery epoch'; END IF;
 FOR r IN SELECT id,generation FROM turnstile.invitation WHERE tenant_id=target AND state IN ('pending','needs_reapproval') AND expires_at<=statement_timestamp() ORDER BY id LIMIT 1000 FOR UPDATE LOOP
  UPDATE turnstile.invitation SET state='expired',version=version+1,generation=generation+1,approval_id=NULL WHERE tenant_id=target AND id=r.id;
  UPDATE turnstile.invitation_delivery SET state='failed',payload=NULL,reason='expired',outcome_at=statement_timestamp(),lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=target AND invitation_id=r.id AND state IN ('queued','sending');
  DELETE FROM turnstile.invitation_reference WHERE tenant_id=target AND invitation_id=r.id;
  INSERT INTO turnstile.invitation_audit(tenant_id,id,invitation_id,generation,actor_kind,action) VALUES(target,gen_random_uuid(),r.id,r.generation+1,'system','expired');
  changed:=changed+1;
 END LOOP;
 SELECT array_agg(id) INTO chosen FROM turnstile.invitation WHERE tenant_id=target AND state='pending' AND (recovery_epoch<>epoch OR NOT turnstile.invitation_approval_valid(target,id));
 IF chosen IS NOT NULL THEN PERFORM turnstile.invalidate_invitations(target,chosen);changed:=changed+cardinality(chosen); END IF;
 -- Reclaim abandoned sends as unknown; there is no safe automatic resend after possible SMTP acceptance.
 FOR r IN UPDATE turnstile.invitation_delivery SET state='unknown',payload=NULL,reason='lease_lost',outcome_at=statement_timestamp(),lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=target AND state='sending' AND lease_expires_at<=statement_timestamp() RETURNING invitation_id,generation LOOP
  INSERT INTO turnstile.invitation_audit(tenant_id,id,invitation_id,generation,actor_kind,action) VALUES(target,gen_random_uuid(),r.invitation_id,r.generation,'system','delivery_unknown');
 END LOOP;
 IF changed>0 THEN UPDATE turnstile.access_context SET revision=revision+1 WHERE tenant_id=target; END IF;
 RETURN changed;
END $$;
REVOKE ALL ON FUNCTION turnstile.maintain_invitations(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.maintain_invitations(uuid,text) TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.bound_invitation_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (SELECT count(*) FROM turnstile.invitation_audit WHERE tenant_id=NEW.tenant_id)>=100000 THEN RAISE EXCEPTION 'Invitation audit capacity' USING ERRCODE='54000'; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION turnstile.bound_invitation_audit() FROM PUBLIC;
CREATE TRIGGER bound_invitation_audit BEFORE INSERT ON turnstile.invitation_audit FOR EACH ROW EXECUTE FUNCTION turnstile.bound_invitation_audit();
--> statement-breakpoint
CREATE FUNCTION turnstile.guard_invitation_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Invitation approval history is immutable' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION turnstile.guard_invitation_history() FROM PUBLIC;
CREATE TRIGGER invitation_history_guard BEFORE UPDATE ON turnstile.invitation_generation FOR EACH ROW EXECUTE FUNCTION turnstile.guard_invitation_history();
--> statement-breakpoint
CREATE FUNCTION turnstile.guard_invitation_operation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['state','committed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','committed_at']) OR OLD.committed_at IS NOT NULL OR (NEW.state IS DISTINCT FROM OLD.state AND NOT(OLD.state='preparing' AND NEW.state='completed')) THEN RAISE EXCEPTION 'Invitation command identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION turnstile.guard_invitation_operation() FROM PUBLIC;
CREATE TRIGGER invitation_operation_guard BEFORE UPDATE ON turnstile.invitation_operation FOR EACH ROW EXECUTE FUNCTION turnstile.guard_invitation_operation();
