CREATE TABLE rems_finalized_expenses (
  expense_id INT UNSIGNED NOT NULL PRIMARY KEY,
  freeze_id INT UNSIGNED NOT NULL,
  expense_version INT UNSIGNED NOT NULL,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  CONSTRAINT rems_finalized_expense FOREIGN KEY (expense_id) REFERENCES rems_expenses(id),
  CONSTRAINT rems_finalized_freeze FOREIGN KEY (freeze_id) REFERENCES rems_allocation_freezes(id)
) ENGINE=InnoDB
