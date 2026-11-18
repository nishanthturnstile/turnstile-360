REVOKE ALL ON control_plane.module_observation FROM PUBLIC, control_plane_runtime;
GRANT SELECT, INSERT ON control_plane.module_observation TO control_plane_runtime;
GRANT UPDATE (epoch,installed,observed_at) ON control_plane.module_observation TO control_plane_runtime;
-- Active authority remains inaccessible to direct runtime UPDATE. The reviewed writer
-- checks live staff/MFA, fixed product/revision, permanent floor and the current epoch.
CREATE FUNCTION control_plane.commit_module_authority(proof text, product uuid, expected integer, mode text, document jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old jsonb; current_epoch uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM control_plane.staff_session p JOIN control_plane.session s ON s.id=p.session_id
 JOIN control_plane."user" u ON u.id=s.user_id JOIN control_plane.staff m ON m.user_id=u.id
 WHERE p.session_id=proof AND m.active AND m.role IN ('admin','operator') AND u.email_verified AND u.two_factor_enabled
 AND s.expires_at>now() AND s.created_at>now()-interval '8 hours' AND p.last_seen_at>now()-interval '30 minutes'
 AND p.mfa_at BETWEEN now()-interval '10 minutes' AND now()) THEN RAISE EXCEPTION 'Current staff MFA required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM control_plane.registry_product r WHERE r.id=commit_module_authority.product AND r.product='turnstile' AND r.revision=expected FOR UPDATE)
 THEN RAISE EXCEPTION 'Product revision changed' USING ERRCODE='40001'; END IF;
 SELECT a.document INTO old FROM control_plane.module_authority a WHERE a.product_id=product AND minimum_version=2 FOR UPDATE;
 IF NOT FOUND OR document IS NULL OR document->>'version'<>'1' OR jsonb_typeof(document->'policy')<>'object'
 OR (document#>>'{policy,active,policyRevision}')::integer<>expected+1 THEN RAISE EXCEPTION 'Module authority context rejected' USING ERRCODE='23514'; END IF;
 IF mode='restrict' THEN
   IF old IS NULL OR document->'epoch' IS DISTINCT FROM old->'epoch'
    OR document->'request' IS DISTINCT FROM old->'request'
    OR (document#>'{policy,active}')-'policyRevision' IS DISTINCT FROM (old#>'{policy,active}')-'policyRevision'
    OR NOT ((old#>'{policy,allowedModuleIds}') @> (document#>'{policy,allowedModuleIds}'))
   THEN RAISE EXCEPTION 'Restriction cannot expand authority' USING ERRCODE='23514'; END IF;
 ELSIF mode='activate' THEN
   SELECT epoch INTO current_epoch FROM control_plane.machine WHERE product_id=product AND revoked_at IS NULL FOR UPDATE;
   IF current_epoch IS NULL OR document->>'epoch'<>current_epoch::text THEN RAISE EXCEPTION 'Current pairing required' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Unknown module operation' USING ERRCODE='23514'; END IF;
 UPDATE control_plane.module_authority a SET document=commit_module_authority.document WHERE a.product_id=product;
END $$;
REVOKE ALL ON FUNCTION control_plane.commit_module_authority(text,uuid,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control_plane.commit_module_authority(text,uuid,integer,text,jsonb) TO control_plane_runtime;
