/**
 * MySQL 驱动：连接池 + 自动建表 + 仓储方法
 * 表结构见 sql/schema.sql（与自动建表语句保持一致）
 */
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import config, { ROOT } from '../config.js';

const ORDER_COLUMNS = [
  'order_no', 'game_key', 'game_name', 'package_id', 'package_name', 'pricing_mode', 'unit',
  'unit_price', 'quantity', 'base_amount', 'overtime_units', 'overtime_amount',
  'upscale_4k', 'upscale_amount', 'rush', 'total_amount', 'paid_amount', 'credit_used',
  'contact', 'contact_norm', 'music_type', 'material_state', 'ref_link', 'requirement',
  'admin_note', 'status', 'source', 'client_ip', 'due_at',
];

const DDL = `
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no VARCHAR(32) NOT NULL,
  game_key VARCHAR(32) NOT NULL,
  game_name VARCHAR(64) NOT NULL,
  package_id VARCHAR(32) NOT NULL,
  package_name VARCHAR(64) NOT NULL,
  pricing_mode VARCHAR(64) NOT NULL,
  unit VARCHAR(8) NOT NULL DEFAULT '分钟',
  unit_price DECIMAL(10,2) NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  base_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  overtime_units INT UNSIGNED NOT NULL DEFAULT 0,
  overtime_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  upscale_4k TINYINT(1) NOT NULL DEFAULT 0,
  upscale_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  rush TINYINT(1) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  credit_used DECIMAL(10,2) NOT NULL DEFAULT 0,
  contact VARCHAR(80) NOT NULL,
  contact_norm VARCHAR(80) NOT NULL,
  music_type VARCHAR(16) NOT NULL DEFAULT 'self',
  material_state VARCHAR(16) NOT NULL DEFAULT 'ready',
  ref_link VARCHAR(512) NOT NULL DEFAULT '',
  requirement TEXT NULL,
  admin_note VARCHAR(512) NOT NULL DEFAULT '',
  status ENUM('wait','paid','doing','done','canceled') NOT NULL DEFAULT 'wait',
  source VARCHAR(16) NOT NULL DEFAULT 'web',
  client_ip VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  delivered_at DATETIME NULL,
  due_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_no (order_no),
  KEY idx_contact_norm (contact_norm),
  KEY idx_status_created (status, created_at),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

const DDL_LOGS = `
CREATE TABLE IF NOT EXISTS order_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  order_no VARCHAR(32) NOT NULL,
  from_status VARCHAR(16) NOT NULL DEFAULT '',
  to_status VARCHAR(16) NOT NULL,
  operator VARCHAR(64) NOT NULL DEFAULT 'system',
  note VARCHAR(512) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order (order_id),
  CONSTRAINT fk_log_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

