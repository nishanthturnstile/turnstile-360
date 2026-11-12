-- Custom SQL migration file, put your code below! --
REVOKE ALL ON control_plane.module_assignment_entry,
  control_plane.module_assignment_state FROM PUBLIC, control_plane_runtime;
GRANT SELECT, INSERT ON control_plane.module_assignment_entry TO control_plane_runtime;
GRANT SELECT ON control_plane.module_assignment_state TO control_plane_runtime;
GRANT INSERT (product_id,draft_id,desired_id), UPDATE (draft_id,desired_id)
  ON control_plane.module_assignment_state TO control_plane_runtime;
