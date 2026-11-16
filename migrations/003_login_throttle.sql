CREATE TABLE rems_login_throttle (
  username_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  window_end TIMESTAMP(3) NOT NULL,
  KEY rems_login_throttle_expiry (window_end)
) ENGINE=InnoDB
