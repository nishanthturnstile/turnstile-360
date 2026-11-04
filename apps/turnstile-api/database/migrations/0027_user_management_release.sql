ALTER TABLE "turnstile"."access_audit" DROP CONSTRAINT "access_audit_action";--> statement-breakpoint
ALTER TABLE "turnstile"."access_audit" DROP CONSTRAINT "access_audit_operator";--> statement-breakpoint
ALTER TABLE "turnstile"."access_command_receipt" DROP CONSTRAINT "access_receipt_operation";--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" DROP CONSTRAINT "access_model_version";--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ADD COLUMN "release_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ADD COLUMN "release_id" text;--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ADD COLUMN "recovery_epoch" text;--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ADD COLUMN "released_by" text;--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "turnstile"."access_audit" ADD CONSTRAINT "access_audit_action" CHECK ("turnstile"."access_audit"."action" IN ('legacy_imported','legacy_replaced','legacy_retired','administrator_bootstrapped','administrator_handed_over','member_assignments_changed','member_suspended','member_reactivated','role_created','role_details_changed','role_permissions_changed','role_deleted','unit_coverage_changed','invitation_changed','release_opened','release_closed','release_recovered'));--> statement-breakpoint
ALTER TABLE "turnstile"."access_audit" ADD CONSTRAINT "access_audit_operator" CHECK ("turnstile"."access_audit"."action" NOT IN ('legacy_imported','legacy_replaced','administrator_bootstrapped','administrator_handed_over','release_opened','release_closed','release_recovered') OR "turnstile"."access_audit"."actor_kind" = 'operator');--> statement-breakpoint
ALTER TABLE "turnstile"."access_command_receipt" ADD CONSTRAINT "access_receipt_operation" CHECK ("turnstile"."access_command_receipt"."operation" IN ('legacy.replace','legacy.retire','administrator.bootstrap','administrator.handover','member.assignments','member.suspend','member.reactivate','role.create','role.patch','role.delete','invitation.issue','invitation.resend','invitation.cancel','invitation.reapprove','unit.create','unit.rename','unit.delete','unit.move','release.open','release.close','release.recover'));--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ADD CONSTRAINT "access_release_state" CHECK (("turnstile"."access_context"."release_id" IS NULL OR "turnstile"."access_context"."release_id" ~ '^[0-9a-f]{64}$') AND ("turnstile"."access_context"."recovery_epoch" IS NULL OR "turnstile"."access_context"."recovery_epoch" ~ '^[0-9a-f]{64}$') AND ("turnstile"."access_context"."released_by" IS NULL OR "turnstile"."access_context"."released_by" ~ '^[A-Za-z0-9_-]{1,200}$') AND (NOT "turnstile"."access_context"."public_writes_enabled" OR ("turnstile"."access_context"."release_id" IS NOT NULL AND "turnstile"."access_context"."recovery_epoch" IS NOT NULL AND "turnstile"."access_context"."released_by" IS NOT NULL AND "turnstile"."access_context"."released_at" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ADD CONSTRAINT "access_model_version" CHECK ("turnstile"."access_context"."model_version" = 1 AND "turnstile"."access_context"."release_version" = 1);
--> statement-breakpoint
-- Retire flat readers without changing their preserved recovery inventory. Old
-- private writers remain fenced by access_inventory_guard after explicit import.
REVOKE SELECT ON turnstile.user_access FROM thaarei_turnstile_runtime;
REVOKE SELECT (tenant_id,user_id,enabled,permissions) ON turnstile.user_access FROM thaarei_turnstile_runtime;

--> statement-breakpoint
-- Release state stays private; every change still advances the access revision.
CREATE OR REPLACE FUNCTION turnstile.guard_access_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE mutable text[];
BEGIN
  mutable := CASE TG_TABLE_NAME
    WHEN 'access_context' THEN CASE WHEN session_user='thaarei_turnstile_migrator' AND current_user=session_user
      THEN ARRAY['revision','public_writes_enabled','release_id','recovery_epoch','released_by','released_at']
      ELSE ARRAY['revision'] END
    WHEN 'access_member' THEN ARRAY['version','status']
    WHEN 'access_legacy_source' THEN ARRAY['version','permissions','retired']
    ELSE ARRAY[]::text[] END;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'Access identity/history is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'access_context' THEN
    IF NEW.revision::bigint <> OLD.revision::bigint + 1 THEN
      RAISE EXCEPTION 'Access revision rejected' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME IN ('access_member','access_legacy_source') THEN
    IF NEW.version::bigint <> OLD.version::bigint + 1 THEN
      RAISE EXCEPTION 'Access version rejected' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'access_legacy_source' THEN
      IF OLD.retired AND NOT NEW.retired THEN
        RAISE EXCEPTION 'Retired legacy source cannot be restored' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION turnstile.lock_access_context(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF target IS NULL OR target IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN
    RAISE EXCEPTION 'Fixed tenant context required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM turnstile.installation WHERE tenant_id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixed installation required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM turnstile.organization_configuration WHERE tenant_id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configuration initialization required' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM turnstile.access_context WHERE tenant_id = target AND model_version = 1
    AND release_version=1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical access initialization required' USING ERRCODE = '23514'; END IF;
END $$;
