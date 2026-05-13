USE auth_demo;

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
    token_hash             CHAR(64) PRIMARY KEY,
    user_id                INT NOT NULL,
    expires_at             DATETIME NOT NULL,
    revoked_at             DATETIME NULL,
    replaced_by_token_hash CHAR(64) NULL,
    created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at           DATETIME NULL,
    INDEX idx_auth_refresh_tokens_user_id (user_id),
    INDEX idx_auth_refresh_tokens_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
