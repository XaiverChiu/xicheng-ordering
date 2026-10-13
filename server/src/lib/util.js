/**
 * 通用校验与小工具
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

/** 业务错误：带 HTTP 状态码，交给统一错误处理器 */
export class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || 'BAD_REQUEST';
  }
}

export const bad = (msg, code) => new HttpError(400, msg, code);
export const unauthorized = (msg = '未登录或登录已过期') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = '没有权限') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (msg = '资源不存在') => new HttpError(404, msg, 'NOT_FOUND');

export function str(v, { field, required = false, max = 500, min = 0, trim = true } = {}) {
  let s = v === undefined || v === null ? '' : String(v);
  if (trim) s = s.trim();
  if (!s && required) throw bad(`${field || '参数'}不能为空`, 'REQUIRED');
  if (s.length > max) throw bad(`${field || '参数'}过长（最多 ${max} 字）`, 'TOO_LONG');
  if (s.length && s.length < min) throw bad(`${field || '参数'}过短（至少 ${min} 字）`, 'TOO_SHORT');
  return s;
}

export function int(v, { field, min = 0, max = 1e9, def = 0 } = {}) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${field || '参数'}必须是整数`, 'INVALID_INT');
  if (n < min || n > max) throw bad(`${field || '参数'}需在 ${min} ~ ${max} 之间`, 'OUT_OF_RANGE');
  return n;
}

/** 联系方式：QQ 号 / 微信号 / 手机号都接受 */
export function contact(v) {
  const s = str(v, { field: '联系方式', required: true, max: 80 });
  // 必须有至少 3 位连续数字或字母，避免「啊啊啊」这类无效输入
  if (!/[0-9A-Za-z]{3,}/.test(s)) {
    throw bad('联系方式格式不正确，请填写 QQ 号 / 微信号 / 手机号', 'INVALID_CONTACT');
  }
  if (!/^[0-9A-Za-z\u4e00-\u9fa5@._+\-\s]{3,80}$/.test(s)) {
    throw bad('联系方式格式不正确，请填写 QQ 号 / 微信号 / 手机号', 'INVALID_CONTACT');
  }
  return s;
}

export function oneOf(v, list, field) {
  if (!list.includes(v)) throw bad(`${field || '参数'}取值不合法`, 'INVALID_ENUM');
  return v;
}

export function boolish(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  return /^(1|true|yes|on)$/i.test(String(v));
}

/* ---------------- 口令散列（scrypt，无外部依赖） ---------------- */

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const calc = scryptSync(String(password), salt, 64);
    const want = Buffer.from(hash, 'hex');
    return calc.length === want.length && timingSafeEqual(calc, want);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

export function sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

/* ---------------- 时间 ---------------- */

export function nowIso() {
  return new Date().toISOString();
}

export function toMysqlDate(d = new Date()) {
  return new Date(d).toISOString().slice(0, 19).replace('T', ' ');
}

export function addHours(h) {
  return new Date(Date.now() + h * 3600_000);
}

/* ---------------- 极简内存限流 ---------------- */

const buckets = new Map();

export function rateLimit(key, { windowMs, max }) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return { ok: true, remaining: max - 1 };
  }
  b.count += 1;
  if (b.count > max) {
    return { ok: false, remaining: 0, retryAfterMs: windowMs - (now - b.start) };
  }
  return { ok: true, remaining: max - b.count };
}

/** 定期清理过期桶，避免内存无界增长 */
export function startRateLimitGC(intervalMs = 300_000) {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (now - v.start > 3_600_000) buckets.delete(k);
  }, intervalMs);
  t.unref?.();
  return t;
}

/* ---------------- CSV ---------------- */

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.title)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(',')).join('\r\n');
  // 加 BOM，Excel 打开中文不乱码
  return '\uFEFF' + head + '\r\n' + body + '\r\n';
}
