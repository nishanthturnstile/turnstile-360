CREATE TABLE "control_plane"."module_authority" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"minimum_version" integer DEFAULT 2 NOT NULL,
	"document" jsonb,
	CONSTRAINT "module_authority_version" CHECK ("control_plane"."module_authority"."minimum_version"=2),
	CONSTRAINT "module_authority_bound" CHECK ("control_plane"."module_authority"."document" IS NULL OR (jsonb_typeof("control_plane"."module_authority"."document")='object' AND octet_length("control_plane"."module_authority"."document"::text)<=131072))
);
--> statement-breakpoint
ALTER TABLE "control_plane"."module_authority" ADD CONSTRAINT "module_authority_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;