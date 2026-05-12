USE auth_demo;

CREATE TABLE IF NOT EXISTS wf003_submissions (
    submission_id          VARCHAR(128) PRIMARY KEY,
    run_id                 VARCHAR(128) NOT NULL,
    workflow_code          VARCHAR(32) NOT NULL DEFAULT 'WF-003',
    client_request_id      VARCHAR(128) NULL,
    user_id                VARCHAR(64) NULL,
    callback_url           VARCHAR(1000) NULL,
    callback_token         VARCHAR(255) NULL,
    car_name               VARCHAR(255) NULL,
    logo                   VARCHAR(1000) NULL,
    feishu_app_id          VARCHAR(255) NULL,
    feishu_id              VARCHAR(255) NULL,
    expected_tasks         INT NOT NULL DEFAULT 0,
    finalized              TINYINT(1) NOT NULL DEFAULT 0,
    finalize_in_progress   TINYINT(1) NOT NULL DEFAULT 0,
    finalize_token         VARCHAR(128) NULL,
    finalize_requested_at  DATETIME NULL,
    finalized_at           DATETIME NULL,
    finalize_error         TEXT NULL,
    created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wf003_submissions_run_id (run_id),
    INDEX idx_wf003_submissions_finalized (finalized),
    INDEX idx_wf003_submissions_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wf003_tasks (
    task_id                 VARCHAR(128) PRIMARY KEY,
    submission_id           VARCHAR(128) NOT NULL,
    type                    VARCHAR(32) NOT NULL,
    task_index              INT NULL,
    group_index             INT NULL,
    image_url               VARCHAR(1000) NULL,
    image_urls_json         JSON NULL,
    state                   VARCHAR(32) NOT NULL DEFAULT 'submitted',
    raw_state               VARCHAR(64) NULL,
    result_url              VARCHAR(1000) NULL,
    fail_code               VARCHAR(255) NULL,
    fail_msg                TEXT NULL,
    callback_payload_json   JSON NULL,
    last_callback_at        DATETIME NULL,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wf003_tasks_submission_id (submission_id),
    INDEX idx_wf003_tasks_state (state),
    CONSTRAINT fk_wf003_tasks_submission
        FOREIGN KEY (submission_id) REFERENCES wf003_submissions(submission_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @wf003_tasks_fk_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_NAME = 'fk_wf003_tasks_submission'
      AND TABLE_NAME = 'wf003_tasks'
);

SET @wf003_tasks_fk_drop_sql := IF(
    @wf003_tasks_fk_exists > 0,
    'ALTER TABLE wf003_tasks DROP FOREIGN KEY fk_wf003_tasks_submission',
    'SELECT 1'
);

PREPARE wf003_tasks_fk_drop_stmt FROM @wf003_tasks_fk_drop_sql;
EXECUTE wf003_tasks_fk_drop_stmt;
DEALLOCATE PREPARE wf003_tasks_fk_drop_stmt;

ALTER TABLE wf003_submissions
    MODIFY COLUMN submission_id VARCHAR(128) NOT NULL,
    MODIFY COLUMN run_id VARCHAR(128) NOT NULL,
    MODIFY COLUMN workflow_code VARCHAR(32) NOT NULL DEFAULT 'WF-003',
    MODIFY COLUMN client_request_id VARCHAR(128) NULL,
    MODIFY COLUMN user_id VARCHAR(64) NULL,
    MODIFY COLUMN callback_url VARCHAR(1000) NULL,
    MODIFY COLUMN callback_token VARCHAR(255) NULL,
    MODIFY COLUMN car_name VARCHAR(255) NULL,
    MODIFY COLUMN logo VARCHAR(1000) NULL,
    MODIFY COLUMN feishu_app_id VARCHAR(255) NULL,
    MODIFY COLUMN feishu_id VARCHAR(255) NULL,
    MODIFY COLUMN expected_tasks INT NOT NULL DEFAULT 0,
    MODIFY COLUMN finalized TINYINT(1) NOT NULL DEFAULT 0,
    MODIFY COLUMN finalize_in_progress TINYINT(1) NOT NULL DEFAULT 0,
    MODIFY COLUMN finalize_token VARCHAR(128) NULL,
    MODIFY COLUMN finalize_requested_at DATETIME NULL,
    MODIFY COLUMN finalized_at DATETIME NULL;

SET @wf003_submissions_finalize_error_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'wf003_submissions'
      AND COLUMN_NAME = 'finalize_error'
);

SET @wf003_submissions_finalize_error_sql := IF(
    @wf003_submissions_finalize_error_exists = 0,
    'ALTER TABLE wf003_submissions ADD COLUMN finalize_error TEXT NULL AFTER finalized_at',
    'SELECT 1'
);

PREPARE wf003_submissions_finalize_error_stmt FROM @wf003_submissions_finalize_error_sql;
EXECUTE wf003_submissions_finalize_error_stmt;
DEALLOCATE PREPARE wf003_submissions_finalize_error_stmt;

SET @wf003_submissions_updated_at_idx_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'wf003_submissions'
      AND INDEX_NAME = 'idx_wf003_submissions_updated_at'
);

