CREATE TABLE rems_expenses (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  expense_date CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period_key INT UNSIGNED NOT NULL,
  category ENUM('Breakfast', 'Lunch', 'Dinner', 'Other') NOT NULL,
  description VARCHAR(100) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at TIMESTAMP(3) NULL,
  CONSTRAINT rems_expense_positive CHECK (amount > 0),
  CONSTRAINT rems_expense_date_month CHECK (
    expense_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND
    period_key = CAST(CONCAT(SUBSTRING(expense_date, 1, 4), SUBSTRING(expense_date, 6, 2)) AS UNSIGNED)
  ),
  CONSTRAINT rems_expense_user FOREIGN KEY (user_id) REFERENCES rems_users(id),
  CONSTRAINT rems_expense_period FOREIGN KEY (period_key) REFERENCES rems_accounting_periods(period_key),
  KEY rems_personal_history (user_id, period_key, deleted_at, expense_date, id),
  KEY rems_expense_review (period_key, deleted_at, expense_date, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
