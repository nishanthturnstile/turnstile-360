ALTER TABLE dms.document_grant FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.document_grant FROM PUBLIC,thaarei_dms_runtime,thaarei_dms_operator,thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT,INSERT,DELETE ON dms.document_grant TO thaarei_dms_runtime,thaarei_dms_operator;
--> statement-breakpoint
CREATE FUNCTION dms.has_document_right(target uuid, permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT current_setting('app.principal_kind',true)='machine' AND EXISTS (
 SELECT 1 FROM dms.document d JOIN dms.application_registration owner ON owner.id=d.application_id AND owner.tenant_id=d.tenant_id JOIN dms.application_registration caller ON caller.id=nullif(current_setting('app.application_id',true),'')::uuid AND caller.tenant_id=d.tenant_id
 WHERE d.id=target AND d.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND d.lifecycle='ACTIVE' AND owner.status='active' AND caller.status='active' AND caller.principal_kind='consumer'
 AND (d.application_id=caller.id OR EXISTS(SELECT 1 FROM dms.document_grant g WHERE g.tenant_id=d.tenant_id AND g.document_id=d.id AND g.application_id=caller.id AND (permission='VISIBLE' OR permission=ANY(g.rights)))))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.has_document_right(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.has_document_right(uuid,text) TO thaarei_dms_runtime;
--> statement-breakpoint
CREATE FUNCTION dms.upload_document(target uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT document_id FROM dms.upload_admission WHERE id=target AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND dms.has_document_right(document_id,'VISIBLE') $$;
--> statement-breakpoint
CREATE FUNCTION dms.controls_upload(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM dms.upload_admission a WHERE a.id=target AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND (a.application_id=nullif(current_setting('app.application_id',true),'')::uuid OR a.contributor_application_id=nullif(current_setting('app.application_id',true),'')::uuid) AND dms.has_document_right(a.document_id,'ADD_VERSION')) $$;
--> statement-breakpoint
CREATE FUNCTION dms.can_charge(owner_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM dms.document d WHERE d.application_id=owner_id AND d.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND dms.has_document_right(d.id,'ADD_VERSION')) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.upload_document(uuid),dms.controls_upload(uuid),dms.can_charge(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.upload_document(uuid),dms.controls_upload(uuid),dms.can_charge(uuid) TO thaarei_dms_runtime;
--> statement-breakpoint
CREATE POLICY shared_read ON dms.document FOR SELECT TO thaarei_dms_runtime USING (dms.has_document_right(id,'VISIBLE'));
--> statement-breakpoint
CREATE POLICY shared_update ON dms.document FOR UPDATE TO thaarei_dms_runtime USING (dms.has_document_right(id,'EDIT_METADATA') OR dms.has_document_right(id,'ADD_VERSION')) WITH CHECK (dms.has_document_right(id,'EDIT_METADATA') OR dms.has_document_right(id,'ADD_VERSION'));
--> statement-breakpoint
CREATE POLICY shared_read ON dms.document_version FOR SELECT TO thaarei_dms_runtime USING (dms.has_document_right(document_id,'VISIBLE'));
--> statement-breakpoint
CREATE POLICY shared_insert ON dms.document_version FOR INSERT TO thaarei_dms_runtime WITH CHECK (dms.has_document_right(document_id,'ADD_VERSION'));
--> statement-breakpoint
CREATE POLICY shared_read ON dms.upload_admission FOR SELECT TO thaarei_dms_runtime USING (dms.has_document_right(document_id,'VISIBLE'));
--> statement-breakpoint
CREATE POLICY shared_insert ON dms.upload_admission FOR INSERT TO thaarei_dms_runtime WITH CHECK (contributor_application_id=nullif(current_setting('app.application_id',true),'')::uuid AND dms.has_document_right(document_id,'ADD_VERSION'));
--> statement-breakpoint
CREATE POLICY shared_update ON dms.upload_admission FOR UPDATE TO thaarei_dms_runtime USING (dms.controls_upload(id)) WITH CHECK (dms.controls_upload(id));
--> statement-breakpoint
CREATE POLICY shared_read ON dms.upload_session FOR SELECT TO thaarei_dms_runtime USING (dms.has_document_right(dms.upload_document(id),'VISIBLE'));
--> statement-breakpoint
CREATE POLICY shared_insert ON dms.upload_session FOR INSERT TO thaarei_dms_runtime WITH CHECK (dms.controls_upload(id));
--> statement-breakpoint
CREATE POLICY shared_update ON dms.upload_session FOR UPDATE TO thaarei_dms_runtime USING (dms.controls_upload(id)) WITH CHECK (dms.controls_upload(id));
--> statement-breakpoint
CREATE POLICY shared_read ON dms.security_candidate FOR SELECT TO thaarei_dms_runtime USING (dms.has_document_right(dms.upload_document(upload_id),'VISIBLE'));
--> statement-breakpoint
CREATE POLICY shared_read ON dms.binary_restore FOR SELECT TO thaarei_dms_runtime USING (dms.has_document_right(dms.upload_document(id),'READ'));
--> statement-breakpoint
CREATE POLICY shared_usage ON dms.admission_application_usage FOR ALL TO thaarei_dms_runtime USING (dms.can_charge(application_id)) WITH CHECK (dms.can_charge(application_id));
--> statement-breakpoint
CREATE POLICY shared_audit ON dms.audit_event FOR INSERT TO thaarei_dms_runtime WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND actor_kind='machine' AND actor_id=current_setting('app.actor_id',true) AND document_id IS NOT NULL AND dms.has_document_right(document_id,'VISIBLE'));
--> statement-breakpoint
CREATE POLICY shared_outbox ON dms.outbox_intent FOR INSERT TO thaarei_dms_runtime WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM dms.document d WHERE d.application_id=outbox_intent.application_id AND dms.has_document_right(d.id,'VISIBLE')));
--> statement-breakpoint
GRANT UPDATE (revision) ON dms.document TO thaarei_dms_operator;
--> statement-breakpoint
GRANT INSERT ON dms.audit_event,dms.outbox_intent TO thaarei_dms_operator;
--> statement-breakpoint
CREATE POLICY operator_grants_update ON dms.document FOR UPDATE TO thaarei_dms_operator USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization WHERE subject_id=current_setting('app.actor_id',true) AND tenant_id=document.tenant_id AND revoked_at IS NULL)) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
CREATE POLICY operator_grants_audit ON dms.audit_event FOR INSERT TO thaarei_dms_operator WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND action='document.permissions-changed' AND actor_kind='operator' AND actor_id=current_setting('app.actor_id',true) AND EXISTS(SELECT 1 FROM dms.operator_authorization WHERE subject_id=current_setting('app.actor_id',true) AND tenant_id=audit_event.tenant_id AND revoked_at IS NULL));
--> statement-breakpoint
CREATE POLICY operator_grants_outbox ON dms.outbox_intent FOR INSERT TO thaarei_dms_operator WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND kind='document.permissions-changed' AND EXISTS(SELECT 1 FROM dms.operator_authorization WHERE subject_id=current_setting('app.actor_id',true) AND tenant_id=outbox_intent.tenant_id AND revoked_at IS NULL));
--> statement-breakpoint
CREATE FUNCTION dms.default_contributor() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN NEW.contributor_application_id=coalesce(NEW.contributor_application_id,NEW.application_id); RETURN NEW; END $$;
--> statement-breakpoint
CREATE FUNCTION dms.default_batch_application() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN NEW.batch_application_id=coalesce(NEW.batch_application_id,NEW.application_id); RETURN NEW; END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.default_contributor(),dms.default_batch_application() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER default_contributor BEFORE INSERT ON dms.upload_admission FOR EACH ROW EXECUTE FUNCTION dms.default_contributor();
--> statement-breakpoint
CREATE TRIGGER default_batch_application BEFORE INSERT ON dms.upload_session FOR EACH ROW EXECUTE FUNCTION dms.default_batch_application();
--> statement-breakpoint
UPDATE dms.document SET "references"=(SELECT coalesce(jsonb_agg(ref || jsonb_build_object('applicationId',application_id)),'[]'::jsonb) FROM jsonb_array_elements("references") ref);
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.has_document_right(uuid,text) TO thaarei_dms_operator;
--> statement-breakpoint
CREATE FUNCTION dms.operator_grant_targets(targets uuid[]) RETURNS SETOF uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT r.id FROM dms.application_registration r WHERE cardinality(targets)<=64 AND r.id=ANY(targets) AND r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND r.status='active' AND r.principal_kind='consumer' AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=r.tenant_id AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL) ORDER BY r.id FOR SHARE
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.operator_grant_targets(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dms.operator_grant_targets(uuid[]) TO thaarei_dms_operator;
