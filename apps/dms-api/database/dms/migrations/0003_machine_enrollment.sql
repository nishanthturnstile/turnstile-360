CREATE TABLE "dms"."enrollment_key" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"deployment_id" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "enrollment_key_tenant_identity" UNIQUE("tenant_id","id"),
	CONSTRAINT "enrollment_digest" CHECK ("dms"."enrollment_key"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "enrollment_expiry" CHECK ("dms"."enrollment_key"."expires_at" > "dms"."enrollment_key"."created_at" AND "dms"."enrollment_key"."expires_at" <= "dms"."enrollment_key"."created_at" + interval '24 hours')
);
--> statement-breakpoint
ALTER TABLE "dms"."enrollment_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."enrollment_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"deployment_id" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"enrollment_key_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "enrollment_receipt_enrollment_key_id_unique" UNIQUE("enrollment_key_id"),
	CONSTRAINT "enrollment_idempotency_scope" UNIQUE("tenant_id","deployment_id","issuer","client_id","operation","idempotency_hash"),
	CONSTRAINT "enrollment_receipt_hashes" CHECK ("dms"."enrollment_receipt"."idempotency_hash" ~ '^[0-9a-f]{64}$' AND "dms"."enrollment_receipt"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "enrollment_receipt_expiry" CHECK ("dms"."enrollment_receipt"."expires_at" > "dms"."enrollment_receipt"."created_at" AND "dms"."enrollment_receipt"."expires_at" <= "dms"."enrollment_receipt"."created_at" + interval '24 hours')
);
--> statement-breakpoint
ALTER TABLE "dms"."enrollment_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dms"."security_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_event_bounds" CHECK (length("dms"."security_event"."actor_id") BETWEEN 1 AND 200 AND length("dms"."security_event"."subject_id") BETWEEN 1 AND 128 AND "dms"."security_event"."action" ~ '^[a-z][a-z0-9_.-]{0,47}$'),
	CONSTRAINT "security_event_outcome" CHECK ("dms"."security_event"."outcome" IN ('success', 'denied', 'pending')),
	CONSTRAINT "security_event_actor_kind" CHECK ("dms"."security_event"."actor_kind" IN ('operator', 'machine'))
);
--> statement-breakpoint
ALTER TABLE "dms"."security_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dms"."application_registration" ADD COLUMN "principal_kind" text DEFAULT 'consumer' NOT NULL;--> statement-breakpoint
-- Reviewed generation order: create the referenced unique constraint before its FK.
ALTER TABLE "dms"."application_registration" ADD CONSTRAINT "application_enrollment_identity" UNIQUE("tenant_id","id","issuer","client_id");--> statement-breakpoint
ALTER TABLE "dms"."enrollment_key" ADD CONSTRAINT "enrollment_key_tenant_id_application_id_issuer_client_id_application_registration_tenant_id_id_issuer_client_id_fk" FOREIGN KEY ("tenant_id","application_id","issuer","client_id") REFERENCES "dms"."application_registration"("tenant_id","id","issuer","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."enrollment_receipt" ADD CONSTRAINT "enrollment_receipt_tenant_id_application_id_application_registration_tenant_id_id_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "dms"."application_registration"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."enrollment_receipt" ADD CONSTRAINT "enrollment_receipt_tenant_id_enrollment_key_id_enrollment_key_tenant_id_id_fk" FOREIGN KEY ("tenant_id","enrollment_key_id") REFERENCES "dms"."enrollment_key"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."security_event" ADD CONSTRAINT "security_event_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "dms"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollment_key_application_idx" ON "dms"."enrollment_key" USING btree ("tenant_id","application_id");--> statement-breakpoint
CREATE INDEX "enrollment_receipt_expiry_idx" ON "dms"."enrollment_receipt" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "security_event_retention_idx" ON "dms"."security_event" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "dms"."application_registration" ADD CONSTRAINT "application_principal_kind" CHECK ("dms"."application_registration"."principal_kind" IN ('consumer', 'publisher', 'scanner', 'extractor'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dms"."enrollment_key" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator", "thaarei_dms_runtime" USING ("dms"."enrollment_key"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("dms"."enrollment_key"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dms"."enrollment_receipt" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator", "thaarei_dms_runtime" USING ("dms"."enrollment_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("dms"."enrollment_receipt"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dms"."security_event" AS PERMISSIVE FOR ALL TO "thaarei_dms_migrator", "thaarei_dms_runtime" USING ("dms"."security_event"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("dms"."security_event"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);