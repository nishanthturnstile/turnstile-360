ALTER TABLE control_plane.staff ADD CONSTRAINT staff_role CHECK (role IN ('admin','operator','viewer'));
ALTER TABLE control_plane.staff ADD CONSTRAINT staff_revision CHECK (revision > 0);
CREATE UNIQUE INDEX two_factor_one_user_idx ON control_plane.two_factor (user_id);
CREATE UNIQUE INDEX account_provider_user_idx ON control_plane.account (user_id, provider_id);
CREATE INDEX staff_active_admin_idx ON control_plane.staff (role) WHERE active;
CREATE INDEX staff_audit_created_idx ON control_plane.staff_audit (created_at, id);
REVOKE ALL ON SCHEMA control_plane FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA control_plane FROM PUBLIC;
GRANT USAGE ON SCHEMA control_plane TO control_plane_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON control_plane."user", control_plane.session,
  control_plane.account, control_plane.verification, control_plane.two_factor,
  control_plane.rate_limit, control_plane.staff_session TO control_plane_runtime;
GRANT SELECT, INSERT, UPDATE ON control_plane.staff TO control_plane_runtime;
GRANT SELECT, INSERT ON control_plane.staff_audit TO control_plane_runtime;
-- Runtime cannot own schema, migrate, delete staff or rewrite attributed audit evidence.
