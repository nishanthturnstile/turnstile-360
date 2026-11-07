REVOKE ALL ON control_plane.machine_authority, control_plane.machine,
  control_plane.pairing, control_plane.machine_receipt, control_plane.machine_decision FROM PUBLIC;
GRANT SELECT ON control_plane.machine_authority, control_plane.machine,
  control_plane.pairing, control_plane.machine_receipt, control_plane.machine_decision TO control_plane_runtime;
GRANT INSERT ON control_plane.machine, control_plane.pairing, control_plane.machine_receipt,
  control_plane.machine_decision TO control_plane_runtime;
GRANT UPDATE (epoch,generation,secret_digest,operation_id,revoked_at,sequence,
  first_issued_at,first_acknowledged_at,current_acknowledged_at,last_contact_at)
  ON control_plane.machine TO control_plane_runtime;
GRANT UPDATE (revoked_at,consumed_at,request_id,input_digest,receipt)
  ON control_plane.pairing TO control_plane_runtime;
GRANT UPDATE (pairing_verified_at) ON control_plane.registry_product TO control_plane_runtime;
-- The owning protocol may assert pairing. Bindings, authority marker, receipts and decision
-- evidence remain immutable to runtime. No DELETE grants or runtime schema ownership.
