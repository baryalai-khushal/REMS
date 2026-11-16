CREATE TABLE rems_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY rems_sessions_expiry (expires_at),
  CONSTRAINT rems_sessions_user FOREIGN KEY (user_id) REFERENCES rems_users(id) ON DELETE CASCADE
) ENGINE=InnoDB
