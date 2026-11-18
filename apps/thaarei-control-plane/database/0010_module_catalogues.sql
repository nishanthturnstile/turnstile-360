CREATE TABLE "control_plane"."module_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"resource_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" varchar(300) NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."module_catalogue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"digest" varchar(64) NOT NULL,
	"document" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"proof_digest" varchar(64),
	"key_id" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "module_catalogue_digest_unique" UNIQUE("digest"),
	CONSTRAINT "module_catalogue_revision" CHECK ("control_plane"."module_catalogue"."revision">0),
	CONSTRAINT "module_catalogue_digest" CHECK ("control_plane"."module_catalogue"."digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "module_catalogue_document_bound" CHECK (jsonb_typeof("control_plane"."module_catalogue"."document")='object' AND octet_length("control_plane"."module_catalogue"."document"::text)<=131072),
	CONSTRAINT "module_catalogue_state" CHECK (("control_plane"."module_catalogue"."status"='draft' AND "control_plane"."module_catalogue"."published_at" IS NULL AND "control_plane"."module_catalogue"."proof_digest" IS NULL AND "control_plane"."module_catalogue"."key_id" IS NULL) OR ("control_plane"."module_catalogue"."status"='released' AND "control_plane"."module_catalogue"."published_at" IS NOT NULL AND "control_plane"."module_catalogue"."proof_digest" IS NOT NULL AND "control_plane"."module_catalogue"."key_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "control_plane"."module_code" (
	"id" uuid PRIMARY KEY NOT NULL,
	"digest" varchar(64) NOT NULL,
	"document" jsonb NOT NULL,
	"proof_digest" varchar(64) NOT NULL,
	"key_id" varchar(80) NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_code_digest_unique" UNIQUE("digest"),
	CONSTRAINT "module_code_digest" CHECK ("control_plane"."module_code"."digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "module_code_document_bound" CHECK (jsonb_typeof("control_plane"."module_code"."document")='object' AND octet_length("control_plane"."module_code"."document"::text)<=131072)
);
--> statement-breakpoint
CREATE TABLE "control_plane"."module_receipt" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"digest" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."module_audit" ADD CONSTRAINT "module_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "control_plane"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."module_catalogue" ADD CONSTRAINT "module_catalogue_source_id_module_code_id_fk" FOREIGN KEY ("source_id") REFERENCES "control_plane"."module_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."module_code" ADD CONSTRAINT "module_code_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "control_plane"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."module_receipt" ADD CONSTRAINT "module_receipt_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "control_plane"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "module_audit_resource_idx" ON "control_plane"."module_audit" USING btree ("resource_id","committed_at","id");--> statement-breakpoint
CREATE INDEX "module_audit_actor_idx" ON "control_plane"."module_audit" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "module_catalogue_source_idx" ON "control_plane"."module_catalogue" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "module_code_actor_idx" ON "control_plane"."module_code" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "module_receipt_actor_idx" ON "control_plane"."module_receipt" USING btree ("actor_id");