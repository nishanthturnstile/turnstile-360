CREATE TABLE "turnstile"."documents_intent" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"recovery_marker" text NOT NULL,
	"kind" text NOT NULL,
	"digest" text NOT NULL,
	"subject_key" text NOT NULL,
	"command" jsonb,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconciliation_until" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"attempt_id" uuid,
	"terminal_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"upload_id" uuid,
	"disposition" jsonb,
	CONSTRAINT "documents_intent_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "documents_intent_shape" CHECK (
    length(actor_id) BETWEEN 1 AND 200 AND digest ~ '^[0-9a-f]{64}$'
    AND recovery_marker ~ '^[0-9a-f]{64}$' AND subject_key ~ '^[0-9a-f]{64}$'
    AND kind IN ('upload.begin','upload.complete','upload.refresh','upload.cancel')
    AND state IN ('DRAFT','DISPATCHING','UNCERTAIN','RESOLVED','UNRESOLVED_REQUIRES_REVIEW','DISPOSED')
    AND (command IS NULL OR (jsonb_typeof(command)='object' AND octet_length(command::text)<=40960))
    AND (state NOT IN ('DRAFT','DISPATCHING','UNCERTAIN') OR command IS NOT NULL)
    AND ((state='DISPATCHING') = (attempt_id IS NOT NULL AND lease_until IS NOT NULL))
    AND ((state IN ('RESOLVED','UNRESOLVED_REQUIRES_REVIEW','DISPOSED')) = (terminal_at IS NOT NULL))
    AND ((state IN ('RESOLVED','DISPOSED')) = (resolved_at IS NOT NULL))
    AND (state<>'RESOLVED' OR upload_id IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "turnstile"."documents_intent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turnstile"."documents_intent" ADD CONSTRAINT "documents_intent_tenant_id_installation_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "turnstile"."installation"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_intent_actor_history" ON "turnstile"."documents_intent" USING btree ("tenant_id","actor_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_intent_active_subject" ON "turnstile"."documents_intent" USING btree ("tenant_id","kind","subject_key") WHERE state IN ('DRAFT','DISPATCHING','UNCERTAIN','UNRESOLVED_REQUIRES_REVIEW');--> statement-breakpoint
CREATE INDEX "documents_intent_binding" ON "turnstile"."documents_intent" USING btree ("tenant_id","upload_id") WHERE kind='upload.begin' AND state='RESOLVED';--> statement-breakpoint
CREATE POLICY "installation_isolation" ON "turnstile"."documents_intent" AS PERMISSIVE FOR ALL TO "thaarei_turnstile_migrator", "thaarei_turnstile_runtime" USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "documents_intent_runtime_prune" ON "turnstile"."documents_intent" AS RESTRICTIVE FOR DELETE TO "thaarei_turnstile_runtime" USING ((state='DRAFT' AND created_at<=statement_timestamp()-interval '1 day')
          OR (state IN ('RESOLVED','DISPOSED') AND resolved_at<=statement_timestamp()-interval '90 days'));
--> statement-breakpoint
ALTER TABLE turnstile.documents_intent FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON turnstile.documents_intent FROM PUBLIC;
GRANT SELECT, DELETE ON turnstile.documents_intent TO thaarei_turnstile_runtime;
GRANT INSERT (tenant_id,id,actor_id,recovery_marker,kind,digest,subject_key,command,upload_id)
  ON turnstile.documents_intent TO thaarei_turnstile_runtime;
GRANT UPDATE (command,state,reconciliation_until,lease_until,attempt_id,terminal_at,resolved_at,upload_id)
  ON turnstile.documents_intent TO thaarei_turnstile_runtime;
--> statement-breakpoint
CREATE FUNCTION turnstile.protect_documents_intent_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.state IN ('RESOLVED','DISPOSED','UNRESOLVED_REQUIRES_REVIEW') AND
     NOT (session_user='thaarei_turnstile_migrator' AND session_user=current_user) AND
     (to_jsonb(NEW)-'command') IS DISTINCT FROM (to_jsonb(OLD)-'command') THEN
    RAISE EXCEPTION 'Terminal Documents intent is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.command IS DISTINCT FROM OLD.command AND
     (NEW.command IS NOT NULL OR OLD.terminal_at IS NULL OR OLD.terminal_at>statement_timestamp()-interval '30 days') THEN
    RAISE EXCEPTION 'Documents command payload is immutable before retention' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION turnstile.protect_documents_intent_history() FROM PUBLIC;
CREATE TRIGGER documents_intent_history BEFORE UPDATE ON turnstile.documents_intent
FOR EACH ROW EXECUTE FUNCTION turnstile.protect_documents_intent_history();
