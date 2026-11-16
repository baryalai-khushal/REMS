CREATE TABLE rems_settlement_ledger (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  period_key INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  direction ENUM('collection', 'payout') NOT NULL,
  entry_kind ENUM('payment', 'reversal') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  payment_date CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  reversal_of INT UNSIGNED NULL UNIQUE,
  recorded_by INT UNSIGNED NOT NULL,
  recorded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT rems_ledger_participant FOREIGN KEY (period_key, user_id) REFERENCES rems_settlement_participants(period_key, user_id),
  CONSTRAINT rems_ledger_original FOREIGN KEY (reversal_of) REFERENCES rems_settlement_ledger(id),
  CONSTRAINT rems_ledger_admin FOREIGN KEY (recorded_by) REFERENCES rems_users(id),
  CONSTRAINT rems_ledger_positive CHECK (amount > 0),
  CONSTRAINT rems_ledger_reversal CHECK (
    (entry_kind = 'payment' AND reversal_of IS NULL) OR
    (entry_kind = 'reversal' AND reversal_of IS NOT NULL AND CHAR_LENGTH(TRIM(note)) > 0)
  ),
  KEY rems_ledger_month (period_key, id),
  KEY rems_ledger_person (period_key, user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
