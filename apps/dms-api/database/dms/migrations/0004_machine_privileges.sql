-- Custom SQL migration file, put your code below! --
-- Runtime enrollment can consume keys and create receipts, but cannot issue/revoke keys,
-- rewrite identity/scope mappings, alter receipts, or edit/delete security evidence.
ALTER TABLE dms.enrollment_key FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.enrollment_receipt FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dms.security_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.enrollment_key, dms.enrollment_receipt, dms.security_event FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON dms.enrollment_key, dms.enrollment_receipt TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT UPDATE (consumed_at) ON dms.enrollment_key TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT INSERT ON dms.enrollment_receipt, dms.security_event TO thaarei_dms_runtime;
--> statement-breakpoint
REVOKE INSERT, DELETE, UPDATE ON dms.application_registration FROM thaarei_dms_runtime;
--> statement-breakpoint
GRANT UPDATE (status, updated_at) ON dms.application_registration TO thaarei_dms_runtime;
