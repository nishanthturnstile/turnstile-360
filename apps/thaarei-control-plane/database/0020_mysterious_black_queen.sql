ALTER TABLE "control_plane"."registry_product" ADD COLUMN "licence_expires_at" timestamp with time zone;
GRANT UPDATE (licence_expires_at) ON control_plane.registry_product TO control_plane_runtime;
