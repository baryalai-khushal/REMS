CREATE TABLE rems_memberships (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  roster_period INT UNSIGNED NOT NULL,
  starts_on CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  leaves_on CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
  CONSTRAINT rems_membership_user FOREIGN KEY (user_id) REFERENCES rems_users(id),
  CONSTRAINT rems_membership_roster FOREIGN KEY (roster_period) REFERENCES rems_participation_rosters(period_key),
  CONSTRAINT rems_membership_dates CHECK (leaves_on IS NULL OR leaves_on >= starts_on),
  KEY rems_membership_dates_index (starts_on, leaves_on)
) ENGINE=InnoDB
