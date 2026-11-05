CREATE TABLE "dms"."operator_authorization" (
	"tenant_id" uuid NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "operator_authorization_tenant_id_subject_id_pk" PRIMARY KEY("tenant_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "dms"."operator_authorization" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."operator_authorization" ADD CONSTRAINT "operator_authorization_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dms"."operator_authorization" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator" USING ("dms"."operator_authorization"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("dms"."operator_authorization"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE dms.operator_authorization FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.operator_authorization FROM PUBLIC, thaarei_dms_runtime;
