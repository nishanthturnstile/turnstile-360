-- Runtime stays unable to write Access tables. This capability only consumes an
-- existing, current approved invitation and never replaces a member's grants.
ALTER TABLE turnstile.invitation_acceptance FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.invitation_acceptance FROM PUBLIC,thaarei_turnstile_runtime;
GRANT SELECT ON turnstile.invitation_acceptance TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.accept_invitation(target uuid, chosen uuid, expected_generation integer,
 expected_version integer, subject text, verified_email text, epoch text,
 permission_digest text, scope_digest text, request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i turnstile.invitation; g turnstile.invitation_generation; member uuid;
 a jsonb; anchor text; assignment uuid; scope text; before_revision integer; transition_at timestamptz;
BEGIN
 PERFORM turnstile.lock_access_context(target);
 SELECT * INTO i FROM turnstile.invitation WHERE tenant_id=target AND id=chosen FOR UPDATE;
 transition_at:=clock_timestamp();
 IF NOT FOUND OR subject IS NULL OR subject !~ '^[A-Za-z0-9_-]{1,200}$' OR
   epoch IS NULL OR epoch<>i.recovery_epoch THEN RETURN NULL; END IF;
 IF i.state='accepted' THEN
   IF i.accepted_user_id IS DISTINCT FROM subject OR i.generation IS DISTINCT FROM expected_generation THEN RETURN NULL; END IF;
   RETURN (SELECT id FROM turnstile.access_member WHERE tenant_id=target AND user_id=subject);
 END IF;
 IF verified_email IS DISTINCT FROM i.email OR i.state<>'pending' OR i.generation IS DISTINCT FROM expected_generation OR i.version IS DISTINCT FROM expected_version
   OR i.expires_at<=transition_at OR NOT turnstile.invitation_approval_valid(target,chosen)
   OR NOT EXISTS(SELECT 1 FROM turnstile.organization_configuration WHERE tenant_id=target AND completed_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM turnstile.access_member WHERE tenant_id=target AND user_id=subject)
   THEN RETURN NULL; END IF;
 SELECT * INTO g FROM turnstile.invitation_generation WHERE tenant_id=target AND invitation_id=chosen
   AND generation=i.generation AND id=i.approval_id;
 IF NOT FOUND OR g.recovery_epoch<>epoch OR g.expires_at<=transition_at
   OR g.approval->>'permissionDigest' IS DISTINCT FROM permission_digest
   OR g.approval->>'scopeDigest' IS DISTINCT FROM scope_digest THEN RETURN NULL; END IF;
 member:=gen_random_uuid();
 INSERT INTO turnstile.access_member(tenant_id,id,user_id,status) VALUES(target,member,subject,'active');
 FOR a IN SELECT value FROM jsonb_array_elements(g.assignments) LOOP
   assignment:=gen_random_uuid();
   scope:=CASE WHEN a->'scope'->>'kind'='company' THEN 'company' ELSE
     'units:'||(a->'scope'->>'includeChildren')||':'||
       (SELECT string_agg(value,',' ORDER BY value) FROM jsonb_array_elements_text(a->'scope'->'unitIds')) END;
   INSERT INTO turnstile.access_assignment(tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key)
     VALUES(target,assignment,member,(a->'role'->>'id')::uuid,a->'scope'->>'kind',
       coalesce((a->'scope'->>'includeChildren')::boolean,false),scope);
   IF a->'scope'->>'kind'='units' THEN
     FOR anchor IN SELECT value FROM jsonb_array_elements_text(a->'scope'->'unitIds') LOOP
       INSERT INTO turnstile.access_scope_anchor(tenant_id,assignment_id,unit_id) VALUES(target,assignment,anchor::uuid);
     END LOOP;
   END IF;
 END LOOP;
 UPDATE turnstile.invitation SET state='accepted',version=version+1,accepted_at=transition_at,accepted_user_id=subject
   WHERE tenant_id=target AND id=chosen;
 INSERT INTO turnstile.invitation_acceptance(tenant_id,invitation_id,generation,user_id,member_id)
   VALUES(target,chosen,i.generation,subject,member);
 UPDATE turnstile.invitation_delivery SET state='failed',payload=NULL,reason='stale_generation',
   outcome_at=statement_timestamp(),lease_id=NULL,lease_expires_at=NULL
   WHERE tenant_id=target AND invitation_id=chosen AND state IN ('queued','sending');
 DELETE FROM turnstile.invitation_reference WHERE tenant_id=target AND invitation_id=chosen;
 INSERT INTO turnstile.invitation_audit(tenant_id,id,invitation_id,generation,actor_kind,actor_id,action)
   VALUES(target,gen_random_uuid(),chosen,i.generation,'user',subject,'accepted');
 UPDATE turnstile.access_context SET revision=revision+1 WHERE tenant_id=target RETURNING revision-1 INTO before_revision;
 INSERT INTO turnstile.access_audit(tenant_id,id,actor_kind,actor_id,request_id,action,subject_id,subject_user_id,revision_before,revision_after)
   VALUES(target,gen_random_uuid(),'user',subject,request_id,'invitation_changed',member,subject,before_revision,before_revision+1);
 RETURN member;
END $$;
REVOKE ALL ON FUNCTION turnstile.accept_invitation(uuid,uuid,integer,integer,text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.accept_invitation(uuid,uuid,integer,integer,text,text,text,text,text,uuid) TO thaarei_turnstile_runtime;
--> statement-breakpoint
-- Receipt history is immutable even to an operator; retention only deletes.
CREATE TRIGGER invitation_acceptance_history BEFORE UPDATE ON turnstile.invitation_acceptance
 FOR EACH ROW EXECUTE FUNCTION turnstile.guard_invitation_history();
