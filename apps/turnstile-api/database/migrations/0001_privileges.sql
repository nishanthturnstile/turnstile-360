-- Reviewed least-privilege grants. No DDL, TRUNCATE, schema ownership or cross-owner access.
REVOKE ALL ON SCHEMA "turnstile" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "turnstile" TO "thaarei_turnstile_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "turnstile"."session" TO "thaarei_turnstile_runtime";
--> statement-breakpoint
GRANT SELECT ON "turnstile"."installation" TO "thaarei_turnstile_runtime";
--> statement-breakpoint
GRANT SELECT ON "turnstile"."user_access" TO "thaarei_turnstile_runtime";
--> statement-breakpoint
ALTER TABLE "turnstile"."session" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "turnstile"."user_access" FORCE ROW LEVEL SECURITY;
