CREATE TABLE "control_plane"."registry_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"reason" varchar(300) NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_audit_actor_role" CHECK ("control_plane"."registry_audit"."actor_role" IN ('admin','operator','viewer'))
);
--> statement-breakpoint
CREATE TABLE "control_plane"."registry_client" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(160) NOT NULL,
	"contact_name" varchar(100),
	"contact_email" varchar(254),
	"archived" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_client_code_unique" UNIQUE("code"),
	CONSTRAINT "registry_client_revision" CHECK ("control_plane"."registry_client"."revision">0),
	CONSTRAINT "registry_client_code" CHECK ("control_plane"."registry_client"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$')
);
--> statement-breakpoint
CREATE TABLE "control_plane"."registry_installation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"environment" varchar(32) NOT NULL,
	"label" varchar(100) NOT NULL,
	"local_installation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_installation_local_installation_id_unique" UNIQUE("local_installation_id"),
	CONSTRAINT "registry_installation_client_environment" UNIQUE("client_id","environment"),
	CONSTRAINT "registry_installation_client_pair" UNIQUE("id","client_id"),
	CONSTRAINT "registry_installation_environment" CHECK ("control_plane"."registry_installation"."environment" ~ '^[a-z0-9][a-z0-9_-]{0,31}$')
);
--> statement-breakpoint
CREATE TABLE "control_plane"."registry_product" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"product" text NOT NULL,
	"application_id" uuid,
	"policy_state" text DEFAULT 'pending' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"policy_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"policy_changed_by" text NOT NULL,
	"policy_reason" varchar(300),
	"pairing_verified_at" timestamp with time zone,
	"first_approved_at" timestamp with time zone,
	"last_approved_at" timestamp with time zone,
	CONSTRAINT "registry_product_installation_kind" UNIQUE("installation_id","product"),
	CONSTRAINT "registry_product_kind_binding" CHECK (("control_plane"."registry_product"."product"='dms' AND "control_plane"."registry_product"."application_id" IS NULL) OR ("control_plane"."registry_product"."product"='turnstile' AND "control_plane"."registry_product"."application_id" IS NOT NULL)),
	CONSTRAINT "registry_product_revision" CHECK ("control_plane"."registry_product"."revision">0),
	CONSTRAINT "registry_product_policy" CHECK ("control_plane"."registry_product"."policy_state" IN ('pending','approved','rejected','suspended')),
	CONSTRAINT "registry_product_approval_pairing" CHECK ("control_plane"."registry_product"."policy_state"<>'approved' OR "control_plane"."registry_product"."pairing_verified_at" IS NOT NULL),
	CONSTRAINT "registry_product_approval_dates" CHECK (("control_plane"."registry_product"."first_approved_at" IS NULL AND "control_plane"."registry_product"."last_approved_at" IS NULL) OR ("control_plane"."registry_product"."first_approved_at" IS NOT NULL AND "control_plane"."registry_product"."last_approved_at" IS NOT NULL AND "control_plane"."registry_product"."first_approved_at"<="control_plane"."registry_product"."last_approved_at")),
	CONSTRAINT "registry_product_approved_evidence" CHECK ("control_plane"."registry_product"."policy_state"<>'approved' OR "control_plane"."registry_product"."first_approved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "control_plane"."registry_receipt" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"digest" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."registry_audit" ADD CONSTRAINT "registry_audit_client_id_registry_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "control_plane"."registry_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."registry_audit" ADD CONSTRAINT "registry_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "control_plane"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."registry_installation" ADD CONSTRAINT "registry_installation_client_id_registry_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "control_plane"."registry_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."registry_product" ADD CONSTRAINT "registry_product_client_id_registry_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "control_plane"."registry_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."registry_product" ADD CONSTRAINT "registry_product_policy_changed_by_user_id_fk" FOREIGN KEY ("policy_changed_by") REFERENCES "control_plane"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."registry_product" ADD CONSTRAINT "registry_product_installation_client" FOREIGN KEY ("installation_id","client_id") REFERENCES "control_plane"."registry_installation"("id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."registry_receipt" ADD CONSTRAINT "registry_receipt_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "control_plane"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registry_audit_client_time_idx" ON "control_plane"."registry_audit" USING btree ("client_id","committed_at","id");--> statement-breakpoint
CREATE INDEX "registry_audit_actor_idx" ON "control_plane"."registry_audit" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "registry_product_client_idx" ON "control_plane"."registry_product" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "registry_product_actor_idx" ON "control_plane"."registry_product" USING btree ("policy_changed_by");--> statement-breakpoint
CREATE INDEX "registry_receipt_actor_idx" ON "control_plane"."registry_receipt" USING btree ("actor_id");