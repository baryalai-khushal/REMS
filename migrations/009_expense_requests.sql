CREATE TABLE rems_expense_requests (
  actor_id INT UNSIGNED NOT NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expense_id INT UNSIGNED NOT NULL,
  result JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (actor_id, request_key),
  CONSTRAINT rems_request_actor FOREIGN KEY (actor_id) REFERENCES rems_users(id),
  CONSTRAINT rems_request_expense FOREIGN KEY (expense_id) REFERENCES rems_expenses(id)
) ENGINE=InnoDB
