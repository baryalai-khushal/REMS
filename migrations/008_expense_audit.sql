CREATE TABLE rems_expense_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  expense_id INT UNSIGNED NOT NULL,
  actor_id INT UNSIGNED NOT NULL,
  action ENUM('create', 'update', 'delete') NOT NULL,
  occurred_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  before_values JSON NULL,
  after_values JSON NOT NULL,
  CONSTRAINT rems_audit_expense FOREIGN KEY (expense_id) REFERENCES rems_expenses(id),
  CONSTRAINT rems_audit_actor FOREIGN KEY (actor_id) REFERENCES rems_users(id),
  KEY rems_expense_audit_history (expense_id, id),
  KEY rems_expense_audit_actor (actor_id, occurred_at)
) ENGINE=InnoDB
