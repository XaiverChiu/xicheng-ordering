/**
 * 订单服务：下单、查询、状态流转
 * 所有对外返回都经过 toPublicOrder() 脱敏
 */
import { db } from '../db/index.js';
import { addHours, bad, contact, forbidden, int, notFound, sha256, str, toMysqlDate, boolish, oneOf, randomToken, hashPassword, verifyPassword } from '../lib/util.js';
import { getGame, getPackage, calculatePrice, CONTACT } from '../domain/catalog.js';
import { makeOrderNo, canTransit, statusLabel, STATUS_STEP, STATUS_LABEL } from '../domain/order.js';

/** 联系方式归一化：去掉空格、横线、大小写差异，便于模糊查询 */
export function normalizeContact(v) {
  return String(v || '').toLowerCase().replace(/[\s\-+_]/g, '');
}

/** 联系方式打码，用于公开查询结果展示 */
export function maskContact(v) {
  const s = String(v || '');
  if (s.length <= 4) return s[0] + '***';
  return s.slice(0, 3) + '***' + s.slice(-2);
}

/* ============================================================
   下单
   ============================================================ */

export async function createOrder(payload, ctx = {}) {
  const gameKey = str(payload.game, { field: '游戏分组', required: true, max: 32 });
  const pkgId = str(payload.pkg, { field: '规格', required: true, max: 32 });
  const contactRaw = contact(payload.contact);
  const duration = int(payload.duration, { field: '成品时长/回合数', min: 1, max: 600, def: 1 });
  const up4k = boolish(payload.up4k);
  const rush = boolish(payload.rush);
  const musicType = oneOf(str(payload.music, { field: '配乐方式' }) || 'self', ['self', 'pro'], '配乐方式');
  const materialState = oneOf(
    str(payload.material, { field: '素材情况' }) || 'ready',
    ['ready', 'later'],
    '素材情况'
  );
  const refLink = str(payload.link, { field: '配乐/参考链接', max: 500 });
  const requirement = str(payload.note, { field: '剪辑要求', max: 2000 });

  // 计价（会校验分组与规格是否存在、是否可自助下单）
  const price = calculatePrice({ gameKey, pkgId, duration, up4k, rush });
  const game = getGame(gameKey);
  const pkg = getPackage(gameKey, pkgId);

  const contactNorm = normalizeContact(contactRaw);
  const orderNo = await allocateOrderNo();

  const record = {
    order_no: orderNo,
    game_key: game.key,
    game_name: game.name,
    package_id: pkg.id,
    package_name: pkg.name,
    pricing_mode: pkg.mode,
    unit: pkg.unit,
    unit_price: pkg.price,
    quantity: price.qty,
    base_amount: price.base,
    overtime_units: price.overUnit,
    overtime_amount: price.over,
    upscale_4k: up4k ? 1 : 0,
    upscale_amount: price.up4k,
    rush: rush ? 1 : 0,
    total_amount: price.total,
    paid_amount: 0,
    credit_used: 0,
    contact: contactRaw,
    contact_norm: contactNorm,
    music_type: musicType,
    material_state: materialState,
    ref_link: refLink,
    requirement: requirement,
    admin_note: '',
    status: 'wait',
    source: str(ctx.source, { max: 16 }) || 'web',
    client_ip: str(ctx.ip, { max: 64 }),
    due_at: null,
  };

  const { id, orderNo: no } = await db().createOrder(record);
  await db().addLog({
    orderId: id,
    orderNo: no,
    fromStatus: '',
    toStatus: 'wait',
    operator: 'customer',
    note: '客户自助提交订单，等待确认付款',
  });

  return toPublicOrder({ ...record, id, created_at: toMysqlDate(new Date()) });
}

/** 订单号重复时重试（唯一索引兜底） */
async function allocateOrderNo(attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const no = makeOrderNo('XC');
    const exist = await db().findOrderByNo(no);
    if (!exist) return no;
  }
  // 极端情况下追加时间戳后缀，保证唯一
  return makeOrderNo('XC') + String(Date.now() % 100);
}

/* ============================================================
   查询
   ============================================================ */

export async function getOrderByNo(orderNo) {
  const no = str(orderNo, { field: '订单号', required: true, max: 32 });
  const row = await db().findOrderByNo(no);
  if (!row) throw notFound('没有找到该订单，请检查订单号是否正确');
  return row;
}

/**
 * 客户查询：支持订单号精确查询，或用联系方式查最近订单
 * 为防遍历，联系方式查询返回脱敏后的联系方式列表
 */
