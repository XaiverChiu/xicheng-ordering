/**
 * 配置：全部可用环境变量覆盖
 * 复制 .env.example 为 .env 后修改即可（Node 20+ 用 --env-file 加载，见 package.json 说明）
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');          // server/
export const PROJECT_ROOT = path.resolve(ROOT, '..');       // 仓库根目录

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

export const config = {
  env: process.env.NODE_ENV || 'development',
  /** 生产模式判定：生产模式下不响应任何测试后门（如 ocrSkip） */
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: num(process.env.PORT, 4500),
  /** 默认只监听本机；部署到服务器时改为 0.0.0.0 */
  host: process.env.HOST || '127.0.0.1',

  /** 付款截图自动核验：auto=OCR 自动核对（默认）；off=跳过 OCR（仅测试/调试用，单号格式与唯一性仍强制） */
  ocrMode: (process.env.OCR_MODE || 'auto').toLowerCase(),

  /** 付款截图上传 */
  uploads: {
    /** 允许的图片类型 */
    mime: ['image/png', 'image/jpeg', 'image/webp'],
    /** 单张截图大小上限 */
    maxBytes: num(process.env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024),
  },

  /** 数据库驱动：mysql | memory（无 MySQL 时用内存驱动先跑通流程） */
  db: {
    driver: (process.env.DB_DRIVER || 'mysql').toLowerCase(),
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xicheng_ordering',
    connectionLimit: num(process.env.DB_POOL, 10),
    /** mysql 驱动下是否自动建表 */
    autoMigrate: bool(process.env.DB_AUTO_MIGRATE, true),
    /** 内存驱动下是否把数据落盘到 data/memory-db.json（重启不丢单） */
    persistMemory: bool(process.env.MEMORY_PERSIST, true),
  },

  /** 站点对外地址，用于生成查询链接 */
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',

  /** 管理后台初始账号（首次启动时写入数据库） */
  admin: {
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || 'xicheng@2026',
  },

  /** 登录会话有效期（小时） */
  sessionHours: num(process.env.SESSION_HOURS, 12),

  /** 下单频率限制：窗口内最多几单 */
  rateLimit: {
    orderWindowMs: num(process.env.RL_ORDER_WINDOW_MS, 60_000),
    orderMax: num(process.env.RL_ORDER_MAX, 5),
    loginWindowMs: num(process.env.RL_LOGIN_WINDOW_MS, 300_000),
    loginMax: num(process.env.RL_LOGIN_MAX, 10),
  },

  /** 是否允许通过管理后台删除订单 */
  allowDeleteOrder: bool(process.env.ALLOW_DELETE_ORDER, true),
};

export default config;
