ALTER TABLE dms.security_candidate FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.security_candidate FROM PUBLIC,thaarei_dms_runtime,thaarei_dms_operator,thaarei_dms_coordinator;
--> statement-breakpoint
GRANT SELECT ON dms.security_candidate TO thaarei_dms_coordinator,thaarei_dms_runtime;
--> statement-breakpoint
GRANT INSERT ON dms.security_candidate TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (state,sha256,evidence,assessed_at) ON dms.security_candidate TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (availability) ON dms.document_version TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (current_version_id,revision) ON dms.document TO thaarei_dms_coordinator;
