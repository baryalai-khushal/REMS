CREATE TABLE rems_finalized_shares (
  expense_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  share_minor BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (expense_id, user_id),
  CONSTRAINT rems_share_expense FOREIGN KEY (expense_id) REFERENCES rems_finalized_expenses(expense_id),
  CONSTRAINT rems_share_user FOREIGN KEY (user_id) REFERENCES rems_users(id)
) ENGINE=InnoDB
