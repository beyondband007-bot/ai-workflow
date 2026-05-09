CREATE DATABASE IF NOT EXISTS auth_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE auth_demo;

CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    username      VARCHAR(50) NOT NULL UNIQUE,
    nickname      VARCHAR(100) NULL,
    avatar_img    VARCHAR(500) NULL,
    phone         VARCHAR(32) NULL,
    address       VARCHAR(255) NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active     TINYINT(1) NOT NULL DEFAULT 1,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME NULL,
    INDEX idx_users_email (email),
    INDEX idx_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

CREATE TABLE IF NOT EXISTS wf_003_manufacturer_logos (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
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
    INDEX idx_wf003_manufacturer_logos_name (manufacturer_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS point_accounts (
    user_id                 INT PRIMARY KEY,
    available_points        INT NOT NULL DEFAULT 0,
    frozen_points           INT NOT NULL DEFAULT 0,
    total_recharged_points  INT NOT NULL DEFAULT 0,
    total_consumed_points   INT NOT NULL DEFAULT 0,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_point_accounts_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS points_transactions (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    type          VARCHAR(50) NOT NULL,
    points        INT NOT NULL,
    balance_after INT NOT NULL,
    remark        VARCHAR(255) NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_points_transactions_user_id (user_id),
    INDEX idx_points_transactions_type (type),
    INDEX idx_points_transactions_created_at (created_at),
    CONSTRAINT fk_points_transactions_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_orders (
    id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id               INT NOT NULL,
    out_trade_no          VARCHAR(64) NOT NULL UNIQUE,
    provider              VARCHAR(32) NOT NULL,
    subject               VARCHAR(255) NOT NULL,
    total_amount          DECIMAL(10, 2) NOT NULL,
    points                INT NOT NULL,
    status                VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    status_message        VARCHAR(255) NULL,
    client_token_hash     CHAR(64) NULL,
    qr_code               VARCHAR(1024) NULL,
    qr_code_data_url      MEDIUMTEXT NULL,
    alipay_trade_no       VARCHAR(64) NULL,
    alipay_trade_status   VARCHAR(32) NULL,
    paid_at               DATETIME NULL,
    canceled_at           DATETIME NULL,
    closed_at             DATETIME NULL,
    last_checked_at       DATETIME NULL,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_payment_orders_user_id (user_id),
    INDEX idx_payment_orders_provider (provider),
    INDEX idx_payment_orders_status (status),
    INDEX idx_payment_orders_created_at (created_at),
    CONSTRAINT fk_payment_orders_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_events (
    id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id              BIGINT NOT NULL,
    event_type            VARCHAR(64) NOT NULL,
    provider              VARCHAR(32) NOT NULL,
    payload_json          JSON NULL,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_payment_events_order_id (order_id),
    INDEX idx_payment_events_event_type (event_type),
    INDEX idx_payment_events_created_at (created_at),
    CONSTRAINT fk_payment_events_order
        FOREIGN KEY (order_id) REFERENCES payment_orders(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS workflow_runs (
    id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
    run_id                  VARCHAR(64) NOT NULL UNIQUE,
    user_id                 INT NOT NULL,
    workflow_code           VARCHAR(32) NOT NULL,
    client_request_id       VARCHAR(128) NOT NULL,
    status                  VARCHAR(32) NOT NULL,
    billing_status          VARCHAR(32) NOT NULL,
    estimated_count         INT NOT NULL DEFAULT 0,
    actual_completed_count  INT NULL,
    estimated_frozen_points INT NOT NULL DEFAULT 0,
    final_charge_points     INT NOT NULL DEFAULT 0,
    refund_points           INT NOT NULL DEFAULT 0,
    request_payload_summary JSON NULL,
    result_summary          TEXT NULL,
    result_summary_url      VARCHAR(500) NULL,
    result_urls_json        JSON NULL,
    external_task_id        VARCHAR(128) NULL,
    error_message           TEXT NULL,
    started_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at             DATETIME NULL,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_workflow_runs_user_workflow_client (user_id, workflow_code, client_request_id),
    INDEX idx_workflow_runs_user_id (user_id),
    INDEX idx_workflow_runs_workflow_code (workflow_code),
    INDEX idx_workflow_runs_created_at (created_at),
    CONSTRAINT fk_workflow_runs_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

CREATE TABLE IF NOT EXISTS api_call_logs (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    api_name        VARCHAR(64) NOT NULL,
    request_summary TEXT NULL,
    points_cost     INT NOT NULL DEFAULT 0,
    status          VARCHAR(32) NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_api_call_logs_user_id (user_id),
    INDEX idx_api_call_logs_api_name (api_name),
    INDEX idx_api_call_logs_created_at (created_at),
    CONSTRAINT fk_api_call_logs_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
