REVOKE ALL ON control_plane.module_authority FROM PUBLIC, control_plane_runtime;
GRANT SELECT ON control_plane.module_authority TO control_plane_runtime;
-- Runtime can establish only a closed fence. No deletion, downgrade or active-policy writes.
GRANT INSERT (product_id) ON control_plane.module_authority TO control_plane_runtime;