export async function trackOrders(query) {
  const q = str(query, { field: '查询内容', required: true, max: 80 });
  const asNo = await db().findOrderByNo(q.toUpperCase());
  if (asNo) {
    const logs = await db().listLogs(asNo.id);
    return { mode: 'order', orders: [toPublicOrder(asNo, { mask: true, logs })] };
  }
  const norm = normalizeContact(q);
  if (norm.length < 3) throw bad('请填写完整的订单号或联系方式', 'INVALID_QUERY');
  const rows = await db().findOrdersByContact(norm, 20);
  if (!rows.length) throw notFound('没有查到该联系方式下的订单记录');
  return { mode: 'contact', orders: rows.map((r) => toPublicOrder(r, { mask: true })) };
}

/* ============================================================
   状态流转（管理后台）
   ============================================================ */

export async function updateOrderStatus(orderNo, toStatus, { operator = 'admin', note = '' } = {}) {
  const row = await getOrderByNo(orderNo);
  const target = oneOf(String(toStatus), Object.keys(STATUS_LABEL), '目标状态');
  if (!canTransit(row.status, target)) {
    throw bad(`不允许从「${statusLabel(row.status)}」直接变更为「${statusLabel(target)}」`, 'INVALID_TRANSITION');
  }
  const patch = { status: target };
  if (target === 'paid' && !row.paid_at) {
    const paidAt = new Date();
    patch.paid_at = toMysqlDate(paidAt);
    patch.paid_amount = row.total_amount;
    const game = getGame(row.game_key);
    if (game?.ttlMinutes) patch.due_at = toMysqlDate(addHours(game.ttlMinutes / 60));
  }
  if (target === 'done') patch.delivered_at = toMysqlDate(new Date());
  if (target === 'canceled') patch.due_at = row.due_at; // 保留历史承诺时间

  await db().updateOrder(row.id, patch);
  await db().addLog({
    orderId: row.id,
    orderNo: row.order_no,
    fromStatus: row.status,
    toStatus: target,
    operator,
    note: str(note, { max: 500 }),
  });
  return toPublicOrder({ ...row, ...patch });
}

export async function updateOrderInfo(orderNo, patch, { operator = 'admin' } = {}) {
  const row = await getOrderByNo(orderNo);
  const allow = {};
  if (patch.adminNote !== undefined) allow.admin_note = str(patch.adminNote, { max: 500 });
  if (patch.requirement !== undefined) allow.requirement = str(patch.requirement, { max: 2000 });
  if (patch.refLink !== undefined) allow.ref_link = str(patch.refLink, { max: 500 });
  if (patch.paidAmount !== undefined) {
    const n = Number(patch.paidAmount);
    if (!Number.isFinite(n) || n < 0) throw bad('已付金额不合法', 'INVALID_AMOUNT');
    allow.paid_amount = Math.round(n * 100) / 100;
  }
  if (patch.rush !== undefined) allow.rush = boolish(patch.rush) ? 1 : 0;
  if (!Object.keys(allow).length) throw bad('没有可更新的字段', 'NOTHING_TO_UPDATE');

  await db().updateOrder(row.id, allow);
  await db().addLog({
    orderId: row.id,
    orderNo: row.order_no,
    fromStatus: row.status,
    toStatus: row.status,
    operator,
    note: '更新订单信息：' + Object.keys(allow).join('、'),
  });
  return toPublicOrder({ ...row, ...allow });
}

export async function deleteOrder(orderNo, { operator = 'admin' } = {}) {
  const row = await getOrderByNo(orderNo);
  await db().deleteOrder(row.id);
  return { orderNo: row.order_no, deleted: true };
}

export async function listOrders(query = {}) {
  const status = query.status ? oneOf(String(query.status), Object.keys(STATUS_LABEL), '状态') : '';
  const res = await db().listOrders({
    status: status || undefined,
    keyword: str(query.keyword, { max: 80 }) || undefined,
    gameKey: str(query.game, { max: 32 }) || undefined,
    from: str(query.from, { max: 32 }) || undefined,
    to: str(query.to, { max: 32 }) || undefined,
    page: int(query.page, { min: 1, max: 100000, def: 1 }),
    pageSize: int(query.pageSize, { min: 1, max: 200, def: 20 }),
  });
  return { ...res, rows: res.rows.map((r) => toPublicOrder(r)) };
}

export async function orderStats() {
  const s = await db().stats();
  const byStatus = {};
  for (const key of Object.keys(STATUS_LABEL)) {
    const hit = s.byStatus.find((x) => x.status === key);
    byStatus[key] = { status: key, label: STATUS_LABEL[key], count: Number(hit?.n || 0), amount: Number(hit?.amount || 0) };
  }
  return { byStatus, today: s.today, total: s.total, paidAmount: s.paidAmount, overdue: s.overdue };
}

