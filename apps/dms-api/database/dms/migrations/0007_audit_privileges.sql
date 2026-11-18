ALTER TABLE dms.audit_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.outbox_intent FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.audit_event, dms.outbox_intent FROM PUBLIC, thaarei_dms_runtime, thaarei_dms_operator, thaarei_dms_coordinator;
--> statement-breakpoint
GRANT USAGE ON SCHEMA dms TO thaarei_dms_operator, thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT ON dms.installation, dms.operator_authorization, dms.audit_event TO thaarei_dms_operator;
--> statement-breakpoint
GRANT INSERT ON dms.security_event TO thaarei_dms_operator;
--> statement-breakpoint
GRANT SELECT, INSERT ON dms.audit_event TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT INSERT ON dms.outbox_intent TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT SELECT ON dms.outbox_intent TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE POLICY operator_grant_read ON dms.operator_authorization FOR SELECT TO thaarei_dms_operator USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND subject_id = current_setting('app.actor_id',true));
--> statement-breakpoint
CREATE POLICY operator_read_evidence ON dms.security_event FOR INSERT TO thaarei_dms_operator WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND actor_kind = 'operator' AND actor_id = current_setting('app.actor_id',true) AND action = 'operator.audit.read' AND outcome = 'success' AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id = security_event.tenant_id AND oa.subject_id = current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));
