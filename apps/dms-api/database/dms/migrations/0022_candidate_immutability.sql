GRANT UPDATE (etag) ON dms.security_candidate TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE FUNCTION dms.protect_security_candidate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user='thaarei_dms_migrator' THEN RETURN NEW; END IF;
 IF (NEW.id,NEW.tenant_id,NEW.application_id,NEW.upload_id,NEW.object_id,NEW.size,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.application_id,OLD.upload_id,OLD.object_id,OLD.size,OLD.created_at) OR
 (OLD.state<>'COPYING' AND NEW.etag IS DISTINCT FROM OLD.etag) OR
 (OLD.state NOT IN ('COPYING','PENDING') AND (NEW.sha256,NEW.evidence,NEW.assessed_at) IS DISTINCT FROM (OLD.sha256,OLD.evidence,OLD.assessed_at)) OR
 NOT (NEW.state=OLD.state OR (OLD.state='COPYING' AND NEW.state IN ('PENDING','INCONCLUSIVE')) OR (OLD.state='PENDING' AND NEW.state IN ('PASSED','REJECTED','INCONCLUSIVE','INVALIDATED')) OR (OLD.state IN ('PASSED','REJECTED','INCONCLUSIVE') AND NEW.state='INVALIDATED')) THEN
 RAISE EXCEPTION 'Immutable security candidate' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.protect_security_candidate() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER protect_security_candidate BEFORE UPDATE ON dms.security_candidate FOR EACH ROW EXECUTE FUNCTION dms.protect_security_candidate();