/* ============================================================
   后台账号
   ============================================================ */

export async function ensureDefaultAdmin() {
  const count = await db().countAdmins();
  if (count > 0) return false;
  const { config } = await import('../config.js');
  await db().createAdmin({
    username: config.admin.username,
    passwordHash: hashPassword(config.admin.password),
    displayName: '超级管理员',
    role: 'admin',
  });
  return true;
}

export async function login(username, password) {
  const { config } = await import('../config.js');
  const u = str(username, { field: '账号', required: true, max: 32 });
  const p = str(password, { field: '密码', required: true, max: 128 });
  const admin = await db().findAdminByUsername(u);
  if (!admin || !admin.enabled || !verifyPassword(p, admin.password_hash)) {
    throw bad('账号或密码不正确', 'BAD_CREDENTIALS');
  }
  const token = randomToken(32);
  const expiresAt = addHours(config.sessionHours);
  await db().createSession({ adminId: admin.id, tokenHash: sha256(token), expiresAt });
  await db().touchAdminLogin(admin.id);
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    admin: { username: admin.username, displayName: admin.display_name, role: admin.role },
  };
}

export async function resolveSession(token) {
  if (!token) return null;
  const s = await db().findSession(sha256(token));
  if (!s) return null;
  if (!s.enabled) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    await db().deleteSession(s.token_hash);
    return null;
  }
  return { adminId: s.admin_id, username: s.username, displayName: s.display_name, role: s.role };
}

export async function logout(token) {
  if (!token) return { ok: true };
  await db().deleteSession(sha256(token));
  return { ok: true };
}

/* ============================================================
   后台账号管理
   ============================================================ */

export const ADMIN_ROLES = ['admin', 'operator'];

function toPublicAdmin(a) {
  if (!a) return null;
  return {
    id: a.id,
    username: a.username,
    displayName: a.display_name || a.username,
    role: a.role,
    enabled: !!a.enabled,
    lastLoginAt: a.last_login_at || null,
    createdAt: a.created_at || null,
  };
}

export async function listAdmins() {
  const rows = await db().listAdmins();
  return rows.map(toPublicAdmin);
}

/** 修改自己的密码：必须校验原密码 */
export async function changeOwnPassword(username, { currentPassword, newPassword }, { keepSessionToken = '' } = {}) {
  const cur = str(currentPassword, { field: '当前密码', required: true, max: 128 });
  const next = str(newPassword, { field: '新密码', required: true, max: 128, min: 8 });
  if (next === cur) throw bad('新密码不能与当前密码相同', 'SAME_PASSWORD');

  const admin = await db().findAdminByUsername(username);
  if (!admin || !verifyPassword(cur, admin.password_hash)) {
    throw bad('当前密码不正确', 'BAD_CREDENTIALS');
  }
  await db().updateAdmin(admin.id, { password_hash: hashPassword(next) });
  // 改密后注销该账号的其它会话，仅保留当前会话
  const revoked = await db().deleteSessionsByAdmin(admin.id, keepSessionToken ? sha256(keepSessionToken) : '');
  return { changed: true, revokedSessions: revoked };
}

/** 新建后台账号（仅超级管理员） */
export async function createAdminAccount({ username, password, displayName, role }) {
  // 先校验字符集，再校验长度，这样中文/特殊字符会得到明确的「账号名非法」提示
  const u = str(username, { field: '账号', required: true, max: 64 });
  if (!/^[A-Za-z0-9_.-]+$/.test(u) || u.length < 3 || u.length > 32) {
    throw bad('账号只能包含字母、数字、下划线、点或横线（3~32 位）', 'INVALID_USERNAME');
  }
  const p = str(password, { field: '密码', required: true, max: 128 });
  if (p.length < 8) throw bad('密码至少 8 位', 'TOO_SHORT');
  const r = oneOf(str(role, { field: '角色' }) || 'operator', ADMIN_ROLES, '角色');
  const existing = await db().findAdminByUsername(u);
  if (existing) throw bad('该账号已存在', 'USERNAME_TAKEN');
  const id = await db().createAdmin({
    username: u,
    passwordHash: hashPassword(p),
    displayName: str(displayName, { field: '显示名', max: 64 }) || u,
    role: r,
  });
  const created = await db().findAdminById(id);
  return toPublicAdmin(created);
}

