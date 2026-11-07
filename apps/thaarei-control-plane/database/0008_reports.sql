CREATE TABLE "control_plane"."report_counter" (
	"product_id" uuid NOT NULL,
	"epoch" uuid NOT NULL,
	"counter_epoch" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"totals" jsonb NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	CONSTRAINT "report_counter_product_id_epoch_counter_epoch_pk" PRIMARY KEY("product_id","epoch","counter_epoch")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."report_latest" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"epoch" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"sequence" bigint,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "control_plane"."report_snapshot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"epoch" uuid NOT NULL,
	"sequence" bigint,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"counter_reset" boolean DEFAULT false NOT NULL,
	CONSTRAINT "report_sequence_bound" CHECK ("control_plane"."report_snapshot"."sequence" IS NULL OR ("control_plane"."report_snapshot"."sequence">0 AND "control_plane"."report_snapshot"."sequence"<=9007199254740991))
);
--> statement-breakpoint
ALTER TABLE "control_plane"."report_counter" ADD CONSTRAINT "report_counter_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."report_latest" ADD CONSTRAINT "report_latest_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."report_snapshot" ADD CONSTRAINT "report_snapshot_product_id_registry_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "control_plane"."registry_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_snapshot_product_time_idx" ON "control_plane"."report_snapshot" USING btree ("product_id","received_at","id");--> statement-breakpoint
CREATE INDEX "report_snapshot_retention_idx" ON "control_plane"."report_snapshot" USING btree ("received_at","id");