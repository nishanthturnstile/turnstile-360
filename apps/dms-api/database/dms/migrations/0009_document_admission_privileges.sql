ALTER TABLE dms.document FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.document_version FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.upload_admission FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.admission_policy FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.admission_capacity FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.admission_tenant_usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.admission_application_usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.document,dms.document_version,dms.upload_admission,dms.admission_policy,dms.admission_capacity,dms.admission_tenant_usage,dms.admission_application_usage FROM PUBLIC,thaarei_dms_runtime,thaarei_dms_operator,thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT ON dms.document,dms.document_version,dms.upload_admission,dms.admission_policy,dms.admission_capacity,dms.admission_tenant_usage,dms.admission_application_usage TO thaarei_dms_runtime,thaarei_dms_coordinator;
--> statement-breakpoint
GRANT INSERT ON dms.document,dms.document_version,dms.upload_admission,dms.admission_tenant_usage,dms.admission_application_usage TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT UPDATE (revision,next_version) ON dms.document TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT UPDATE (capability_expires_at) ON dms.upload_admission TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT UPDATE ON dms.admission_tenant_usage,dms.admission_application_usage TO thaarei_dms_runtime,thaarei_dms_coordinator;
--> statement-breakpoint
GRANT INSERT ON dms.admission_tenant_usage,dms.admission_application_usage,dms.admission_capacity TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE ON dms.admission_capacity TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (state,reserved_storage,reserved_scratch,staging_bytes,original_bytes,work_released) ON dms.upload_admission TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT ON dms.installation TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT INSERT ON dms.audit_event,dms.outbox_intent TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT ON dms.document,dms.document_version,dms.admission_policy TO thaarei_dms_operator;
--> statement-breakpoint
GRANT INSERT ON dms.admission_policy TO thaarei_dms_operator;
--> statement-breakpoint
GRANT UPDATE (revision,settings,updated_at) ON dms.admission_policy TO thaarei_dms_operator;
--> statement-breakpoint
CREATE POLICY operator_admission_evidence ON dms.security_event FOR INSERT TO thaarei_dms_operator WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND actor_kind='operator' AND actor_id=current_setting('app.actor_id',true) AND action IN ('operator.document.inspect','admission.policy.read','admission.policy.configure') AND outcome='success' AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=security_event.tenant_id AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));
