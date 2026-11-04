CREATE TABLE "turnstile"."invitation_acceptance" (
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"user_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT statement_timestamp()+interval '7 days' NOT NULL,
	CONSTRAINT "invitation_acceptance_tenant_id_invitation_id_pk" PRIMARY KEY("tenant_id","invitation_id"),
	CONSTRAINT "invitation_acceptance_subject" CHECK ("turnstile"."invitation_acceptance"."user_id" ~ '^[A-Za-z0-9_-]{1,200}$' AND "turnstile"."invitation_acceptance"."generation">0),
	CONSTRAINT "invitation_acceptance_window" CHECK ("turnstile"."invitation_acceptance"."expires_at"="turnstile"."invitation_acceptance"."created_at"+interval '7 days')
);
--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_acceptance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_audit" DROP CONSTRAINT "invitation_audit_actions";--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_acceptance" ADD CONSTRAINT "invitation_acceptance_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_acceptance" ADD CONSTRAINT "invitation_acceptance_tenant_id_invitation_id_invitation_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "turnstile"."invitation"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_acceptance_retention_idx" ON "turnstile"."invitation_acceptance" USING btree ("tenant_id","expires_at");--> statement-breakpoint
ALTER TABLE "turnstile"."invitation_audit" ADD CONSTRAINT "invitation_audit_actions" CHECK ("turnstile"."invitation_audit"."action" IN ('issued','resent','reapproved','cancelled','expired','invalidated','smtp_accepted','delivery_failed','delivery_unknown','accepted','declined'));--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."invitation_acceptance" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."invitation_acceptance"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("turnstile"."invitation_acceptance"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid);