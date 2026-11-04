ALTER TABLE turnstile.member_display FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.member_display FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON turnstile.member_display TO thaarei_turnstile_runtime;
--> statement-breakpoint
-- An action and its scope remain paired; shell never broadens resource authority.
CREATE FUNCTION turnstile.people_covers(target uuid, subject text, actions text[], scope jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 WITH RECURSIVE actor AS (SELECT * FROM turnstile.access_member WHERE tenant_id=target AND user_id=subject AND status='active'),
 sources AS (
  SELECT a.scope_kind,a.include_children,ARRAY(SELECT unit_id FROM turnstile.access_scope_anchor s WHERE s.tenant_id=target AND s.assignment_id=a.id) AS anchors,
    ARRAY(SELECT permission FROM turnstile.access_role_permission p WHERE p.tenant_id=target AND p.role_id=a.role_id) AS permissions
    FROM turnstile.access_assignment a JOIN actor m ON m.tenant_id=a.tenant_id AND m.id=a.member_id
  UNION ALL SELECT 'company',false,ARRAY[]::uuid[],l.permissions FROM turnstile.access_legacy_source l JOIN actor m ON m.tenant_id=l.tenant_id AND m.id=l.member_id WHERE NOT l.retired
 ), abilities AS (SELECT s.*,p.action FROM sources s CROSS JOIN LATERAL unnest(s.permissions || CASE WHEN 'turnstile:configuration:manage'=ANY(s.permissions) THEN ARRAY['turnstile:units:read','turnstile:units:manage'] WHEN 'turnstile:units:manage'=ANY(s.permissions) THEN ARRAY['turnstile:units:read'] ELSE ARRAY[]::text[] END) p(action)),
 ancestry AS (SELECT id,id AS ancestor,0 AS depth FROM turnstile.organization_unit WHERE tenant_id=target
  UNION ALL SELECT a.id,u.parent_id,a.depth+1 FROM ancestry a JOIN turnstile.organization_unit u ON u.tenant_id=target AND u.id=a.ancestor WHERE u.parent_id IS NOT NULL AND a.depth<8)
 SELECT EXISTS(SELECT 1 FROM abilities WHERE action='turnstile:access') AND actions IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM unnest(actions) wanted WHERE wanted<>'turnstile:access' AND CASE
  WHEN scope->>'kind'='company' THEN NOT EXISTS(SELECT 1 FROM abilities b WHERE b.action=wanted AND b.scope_kind='company')
  WHEN scope->>'kind'='units' THEN EXISTS(SELECT 1 FROM jsonb_array_elements_text(scope->'unitIds') x(id) WHERE NOT EXISTS(
   SELECT 1 FROM abilities b WHERE b.action=wanted AND (b.scope_kind='company' OR ((NOT coalesce((scope->>'includeChildren')::boolean,false) OR b.include_children)
    AND EXISTS(SELECT 1 FROM unnest(b.anchors) anchor WHERE anchor=x.id::uuid OR (b.include_children AND EXISTS(SELECT 1 FROM ancestry a WHERE a.id=x.id::uuid AND a.ancestor=anchor)))))))
  ELSE true END);

