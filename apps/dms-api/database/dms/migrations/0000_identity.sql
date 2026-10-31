CREATE SCHEMA "dms";
--> statement-breakpoint
CREATE TABLE "dms"."application_registration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scope_ceiling" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_tenant_identity" UNIQUE("tenant_id","id"),
	CONSTRAINT "application_client_identity" UNIQUE("tenant_id","issuer","client_id"),
	CONSTRAINT "application_status" CHECK ("dms"."application_registration"."status" IN ('pending', 'active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "dms"."application_registration" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."installation" (
	"singleton" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_tenant_id_unique" UNIQUE("tenant_id"),
	CONSTRAINT "installation_customer_key_unique" UNIQUE("customer_key"),
	CONSTRAINT "one_installation" CHECK ("dms"."installation"."singleton" = 1)
);
--> statement-breakpoint
ALTER TABLE "dms"."application_registration" ADD CONSTRAINT "application_registration_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dms"."application_registration" AS PERMISSIVE FOR ALL TO "thaarei_dms_runtime" USING ("dms"."application_registration"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("dms"."application_registration"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);