const DDL_ADMINS = `
CREATE TABLE IF NOT EXISTS admins (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(64) NOT NULL DEFAULT '',
  role ENUM('admin','operator') NOT NULL DEFAULT 'admin',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

const DDL_SESSIONS = `
CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_token (token_hash),
  KEY idx_admin (admin_id),
  CONSTRAINT fk_sess_admin FOREIGN KEY (admin_id) REFERENCES admins (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

const CLAIM_COLUMNS = [
  'claim_no', 'status', 'game_key', 'game_name', 'package_id', 'package_name', 'pricing_mode',
  'unit', 'unit_price', 'quantity', 'base_amount', 'overtime_units', 'overtime_amount',
  'upscale_4k', 'upscale_amount', 'rush', 'total_amount', 'contact', 'contact_norm', 'pay_ref',
  'pay_no', 'pay_shot', 'ocr_ok', 'ocr_note',
  'music_type', 'material_state', 'ref_link', 'requirement', 'order_no', 'review_note',
  'reviewed_by', 'reviewed_at', 'source', 'client_ip',
];

const DDL_CLAIMS = `
CREATE TABLE IF NOT EXISTS payment_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  claim_no VARCHAR(32) NOT NULL,
  status ENUM('pending','confirmed','rejected','expired') NOT NULL DEFAULT 'pending',
  game_key VARCHAR(32) NOT NULL,
  game_name VARCHAR(64) NOT NULL,
  package_id VARCHAR(32) NOT NULL,
  package_name VARCHAR(64) NOT NULL,
  pricing_mode VARCHAR(64) NOT NULL,
  unit VARCHAR(8) NOT NULL DEFAULT '分钟',
  unit_price DECIMAL(10,2) NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  base_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  overtime_units INT UNSIGNED NOT NULL DEFAULT 0,
  overtime_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  upscale_4k TINYINT(1) NOT NULL DEFAULT 0,
  upscale_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  rush TINYINT(1) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  contact VARCHAR(80) NOT NULL,
  contact_norm VARCHAR(80) NOT NULL,
  pay_ref VARCHAR(120) NOT NULL DEFAULT '',
  pay_no VARCHAR(64) NULL COMMENT '客户填写的转账单号（微信/支付宝交易号），全局唯一防复用',
  pay_shot VARCHAR(255) NOT NULL DEFAULT '' COMMENT '付款截图 URL（/uploads/ 下）',
  ocr_ok TINYINT(1) NOT NULL DEFAULT 0 COMMENT '自动核验（OCR）是否通过',
  ocr_note VARCHAR(255) NOT NULL DEFAULT '' COMMENT '自动核验摘要（识别到的单号/金额等）',
  music_type VARCHAR(16) NOT NULL DEFAULT 'self',
  material_state VARCHAR(16) NOT NULL DEFAULT 'ready',
  ref_link VARCHAR(512) NOT NULL DEFAULT '',
  requirement TEXT NULL,
  order_no VARCHAR(32) NOT NULL DEFAULT '',
  review_note VARCHAR(255) NOT NULL DEFAULT '',
  reviewed_by VARCHAR(64) NOT NULL DEFAULT '',
  reviewed_at DATETIME NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'web',
  client_ip VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_claim_no (claim_no),
  UNIQUE KEY uk_pay_no (pay_no),
  KEY idx_status_created (status, created_at),
  KEY idx_contact_norm (contact_norm),
  KEY idx_order_no (order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

/** 老库升级：payment_claims 补自动核验相关列（已存在则跳过，兼容重复启动/并发启动） */
async function migrateClaimsColumns(pool, log) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_claims'`
  );
  const have = new Set((cols || []).map((c) => c.COLUMN_NAME));
  const alters = [];
  if (!have.has('pay_no')) alters.push('ADD COLUMN pay_no VARCHAR(64) NULL AFTER pay_ref');
  if (!have.has('pay_shot')) alters.push('ADD COLUMN pay_shot VARCHAR(255) NOT NULL DEFAULT \'\' AFTER pay_no');
  if (!have.has('ocr_ok')) alters.push('ADD COLUMN ocr_ok TINYINT(1) NOT NULL DEFAULT 0 AFTER pay_shot');
  if (!have.has('ocr_note')) alters.push('ADD COLUMN ocr_note VARCHAR(255) NOT NULL DEFAULT \'\' AFTER ocr_ok');
  for (const alter of alters) {
    try {
      await pool.query(`ALTER TABLE payment_claims ${alter}`);
    } catch (e) {
      if (!/duplicate|already exists/i.test(String(e.message))) throw e;
    }
  }
  if (alters.length) log.info?.('[db] payment_claims 已升级（新增自动核验列）');
}

