CREATE TABLE "auth"."identity_audit" (
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"operation_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identity_audit_action" CHECK ("auth"."identity_audit"."action" IN ('prepare', 'complete', 'project', 'cancel'))
);
--> statement-breakpoint
CREATE TABLE "auth"."identity_epoch" (
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"invitation_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identity_epoch_tenant_id_application_id_client_id_invitation_id_pk" PRIMARY KEY("tenant_id","application_id","client_id","invitation_id"),
	CONSTRAINT "identity_epoch_generation" CHECK ("auth"."identity_epoch"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "auth"."identity_limit" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"window" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "identity_limit_tenant_id_key_window_pk" PRIMARY KEY("tenant_id","key","window")
);
--> statement-breakpoint
CREATE TABLE "auth"."identity_preparation" (
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"email" text NOT NULL,
	"request_hash" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"sealed_receipt" text NOT NULL,
	"exchanged_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"retained_until" timestamp with time zone NOT NULL,
	"user_id" text,
	CONSTRAINT "identity_preparation_tenant_id_application_id_client_id_id_pk" PRIMARY KEY("tenant_id","application_id","client_id","id"),
	CONSTRAINT "identity_receipt_hash" UNIQUE("receipt_hash")
);
--> statement-breakpoint
CREATE TABLE "auth"."identity_setup" (
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"digest" text PRIMARY KEY NOT NULL,
	"preparation_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."identity_subject" (
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"member_version" integer NOT NULL,
	CONSTRAINT "identity_subject_tenant_id_application_id_client_id_member_id_pk" PRIMARY KEY("tenant_id","application_id","client_id","member_id"),
	CONSTRAINT "identity_subject_user" UNIQUE("tenant_id","application_id","client_id","user_id"),
	CONSTRAINT "identity_subject_version" CHECK ("auth"."identity_subject"."member_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "auth"."identity_preparation" ADD CONSTRAINT "identity_preparation_tenant_id_application_id_client_id_invitation_id_identity_epoch_tenant_id_application_id_client_id_invitation_id_fk" FOREIGN KEY ("tenant_id","application_id","client_id","invitation_id") REFERENCES "auth"."identity_epoch"("tenant_id","application_id","client_id","invitation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."identity_setup" ADD CONSTRAINT "identity_setup_tenant_id_application_id_client_id_preparation_id_identity_preparation_tenant_id_application_id_client_id_id_fk" FOREIGN KEY ("tenant_id","application_id","client_id","preparation_id") REFERENCES "auth"."identity_preparation"("tenant_id","application_id","client_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_audit_retention" ON "auth"."identity_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "identity_limit_expiry" ON "auth"."identity_limit" USING btree ("window");--> statement-breakpoint
CREATE INDEX "identity_preparation_retention" ON "auth"."identity_preparation" USING btree ("retained_until");--> statement-breakpoint
CREATE INDEX "identity_setup_preparation" ON "auth"."identity_setup" USING btree ("tenant_id","application_id","client_id","preparation_id");--> statement-breakpoint
CREATE INDEX "identity_setup_expiry" ON "auth"."identity_setup" USING btree ("expires_at");