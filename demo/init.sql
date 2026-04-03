-- 1. 创建数据库
CREATE DATABASE IF NOT EXISTS auth_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE auth_demo;

-- 2. 用户表（也可由 SQLAlchemy 自动创建，此文件仅供参考）
CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL COMMENT '邮箱',
    username      VARCHAR(50) UNIQUE  NOT NULL COMMENT '用户名',
    password_hash VARCHAR(255)        NOT NULL COMMENT 'bcrypt 哈希密码',
    is_active     TINYINT(1) DEFAULT 1        COMMENT '是否启用',
    created_at    DATETIME DEFAULT NOW()      COMMENT '注册时间',
    last_login_at DATETIME                    COMMENT '最后登录时间',

    INDEX idx_email    (email),
    INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wf_003_feishu (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL UNIQUE COMMENT '关联用户 ID',
    feishu_app_id VARCHAR(255) NOT NULL COMMENT 'WF-003 飞书多维表 App ID',
    feishu_id     VARCHAR(255) NOT NULL COMMENT 'WF-003 飞书多维表 Table ID',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_wf_003_feishu_user_id (user_id),
    CONSTRAINT fk_wf_003_feishu_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
