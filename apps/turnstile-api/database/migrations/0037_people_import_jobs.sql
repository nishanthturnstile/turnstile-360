CREATE TABLE "turnstile"."people_import_job" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"filename" text NOT NULL,
	"digest" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"assignments" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"organization_revision" integer NOT NULL,
	"recovery_epoch" text NOT NULL,
	"reason" text,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_expires_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_import_job_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "people_import_job_shape" CHECK ("turnstile"."people_import_job"."version">0 AND "turnstile"."people_import_job"."organization_revision">=0 AND length("turnstile"."people_import_job"."filename") BETWEEN 1 AND 120 AND "turnstile"."people_import_job"."state" IN ('draft','queued','running','paused','completed','cancelled') AND (("turnstile"."people_import_job"."lease_id" IS NULL AND "turnstile"."people_import_job"."lease_expires_at" IS NULL) OR ("turnstile"."people_import_job"."lease_id" IS NOT NULL AND "turnstile"."people_import_job"."lease_expires_at" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."people_import_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "turnstile"."people_import_row" (
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"email" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"command_key" uuid NOT NULL,
	"command" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"invitation_id" uuid,
	CONSTRAINT "people_import_row_tenant_id_job_id_number_pk" PRIMARY KEY("tenant_id","job_id","number"),
	CONSTRAINT "people_import_row_shape" CHECK ("turnstile"."people_import_row"."number" BETWEEN 2 AND 501 AND length("turnstile"."people_import_row"."email")<=320 AND "turnstile"."people_import_row"."attempts" BETWEEN 0 AND 5 AND "turnstile"."people_import_row"."state" IN ('pending','processing','succeeded','failed','skipped','cancelled') AND ("turnstile"."people_import_row"."state"<>'succeeded' OR "turnstile"."people_import_row"."invitation_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."people_import_row" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnstile"."people_import_row" ADD CONSTRAINT "people_import_row_tenant_id_job_id_people_import_job_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "turnstile"."people_import_job"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_import_due_idx" ON "turnstile"."people_import_job" USING btree ("tenant_id","state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "people_import_history_idx" ON "turnstile"."people_import_job" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "people_import_row_due_idx" ON "turnstile"."people_import_row" USING btree ("tenant_id","job_id","state","number");--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."people_import_job" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."people_import_row" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE turnstile.people_import_job FORCE ROW LEVEL SECURITY;
ALTER TABLE turnstile.people_import_row FORCE ROW LEVEL SECURITY;
REVOKE ALL ON turnstile.people_import_job,turnstile.people_import_row FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON turnstile.people_import_job,turnstile.people_import_row TO thaarei_turnstile_runtime;
