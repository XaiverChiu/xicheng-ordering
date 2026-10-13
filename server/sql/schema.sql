-- ============================================================
-- XiCheng 游戏剪辑自助下单平台 · 建表脚本
-- 数据库：MySQL 5.7+ / 8.0+，字符集 utf8mb4
-- 执行：mysql -u root -p < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS `xicheng_ordering`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE `xicheng_ordering`;

-- ------------------------------------------------------------
-- 订单
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `orders` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no`         VARCHAR(32)  NOT NULL                 COMMENT '订单号 XC-YYMMDD-XXXX',
  `game_key`         VARCHAR(32)  NOT NULL                 COMMENT '分组：delta / valorant',
  `game_name`        VARCHAR(64)  NOT NULL                 COMMENT '分组名称快照',
  `package_id`       VARCHAR(32)  NOT NULL                 COMMENT '规格 ID',
  `package_name`     VARCHAR(64)  NOT NULL                 COMMENT '规格名称快照',
  `pricing_mode`     VARCHAR(64)  NOT NULL                 COMMENT '计价方式文案',
  `unit`             VARCHAR(8)   NOT NULL DEFAULT '分钟'  COMMENT '分钟 / 回合',
  `unit_price`       DECIMAL(10,2) NOT NULL                COMMENT '名义单价（元/分钟 或 元/回合）',
  `quantity`         INT UNSIGNED NOT NULL DEFAULT 1       COMMENT '分钟数或回合数',
  `base_amount`      DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT '规格小计',
  `overtime_units`   INT UNSIGNED NOT NULL DEFAULT 0       COMMENT '超出基准的分钟数',
  `overtime_amount`  DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT '超时长加价（每分钟 +12）',
  `upscale_4k`       TINYINT(1)   NOT NULL DEFAULT 0       COMMENT '是否加 4K 超分（+15）',
  `upscale_amount`   DECIMAL(10,2) NOT NULL DEFAULT 0,
  `rush`             TINYINT(1)   NOT NULL DEFAULT 0       COMMENT '是否加急（费用另议）',
  `total_amount`     DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT '应付合计',
  `paid_amount`      DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT '已付金额',
  `credit_used`      DECIMAL(10,2) NOT NULL DEFAULT 0      COMMENT '存单抵扣金额',
  `contact`          VARCHAR(80)  NOT NULL                 COMMENT '联系方式（QQ/微信/手机号）',
  `contact_norm`     VARCHAR(80)  NOT NULL                 COMMENT '联系方式归一化（去空格小写，用于查询）',
  `music_type`       VARCHAR(16)  NOT NULL DEFAULT 'self'  COMMENT 'self 自备 / pro 剪辑师自选',
  `material_state`   VARCHAR(16)  NOT NULL DEFAULT 'ready' COMMENT 'ready 已备好 / later 稍后提供',
  `ref_link`         VARCHAR(512) NOT NULL DEFAULT ''      COMMENT '配乐 / 参考链接',
  `requirement`      TEXT         NULL                     COMMENT '剪辑要求',
  `admin_note`       VARCHAR(512) NOT NULL DEFAULT ''      COMMENT '管理员备注（内部可见）',
  `status`           ENUM('wait','paid','doing','done','canceled') NOT NULL DEFAULT 'wait',
  `source`           VARCHAR(16)  NOT NULL DEFAULT 'web'   COMMENT '下单来源',
  `client_ip`        VARCHAR(64)  NOT NULL DEFAULT '',
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at`          DATETIME     NULL                     COMMENT '付款到账时间',
  `delivered_at`     DATETIME     NULL                     COMMENT '交付时间',
  `due_at`           DATETIME     NULL                     COMMENT '承诺交付截止（付款时间 + 48h）',
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_contact_norm` (`contact_norm`),
  KEY `idx_status_created` (`status`, `created_at`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='订单主表';

-- ------------------------------------------------------------
-- 订单状态流转日志
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `order_logs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`    BIGINT UNSIGNED NOT NULL,
  `order_no`    VARCHAR(32)  NOT NULL,
  `from_status` VARCHAR(16)  NOT NULL DEFAULT '',
  `to_status`   VARCHAR(16)  NOT NULL,
  `operator`    VARCHAR(64)  NOT NULL DEFAULT 'system' COMMENT '管理员用户名 / system / customer',
  `note`        VARCHAR(512) NOT NULL DEFAULT '',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`),
  CONSTRAINT `fk_log_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='订单状态流转日志';

-- ------------------------------------------------------------
-- 管理后台账号
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admins` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(32)  NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL COMMENT 'scrypt$salt$hash',
  `display_name`  VARCHAR(64)  NOT NULL DEFAULT '',
  `role`          ENUM('admin','operator') NOT NULL DEFAULT 'admin',
  `enabled`       TINYINT(1)   NOT NULL DEFAULT 1,
  `last_login_at` DATETIME     NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='管理后台账号';

-- ------------------------------------------------------------
-- 管理后台登录会话
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_sessions` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`   INT UNSIGNED NOT NULL,
  `token_hash` CHAR(64)     NOT NULL COMMENT '会话令牌的 sha256',
  `expires_at` DATETIME     NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_token` (`token_hash`),
  KEY `idx_admin` (`admin_id`),
  CONSTRAINT `fk_sess_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='后台登录会话';

