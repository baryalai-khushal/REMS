CREATE TABLE rems_users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii NOT NULL,
  role ENUM('admin', 'roommate') NOT NULL,
  admin_slot TINYINT GENERATED ALWAYS AS (CASE WHEN role = 'admin' THEN 1 ELSE NULL END) STORED,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY rems_users_username_unique (username),
  UNIQUE KEY rems_one_admin (admin_slot)
) ENGINE=InnoDB
