CREATE TABLE "control_plane"."machine_application" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"epoch" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "machine_decision_application_binding_idx" ON "control_plane"."machine_decision" USING btree ("product_id","epoch","id");
--> statement-breakpoint
ALTER TABLE "control_plane"."machine_application" ADD CONSTRAINT "machine_application_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."machine_application" ADD CONSTRAINT "machine_application_decision_binding_fk" FOREIGN KEY ("product_id","epoch","decision_id") REFERENCES "control_plane"."machine_decision"("product_id","epoch","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
