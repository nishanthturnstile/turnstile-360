CREATE SCHEMA "turnstile";
--> statement-breakpoint
CREATE TABLE "turnstile"."installation" (
	"singleton" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_key" text NOT NULL,
	"application_id" uuid NOT NULL,
	CONSTRAINT "installation_tenant_id_unique" UNIQUE("tenant_id"),
	CONSTRAINT "installation_customer_key_unique" UNIQUE("customer_key"),
	CONSTRAINT "installation_application_id_unique" UNIQUE("application_id"),
	CONSTRAINT "one_installation" CHECK ("turnstile"."installation"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE "turnstile"."session" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "turnstile"."session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."user_access" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_access_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "turnstile"."user_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnstile"."session" ADD CONSTRAINT "session_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."user_access" ADD CONSTRAINT "user_access_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_expiry_idx" ON "turnstile"."session" USING btree ("expires_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."session" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_runtime" USING ("turnstile"."session"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."session"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "turnstile"."user_access" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_runtime" USING ("turnstile"."user_access"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("turnstile"."user_access"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);