ALTER TABLE rems_settlement_ledger
  DROP FOREIGN KEY rems_ledger_participant,
  ADD COLUMN basis_freeze_id INT UNSIGNED NULL,
  ADD CONSTRAINT rems_ledger_roster_participant FOREIGN KEY (period_key, user_id) REFERENCES rems_period_participants(period_key, user_id),
  ADD CONSTRAINT rems_ledger_review_basis FOREIGN KEY (basis_freeze_id) REFERENCES rems_allocation_freezes(id)