export async function createMysqlDriver({ log = console } = {}) {
  // 第 1 步：先不指定库连接，确保库存在（否则首次部署必然失败）
  const boot = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: false,
  });
  await boot.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
  );
  await boot.end();

  const pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: config.db.connectionLimit,
    queueLimit: 0,
    charset: 'utf8mb4_0900_ai_ci',
    timezone: 'local',
    decimalNumbers: true,
  });

  // 第 2 步：连通性验证
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();

  // 第 3 步：自动建表
  if (config.db.autoMigrate) {
    for (const ddl of [DDL, DDL_LOGS, DDL_ADMINS, DDL_SESSIONS, DDL_CLAIMS]) await pool.query(ddl);
    await migrateClaimsColumns(pool, log);
    log.info?.('[db] 表结构已就绪');
  }

  const q = async (sql, params = []) => {
    const [rows] = await pool.query(sql, params);
    return rows;
  };

  return {
    kind: 'mysql',
    pool,

    async close() {
      await pool.end();
    },

    /* ---------------- 订单 ---------------- */

    async createOrder(o) {
      const cols = ORDER_COLUMNS;
      const placeholders = cols.map(() => '?').join(', ');
      const values = cols.map((c) => o[c] ?? null);
      const r = await q(`INSERT INTO orders (${cols.join(', ')}) VALUES (${placeholders})`, values);
      return { id: r.insertId, orderNo: o.order_no };
    },

    async findOrderByNo(orderNo) {
      const rows = await q('SELECT * FROM orders WHERE order_no = ? LIMIT 1', [orderNo]);
      return rows[0] || null;
    },

    async findOrderById(id) {
      const rows = await q('SELECT * FROM orders WHERE id = ? LIMIT 1', [id]);
      return rows[0] || null;
    },

    /** 按联系方式（归一化）查最近订单 */
    async findOrdersByContact(contactNorm, limit = 20) {
      return q(
        'SELECT * FROM orders WHERE contact_norm = ? ORDER BY created_at DESC LIMIT ?',
        [contactNorm, Number(limit)]
      );
    },

    async listOrders({ status, keyword, gameKey, from, to, page = 1, pageSize = 20 } = {}) {
      const where = [];
      const params = [];
      if (status) { where.push('status = ?'); params.push(status); }
      if (gameKey) { where.push('game_key = ?'); params.push(gameKey); }
      if (from) { where.push('created_at >= ?'); params.push(from); }
      if (to) { where.push('created_at <= ?'); params.push(to); }
      if (keyword) {
        where.push('(order_no LIKE ? OR contact LIKE ? OR contact_norm LIKE ?)');
        const like = `%${keyword}%`;
        params.push(like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const size = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
      const rows = await q(
        `SELECT * FROM orders ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, size, offset]
      );
      const [{ total }] = await q(`SELECT COUNT(*) AS total FROM orders ${whereSql}`, params);
      return { rows, total: Number(total), page: Number(page) || 1, pageSize: size };
    },

    async updateOrder(id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return 0;
      const sets = keys.map((k) => `${k} = ?`).join(', ');
      const r = await q(`UPDATE orders SET ${sets} WHERE id = ?`, [...keys.map((k) => patch[k]), id]);
      return r.affectedRows;
    },

    async deleteOrder(id) {
      const r = await q('DELETE FROM orders WHERE id = ?', [id]);
      return r.affectedRows;
    },

    async countOrders({ status } = {}) {
      if (status) {
        const [row] = await q('SELECT COUNT(*) AS n FROM orders WHERE status = ?', [status]);
        return Number(row.n);
      }
      const [row] = await q('SELECT COUNT(*) AS n FROM orders');
      return Number(row.n);
    },

    /** 总览统计：按状态计数 + 今日单量 + 累计金额 */
    async stats() {
      const byStatus = await q('SELECT status, COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS amount FROM orders GROUP BY status');
      const [today] = await q(
        "SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS amount FROM orders WHERE DATE(created_at) = CURDATE()"
      );
      const [all] = await q('SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS amount FROM orders');
      const [paid] = await q("SELECT COALESCE(SUM(paid_amount),0) AS amount FROM orders WHERE status <> 'canceled'");
      const overdue = await q(
        "SELECT COUNT(*) AS n FROM orders WHERE due_at IS NOT NULL AND due_at < NOW() AND status IN ('paid','doing')"
      );
      return {
        byStatus,
        today: { count: Number(today.n), amount: Number(today.amount) },
        total: { count: Number(all.n), amount: Number(all.amount) },
        paidAmount: Number(paid.amount),
        overdue: Number(overdue[0].n),
      };
    },

    /* ---------------- 日志 ---------------- */

    async addLog({ orderId, orderNo, fromStatus = '', toStatus, operator = 'system', note = '' }) {
      await q(
        'INSERT INTO order_logs (order_id, order_no, from_status, to_status, operator, note) VALUES (?,?,?,?,?,?)',
        [orderId, orderNo, fromStatus, toStatus, operator, note]
      );
    },

    async listLogs(orderId) {
      return q('SELECT * FROM order_logs WHERE order_id = ? ORDER BY id ASC', [orderId]);
    },

    /* ---------------- 待核对付款 ---------------- */

    async createClaim(c) {
      const cols = CLAIM_COLUMNS;
      const r = await q(
        `INSERT INTO payment_claims (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((k) => c[k] ?? null)
      );
      return { id: r.insertId, claimNo: c.claim_no };
    },

    async findClaimByNo(claimNo) {
      const rows = await q('SELECT * FROM payment_claims WHERE claim_no = ? LIMIT 1', [claimNo]);
      return rows[0] || null;
    },

    async findClaimById(id) {
      const rows = await q('SELECT * FROM payment_claims WHERE id = ? LIMIT 1', [id]);
      return rows[0] || null;
    },

    /** 按转账单号查（唯一性校验：一张截图/一笔转账只能用于一单） */
    async findClaimByPayNo(payNo) {
      const rows = await q('SELECT * FROM payment_claims WHERE pay_no = ? LIMIT 1', [payNo]);
      return rows[0] || null;
    },

    async findClaimsByContact(contactNorm, limit = 20) {
      return q(
        'SELECT * FROM payment_claims WHERE contact_norm = ? ORDER BY created_at DESC LIMIT ?',
        [contactNorm, Number(limit)]
      );
    },

    async listClaims({ status, keyword, page = 1, pageSize = 20 } = {}) {
      const where = [];
      const params = [];
      if (status) { where.push('status = ?'); params.push(status); }
      if (keyword) {
        where.push('(claim_no LIKE ? OR contact LIKE ? OR contact_norm LIKE ? OR pay_ref LIKE ? OR pay_no LIKE ?)');
        const like = `%${keyword}%`;
        params.push(like, like, like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const size = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
      const rows = await q(
        `SELECT * FROM payment_claims ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, size, offset]
      );
      const [{ total }] = await q(`SELECT COUNT(*) AS total FROM payment_claims ${whereSql}`, params);
      return { rows, total: Number(total), page: Number(page) || 1, pageSize: size };
    },

    async updateClaim(id, patch) {
      const keys = Object.keys(patch || {});
      if (!keys.length) return 0;
      const r = await q(
        `UPDATE payment_claims SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...keys.map((k) => patch[k]), id]
      );
      return r.affectedRows;
    },

    async countClaimsByStatus() {
      return q('SELECT status, COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS amount FROM payment_claims GROUP BY status');
    },

    /* ---------------- 管理员 / 会话 ---------------- */

    async findAdminByUsername(username) {
      const rows = await q('SELECT * FROM admins WHERE username = ? LIMIT 1', [username]);
      return rows[0] || null;
    },

    async findAdminById(id) {
      const rows = await q('SELECT * FROM admins WHERE id = ? LIMIT 1', [id]);
      return rows[0] || null;
    },

    async listAdmins() {
      return q('SELECT * FROM admins ORDER BY id ASC');
    },

    async updateAdmin(id, patch) {
      const keys = Object.keys(patch || {});
      if (!keys.length) return 0;
      const sets = keys.map((k) => `${k} = ?`).join(', ');
      const r = await q(`UPDATE admins SET ${sets} WHERE id = ?`, [...keys.map((k) => patch[k]), id]);
      return r.affectedRows;
    },

    async deleteAdmin(id) {
      const r = await q('DELETE FROM admins WHERE id = ?', [id]);
      return r.affectedRows;
    },

    /** 注销某账号的全部会话（可保留一个 token_hash，用于改密后保留当前会话） */
    async deleteSessionsByAdmin(adminId, exceptTokenHash = '') {
      const r = exceptTokenHash
        ? await q('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash <> ?', [adminId, exceptTokenHash])
        : await q('DELETE FROM admin_sessions WHERE admin_id = ?', [adminId]);
      return r.affectedRows;
    },

    async createAdmin({ username, passwordHash, displayName = '', role = 'admin' }) {
      const r = await q(
        'INSERT INTO admins (username, password_hash, display_name, role) VALUES (?,?,?,?)',
        [username, passwordHash, displayName, role]
      );
      return r.insertId;
    },

    async countAdmins() {
      const [row] = await q('SELECT COUNT(*) AS n FROM admins');
      return Number(row.n);
    },

    async touchAdminLogin(id) {
      await q('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [id]);
    },

    async createSession({ adminId, tokenHash, expiresAt }) {
      await q('INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?,?,?)', [
        adminId, tokenHash, expiresAt,
      ]);
    },

    async findSession(tokenHash) {
      const rows = await q(
        `SELECT s.*, a.username, a.display_name, a.role, a.enabled
           FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
          WHERE s.token_hash = ? LIMIT 1`,
        [tokenHash]
      );
      return rows[0] || null;
    },

    async deleteSession(tokenHash) {
      await q('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]);
    },

    async purgeExpiredSessions() {
      const r = await q('DELETE FROM admin_sessions WHERE expires_at < NOW()');
      return r.affectedRows;
    },

    /** 执行 sql/ 目录下的原始脚本（部署时手动跑也行） */
    async runSchemaFile(file = 'schema.sql') {
      const sql = fs.readFileSync(path.join(ROOT, 'sql', file), 'utf8');
      const statements = sql
        .split(/;\s*[\r\n]/)
        .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
        .filter((s) => s && !/^USE\s/i.test(s) && !/^CREATE DATABASE/i.test(s));
      for (const s of statements) await pool.query(s);
    },
  };
}
