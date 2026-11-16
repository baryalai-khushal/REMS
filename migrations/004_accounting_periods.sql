CREATE TABLE rems_accounting_periods (
  period_key INT UNSIGNED NOT NULL PRIMARY KEY,
  status ENUM('open', 'settling', 'closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT rems_period_valid CHECK (period_key DIV 100 BETWEEN 1 AND 3177 AND period_key MOD 100 BETWEEN 1 AND 12)
) ENGINE=InnoDB
