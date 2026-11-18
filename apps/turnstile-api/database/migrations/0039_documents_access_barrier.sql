ALTER TABLE "turnstile"."access_context" DROP CONSTRAINT "access_model_version";--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ALTER COLUMN "release_version" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ADD COLUMN "documents_contract_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION turnstile.guard_access_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE mutable text[];
BEGIN
  mutable := CASE TG_TABLE_NAME
    WHEN 'access_context' THEN CASE WHEN session_user='thaarei_turnstile_migrator' AND current_user=session_user
      THEN ARRAY['revision','public_writes_enabled','release_id','recovery_epoch','released_by','released_at','documents_contract_required']
      ELSE ARRAY['revision'] END
    WHEN 'access_member' THEN ARRAY['version','status']
    WHEN 'access_legacy_source' THEN ARRAY['version','permissions','retired']
    ELSE ARRAY[]::text[] END;
  IF TG_TABLE_NAME='access_context' THEN
    IF session_user='thaarei_turnstile_migrator' AND current_user=session_user AND OLD.release_version=1 AND NEW.release_version=2 THEN
      mutable := mutable || ARRAY['release_version'];
    END IF;
  END IF;
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
    AND release_version=2 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical access initialization required' USING ERRCODE = '23514'; END IF;
END $$;

--> statement-breakpoint
SELECT set_config('app.tenant_id',coalesce((SELECT tenant_id::text FROM turnstile.installation WHERE singleton=1),''),true);
--> statement-breakpoint
UPDATE turnstile.access_context SET release_version=2,revision=revision+1;
--> statement-breakpoint
ALTER TABLE "turnstile"."access_context" ADD CONSTRAINT "access_model_version" CHECK ("turnstile"."access_context"."model_version" = 1 AND "turnstile"."access_context"."release_version" = 2);
--> statement-breakpoint
INSERT INTO turnstile.permission_catalog(permission,company_only) VALUES
('turnstile:documents:read',true),
('turnstile:documents:upload',true),
('turnstile:documents:edit',true),
('turnstile:documents:restore',true),
('turnstile:documents:lifecycle',true),
('turnstile:documents:share',true),
('turnstile:documents:reprocess',true),
('turnstile:documents:audit',true),
('turnstile:documents:validate',true);
--> statement-breakpoint
CREATE FUNCTION turnstile.guard_documents_barrier() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF OLD.documents_contract_required AND NOT NEW.documents_contract_required THEN
   RAISE EXCEPTION 'Documents contract rollback requires coordinated restore' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION turnstile.guard_documents_barrier() FROM PUBLIC;
CREATE TRIGGER documents_barrier_monotonic BEFORE UPDATE ON turnstile.access_context
FOR EACH ROW EXECUTE FUNCTION turnstile.guard_documents_barrier();
--> statement-breakpoint
CREATE FUNCTION turnstile.guard_documents_permission() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.permission LIKE 'turnstile:documents:%' THEN
  PERFORM turnstile.lock_access_context(NEW.tenant_id);
  IF NOT (SELECT documents_contract_required FROM turnstile.access_context WHERE tenant_id=NEW.tenant_id) THEN
   RAISE EXCEPTION 'Activate reviewed v3 compatibility barrier before Documents rights' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION turnstile.guard_documents_permission() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER documents_permission_barrier AFTER INSERT OR UPDATE ON turnstile.access_role_permission
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION turnstile.guard_documents_permission();

