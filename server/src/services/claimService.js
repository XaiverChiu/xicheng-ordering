/**
 * 待核对付款服务
 *
 * 流程：客户下单前先扫码付款 → 填写联系方式与付款备注 → 提交后只生成一条
 * 「待核对付款」记录（不进订单列表）→ 剪辑师在后台核对到账后确认 →
 * 才生成正式订单（XC- 编号）并进入剪辑队列。
 *
 * 这样后台的订单列表里全部都是「已到账」的单，不会混入未付款的。
 */
import { db } from '../db/index.js';
import { addHours, bad, boolish, contact, int, notFound, oneOf, str, toMysqlDate } from '../lib/util.js';
import { getGame, getPackage, calculatePrice } from '../domain/catalog.js';
import { makeOrderNo } from '../domain/order.js';
import { normalizeContact, toPublicOrder } from './orderService.js';

export const CLAIM_STATUS = ['pending', 'confirmed', 'rejected', 'expired'];

export const CLAIM_STATUS_LABEL = {
  pending: '待核对到账',
  confirmed: '已核对 · 已转订单',
  rejected: '已驳回',
  expired: '已过期',
};

/** 待核对编号：XCP-YYMMDD-XXXX（P = payment） */
export function makeClaimNo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const date = String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate());
  return `XCP-${date}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

async function allocateClaimNo(attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const no = makeClaimNo();
    const exist = await db().findClaimByNo(no);
    if (!exist) return no;
  }
  return makeClaimNo() + String(Date.now() % 100);
}

function toPublicClaim(row) {
  if (!row) return null;
  return {
    claimNo: row.claim_no,
    status: row.status,
    statusLabel: CLAIM_STATUS_LABEL[row.status] || row.status,
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
    contact: row.contact,
    payRef: row.pay_ref,
    payNo: row.pay_no,
    payShot: row.pay_shot,
    ocrOk: !!row.ocr_ok,
    ocrNote: row.ocr_note,
    music: row.music_type,
    material: row.material_state,
    refLink: row.ref_link,
    requirement: row.requirement,
    orderNo: row.order_no,
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: toIso(row.reviewed_at),
    createdAt: toIso(row.created_at),
  };
}

function toIso(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

/* ============================================================
   客户：提交付款待核对
   ============================================================ */

/** 转账单号：微信/支付宝账单详情里的交易单号，10~64 位数字或字母 */
function payNo(v) {
  const s = str(v, { field: '转账单号', required: true, max: 64 });
  if (!/^[0-9A-Za-z]{10,64}$/.test(s)) {
    throw bad('转账单号格式不正确：请在微信/支付宝账单详情里复制交易单号（10 位以上的数字或字母）', 'INVALID_PAY_NO');
  }
  return s.toUpperCase();
}

/**
 * 客户：提交付款待核对（新流程：转账单号 + 付款截图 + 自动核验）
 *
 * ctx.ocr 结构（由路由在 OCR 后传入）：
 *   { ok: bool, note: string }
 *   - ok=true  自动核验通过 → 直接生成正式订单（跳过人工点“确认到账”）
 *   - 未传 / ok=false → 只登记为待核对（OCR 关闭或调试模式）
 */
export async function createClaim(payload, ctx = {}) {
  const gameKey = str(payload.game, { field: '游戏分组', required: true, max: 32 });
  const pkgId = str(payload.pkg, { field: '规格', required: true, max: 32 });
  const contactRaw = contact(payload.contact);
  const duration = int(payload.duration, { field: '成品时长/回合数', min: 1, max: 600, def: 1 });
  const up4k = boolish(payload.up4k);
  const rush = boolish(payload.rush);
  const musicType = oneOf(str(payload.music, { field: '配乐方式' }) || 'self', ['self', 'pro'], '配乐方式');
  const materialState = oneOf(str(payload.material, { field: '素材情况' }) || 'ready', ['ready', 'later'], '素材情况');
  const refLink = str(payload.link, { field: '配乐/参考链接', max: 500 });
  const requirement = str(payload.note, { field: '剪辑要求', max: 2000 });
  // 付款备注号：至少 4 位，便于对账；必填
  const payRef = str(payload.payRef, { field: '付款备注/单号', required: true, max: 120, min: 4 });
  // 转账单号：必填 + 格式校验 + 全局唯一（一笔转账只能用于一单，防一图多用）
  const payNoValue = payNo(payload.payNo);
  const used = await db().findClaimByPayNo(payNoValue);
  if (used) {
    throw bad('该转账单号已被使用过（每笔转账只能下一次单），请填写本次付款的交易单号', 'PAY_NO_USED');
  }

  const price = calculatePrice({ gameKey, pkgId, duration, up4k, rush });
  const game = getGame(gameKey);
  const pkg = getPackage(gameKey, pkgId);
  const claimNo = await allocateClaimNo();

  const record = {
    claim_no: claimNo,
    status: 'pending',
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
    contact: contactRaw,
    contact_norm: normalizeContact(contactRaw),
    pay_ref: payRef,
    pay_no: payNoValue,
    pay_shot: str(ctx.payShot, { max: 255 }) || '',
    ocr_ok: ctx.ocr && ctx.ocr.ok ? 1 : 0,
    ocr_note: str(ctx.ocr && ctx.ocr.note, { max: 255 }) || '',
    music_type: musicType,
    material_state: materialState,
    ref_link: refLink,
    requirement,
    order_no: '',
    review_note: '',
    reviewed_by: '',
    reviewed_at: null,
    source: str(ctx.source, { max: 16 }) || 'web',
    client_ip: str(ctx.ip, { max: 64 }),
  };

  const { id } = await db().createClaim(record);
  const claimRow = { ...record, id, created_at: toMysqlDate(new Date()) };

  // 自动核验通过 → 直接生成正式订单并进入剪辑队列
  if (ctx.ocr && ctx.ocr.ok) {
    const auto = await autoConfirmClaim(claimRow, { ocrNote: record.ocr_note });
    return { claim: auto.claim, order: auto.order };
  }

  return { claim: toPublicClaim(claimRow), order: null };
}

/* ============================================================
   查询
   ============================================================ */

export async function getClaimByNo(claimNo) {
  const no = str(claimNo, { field: '待核对编号', required: true, max: 32 });
  const row = await db().findClaimByNo(no.toUpperCase());
  if (!row) throw notFound('没有找到该待核对记录，请检查编号');
  return row;
}

/** 客户查询：编号 或 联系方式（返回该联系方式下所有待核对记录） */
export async function trackClaims(query) {
  const q = str(query, { field: '查询内容', required: true, max: 80 });
  const asNo = await db().findClaimByNo(q.toUpperCase());
  if (asNo) return { mode: 'claim', claims: [toPublicClaim(asNo)] };
  const norm = normalizeContact(q);
  if (norm.length < 3) throw bad('请填写完整的编号或联系方式', 'INVALID_QUERY');
  const rows = await db().findClaimsByContact(norm, 20);
  if (!rows.length) throw notFound('没有查到该联系方式下的待核对记录');
  return { mode: 'contact', claims: rows.map(toPublicClaim) };
}

/* ============================================================
   后台：核对
   ============================================================ */

export async function listClaims({ status, keyword, page = 1, pageSize = 20 } = {}) {
  const res = await db().listClaims({
    status: status ? oneOf(String(status), CLAIM_STATUS, '状态') : undefined,
    keyword: str(keyword, { max: 80 }) || undefined,
    page: int(page, { min: 1, max: 100000, def: 1 }),
    pageSize: int(pageSize, { min: 1, max: 200, def: 20 }),
  });
  return { ...res, rows: res.rows.map(toPublicClaim) };
}

export async function claimStats() {
  const rows = await db().countClaimsByStatus();
  const out = {};
  for (const s of CLAIM_STATUS) {
    const hit = rows.find((r) => r.status === s);
    out[s] = { status: s, label: CLAIM_STATUS_LABEL[s], count: Number(hit?.n || 0), amount: Number(hit?.amount || 0) };
  }
  return out;
}

/** 由待核对记录生成「已付款」正式订单（到账时间即交付时效起算点） */
function buildOrderRecord(claim, { paidAt = new Date(), note = '', paidAmount } = {}) {
  const game = getGame(claim.game_key);
  return {
    order_no: '',
    game_key: claim.game_key,
    game_name: claim.game_name,
    package_id: claim.package_id,
    package_name: claim.package_name,
    pricing_mode: claim.pricing_mode,
    unit: claim.unit,
    unit_price: claim.unit_price,
    quantity: claim.quantity,
    base_amount: claim.base_amount,
    overtime_units: claim.overtime_units,
    overtime_amount: claim.overtime_amount,
    upscale_4k: claim.upscale_4k,
    upscale_amount: claim.upscale_amount,
    rush: claim.rush,
    total_amount: claim.total_amount,
    paid_amount: paidAmount === undefined || paidAmount === null || paidAmount === ''
      ? claim.total_amount
      : Number(paidAmount),
    credit_used: 0,
    contact: claim.contact,
    contact_norm: claim.contact_norm,
    music_type: claim.music_type,
    material_state: claim.material_state,
    ref_link: claim.ref_link,
    requirement: claim.requirement,
    admin_note: note ? '付款核对备注：' + note : '',
    status: 'paid',
    source: claim.source || 'web',
    client_ip: claim.client_ip || '',
    paid_at: toMysqlDate(paidAt),
    due_at: game?.ttlMinutes ? toMysqlDate(addHours(game.ttlMinutes / 60)) : null,
  };
}

/**
 * 核对通过：生成正式订单，并回写 claim.order_no
 * 付款时间就记为「到账时间」，交付时效从这里起算
 */
export async function confirmClaim(claimNo, { operator = 'admin', note = '', paidAmount } = {}) {
  const claim = await getClaimByNo(claimNo);
  if (claim.status === 'confirmed') {
    throw bad(`该记录已核对过，对应订单号 ${claim.order_no || '—'}`, 'ALREADY_CONFIRMED');
  }
  if (claim.status === 'rejected') throw bad('该记录已被驳回，不能再确认', 'ALREADY_REJECTED');

  const orderNo = await allocateOrderNo();
  const paidAt = new Date();
  const patch = { status: 'confirmed', order_no: orderNo, reviewed_by: operator, reviewed_at: toMysqlDate(paidAt), review_note: str(note, { max: 250 }) };

  // 直接落一条「已付款」订单（钱已到账，省掉再点一次）
  const orderRecord = buildOrderRecord(claim, { paidAt, note, paidAmount });
  orderRecord.order_no = orderNo;

  const { id: orderId } = await db().createOrder(orderRecord);
  await db().updateClaim(claim.id, patch);
  await db().addLog({
    orderId,
    orderNo,
    fromStatus: '',
    toStatus: 'paid',
    operator,
    note: `付款核对通过（待核对编号 ${claim.claim_no}，付款备注 ${claim.pay_ref}）` + (note ? `；${note}` : ''),
  });

  return {
    claim: toPublicClaim({ ...claim, ...patch }),
    order: toPublicOrder({ ...orderRecord, id: orderId }),
  };
}

/**
 * 自动核验通过：跳过人工点确认，直接生成正式订单
 * 用于「转账单号 + 付款截图 OCR 一致」的自动放行；不一致仍走人工核对
 */
async function autoConfirmClaim(claimRow, { ocrNote = '' } = {}) {
  const orderNo = await allocateOrderNo();
  const paidAt = new Date();
  const patch = {
    status: 'confirmed',
    order_no: orderNo,
    reviewed_by: 'auto-ocr',
    reviewed_at: toMysqlDate(paidAt),
    review_note: str(ocrNote, { max: 250 }) || '自动核验通过',
    ocr_ok: 1,
  };

  const orderRecord = buildOrderRecord(claimRow, { paidAt, note: '自动核验通过' });
  orderRecord.order_no = orderNo;

  const { id: orderId } = await db().createOrder(orderRecord);
  await db().updateClaim(claimRow.id, patch);
  await db().addLog({
    orderId,
    orderNo,
    fromStatus: '',
    toStatus: 'paid',
    operator: 'auto-ocr',
    note: `自动核验通过（待核对编号 ${claimRow.claim_no}，转账单号 ${claimRow.pay_no}）：${patch.review_note}`,
  });

  return {
    claim: toPublicClaim({ ...claimRow, ...patch }),
    order: toPublicOrder({ ...orderRecord, id: orderId }),
  };
}

/** 驳回：例如没查到这笔到账 */
export async function rejectClaim(claimNo, { operator = 'admin', note = '' } = {}) {
  const claim = await getClaimByNo(claimNo);
  if (claim.status === 'confirmed') throw bad('该记录已核对通过，不能驳回', 'ALREADY_CONFIRMED');
  const patch = {
    status: 'rejected',
    reviewed_by: operator,
    reviewed_at: toMysqlDate(new Date()),
    review_note: str(note, { max: 250 }) || '未查到对应到账',
  };
  await db().updateClaim(claim.id, patch);
  return toPublicClaim({ ...claim, ...patch });
}

async function allocateOrderNo(attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const no = makeOrderNo('XC');
    const exist = await db().findOrderByNo(no);
    if (!exist) return no;
  }
  return makeOrderNo('XC') + String(Date.now() % 100);
}

export { toPublicClaim };
