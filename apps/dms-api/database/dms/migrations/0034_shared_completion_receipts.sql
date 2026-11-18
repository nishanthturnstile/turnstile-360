ALTER TABLE "dms"."upload_receipt" DROP CONSTRAINT "upload_receipt_tenant_id_application_id_upload_id_upload_session_tenant_id_batch_application_id_id_fk";
--> statement-breakpoint
ALTER TABLE "dms"."upload_session" ADD CONSTRAINT "session_tenant_identity" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "dms"."upload_receipt" ADD CONSTRAINT "upload_receipt_tenant_id_application_id_application_registration_tenant_id_id_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "dms"."application_registration"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dms"."upload_receipt" ADD CONSTRAINT "upload_receipt_tenant_id_upload_id_upload_session_tenant_id_id_fk" FOREIGN KEY ("tenant_id","upload_id") REFERENCES "dms"."upload_session"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE POLICY receipt_upload_control ON dms.upload_receipt AS RESTRICTIVE FOR INSERT TO thaarei_dms_runtime WITH CHECK (upload_id IS NULL OR dms.controls_upload(upload_id));
