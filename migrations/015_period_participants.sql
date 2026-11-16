CREATE TABLE rems_period_participants (
  period_key INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (period_key, user_id),
  CONSTRAINT rems_period_roster FOREIGN KEY (period_key) REFERENCES rems_participation_rosters(period_key),
  CONSTRAINT rems_period_member FOREIGN KEY (user_id) REFERENCES rems_memberships(user_id)
) ENGINE=InnoDB
