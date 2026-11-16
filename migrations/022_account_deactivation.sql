ALTER TABLE rems_users
  ADD COLUMN deactivated_at TIMESTAMP(3) NULL,
  ADD COLUMN deactivated_by INT UNSIGNED NULL,
  ADD CONSTRAINT rems_deactivation_actor FOREIGN KEY (deactivated_by) REFERENCES rems_users(id)
