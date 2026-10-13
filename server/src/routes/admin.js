/**
 * 管理后台接口：登录 / 订单管理 / 状态流转 / 统计 / 导出
 */
import config from '../config.js';
import { requireAdmin } from '../middleware/auth.js';
import { login, logout, listOrders, getOrderByNo, updateOrderStatus, updateOrderInfo, deleteOrder, orderStats, toPublicOrder,
  changeOwnPassword, listAdmins, createAdminAccount, updateAdminAccount, removeAdminAccount, ADMIN_ROLES } from '../services/orderService.js';
import { listClaims, claimStats, confirmClaim, rejectClaim, CLAIM_STATUS, CLAIM_STATUS_LABEL } from '../services/claimService.js';
import { db } from '../db/index.js';
import { forbidden, rateLimit, toCsv, str, bad } from '../lib/util.js';
import { STATUS_LABEL } from '../domain/order.js';

export default async function adminRoutes(app) {
  /* ---------------- 登录 ---------------- */

  app.post('/api/admin/login', async (req) => {
    const ip = req.ip || '';
    const rl = rateLimit(`login:${ip}`, {
      windowMs: config.rateLimit.loginWindowMs,
      max: config.rateLimit.loginMax,
    });
    if (!rl.ok) throw bad('登录尝试过于频繁，请稍后再试', 'RATE_LIMITED');
    const { username, password } = req.body || {};
    return { data: await login(username, password) };
  });

  app.post('/api/admin/logout', async (req) => {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return { data: await logout(m ? m[1].trim() : '') };
  });

  app.get('/api/admin/me', { preHandler: requireAdmin() }, async (req) => ({ data: { admin: req.admin } }));

  /* ---------------- 账号管理 ---------------- */

  /** 修改自己的密码（需原密码），改完踢掉其它会话 */
  app.patch('/api/admin/password', { preHandler: requireAdmin() }, async (req) => {
    const { currentPassword, newPassword } = req.body || {};
    const res = await changeOwnPassword(req.admin.username, { currentPassword, newPassword }, {
      keepSessionToken: req.admin.token,
    });
    return { data: res, message: '密码已修改，其它设备的登录已失效' };
  });

  /** 账号列表（仅超级管理员） */
  app.get('/api/admin/accounts', { preHandler: requireAdmin() }, async (req) => {
    if (req.admin.role !== 'admin') throw forbidden('仅超级管理员可管理账号');
    return { data: { accounts: await listAdmins(), roles: ADMIN_ROLES } };
  });

  /** 新建账号（仅超级管理员） */
  app.post('/api/admin/accounts', { preHandler: requireAdmin() }, async (req) => {
    if (req.admin.role !== 'admin') throw forbidden('仅超级管理员可管理账号');
    const account = await createAdminAccount(req.body || {});
    return { data: { account }, message: '账号已创建' };
  });

  /** 修改账号：显示名 / 角色 / 启用停用 / 重置密码（仅超级管理员） */
  app.patch('/api/admin/accounts/:id', { preHandler: requireAdmin() }, async (req) => {
    if (req.admin.role !== 'admin') throw forbidden('仅超级管理员可管理账号');
    const account = await updateAdminAccount(Number(req.params.id), req.body || {}, {
      operator: req.admin.username,
      operatorId: req.admin.adminId ?? null,
    });
    return { data: { account }, message: '账号已更新' };
  });

  /** 删除账号（仅超级管理员） */
  app.delete('/api/admin/accounts/:id', { preHandler: requireAdmin() }, async (req) => {
    if (req.admin.role !== 'admin') throw forbidden('仅超级管理员可管理账号');
    const res = await removeAdminAccount(Number(req.params.id), { operatorId: req.admin.adminId ?? null });
    return { data: res, message: '账号已删除' };
  });

  /* ---------------- 待核对付款 ---------------- */

  /** 待核对列表（默认只看待核对） */
  app.get('/api/admin/payment-claims', { preHandler: requireAdmin() }, async (req) => {
    const res = await listClaims(req.query || {});
    return { data: { ...res, stats: await claimStats() } };
  });

  /** 核对通过 → 生成正式订单 */
  app.post('/api/admin/payment-claims/:claimNo/confirm', { preHandler: requireAdmin() }, async (req) => {
    const { note, paidAmount } = req.body || {};
    const res = await confirmClaim(req.params.claimNo, {
      operator: req.admin.username,
      note,
      paidAmount,
    });
    return { data: res, message: `已核对并生成订单 ${res.order.orderNo}` };
  });

  /** 驳回：没查到这笔到账 */
  app.post('/api/admin/payment-claims/:claimNo/reject', { preHandler: requireAdmin() }, async (req) => {
    const claim = await rejectClaim(req.params.claimNo, {
      operator: req.admin.username,
      note: (req.body || {}).note,
    });
    return { data: { claim }, message: '已驳回该待核对记录' };
  });

  /* ---------------- 订单 ---------------- */

  app.get('/api/admin/orders', { preHandler: requireAdmin() }, async (req) => {
    const res = await listOrders(req.query || {});
    return { data: res };
  });

  app.get('/api/admin/orders/:orderNo', { preHandler: requireAdmin() }, async (req) => {
    const row = await getOrderByNo(req.params.orderNo);
    const logs = await db().listLogs(row.id);
    return { data: { order: toPublicOrder(row, { logs }) } };
  });

  /** 状态流转：wait→paid→doing→done，任意状态可→canceled */
  app.patch('/api/admin/orders/:orderNo/status', { preHandler: requireAdmin() }, async (req) => {
    const { status, note } = req.body || {};
    const order = await updateOrderStatus(req.params.orderNo, status, {
      operator: req.admin.username,
      note,
    });
    return { data: { order } };
  });

  /** 更新信息：内部备注 / 已付金额 / 剪辑要求 / 加急标记 */
  app.patch('/api/admin/orders/:orderNo', { preHandler: requireAdmin() }, async (req) => {
    const order = await updateOrderInfo(req.params.orderNo, req.body || {}, { operator: req.admin.username });
    return { data: { order } };
  });

  app.delete('/api/admin/orders/:orderNo', { preHandler: requireAdmin() }, async (req) => {
    if (!config.allowDeleteOrder) throw forbidden('当前配置不允许删除订单');
    const res = await deleteOrder(req.params.orderNo, { operator: req.admin.username });
    return { data: res, message: '订单已删除' };
  });

  /* ---------------- 统计 ---------------- */

  app.get('/api/admin/stats', { preHandler: requireAdmin() }, async () => ({ data: await orderStats() }));

  /* ---------------- 导出 CSV ---------------- */

  app.get('/api/admin/orders-export.csv', { preHandler: requireAdmin() }, async (req, reply) => {
    const res = await listOrders({ ...req.query, page: 1, pageSize: 200 });
    const rows = res.rows;
    const csv = toCsv(rows, [
      { title: '订单号', get: (r) => r.orderNo },
      { title: '状态', get: (r) => r.statusLabel },
      { title: '分组', get: (r) => r.gameName },
      { title: '规格', get: (r) => r.pkgName },
      { title: '计价方式', get: (r) => r.pricingMode },
      { title: '数量', get: (r) => `${r.quantity}${r.unit}` },
      { title: '单价', get: (r) => r.unitPrice },
      { title: '规格小计', get: (r) => r.baseAmount },
      { title: '超时长分钟', get: (r) => r.overtimeUnits },
      { title: '超时长加价', get: (r) => r.overtimeAmount },
      { title: '4K超分', get: (r) => (r.upscale4k ? '是' : '否') },
      { title: '超分费', get: (r) => r.upscaleAmount },
      { title: '加急', get: (r) => (r.rush ? '是' : '否') },
      { title: '应付合计', get: (r) => r.totalAmount },
      { title: '已付金额', get: (r) => r.paidAmount },
      { title: '联系方式', get: (r) => r.contact },
      { title: '配乐方式', get: (r) => (r.music === 'self' ? '客户自备' : '剪辑师自选') },
      { title: '素材情况', get: (r) => (r.material === 'ready' ? '已备好' : '稍后提供') },
      { title: '参考链接', get: (r) => r.refLink },
      { title: '剪辑要求', get: (r) => (r.requirement || '').replace(/\r?\n/g, ' ') },
      { title: '内部备注', get: (r) => r.adminNote },
      { title: '下单时间', get: (r) => r.createdAt },
      { title: '付款时间', get: (r) => r.paidAt },
      { title: '承诺交付', get: (r) => r.dueAt },
      { title: '交付时间', get: (r) => r.deliveredAt },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="orders-${stamp}.csv"`);
    return csv;
  });

  /* ---------------- 状态字典 ---------------- */

  app.get('/api/admin/meta', { preHandler: requireAdmin() }, async () => ({
    data: {
      statuses: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
      games: (await import('../domain/catalog.js')).CATALOG.map((g) => ({ key: g.key, name: g.name, consult: g.consult })),
    },
  }));
}
