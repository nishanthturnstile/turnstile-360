ALTER TABLE dms.upload_batch FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.upload_batch_item FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.upload_batch_slot FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.upload_session FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.upload_receipt FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.upload_batch,dms.upload_batch_item,dms.upload_batch_slot,dms.upload_session,dms.upload_receipt FROM PUBLIC,thaarei_dms_runtime,thaarei_dms_operator,thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT,INSERT ON dms.upload_batch,dms.upload_batch_item,dms.upload_batch_slot,dms.upload_session,dms.upload_receipt TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT UPDATE (state) ON dms.upload_batch TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT UPDATE (state,upload_id,admission_error) ON dms.upload_batch_item TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT UPDATE (active) ON dms.upload_batch_slot TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT UPDATE (upload_state,completion_requested_at) ON dms.upload_session TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT SELECT ON dms.upload_batch,dms.upload_batch_item,dms.upload_session,dms.upload_receipt TO thaarei_dms_operator,thaarei_dms_coordinator;

--> statement-breakpoint
CREATE POLICY operator_upload_evidence ON dms.security_event FOR INSERT TO thaarei_dms_operator WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND actor_kind='operator' AND actor_id=current_setting('app.actor_id',true) AND action IN ('operator.upload.inspect','operator.batch.inspect') AND outcome='success' AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=security_event.tenant_id AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));
--> statement-breakpoint
GRANT SELECT (id,document_id,version_id,expires_at) ON dms.upload_admission TO thaarei_dms_operator;