SET @wf003_submissions_updated_at_idx_sql := IF(
    @wf003_submissions_updated_at_idx_exists = 0,
    'ALTER TABLE wf003_submissions ADD INDEX idx_wf003_submissions_updated_at (updated_at)',
    'SELECT 1'
);

PREPARE wf003_submissions_updated_at_idx_stmt FROM @wf003_submissions_updated_at_idx_sql;
EXECUTE wf003_submissions_updated_at_idx_stmt;
DEALLOCATE PREPARE wf003_submissions_updated_at_idx_stmt;

ALTER TABLE wf003_tasks
    MODIFY COLUMN task_id VARCHAR(128) NOT NULL,
    MODIFY COLUMN submission_id VARCHAR(128) NOT NULL,
    MODIFY COLUMN type VARCHAR(32) NOT NULL,
    MODIFY COLUMN task_index INT NULL,
    MODIFY COLUMN group_index INT NULL,
    MODIFY COLUMN image_url VARCHAR(1000) NULL,
    MODIFY COLUMN state VARCHAR(32) NOT NULL DEFAULT 'submitted',
    MODIFY COLUMN raw_state VARCHAR(64) NULL,
    MODIFY COLUMN result_url VARCHAR(1000) NULL,
    MODIFY COLUMN fail_code VARCHAR(255) NULL,
    MODIFY COLUMN fail_msg TEXT NULL,
    MODIFY COLUMN last_callback_at DATETIME NULL;

SET @wf003_tasks_state_idx_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'wf003_tasks'
      AND INDEX_NAME = 'idx_wf003_tasks_state'
);

SET @wf003_tasks_state_idx_sql := IF(
    @wf003_tasks_state_idx_exists = 0,
    'ALTER TABLE wf003_tasks ADD INDEX idx_wf003_tasks_state (state)',
    'SELECT 1'
);

PREPARE wf003_tasks_state_idx_stmt FROM @wf003_tasks_state_idx_sql;
EXECUTE wf003_tasks_state_idx_stmt;
DEALLOCATE PREPARE wf003_tasks_state_idx_stmt;

SET @wf003_tasks_submission_idx_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'wf003_tasks'
      AND INDEX_NAME IN ('idx_wf003_tasks_submission', 'idx_wf003_tasks_submission_id')
);

SET @wf003_tasks_submission_idx_sql := IF(
    @wf003_tasks_submission_idx_exists = 0,
    'ALTER TABLE wf003_tasks ADD INDEX idx_wf003_tasks_submission_id (submission_id)',
    'SELECT 1'
);

PREPARE wf003_tasks_submission_idx_stmt FROM @wf003_tasks_submission_idx_sql;
EXECUTE wf003_tasks_submission_idx_stmt;
DEALLOCATE PREPARE wf003_tasks_submission_idx_stmt;

SET @wf003_tasks_fk_recreate_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_NAME = 'fk_wf003_tasks_submission'
      AND TABLE_NAME = 'wf003_tasks'
);

SET @wf003_tasks_fk_recreate_sql := IF(
    @wf003_tasks_fk_recreate_exists = 0,
    'ALTER TABLE wf003_tasks ADD CONSTRAINT fk_wf003_tasks_submission FOREIGN KEY (submission_id) REFERENCES wf003_submissions(submission_id) ON DELETE CASCADE',
    'SELECT 1'
);

PREPARE wf003_tasks_fk_recreate_stmt FROM @wf003_tasks_fk_recreate_sql;
EXECUTE wf003_tasks_fk_recreate_stmt;
DEALLOCATE PREPARE wf003_tasks_fk_recreate_stmt;
