CREATE TABLE rems_participation_rosters (
  period_key INT UNSIGNED NOT NULL PRIMARY KEY,
  confirmed_by INT UNSIGNED NOT NULL,
  confirmed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT rems_roster_period FOREIGN KEY (period_key) REFERENCES rems_accounting_periods(period_key),
  CONSTRAINT rems_roster_actor FOREIGN KEY (confirmed_by) REFERENCES rems_users(id)
) ENGINE=InnoDB
