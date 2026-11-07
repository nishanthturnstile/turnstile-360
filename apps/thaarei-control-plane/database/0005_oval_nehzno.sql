CREATE TABLE "control_plane"."machine" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"epoch" uuid NOT NULL,
	"generation" integer NOT NULL,
	"secret_digest" varchar(64) NOT NULL,
	"operation_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"sequence" integer DEFAULT 0 NOT NULL,
	"first_issued_at" timestamp with time zone,
	"first_acknowledged_at" timestamp with time zone,
	"current_acknowledged_at" timestamp with time zone,
	"last_contact_at" timestamp with time zone,
	CONSTRAINT "machine_generation_positive" CHECK ("control_plane"."machine"."generation">0 AND "control_plane"."machine"."sequence">=0)
);
--> statement-breakpoint
CREATE TABLE "control_plane"."machine_authority" (
	"slot" integer PRIMARY KEY NOT NULL,
	"marker_digest" varchar(64) NOT NULL,
	CONSTRAINT "machine_authority_singleton" CHECK ("control_plane"."machine_authority"."slot"=1)
);
--> statement-breakpoint
CREATE TABLE "control_plane"."machine_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"epoch" uuid NOT NULL,
	"revision" integer NOT NULL,
	"sequence" integer NOT NULL,
	"state" text NOT NULL,
	"token" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "machine_decision_order" CHECK ("control_plane"."machine_decision"."revision">0 AND "control_plane"."machine_decision"."sequence">0),
	CONSTRAINT "machine_decision_state" CHECK ("control_plane"."machine_decision"."state" IN ('pending','approved','rejected','suspended'))
);
--> statement-breakpoint
CREATE TABLE "control_plane"."machine_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"digest" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_receipt_kind" CHECK ("control_plane"."machine_receipt"."kind" IN ('sync','rotate'))
);
--> statement-breakpoint
CREATE TABLE "control_plane"."pairing" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"code_digest" varchar(64) NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"request_id" uuid,
	"input_digest" varchar(64),
	"receipt" jsonb,
	CONSTRAINT "pairing_consumption_complete" CHECK (("control_plane"."pairing"."consumed_at" IS NULL AND "control_plane"."pairing"."request_id" IS NULL AND "control_plane"."pairing"."input_digest" IS NULL AND "control_plane"."pairing"."receipt" IS NULL) OR ("control_plane"."pairing"."consumed_at" IS NOT NULL AND "control_plane"."pairing"."request_id" IS NOT NULL AND "control_plane"."pairing"."input_digest" IS NOT NULL AND "control_plane"."pairing"."receipt" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "control_plane"."machine" ADD CONSTRAINT "machine_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."machine_decision" ADD CONSTRAINT "machine_decision_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."machine_receipt" ADD CONSTRAINT "machine_receipt_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."pairing" ADD CONSTRAINT "pairing_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "machine_decision_current_idx" ON "control_plane"."machine_decision" USING btree ("product_id","epoch","revision","sequence");--> statement-breakpoint
CREATE INDEX "machine_receipt_product_idx" ON "control_plane"."machine_receipt" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "pairing_product_idx" ON "control_plane"."pairing" USING btree ("product_id");