CREATE TABLE rems_accounting_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  first_period INT UNSIGNED NULL,
  CONSTRAINT rems_single_accounting_state CHECK (id = 1),
  CONSTRAINT rems_first_period FOREIGN KEY (first_period) REFERENCES rems_accounting_periods(period_key)
) ENGINE=InnoDB
