CREATE TABLE rems_cutoff_balances (
  freeze_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  username_at_review VARCHAR(32) NOT NULL,
  spending_minor DECIMAL(40,0) UNSIGNED NOT NULL,
  share_minor DECIMAL(40,0) UNSIGNED NOT NULL,
  initial_minor DECIMAL(40,0) NOT NULL,
  PRIMARY KEY (freeze_id, user_id),
  CONSTRAINT rems_cutoff_freeze FOREIGN KEY (freeze_id) REFERENCES rems_allocation_freezes(id),
  CONSTRAINT rems_cutoff_user FOREIGN KEY (user_id) REFERENCES rems_users(id),
  CONSTRAINT rems_cutoff_equation CHECK (initial_minor = CAST(spending_minor AS DECIMAL(41,0)) - CAST(share_minor AS DECIMAL(41,0)))
) ENGINE=InnoDB
