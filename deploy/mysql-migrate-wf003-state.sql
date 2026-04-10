USE auth_demo;

CREATE TABLE IF NOT EXISTS wf003_submissions (
    submission_id         VARCHAR(64) PRIMARY KEY,
    run_id                VARCHAR(64) NOT NULL,
    workflow_code         VARCHAR(32) NOT NULL DEFAULT 'WF-003',
    client_request_id     VARCHAR(128) NOT NULL,
    user_id               VARCHAR(64) NOT NULL DEFAULT '',
    callback_url          VARCHAR(500) NOT NULL DEFAULT '',
    callback_token        VARCHAR(255) NOT NULL DEFAULT '',
    car_name              VARCHAR(255) NOT NULL DEFAULT '',
    logo                  VARCHAR(500) NOT NULL DEFAULT '',
    feishu_app_id         VARCHAR(255) NOT NULL DEFAULT '',
    feishu_id             VARCHAR(255) NOT NULL DEFAULT '',
    expected_tasks        INT NOT NULL DEFAULT 0,
    finalized             TINYINT(1) NOT NULL DEFAULT 0,
    finalized_at          DATETIME NULL,
    finalize_in_progress  TINYINT(1) NOT NULL DEFAULT 0,
    finalize_token        VARCHAR(64) NULL,
    finalize_requested_at DATETIME NULL,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wf003_submissions_run_id (run_id),
    INDEX idx_wf003_submissions_finalized (finalized, finalize_in_progress)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wf003_tasks (
    task_id                VARCHAR(128) PRIMARY KEY,
    submission_id          VARCHAR(64) NOT NULL,
    type                   VARCHAR(16) NOT NULL,
    task_index             INT NULL,
    group_index            INT NULL,
    image_url              VARCHAR(1000) NULL,
    image_urls_json        JSON NULL,
    state                  VARCHAR(32) NOT NULL DEFAULT 'submitted',
    raw_state              VARCHAR(32) NULL,
    result_url             VARCHAR(1000) NULL,
    fail_code              VARCHAR(64) NULL,
    fail_msg               TEXT NULL,
    callback_payload_json  JSON NULL,
    last_callback_at       DATETIME NULL,
    created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wf003_tasks_submission (submission_id),
    INDEX idx_wf003_tasks_submission_state (submission_id, state),
    CONSTRAINT fk_wf003_tasks_submission
        FOREIGN KEY (submission_id) REFERENCES wf003_submissions(submission_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
