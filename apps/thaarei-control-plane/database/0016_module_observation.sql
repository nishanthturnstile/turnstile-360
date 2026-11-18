CREATE TABLE "control_plane"."module_observation" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"epoch" uuid NOT NULL,
	"installed" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_observation_bound" CHECK (jsonb_typeof("control_plane"."module_observation"."installed")='object' AND octet_length("control_plane"."module_observation"."installed"::text)<=1024)
);
--> statement-breakpoint
ALTER TABLE "control_plane"."module_observation" ADD CONSTRAINT "module_observation_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;