$$;
REVOKE ALL ON FUNCTION turnstile.people_covers(uuid,text,text[],jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.people_covers(uuid,text,text[],jsonb) TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.people_admin(target uuid, subject text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM turnstile.access_member m JOIN turnstile.access_assignment a ON a.tenant_id=m.tenant_id AND a.member_id=m.id
 JOIN turnstile.access_role r ON r.tenant_id=a.tenant_id AND r.id=a.role_id WHERE m.tenant_id=target AND m.user_id=subject AND m.status='active' AND a.scope_kind='company' AND r.system_key='workspace_administrator');
$$;
REVOKE ALL ON FUNCTION turnstile.people_admin(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.people_admin(uuid,text) TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.apply_people_command(target uuid, actor text, command_key uuid, command_digest text,
 command jsonb, created_id uuid, name_key text, request_id uuid, token_hash text, impact_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE op text:=command->>'operation'; chosen uuid; role turnstile.access_role; member turnstile.access_member;
 current_revision integer; org_revision integer; permissions text[]; previous_permissions text[]; entry jsonb; old record;
 old_scope jsonb; key_scope text; role_key text; rid uuid; referenced boolean:=false; permission_change boolean:=false;
 changed boolean:=false; retire boolean:=false; before_admins integer; before_managers integer; event text;
BEGIN
 PERFORM turnstile.lock_access_context(target);
 IF op NOT IN ('role.create','role.patch','role.delete','member.assignments','member.suspend','member.reactivate') OR actor IS NULL OR command_digest !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
 IF NOT turnstile.people_covers(target,actor,ARRAY[CASE WHEN op LIKE 'role.%' THEN 'turnstile:roles:manage' ELSE 'turnstile:people:manage' END],'{"kind":"company"}') THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM turnstile.configuration_create_receipt WHERE tenant_id=target AND actor_id=actor AND key=command_key AND expires_at>statement_timestamp()) OR EXISTS(SELECT 1 FROM turnstile.access_command_receipt WHERE tenant_id=target AND actor_id=actor AND key=command_key AND expires_at>statement_timestamp()) THEN RAISE EXCEPTION 'people_conflict' USING ERRCODE='23514'; END IF;
 SELECT revision INTO current_revision FROM turnstile.access_context WHERE tenant_id=target;
 SELECT revision INTO org_revision FROM turnstile.organization_configuration WHERE tenant_id=target AND completed_at IS NOT NULL;
 IF org_revision IS NULL OR current_revision IS DISTINCT FROM (command->>'expectedAccessRevision')::int OR (command ? 'expectedOrganizationRevision' AND org_revision IS DISTINCT FROM (command->>'expectedOrganizationRevision')::int) THEN RAISE EXCEPTION 'people_version' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO before_admins FROM turnstile.access_member m WHERE m.tenant_id=target AND turnstile.people_admin(target,m.user_id);
 SELECT count(*) INTO before_managers FROM turnstile.access_member m WHERE m.tenant_id=target AND turnstile.people_covers(target,m.user_id,ARRAY['turnstile:configuration:manage'],'{"kind":"company"}');
 chosen:=CASE WHEN op='role.create' THEN created_id ELSE (command->>'id')::uuid END;
 IF op LIKE 'role.%' THEN
  IF op<>'role.create' THEN
   SELECT * INTO role FROM turnstile.access_role WHERE tenant_id=target AND id=chosen FOR UPDATE;
   IF NOT FOUND OR role.version IS DISTINCT FROM (command->>'expectedVersion')::int THEN RAISE EXCEPTION 'people_version' USING ERRCODE='23514'; END IF;
   IF role.system_key IS NOT NULL THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
   SELECT ARRAY(SELECT permission FROM turnstile.access_role_permission WHERE tenant_id=target AND role_id=chosen ORDER BY permission) INTO previous_permissions;
   referenced:=EXISTS(SELECT 1 FROM turnstile.access_assignment WHERE tenant_id=target AND role_id=chosen) OR EXISTS(SELECT 1 FROM turnstile.invitation_reference WHERE tenant_id=target AND role_id=chosen);
  END IF;
  IF op='role.create' OR (op='role.patch' AND command->>'change'='permissions') THEN
   IF command->>'source'='copy' THEN
    SELECT ARRAY(SELECT permission FROM turnstile.access_role_permission WHERE tenant_id=target AND role_id=r.id ORDER BY permission) INTO permissions FROM turnstile.access_role r WHERE r.tenant_id=target AND r.id=(command->>'copyFromRoleId')::uuid AND r.version=(command->>'expectedRoleVersion')::int;
   ELSE SELECT ARRAY(SELECT value FROM jsonb_array_elements_text(command->'permissions') ORDER BY value) INTO permissions; END IF;
   IF permissions IS NULL OR cardinality(permissions)<1 OR NOT ('turnstile:access'=ANY(permissions)) THEN RAISE EXCEPTION 'people_version' USING ERRCODE='23514'; END IF;
   permission_change:=previous_permissions IS DISTINCT FROM permissions;
   IF NOT turnstile.people_covers(target,actor,CASE WHEN op='role.create' THEN permissions ELSE ARRAY(SELECT unnest(permissions) EXCEPT SELECT unnest(previous_permissions)) END,'{"kind":"company"}') THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
   IF permission_change AND referenced THEN
    IF NOT turnstile.people_covers(target,actor,ARRAY['turnstile:people:manage'],'{"kind":"company"}') THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
    FOR old IN SELECT a.*,ARRAY(SELECT unit_id FROM turnstile.access_scope_anchor s WHERE s.tenant_id=target AND s.assignment_id=a.id ORDER BY unit_id) AS anchors FROM turnstile.access_assignment a WHERE tenant_id=target AND role_id=chosen LOOP
      old_scope:=CASE WHEN old.scope_kind='company' THEN '{"kind":"company"}'::jsonb ELSE jsonb_build_object('kind','units','unitIds',old.anchors,'includeChildren',old.include_children) END;
      IF NOT turnstile.people_covers(target,actor,previous_permissions||permissions,old_scope) OR (old.scope_kind='units' AND permissions && ARRAY['turnstile:dms:capabilities:read','turnstile:configuration:manage','turnstile:people:manage','turnstile:roles:manage']) THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
    END LOOP;
    FOR old IN SELECT i.assignments FROM turnstile.invitation i JOIN turnstile.invitation_reference x ON x.tenant_id=i.tenant_id AND x.invitation_id=i.id WHERE x.tenant_id=target AND x.role_id=chosen LOOP
     FOR entry IN SELECT value FROM jsonb_array_elements(old.assignments) WHERE value->'role'->>'id'=chosen::text LOOP
      IF NOT turnstile.people_covers(target,actor,previous_permissions||permissions,entry->'scope') OR (entry->'scope'->>'kind'='units' AND permissions && ARRAY['turnstile:dms:capabilities:read','turnstile:configuration:manage','turnstile:people:manage','turnstile:roles:manage']) THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
     END LOOP;
    END LOOP;
   END IF;
  END IF;
 ELSE
  SELECT * INTO member FROM turnstile.access_member WHERE tenant_id=target AND id=chosen FOR UPDATE;
  IF NOT FOUND OR member.version IS DISTINCT FROM (command->>'expectedVersion')::int THEN RAISE EXCEPTION 'people_version' USING ERRCODE='23514'; END IF;
  FOR old IN SELECT a.*,r.system_key,ARRAY(SELECT permission FROM turnstile.access_role_permission p WHERE p.tenant_id=target AND p.role_id=a.role_id) AS permissions,ARRAY(SELECT unit_id FROM turnstile.access_scope_anchor s WHERE s.tenant_id=target AND s.assignment_id=a.id ORDER BY unit_id) AS anchors FROM turnstile.access_assignment a JOIN turnstile.access_role r ON r.tenant_id=a.tenant_id AND r.id=a.role_id WHERE a.tenant_id=target AND a.member_id=chosen LOOP
   old_scope:=CASE WHEN old.scope_kind='company' THEN '{"kind":"company"}'::jsonb ELSE jsonb_build_object('kind','units','unitIds',old.anchors,'includeChildren',old.include_children) END;
   IF op<>'member.assignments' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') a WHERE a->>'roleId'=old.role_id::text AND (CASE WHEN a->'scope'->>'kind'='company' THEN 'company' ELSE 'units:'||(a->'scope'->>'includeChildren')||':'||(SELECT string_agg(value,',' ORDER BY value) FROM jsonb_array_elements_text(a->'scope'->'unitIds')) END)=old.scope_key) THEN
    IF NOT turnstile.people_covers(target,actor,old.permissions,old_scope) OR (old.system_key='workspace_administrator' AND NOT turnstile.people_admin(target,actor)) THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
   END IF;
  END LOOP;
  IF op='member.assignments' THEN
   FOR entry IN SELECT value FROM jsonb_array_elements(command->'assignments') LOOP
    SELECT r.system_key,ARRAY(SELECT permission FROM turnstile.access_role_permission p WHERE p.tenant_id=target AND p.role_id=r.id) INTO role_key,permissions FROM turnstile.access_role r WHERE r.tenant_id=target AND r.id=(entry->>'roleId')::uuid AND r.version=(entry->>'expectedRoleVersion')::int;
    IF NOT FOUND THEN RAISE EXCEPTION 'people_version' USING ERRCODE='23514'; END IF;
    IF NOT turnstile.people_covers(target,actor,permissions,entry->'scope') AND NOT EXISTS(SELECT 1 FROM turnstile.access_assignment WHERE tenant_id=target AND member_id=chosen AND role_id=(entry->>'roleId')::uuid AND scope_key=CASE WHEN entry->'scope'->>'kind'='company' THEN 'company' ELSE 'units:'||(entry->'scope'->>'includeChildren')||':'||(SELECT string_agg(value,',' ORDER BY value) FROM jsonb_array_elements_text(entry->'scope'->'unitIds')) END) THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
    IF role_key='workspace_administrator' AND NOT turnstile.people_admin(target,actor) AND NOT EXISTS(SELECT 1 FROM turnstile.access_assignment WHERE tenant_id=target AND member_id=chosen AND role_id=(entry->>'roleId')::uuid) THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
   END LOOP;
   IF command->>'retireLegacyVersion' IS NOT NULL THEN
    SELECT * INTO old FROM turnstile.access_legacy_source WHERE tenant_id=target AND member_id=chosen;
    IF NOT FOUND OR old.version IS DISTINCT FROM (command->>'retireLegacyVersion')::int THEN RAISE EXCEPTION 'people_version' USING ERRCODE='23514'; END IF;
    retire:=NOT old.retired;
    IF retire AND NOT turnstile.people_covers(target,actor,old.permissions,'{"kind":"company"}') THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
   END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM turnstile.access_legacy_source l WHERE l.tenant_id=target AND l.member_id=chosen AND NOT l.retired AND NOT turnstile.people_covers(target,actor,l.permissions,'{"kind":"company"}')) THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 IF op LIKE 'member.%' OR (op='role.patch' AND permission_change AND referenced) THEN
  IF NOT EXISTS(SELECT 1 FROM turnstile.access_impact_receipt proof WHERE proof.tenant_id=target AND proof.actor_id=actor AND proof.access_revision=current_revision AND proof.organization_revision=org_revision AND proof.token_hash=apply_people_command.token_hash AND proof.command_digest=impact_digest AND proof.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'people_impact' USING ERRCODE='23514'; END IF;
 END IF;
 IF op='role.create' THEN
  IF (SELECT count(*) FROM turnstile.access_role WHERE tenant_id=target)>=128 THEN RAISE EXCEPTION 'Role capacity' USING ERRCODE='54000'; END IF;
  INSERT INTO turnstile.access_role(tenant_id,id,name,name_key,description) VALUES(target,chosen,command->>'name',apply_people_command.name_key,command->>'description');
  INSERT INTO turnstile.access_role_permission(tenant_id,role_id,permission) SELECT target,chosen,unnest(permissions);changed:=true;event:='role_created';
 ELSIF op='role.delete' THEN
  IF referenced THEN RAISE EXCEPTION 'people_reference' USING ERRCODE='23514'; END IF;
  DELETE FROM turnstile.access_role_permission WHERE tenant_id=target AND role_id=chosen;
  DELETE FROM turnstile.access_role WHERE tenant_id=target AND id=chosen;changed:=true;event:='role_deleted';
 ELSIF op='role.patch' THEN
  IF command->>'change'='permissions' THEN
   changed:=permission_change;event:='role_permissions_changed';
   IF changed THEN
    UPDATE turnstile.access_role SET version=version+1,permission_version=permission_version+1 WHERE tenant_id=target AND id=chosen;
    DELETE FROM turnstile.access_role_permission WHERE tenant_id=target AND role_id=chosen;
    INSERT INTO turnstile.access_role_permission(tenant_id,role_id,permission) SELECT target,chosen,unnest(permissions);
   END IF;
  ELSE
   changed:=(command ? 'name' AND command->>'name' IS DISTINCT FROM role.name) OR (command ? 'description' AND command->>'description' IS DISTINCT FROM role.description);event:='role_details_changed';
   IF changed THEN UPDATE turnstile.access_role SET version=version+1,name=CASE WHEN command ? 'name' THEN command->>'name' ELSE name END,name_key=CASE WHEN command ? 'name' THEN apply_people_command.name_key ELSE access_role.name_key END,description=CASE WHEN command ? 'description' THEN command->>'description' ELSE description END WHERE tenant_id=target AND id=chosen; END IF;
  END IF;
 ELSIF op='member.assignments' THEN
  FOR old IN SELECT * FROM turnstile.access_assignment WHERE tenant_id=target AND member_id=chosen LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') a WHERE a->>'roleId'=old.role_id::text AND (CASE WHEN a->'scope'->>'kind'='company' THEN 'company' ELSE 'units:'||(a->'scope'->>'includeChildren')||':'||(SELECT string_agg(value,',' ORDER BY value) FROM jsonb_array_elements_text(a->'scope'->'unitIds')) END)=old.scope_key) THEN
    DELETE FROM turnstile.access_scope_anchor WHERE tenant_id=target AND assignment_id=old.id;
    DELETE FROM turnstile.access_assignment WHERE tenant_id=target AND id=old.id;changed:=true;
   END IF;
  END LOOP;
  FOR entry IN SELECT value FROM jsonb_array_elements(command->'assignments') LOOP
   key_scope:=CASE WHEN entry->'scope'->>'kind'='company' THEN 'company' ELSE 'units:'||(entry->'scope'->>'includeChildren')||':'||(SELECT string_agg(value,',' ORDER BY value) FROM jsonb_array_elements_text(entry->'scope'->'unitIds')) END;
   rid:=gen_random_uuid();
   INSERT INTO turnstile.access_assignment(tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key)
    VALUES(target,rid,chosen,(entry->>'roleId')::uuid,entry->'scope'->>'kind',coalesce((entry->'scope'->>'includeChildren')::boolean,false),key_scope) ON CONFLICT DO NOTHING;
   IF FOUND THEN
    changed:=true;
    IF entry->'scope'->>'kind'='units' THEN INSERT INTO turnstile.access_scope_anchor(tenant_id,assignment_id,unit_id) SELECT target,rid,value::uuid FROM jsonb_array_elements_text(entry->'scope'->'unitIds'); END IF;
   END IF;
  END LOOP;
  IF retire THEN UPDATE turnstile.access_legacy_source SET retired=true,version=version+1 WHERE tenant_id=target AND member_id=chosen;changed:=true; END IF;
  IF changed THEN UPDATE turnstile.access_member SET version=version+1 WHERE tenant_id=target AND id=chosen; END IF;event:='member_assignments_changed';
 ELSE
  changed:=member.status IS DISTINCT FROM CASE WHEN op='member.suspend' THEN 'suspended' ELSE 'active' END;
  IF changed THEN UPDATE turnstile.access_member SET status=CASE WHEN op='member.suspend' THEN 'suspended' ELSE 'active' END,version=version+1 WHERE tenant_id=target AND id=chosen; END IF;
  event:=CASE WHEN op='member.suspend' THEN 'member_suspended' ELSE 'member_reactivated' END;
 END IF;
 IF before_admins>0 AND NOT EXISTS(SELECT 1 FROM turnstile.access_member m WHERE m.tenant_id=target AND turnstile.people_admin(target,m.user_id)) THEN RAISE EXCEPTION 'people_last_admin' USING ERRCODE='23514'; END IF;
 IF before_managers>0 AND NOT EXISTS(SELECT 1 FROM turnstile.access_member m WHERE m.tenant_id=target AND turnstile.people_covers(target,m.user_id,ARRAY['turnstile:configuration:manage'],'{"kind":"company"}')) THEN RAISE EXCEPTION 'people_last_manager' USING ERRCODE='23514'; END IF;
 IF changed THEN
  UPDATE turnstile.access_context SET revision=revision+1 WHERE tenant_id=target;
  INSERT INTO turnstile.access_audit(tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,subject_user_id,revision_before,revision_after)
    VALUES(target,gen_random_uuid(),'user',actor,request_id,event,chosen,member.user_id,current_revision,current_revision+1);
  IF retire THEN INSERT INTO turnstile.access_audit(tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,subject_user_id,revision_before,revision_after) VALUES(target,gen_random_uuid(),'user',actor,request_id,'legacy_retired',chosen,member.user_id,current_revision,current_revision+1); END IF;
 END IF;
 DELETE FROM turnstile.access_command_receipt WHERE tenant_id=target AND actor_id=actor AND key=command_key AND expires_at<=statement_timestamp();
 IF (SELECT count(*) FROM turnstile.access_command_receipt WHERE tenant_id=target)>=10000 THEN RAISE EXCEPTION 'Receipt capacity' USING ERRCODE='54000'; END IF;
 INSERT INTO turnstile.access_command_receipt(tenant_id,actor_id,key,operation,digest,subject_id,people_changed) VALUES(target,actor,command_key,op,command_digest,chosen,changed);
 RETURN chosen;
END $$;
REVOKE ALL ON FUNCTION turnstile.apply_people_command(uuid,text,uuid,text,jsonb,uuid,text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.apply_people_command(uuid,text,uuid,text,jsonb,uuid,text,uuid,text,text) TO thaarei_turnstile_runtime;
