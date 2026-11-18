REVOKE ALL ON control_plane.machine_application FROM PUBLIC, control_plane_runtime;
GRANT SELECT, INSERT ON control_plane.machine_application TO control_plane_runtime;
GRANT UPDATE (epoch,decision_id,applied_at,received_at) ON control_plane.machine_application TO control_plane_runtime;
