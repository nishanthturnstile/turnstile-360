-- Reviewed least-privilege grants. No DDL, TRUNCATE, schema ownership or cross-owner access.
REVOKE ALL ON SCHEMA "auth" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "auth" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."account" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."jwks" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."oauth_access_token" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."oauth_client" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."oauth_client_assertion" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."oauth_client_resource" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."oauth_consent" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."oauth_refresh_token" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."oauth_resource" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."rate_limit" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."session" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."user" TO "thaarei_auth_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth"."verification" TO "thaarei_auth_runtime";
