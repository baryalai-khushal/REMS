CREATE TABLE rems_departures (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  period_key INT UNSIGNED NOT NULL,
  leaves_on CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  freeze_id INT UNSIGNED NOT NULL,
  source_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  finalized_by INT UNSIGNED NOT NULL,
  finalized_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deactivated_by INT UNSIGNED NULL,
  deactivated_at TIMESTAMP(3) NULL,
  CONSTRAINT rems_departure_user FOREIGN KEY (user_id) REFERENCES rems_memberships(user_id),
  CONSTRAINT rems_departure_period FOREIGN KEY (period_key) REFERENCES rems_accounting_periods(period_key),
  CONSTRAINT rems_departure_freeze FOREIGN KEY (freeze_id) REFERENCES rems_allocation_freezes(id),
  CONSTRAINT rems_departure_actor FOREIGN KEY (finalized_by) REFERENCES rems_users(id),
  CONSTRAINT rems_departure_deactivation_actor FOREIGN KEY (deactivated_by) REFERENCES rems_users(id),
  KEY rems_departures_period (period_key, leaves_on)
) ENGINE=InnoDB
