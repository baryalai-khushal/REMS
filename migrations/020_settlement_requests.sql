CREATE TABLE rems_settlement_requests (
  actor_id INT UNSIGNED NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period_key INT UNSIGNED NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result JSON NOT NULL,
  recorded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (actor_id, request_key),
  CONSTRAINT rems_settlement_request_actor FOREIGN KEY (actor_id) REFERENCES rems_users(id),
  CONSTRAINT rems_settlement_request_period FOREIGN KEY (period_key) REFERENCES rems_accounting_periods(period_key)
) ENGINE=InnoDB
