USE auth_demo;

CREATE TABLE IF NOT EXISTS wf_003_feishu (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL UNIQUE,
    feishu_app_id VARCHAR(255) NOT NULL,
    feishu_id     VARCHAR(255) NOT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wf_003_feishu_user_id (user_id),
    CONSTRAINT fk_wf_003_feishu_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO wf_003_feishu (user_id, feishu_app_id, feishu_id)
SELECT id, feishu_app_id, feishu_id
FROM users
WHERE feishu_app_id IS NOT NULL
  AND TRIM(feishu_app_id) <> ''
  AND feishu_id IS NOT NULL
  AND TRIM(feishu_id) <> ''
ON DUPLICATE KEY UPDATE
    feishu_app_id = VALUES(feishu_app_id),
    feishu_id = VALUES(feishu_id);

ALTER TABLE users
    DROP COLUMN feishu_app_id,
    DROP COLUMN feishu_id;
