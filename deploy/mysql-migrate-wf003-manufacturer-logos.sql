USE auth_demo;

CREATE TABLE IF NOT EXISTS wf_003_manufacturer_logos (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id             INT NULL,
    manufacturer_code   VARCHAR(64) NOT NULL UNIQUE,
    manufacturer_name   VARCHAR(128) NOT NULL,
    logo_file_name      VARCHAR(255) NULL,
    logo_mime_type      VARCHAR(64) NOT NULL,
    logo_public_url     VARCHAR(1000) NULL,
    logo_content        LONGBLOB NOT NULL,
    logo_sha256         CHAR(64) NULL,
    is_active           TINYINT(1) NOT NULL DEFAULT 1,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wf003_manufacturer_logos_active (is_active),
    INDEX idx_wf003_manufacturer_logos_name (manufacturer_name),
    INDEX idx_wf003_manufacturer_logos_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @wf003_user_id_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'wf_003_manufacturer_logos'
      AND COLUMN_NAME = 'user_id'
);

SET @wf003_user_id_sql := IF(
    @wf003_user_id_exists = 0,
    'ALTER TABLE wf_003_manufacturer_logos ADD COLUMN user_id INT NULL AFTER id, ADD INDEX idx_wf003_manufacturer_logos_user_id (user_id)',
    'SELECT 1'
);

PREPARE wf003_user_id_stmt FROM @wf003_user_id_sql;
EXECUTE wf003_user_id_stmt;
DEALLOCATE PREPARE wf003_user_id_stmt;

SET @wf003_logo_public_url_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'wf_003_manufacturer_logos'
      AND COLUMN_NAME = 'logo_public_url'
);

SET @wf003_logo_public_url_sql := IF(
    @wf003_logo_public_url_exists = 0,
    'ALTER TABLE wf_003_manufacturer_logos ADD COLUMN logo_public_url VARCHAR(1000) NULL AFTER logo_mime_type',
    'SELECT 1'
);

PREPARE wf003_logo_public_url_stmt FROM @wf003_logo_public_url_sql;
EXECUTE wf003_logo_public_url_stmt;
DEALLOCATE PREPARE wf003_logo_public_url_stmt;