-- ------------------------------------------------------------
-- 客户档案（按联系方式聚合，金额为派生值，便于后台查看）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `customers` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contact_norm` VARCHAR(80) NOT NULL,
  `contact`      VARCHAR(80) NOT NULL,
  `total_orders` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `last_order_at` DATETIME NULL,
  `first_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_contact_norm` (`contact_norm`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='客户档案（按联系方式）';

-- ------------------------------------------------------------
-- 待核对付款（客户已付款、等待剪辑师核对到账）
-- 核对通过后才生成正式订单（orders），保证后台订单列表里都是已到账的单
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payment_claims` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `claim_no`       VARCHAR(32)  NOT NULL                 COMMENT '待核对编号 XCP-YYMMDD-XXXX',
  `status`         ENUM('pending','confirmed','rejected','expired') NOT NULL DEFAULT 'pending',
  `game_key`       VARCHAR(32)  NOT NULL,
  `game_name`      VARCHAR(64)  NOT NULL,
  `package_id`     VARCHAR(32)  NOT NULL,
  `package_name`   VARCHAR(64)  NOT NULL,
  `pricing_mode`   VARCHAR(64)  NOT NULL,
  `unit`           VARCHAR(8)   NOT NULL DEFAULT '分钟',
  `unit_price`     DECIMAL(10,2) NOT NULL,
  `quantity`       INT UNSIGNED NOT NULL DEFAULT 1,
  `base_amount`    DECIMAL(10,2) NOT NULL DEFAULT 0,
  `overtime_units` INT UNSIGNED NOT NULL DEFAULT 0,
  `overtime_amount` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `upscale_4k`     TINYINT(1)   NOT NULL DEFAULT 0,
  `upscale_amount` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `rush`           TINYINT(1)   NOT NULL DEFAULT 0,
  `total_amount`   DECIMAL(10,2) NOT NULL DEFAULT 0,
  `contact`        VARCHAR(80)  NOT NULL                 COMMENT '联系方式',
  `contact_norm`   VARCHAR(80)  NOT NULL,
  `pay_ref`        VARCHAR(120) NOT NULL DEFAULT ''      COMMENT '付款备注/单号，供对账',
  `pay_no`         VARCHAR(64)  NULL                      COMMENT '客户填写的转账单号（微信/支付宝交易号），全局唯一防复用',
  `pay_shot`       VARCHAR(255) NOT NULL DEFAULT ''       COMMENT '付款截图 URL（/uploads/ 下）',
  `ocr_ok`         TINYINT(1)   NOT NULL DEFAULT 0        COMMENT '自动核验（OCR）是否通过',
  `ocr_note`       VARCHAR(255) NOT NULL DEFAULT ''       COMMENT '自动核验摘要（识别到的单号/金额等）',
  `music_type`     VARCHAR(16)  NOT NULL DEFAULT 'self',
  `material_state` VARCHAR(16)  NOT NULL DEFAULT 'ready',
  `ref_link`       VARCHAR(512) NOT NULL DEFAULT '',
  `requirement`    TEXT         NULL,
  `order_no`       VARCHAR(32)  NOT NULL DEFAULT ''      COMMENT '核对通过后生成的正式订单号',
  `review_note`    VARCHAR(255) NOT NULL DEFAULT ''      COMMENT '核对备注',
  `reviewed_by`    VARCHAR(64)  NOT NULL DEFAULT '',
  `reviewed_at`    DATETIME     NULL,
  `source`         VARCHAR(16)  NOT NULL DEFAULT 'web',
  `client_ip`      VARCHAR(64)  NOT NULL DEFAULT '',
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_claim_no` (`claim_no`),
  UNIQUE KEY `uk_pay_no` (`pay_no`),
  KEY `idx_status_created` (`status`, `created_at`),
  KEY `idx_contact_norm` (`contact_norm`),
  KEY `idx_order_no` (`order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='待核对付款（转账单号+截图自动核验）';

-- ------------------------------------------------------------
-- 存单 / 余额（1.md 未明确要求，预留结构，先不开放充值入口）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `credit_accounts` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contact_norm` VARCHAR(80) NOT NULL,
  `contact`      VARCHAR(80) NOT NULL,
  `balance`      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '可用余额',
  `total_topup`  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '累计充值',
  `total_bonus`  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '累计赠送',
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_contact_norm` (`contact_norm`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='存单账户';

CREATE TABLE IF NOT EXISTS `credit_transactions` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contact_norm` VARCHAR(80) NOT NULL,
  `type`         ENUM('topup','bonus','consume','refund','adjust') NOT NULL,
  `amount`       DECIMAL(12,2) NOT NULL,
  `balance_after` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `order_no`     VARCHAR(32) NOT NULL DEFAULT '',
  `operator`     VARCHAR(64) NOT NULL DEFAULT 'system',
  `note`         VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contact` (`contact_norm`, `created_at`),
  KEY `idx_order_no` (`order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='存单流水';
