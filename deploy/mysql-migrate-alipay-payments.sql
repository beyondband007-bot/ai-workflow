USE auth_demo;

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
