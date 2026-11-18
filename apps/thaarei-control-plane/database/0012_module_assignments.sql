CREATE TABLE "control_plane"."module_assignment_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"revision" integer NOT NULL,
	"document" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_assignment_product_revision" UNIQUE("product_id","revision"),
	CONSTRAINT "module_assignment_pointer" UNIQUE("id","product_id","kind"),
	CONSTRAINT "module_assignment_kind" CHECK ("control_plane"."module_assignment_entry"."kind" IN ('draft','approved')),
	CONSTRAINT "module_assignment_revision" CHECK ("control_plane"."module_assignment_entry"."revision">1),
	CONSTRAINT "module_assignment_document_bound" CHECK (jsonb_typeof("control_plane"."module_assignment_entry"."document")='object' AND octet_length("control_plane"."module_assignment_entry"."document"::text)<=65536)
);
--> statement-breakpoint
CREATE TABLE "control_plane"."module_assignment_state" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"draft_id" uuid,
	"draft_kind" text DEFAULT 'draft' NOT NULL,
	"desired_id" uuid,
	"desired_kind" text DEFAULT 'approved' NOT NULL,
	CONSTRAINT "module_assignment_pointer_kinds" CHECK ("control_plane"."module_assignment_state"."draft_kind"='draft' AND "control_plane"."module_assignment_state"."desired_kind"='approved')
);
--> statement-breakpoint
ALTER TABLE "control_plane"."module_assignment_entry" ADD CONSTRAINT "module_assignment_entry_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."module_assignment_entry" ADD CONSTRAINT "module_assignment_entry_catalogue_id_module_catalogue_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "control_plane"."module_catalogue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."module_assignment_entry" ADD CONSTRAINT "module_assignment_entry_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "control_plane"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."module_assignment_state" ADD CONSTRAINT "module_assignment_state_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."module_assignment_state" ADD CONSTRAINT "module_assignment_draft_pointer" FOREIGN KEY ("draft_id","product_id","draft_kind") REFERENCES "control_plane"."module_assignment_entry"("id","product_id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."module_assignment_state" ADD CONSTRAINT "module_assignment_desired_pointer" FOREIGN KEY ("desired_id","product_id","desired_kind") REFERENCES "control_plane"."module_assignment_entry"("id","product_id","kind") ON DELETE no action ON UPDATE no action;