ALTER TABLE dms.binary_restore FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON dms.binary_restore FROM PUBLIC,thaarei_dms_runtime,thaarei_dms_coordinator,thaarei_dms_operator;
--> statement-breakpoint
GRANT SELECT,INSERT ON dms.binary_restore TO thaarei_dms_runtime;
--> statement-breakpoint
GRANT SELECT ON dms.binary_restore TO thaarei_dms_coordinator;
--> statement-breakpoint
GRANT UPDATE (invalidation_generation) ON dms.security_candidate TO thaarei_dms_coordinator;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION dms.protect_security_candidate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user='thaarei_dms_migrator' THEN RETURN NEW; END IF;
 IF (NEW.id,NEW.tenant_id,NEW.application_id,NEW.upload_id,NEW.object_id,NEW.size,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.application_id,OLD.upload_id,OLD.object_id,OLD.size,OLD.created_at) OR
 (OLD.state<>'COPYING' AND NEW.etag IS DISTINCT FROM OLD.etag) OR
 (OLD.state NOT IN ('COPYING','PENDING') AND (NEW.sha256,NEW.evidence,NEW.assessed_at) IS DISTINCT FROM (OLD.sha256,OLD.evidence,OLD.assessed_at)) OR
 (NEW.invalidation_generation<>OLD.invalidation_generation AND NOT ((NEW.state='INVALIDATED' OR (OLD.state='PENDING' AND NEW.state IN ('REJECTED','INCONCLUSIVE'))) AND NEW.invalidation_generation=OLD.invalidation_generation+1)) OR
 NOT (NEW.state=OLD.state OR (OLD.state='COPYING' AND NEW.state IN ('PENDING','INCONCLUSIVE','INVALIDATED')) OR (OLD.state='PENDING' AND NEW.state IN ('PASSED','REJECTED','INCONCLUSIVE','INVALIDATED')) OR (OLD.state IN ('PASSED','REJECTED','INCONCLUSIVE') AND NEW.state='INVALIDATED')) THEN
 RAISE EXCEPTION 'Immutable security candidate' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION dms.check_restore_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user='thaarei_dms_migrator' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM dms.upload_admission a JOIN dms.security_candidate c ON c.id=NEW.source_candidate_id AND c.tenant_id=a.tenant_id AND c.application_id=a.application_id JOIN dms.upload_admission source ON source.id=c.upload_id AND source.document_id=a.document_id WHERE a.id=NEW.id AND a.tenant_id=NEW.tenant_id AND a.application_id=NEW.application_id AND a.storage_mode='REUSE' AND c.sha256 IS NOT NULL AND c.evidence->>'outcome'='PASSED' AND c.invalidation_generation=NEW.source_generation) THEN
 RAISE EXCEPTION 'Invalid restore reference' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.check_restore_reference() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER check_restore_reference BEFORE INSERT ON dms.binary_restore FOR EACH ROW EXECUTE FUNCTION dms.check_restore_reference();
--> statement-breakpoint
CREATE FUNCTION dms.check_shared_candidate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user='thaarei_dms_migrator' THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM dms.security_candidate c WHERE c.tenant_id=NEW.tenant_id AND c.object_id=NEW.object_id) AND NOT EXISTS(SELECT 1 FROM dms.binary_restore r JOIN dms.security_candidate c ON c.id=r.source_candidate_id JOIN dms.upload_admission source ON source.id=c.upload_id JOIN dms.upload_admission target ON target.id=NEW.upload_id WHERE r.id=NEW.upload_id AND r.tenant_id=NEW.tenant_id AND r.application_id=NEW.application_id AND c.object_id=NEW.object_id AND c.etag=NEW.etag AND c.size=NEW.size AND c.invalidation_generation=NEW.invalidation_generation AND r.source_generation=c.invalidation_generation AND source.document_id=target.document_id AND NEW.state='PENDING' AND NEW.sha256 IS NULL AND NEW.evidence IS NULL) THEN
 RAISE EXCEPTION 'Invalid shared original reference' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION dms.check_shared_candidate() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER check_shared_candidate BEFORE INSERT ON dms.security_candidate FOR EACH ROW EXECUTE FUNCTION dms.check_shared_candidate();