/** 修改其它账号：显示名 / 角色 / 启用状态 / 重置密码（仅超级管理员） */
export async function updateAdminAccount(id, patch, { operator = '', operatorId = null } = {}) {
  const target = await db().findAdminById(id);
  if (!target) throw notFound('账号不存在');

  const allow = {};
  if (patch.displayName !== undefined) allow.display_name = str(patch.displayName, { field: '显示名', max: 64 });
  if (patch.role !== undefined) allow.role = oneOf(str(patch.role), ADMIN_ROLES, '角色');
  if (patch.enabled !== undefined) allow.enabled = boolish(patch.enabled) ? 1 : 0;
  if (patch.password !== undefined) {
    allow.password_hash = hashPassword(str(patch.password, { field: '新密码', required: true, max: 128, min: 8 }));
  }
  if (!Object.keys(allow).length) throw bad('没有可更新的字段', 'NOTHING_TO_UPDATE');

  // 防止把自己停用或降权后把自己锁在外面
  if (operatorId !== null && Number(operatorId) === Number(target.id)) {
    if (allow.enabled === 0) throw bad('不能停用当前登录的账号', 'CANNOT_DISABLE_SELF');
    if (allow.role && allow.role !== 'admin') throw bad('不能降低当前登录账号的角色', 'CANNOT_DEMOTE_SELF');
  }
  // 系统里至少要保留一个可用的超级管理员
  if ((allow.enabled === 0 || (allow.role && allow.role !== 'admin')) && target.role === 'admin') {
    const admins = await db().listAdmins();
    const otherActiveAdmins = admins.filter(
      (a) => a.id !== target.id && a.role === 'admin' && a.enabled
    );
    if (!otherActiveAdmins.length) throw bad('必须保留至少一个启用状态的超级管理员', 'LAST_ADMIN');
  }

  await db().updateAdmin(target.id, allow);
  // 重置密码或停用时，踢掉该账号的所有会话
  if (allow.password_hash || allow.enabled === 0) {
    await db().deleteSessionsByAdmin(target.id, '');
  }
  return toPublicAdmin(await db().findAdminById(target.id));
}

/** 删除后台账号（仅超级管理员；不能删自己，且必须留至少一个管理员） */
export async function removeAdminAccount(id, { operatorId = null } = {}) {
  const target = await db().findAdminById(id);
  if (!target) throw notFound('账号不存在');
  if (operatorId !== null && Number(operatorId) === Number(target.id)) {
    throw bad('不能删除当前登录的账号', 'CANNOT_DELETE_SELF');
  }
  if (target.role === 'admin') {
    const admins = await db().listAdmins();
    const others = admins.filter((a) => a.id !== target.id && a.role === 'admin' && a.enabled);
    if (!others.length) throw bad('必须保留至少一个启用状态的超级管理员', 'LAST_ADMIN');
  }
  await db().deleteAdmin(target.id);
  return { deleted: true, username: target.username };
}

/* ============================================================
   脱敏输出
   ============================================================ */

export function toPublicOrder(row, { mask = false, logs = null } = {}) {
  if (!row) return null;
  const step = STATUS_STEP[row.status] ?? 1;
  const out = {
    orderNo: row.order_no,
    game: row.game_key,
    gameName: row.game_name,
    pkg: row.package_id,
    pkgName: row.package_name,
    pricingMode: row.pricing_mode,
    unit: row.unit,
    unitPrice: Number(row.unit_price),
    quantity: Number(row.quantity),
    baseAmount: Number(row.base_amount),
    overtimeUnits: Number(row.overtime_units),
    overtimeAmount: Number(row.overtime_amount),
    upscale4k: !!row.upscale_4k,
    upscaleAmount: Number(row.upscale_amount),
    rush: !!row.rush,
    totalAmount: Number(row.total_amount),
    paidAmount: Number(row.paid_amount),
    contact: mask ? maskContact(row.contact) : row.contact,
    music: row.music_type,
    material: row.material_state,
    refLink: row.ref_link,
    requirement: row.requirement,
    status: row.status,
    statusLabel: statusLabel(row.status),
    step,
    createdAt: toIso(row.created_at),
    paidAt: toIso(row.paid_at),
    deliveredAt: toIso(row.delivered_at),
    dueAt: toIso(row.due_at),
    updatedAt: toIso(row.updated_at),
  };
  if (!mask) {
    out.adminNote = row.admin_note;
    out.clientIp = row.client_ip;
    out.source = row.source;
  }
  if (logs) {
    out.logs = logs.map((l) => ({
      from: l.from_status,
      to: l.to_status,
      toLabel: statusLabel(l.to_status),
      operator: l.operator,
      note: l.note,
      at: toIso(l.created_at),
    }));
  }
  return out;
}

function toIso(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export const PUBLIC_CONSTANTS = { CONTACT, ADDON_4K: 15, EXTRA_MIN: 12 };
