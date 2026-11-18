ALTER TABLE dms.work_identity FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.work_job FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.work_dispatch FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.work_attempt FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.work_identity,dms.work_job,dms.work_dispatch,dms.work_attempt FROM PUBLIC,thaarei_dms_runtime,thaarei_dms_operator,thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT ON dms.work_identity,dms.work_job,dms.work_dispatch,dms.work_attempt TO thaarei_dms_coordinator,thaarei_dms_operator;
--> statement-breakpoint
GRANT INSERT,UPDATE ON dms.work_job,dms.work_dispatch,dms.work_attempt TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT INSERT ON dms.work_identity TO thaarei_dms_operator;
--> statement-breakpoint
GRANT UPDATE (enabled) ON dms.work_identity TO thaarei_dms_operator;
--> statement-breakpoint
GRANT SELECT ON dms.application_registration TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (updated_at) ON dms.application_registration TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE POLICY coordinator_registration_read ON dms.application_registration FOR SELECT TO thaarei_dms_coordinator USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
CREATE POLICY coordinator_registration_lock ON dms.application_registration FOR UPDATE TO thaarei_dms_coordinator USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
GRANT UPDATE (upload_state,discovery_token,discovery_until,discovery_next_at,observed_etag,observed_size,observed_at,failure_code) ON dms.upload_session TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE POLICY coordinator_session_update ON dms.upload_session FOR UPDATE TO thaarei_dms_coordinator USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
GRANT UPDATE (state) ON dms.upload_batch,dms.upload_batch_item TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT ON dms.upload_batch_slot TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (active) ON dms.upload_batch_slot TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE POLICY coordinator_batch_update ON dms.upload_batch FOR UPDATE TO thaarei_dms_coordinator USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
CREATE POLICY coordinator_item_update ON dms.upload_batch_item FOR UPDATE TO thaarei_dms_coordinator USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
CREATE POLICY coordinator_slot_read ON dms.upload_batch_slot FOR SELECT TO thaarei_dms_coordinator USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
CREATE POLICY coordinator_slot_update ON dms.upload_batch_slot FOR UPDATE TO thaarei_dms_coordinator USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
CREATE POLICY operator_work_evidence ON dms.security_event FOR INSERT TO thaarei_dms_operator WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND actor_kind='operator' AND actor_id=current_setting('app.actor_id',true) AND action IN ('operator.work.authorize','operator.work.disable','operator.work.inspect') AND outcome='success' AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=security_event.tenant_id AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL));
