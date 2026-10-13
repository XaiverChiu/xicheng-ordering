/**
 * XiCheng 下单平台 · 后端入口
 * - 提供 JSON API
 * - 同源托管前端页面（design/ 目录），并注入 API 桥接脚本
 */
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import config, { PROJECT_ROOT, ROOT } from './config.js';
import { initDb, closeDb, db } from './db/index.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import { ensureDefaultAdmin } from './services/orderService.js';
import { HttpError, startRateLimitGC } from './lib/util.js';

const log = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

const app = Fastify({
  logger: config.env === 'production'
    ? { level: 'info' }
    : { level: 'warn', transport: undefined },
  bodyLimit: 1024 * 256,          // 256KB 足够，防止大包攻击（multipart 上传不受此限制，见下方 limits）
  trustProxy: true,
  disableRequestLogging: config.env === 'production',
});

/* 付款截图上传：单文件、≤5MB、字段数限制，避免大包攻击 */
await app.register(multipart, {
  limits: {
    fileSize: config.uploads.maxBytes,
    files: 1,
    fields: 40,
    parts: 45,
  },
});

/* ============================================================
   统一返回格式：{ ok, data, message } / { ok:false, error }
   ============================================================ */
app.addHook('onSend', async (req, reply, payload) => {
  if (reply.statusCode === 204) return payload;
  const ct = String(reply.getHeader('content-type') || '');
  if (!ct.includes('application/json')) {
    // 非 JSON（静态资源、CSV、HTML）原样返回
    return payload;
  }
  if (typeof payload !== 'string') return payload;
  let body;
  try {
    body = JSON.parse(payload);
  } catch {
    return payload;
  }
  if (body && typeof body === 'object' && ('ok' in body)) return payload;   // 已是标准格式
  if (body && typeof body === 'object' && body.error) return payload;       // 错误格式
  const wrapped = { ok: true, data: body && 'data' in body ? body.data : body };
  if (body && body.message) wrapped.message = body.message;
  return JSON.stringify(wrapped);
});

/* ============================================================
   跨域（开发期前端可能跑在 4180 等其它端口）
   ============================================================ */
app.addHook('onRequest', async (req, reply) => {
  const origin = req.headers.origin;
  if (origin) {
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'Origin');
    reply.header('access-control-allow-credentials', 'true');
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type,authorization');
    reply.header('access-control-max-age', '600');
  }
  if (req.method === 'OPTIONS') {
    reply.code(204).send('');
  }
});

/* ============================================================
   统一错误处理
   ============================================================ */
app.setErrorHandler((err, req, reply) => {
  // 上传超限（@fastify/multipart 抛出的特殊错误）转成友好提示
  if (err && (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.code === 'FST_FILES_LIMIT')) {
    return reply.code(400).send({
      ok: false,
      error: { code: 'FILE_TOO_LARGE', message: '付款截图大小不能超过 5MB' },
    });
  }
  const status = err instanceof HttpError ? err.statusCode : (err.statusCode && err.statusCode >= 400 ? err.statusCode : 500);
  const code = err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  if (status >= 500) {
    req.log?.error?.(err);
    console.error('[error]', req.method, req.url, '-', err.message, '\n', err.stack);
  }
  reply.code(status).send({
    ok: false,
    error: {
      code,
      message: status >= 500 ? '服务器内部错误，请稍后重试' : err.message,
    },
  });
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) {
    return reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } });
  }
  return reply.code(404).type('text/html; charset=utf-8').send('<h1>404</h1><p>页面不存在，<a href="/">返回首页</a></p>');
});

/* ============================================================
   静态资源 + 前端页面（同源托管，免跨域）
   ============================================================ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.csv': 'text/csv; charset=utf-8',
};

/** 前端可能出现在这些位置（design/ 为已定稿的设计稿，public/ 优先） */
const STATIC_DIRS = [
  path.join(ROOT, 'public'),
  path.join(PROJECT_ROOT, 'design'),
];

