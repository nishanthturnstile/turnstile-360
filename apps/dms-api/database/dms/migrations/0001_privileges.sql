-- Reviewed least-privilege grants. No DDL, TRUNCATE, schema ownership or cross-owner access.
REVOKE ALL ON SCHEMA "dms" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "dms" TO "thaarei_dms_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "dms"."application_registration" TO "thaarei_dms_runtime";
--> statement-breakpoint
GRANT SELECT ON "dms"."installation" TO "thaarei_dms_runtime";
--> statement-breakpoint
ALTER TABLE "dms"."application_registration" FORCE ROW LEVEL SECURITY;
