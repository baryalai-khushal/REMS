CREATE TABLE rems_month_settlements (
  period_key INT UNSIGNED NOT NULL PRIMARY KEY,
  freeze_id INT UNSIGNED NOT NULL UNIQUE,
  review_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  begun_by INT UNSIGNED NOT NULL,
  begun_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_by INT UNSIGNED NULL,
  closed_at TIMESTAMP(3) NULL,
  CONSTRAINT rems_settlement_period FOREIGN KEY (period_key) REFERENCES rems_accounting_periods(period_key),
  CONSTRAINT rems_settlement_freeze FOREIGN KEY (freeze_id) REFERENCES rems_allocation_freezes(id),
  CONSTRAINT rems_settlement_begin_actor FOREIGN KEY (begun_by) REFERENCES rems_users(id),
  CONSTRAINT rems_settlement_close_actor FOREIGN KEY (closed_by) REFERENCES rems_users(id)
) ENGINE=InnoDB