/** 付款截图存证目录：URL /uploads/xxx → server/uploads/xxx（直接映射，不走根目录拼接） */
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const WEB_DIST_DIR = path.join(PROJECT_ROOT, 'web', 'dist');

function resolveStatic(urlPath) {
  const raw = decodeURIComponent(urlPath.split('?')[0]);
  const isNew = raw === '/new' || raw.startsWith('/new/');
  const rel = raw.replace(/^\/+/, '') || 'index.html';
  if (isNew) {
    const newRel = rel === 'new' ? 'index.html' : rel.slice('new/'.length);
    const file = path.join(WEB_DIST_DIR, newRel || 'index.html');
    if (!file.startsWith(WEB_DIST_DIR)) return null;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    return null;
  }
  if (rel.startsWith('uploads/')) {
    const file = path.join(UPLOADS_DIR, rel.slice('uploads/'.length));
    if (!file.startsWith(UPLOADS_DIR)) return null;            // 目录穿越防护
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    return null;
  }
  for (const dir of STATIC_DIRS) {
    const file = path.join(dir, rel);
    if (!file.startsWith(dir)) continue;                 // 目录穿越防护
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

app.get('/', async (req, reply) => serveStatic('/index.html', req, reply));
app.get('/new', async (req, reply) => serveStatic('/new/', req, reply));
app.get('/new/*', async (req, reply) => serveStatic(req.url, req, reply));
app.get('/admin', async (req, reply) => {
  const file = path.join(ROOT, 'public', 'admin.html');
  if (!fs.existsSync(file)) return reply.callNotFound();
  reply
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store');
  return fs.readFileSync(file);
});
app.get('/*', async (req, reply) => {
  if (req.url.startsWith('/api/')) return;               // 交给 API 路由
  return serveStatic(req.url, req, reply);
});

async function serveStatic(urlPath, req, reply) {
  const file = resolveStatic(urlPath);
  if (!file) return reply.callNotFound();
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  let body = fs.readFileSync(file);

  // HTML 注入 API 桥接脚本：把前端的本地存储调用换成真实接口
  // 带文件时间戳版本号，改桥接后浏览器缓存自动失效（否则 5 分钟缓存会吃到旧版）
  if (ext === '.html' && !file.startsWith(WEB_DIST_DIR)) {
    const bridge = path.join(ROOT, 'public', 'api-bridge.js');
    let html = body.toString('utf8');
    if (fs.existsSync(bridge)) {
      const v = Math.floor(fs.statSync(bridge).mtimeMs);
      html = html.includes('</body>')
        ? html.replace('</body>', `  <script src="/api-bridge.js?v=${v}"></script>\n</body>`)
        : html + `\n<script src="/api-bridge.js?v=${v}"></script>`;
    }
    body = Buffer.from(html, 'utf8');
  }

  reply
    .header('content-type', type)
    .header('cache-control', ext === '.html' ? 'no-store' : 'public, max-age=300')
    .header('x-content-type-options', 'nosniff');
  return body;
}

/* ============================================================
   启动
   ============================================================ */
async function start() {
  const driver = await initDb({ log, allowFallback: true });
  log.info(`[db] 驱动：${driver.kind}`);

  const created = await ensureDefaultAdmin();
  if (created) {
    log.info(`[admin] 已创建默认管理员：${config.admin.username} / ${config.admin.password}（请尽快修改密码）`);
  }

  await app.register(publicRoutes);
  await app.register(adminRoutes);

  await app.listen({ port: config.port, host: config.host });
  log.info(`[server] 已启动：http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`);
  log.info(`[server] 前端页面：http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}/`);
  log.info(`[server] 管理后台：http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}/admin`);

  const gc = startRateLimitGC();

  const shutdown = async (sig) => {
    log.info(`[server] 收到 ${sig}，正在关闭…`);
    clearInterval(gc);
    try { await app.close(); } catch {}
    try { await closeDb(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((e) => {
  console.error('[server] 启动失败：', e);
  process.exit(1);
});
