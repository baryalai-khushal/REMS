CREATE TABLE rems_settlement_participants (
  period_key INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  username_at_review VARCHAR(32) NOT NULL,
  spending_minor DECIMAL(40,0) UNSIGNED NOT NULL,
  share_minor DECIMAL(40,0) UNSIGNED NOT NULL,
  initial_minor DECIMAL(40,0) NOT NULL,
  PRIMARY KEY (period_key, user_id),
  CONSTRAINT rems_frozen_balance_month FOREIGN KEY (period_key) REFERENCES rems_month_settlements(period_key),
  CONSTRAINT rems_frozen_balance_user FOREIGN KEY (user_id) REFERENCES rems_users(id),
  CONSTRAINT rems_initial_balance_equation CHECK (initial_minor = spending_minor - share_minor)
) ENGINE=InnoDB
