CREATE TABLE rems_allocation_freezes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  period_key INT UNSIGNED NOT NULL,
  through_date CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind ENUM('departure', 'month_end') NOT NULL,
  algorithm_version VARCHAR(40) CHARACTER SET ascii NOT NULL,
  finalized_by INT UNSIGNED NOT NULL,
  finalized_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT rems_freeze_period FOREIGN KEY (period_key) REFERENCES rems_accounting_periods(period_key),
  CONSTRAINT rems_freeze_actor FOREIGN KEY (finalized_by) REFERENCES rems_users(id),
  UNIQUE KEY rems_freeze_boundary (period_key, through_date, kind)
) ENGINE=InnoDB
