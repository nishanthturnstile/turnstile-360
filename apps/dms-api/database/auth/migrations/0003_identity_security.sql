-- Authority feature tables are separate from the provider-owned NOT RLS tables.
ALTER TABLE auth.identity_epoch ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.identity_epoch FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY identity_epoch_installation ON auth.identity_epoch TO thaarei_auth_runtime, thaarei_auth_migrator USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
REVOKE ALL ON auth.identity_epoch FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.identity_epoch TO thaarei_auth_runtime;
--> statement-breakpoint
ALTER TABLE auth.identity_preparation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.identity_preparation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY identity_preparation_installation ON auth.identity_preparation TO thaarei_auth_runtime, thaarei_auth_migrator USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
REVOKE ALL ON auth.identity_preparation FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.identity_preparation TO thaarei_auth_runtime;
--> statement-breakpoint
ALTER TABLE auth.identity_setup ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.identity_setup FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY identity_setup_installation ON auth.identity_setup TO thaarei_auth_runtime, thaarei_auth_migrator USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
REVOKE ALL ON auth.identity_setup FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.identity_setup TO thaarei_auth_runtime;
--> statement-breakpoint
ALTER TABLE auth.identity_subject ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.identity_subject FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY identity_subject_installation ON auth.identity_subject TO thaarei_auth_runtime, thaarei_auth_migrator USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
REVOKE ALL ON auth.identity_subject FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.identity_subject TO thaarei_auth_runtime;
--> statement-breakpoint
ALTER TABLE auth.identity_limit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.identity_limit FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY identity_limit_installation ON auth.identity_limit TO thaarei_auth_runtime, thaarei_auth_migrator USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
REVOKE ALL ON auth.identity_limit FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.identity_limit TO thaarei_auth_runtime;
--> statement-breakpoint
ALTER TABLE auth.identity_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.identity_audit FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY identity_audit_installation ON auth.identity_audit TO thaarei_auth_runtime, thaarei_auth_migrator USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
REVOKE ALL ON auth.identity_audit FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON auth.identity_audit TO thaarei_auth_runtime;
