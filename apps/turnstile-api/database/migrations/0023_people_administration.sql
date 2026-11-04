CREATE TABLE "turnstile"."member_display" (
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"member_version" integer NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"name" text,
	"email" text,
	"verified_at" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_display_tenant_id_member_id_pk" PRIMARY KEY("tenant_id","member_id"),
	CONSTRAINT "member_display_shape" CHECK ("turnstile"."member_display"."state" IN ('present','deleted') AND "turnstile"."member_display"."member_version">0 AND ("turnstile"."member_display"."state"='deleted' OR ("turnstile"."member_display"."name" IS NOT NULL AND "turnstile"."member_display"."email" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "turnstile"."member_display" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnstile"."access_command_receipt" ADD COLUMN "people_changed" boolean;--> statement-breakpoint
ALTER TABLE "turnstile"."member_display" ADD CONSTRAINT "member_display_tenant_id_member_id_access_member_tenant_id_id_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "turnstile"."access_member"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_display_email_idx" ON "turnstile"."member_display" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "member_display_refresh_idx" ON "turnstile"."member_display" USING btree ("tenant_id","checked_at");--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."member_display" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING ("turnstile"."member_display"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("turnstile"."member_display"."tenant_id"=nullif(current_setting('app.tenant_id',true),'')::uuid);