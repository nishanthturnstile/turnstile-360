REVOKE ALL ON control_plane.report_snapshot,control_plane.report_latest,control_plane.report_counter FROM PUBLIC;
GRANT SELECT,INSERT ON control_plane.report_snapshot TO control_plane_runtime;
GRANT SELECT,INSERT,UPDATE ON control_plane.report_latest,control_plane.report_counter TO control_plane_runtime;
CREATE UNIQUE INDEX report_snapshot_order_idx ON control_plane.report_snapshot(product_id,epoch,sequence) WHERE sequence IS NOT NULL;
CREATE INDEX registry_audit_retention_idx ON control_plane.registry_audit(committed_at,id);
CREATE INDEX staff_audit_retention_idx ON control_plane.staff_audit(created_at,id);
CREATE FUNCTION control_plane.prune_reporting() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE samples integer; registry_events integer; staff_events integer; latest_values integer;
BEGIN
 DELETE FROM control_plane.report_snapshot WHERE id IN(SELECT id FROM control_plane.report_snapshot WHERE received_at<clock_timestamp()-interval '90 days' ORDER BY received_at,id LIMIT 1000 FOR UPDATE SKIP LOCKED); GET DIAGNOSTICS samples=ROW_COUNT;
 UPDATE control_plane.report_latest SET payload=NULL WHERE product_id IN(SELECT product_id FROM control_plane.report_latest WHERE received_at<clock_timestamp()-interval '90 days' AND payload IS NOT NULL ORDER BY received_at,product_id LIMIT 1000 FOR UPDATE SKIP LOCKED); GET DIAGNOSTICS latest_values=ROW_COUNT;
 DELETE FROM control_plane.registry_audit WHERE id IN(SELECT id FROM control_plane.registry_audit WHERE committed_at<clock_timestamp()-interval '365 days' ORDER BY committed_at,id LIMIT 1000 FOR UPDATE SKIP LOCKED); GET DIAGNOSTICS registry_events=ROW_COUNT;
 DELETE FROM control_plane.staff_audit WHERE id IN(SELECT id FROM control_plane.staff_audit WHERE created_at<clock_timestamp()-interval '365 days' ORDER BY created_at,id LIMIT 1000 FOR UPDATE SKIP LOCKED); GET DIAGNOSTICS staff_events=ROW_COUNT;
 RETURN jsonb_build_object('snapshots',samples,'latestValues',latest_values,'registryAudit',registry_events,'staffAudit',staff_events);
END $$;
REVOKE ALL ON FUNCTION control_plane.prune_reporting() FROM PUBLIC;

CREATE UNIQUE INDEX machine_report_order_idx ON control_plane.machine_receipt(product_id,(result->>'reportEpoch'),((result->>'reportSequence')::bigint)) WHERE kind='sync' AND result ? 'reportSequence';
