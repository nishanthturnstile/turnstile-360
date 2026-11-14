-- Keep access_audit append-only to runtime; expose only bounded, authorized product events.
CREATE FUNCTION turnstile.read_people_audit(target uuid, actor text, wanted_source text,
 wanted_action text, chosen uuid, since_at timestamptz, until_at timestamptz,
 before_at timestamptz, before_id uuid, before_source text, page_size integer)
RETURNS TABLE(id uuid, source text, action text, occurred_at timestamptz,
 actor_kind text, actor_id text, subject_id uuid, revision_before integer,
 revision_after integer, generation integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF target IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
 OR page_size IS NULL OR page_size<1 OR page_size>101
 OR (wanted_source IS NOT NULL AND wanted_source NOT IN ('access','invitations'))
 OR NOT turnstile.people_covers(target,actor,ARRAY['turnstile:people:manage'],'{"kind":"company"}')
 OR NOT EXISTS(SELECT 1 FROM turnstile.organization_configuration o WHERE o.tenant_id=target AND o.completed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'people_denied' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 WITH events AS (
  SELECT a.id,'access'::text AS source,a.action,a.occurred_at,a.actor_kind,a.actor_id,
    a.subject_id,a.revision_before,a.revision_after,NULL::integer AS generation
  FROM turnstile.access_audit a WHERE a.tenant_id=target AND a.actor_kind='user'
    AND (wanted_source IS NULL OR wanted_source='access')
    AND a.occurred_at>=greatest(coalesce(since_at,'-infinity'::timestamptz),statement_timestamp()-interval '90 days')
    AND (until_at IS NULL OR a.occurred_at<=until_at)
    AND (wanted_action IS NULL OR a.action=wanted_action)
    AND (chosen IS NULL OR a.subject_id=chosen)
  UNION ALL
  SELECT a.id,'invitations',a.action,a.created_at,a.actor_kind,a.actor_id,
    a.invitation_id,NULL::integer,NULL::integer,a.generation
  FROM turnstile.invitation_audit a WHERE a.tenant_id=target
    AND (wanted_source IS NULL OR wanted_source='invitations')
    AND a.created_at>=greatest(coalesce(since_at,'-infinity'::timestamptz),statement_timestamp()-interval '90 days')
    AND (until_at IS NULL OR a.created_at<=until_at)
    AND (wanted_action IS NULL OR a.action=wanted_action)
    AND (chosen IS NULL OR a.invitation_id=chosen)
 ) SELECT e.* FROM events e
 WHERE before_at IS NULL OR (e.occurred_at,e.id,e.source)<(before_at,before_id,before_source)
 ORDER BY e.occurred_at DESC,e.id DESC,e.source DESC LIMIT page_size;
END;
$$;
REVOKE ALL ON FUNCTION turnstile.read_people_audit(uuid,text,text,text,uuid,timestamptz,timestamptz,timestamptz,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION turnstile.read_people_audit(uuid,text,text,text,uuid,timestamptz,timestamptz,timestamptz,uuid,text,integer) TO thaarei_turnstile_runtime;
