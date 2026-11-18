REVOKE ALL ON control_plane.registry_client, control_plane.registry_installation,
  control_plane.registry_product, control_plane.registry_receipt, control_plane.registry_audit FROM PUBLIC;
GRANT SELECT ON control_plane.registry_client, control_plane.registry_installation,
  control_plane.registry_product, control_plane.registry_receipt, control_plane.registry_audit TO control_plane_runtime;
GRANT INSERT (id,code,name,contact_name,contact_email,registered_at,updated_at)
  ON control_plane.registry_client TO control_plane_runtime;
GRANT UPDATE (name,contact_name,contact_email,archived,revision,updated_at)
  ON control_plane.registry_client TO control_plane_runtime;
GRANT INSERT (id,client_id,environment,label,local_installation_id,tenant_id,registered_at)
  ON control_plane.registry_installation TO control_plane_runtime;
GRANT INSERT (id,client_id,installation_id,product,application_id,policy_changed_by,registered_at,policy_changed_at)
  ON control_plane.registry_product TO control_plane_runtime;
GRANT UPDATE (policy_state,revision,policy_reason,policy_changed_by,policy_changed_at,first_approved_at,last_approved_at)
  ON control_plane.registry_product TO control_plane_runtime;
GRANT INSERT ON control_plane.registry_receipt, control_plane.registry_audit TO control_plane_runtime;
-- No hard delete, binding/code rewrite, pairing assertion, receipt rewrite or audit rewrite.
-- TCP-I04 must grant a separately reviewed owning pairing update when its protocol exists.
