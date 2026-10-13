/**
 * 公开接口：价目表 / 计价 / 下单 / 查单
 */
import fs from 'node:fs';
import path from 'node:path';
import config, { ROOT } from '../config.js';
import { CATALOG, CONTACT, PAYMENT, RULES, DURATION_OPTIONS, ROUND_OPTIONS, calculatePrice, allowedDurations, getGame, getPackage } from '../domain/catalog.js';
import { trackOrders, getOrderByNo, toPublicOrder, normalizeContact } from '../services/orderService.js';
import { createClaim, trackClaims, toPublicClaim } from '../services/claimService.js';
import { db } from '../db/index.js';
import { bad, notFound, rateLimit, str } from '../lib/util.js';
import { ocrPaymentShot } from '../lib/ocr.js';

/** 上传目录与静态服务一致（server/uploads），避免从其它工作目录启动时路径漂移 */
const UPLOAD_DIR = path.join(ROOT, 'uploads');

/**
 * 单号一致性判定：填写的单号必须与截图里识别出的某个串完全一致，
 * 或截图里某个 ≥10 位的串完整包含填写单号（OCR 可能把长单号拆成几段）。
 * 不做模糊容差——两串只差一位也视为不符，宁可转人工也不误放行。
 */
function payNoMatches(filled, ocrDigits) {
  const f = String(filled || '').toUpperCase();
  if (!f) return false;
  for (const d of ocrDigits) {
    const dd = String(d).toUpperCase();
    if (dd === f) return true;
    if (dd.length >= 10 && dd.includes(f)) return true;
  }
  return false;
}

/** 金额一致性判定：识别出的金额与系统应付一致（容忍 OCR 误差 ±1 元） */
function amountMatches(ocrAmounts, total) {
  const t = Number(total);
  return ocrAmounts.some((a) => Math.abs(a - t) <= 1);
}

export default async function publicRoutes(app) {
  /** 站点配置：价目表 + 联系方式 + 收款方式 + 规则（前端一次性拉取） */
  app.get('/api/public/config', async () => ({
    data: {
      games: CATALOG,
      contact: CONTACT,
      payment: PAYMENT,
      rules: RULES,
      durations: DURATION_OPTIONS,
      rounds: ROUND_OPTIONS,
      serverTime: new Date().toISOString(),
    },
  }));

  /** 计价试算：与下单同一套逻辑，前端只用它显示价格 */
  app.post('/api/public/quote', async (req) => {
    const b = req.body || {};
    const price = calculatePrice({
      gameKey: b.game,
      pkgId: b.pkg,
      duration: b.duration ?? 1,
      up4k: b.up4k,
      rush: b.rush,
    });
    const allowed = allowedDurations(b.game, b.pkg);
    return { data: { ...price, allowedDurations: allowed } };
  });

  /**
   * 提交付款待核对（下单前必须先付款）
   * multipart 表单：转账单号 payNo + 付款截图 payShot（图片） + 其余业务字段
   * 后端 OCR 自动核对 → 一致直接生成订单；不一致/无法识别 → 待人工核对
   */
  app.post('/api/public/payment-claims', async (req, reply) => {
    const ip = clientIp(req);
    const rl = rateLimit(`claim:${ip}`, {
      windowMs: config.rateLimit.orderWindowMs,
      max: config.rateLimit.orderMax,
    });
    if (!rl.ok) {
      reply.header('retry-after', Math.ceil((rl.retryAfterMs || 60000) / 1000));
      throw bad('提交过于频繁，请稍后再试或直接联系剪辑师', 'RATE_LIMITED');
    }

    let fields = {};
    let savedShot = null; // { url, diskPath }
    let succeeded = false;
    try {
      const isMulti = req.isMultipart?.() || /multipart\/form-data/i.test(req.headers['content-type'] || '');
      if (isMulti) {
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            if (savedShot) {
              await part.toBuffer().catch(() => {});
              throw bad('只能上传一张付款截图', 'TOO_MANY_FILES');
            }
            if (!config.uploads.mime.includes(part.mimetype)) {
              await part.toBuffer().catch(() => {});
              throw bad('付款截图仅支持 PNG / JPG / WebP 图片', 'BAD_FILE_TYPE');
            }
            const buf = await part.toBuffer();
            if (!buf || buf.length > config.uploads.maxBytes) {
              throw bad('付款截图大小不能超过 5MB', 'FILE_TOO_LARGE');
            }
            const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[part.mimetype] || '.img';
            const name = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
            const diskPath = path.join(UPLOAD_DIR, name);
            fs.writeFileSync(diskPath, buf);
            savedShot = { url: `/uploads/${name}`, diskPath };
          } else {
            fields[part.fieldname] = part.value;
          }
        }
      } else {
        fields = req.body || {};
      }

      // 截图必填
      if (!savedShot) throw bad('请上传付款截图（转账后的账单详情截图）', 'NO_PAY_SHOT');

      // 应付金额以服务端重算为准（不信任前端传值），用于与截图 OCR 出的金额比对
      let expectedTotal = 0;
      try {
        expectedTotal = calculatePrice({
          gameKey: fields.game,
          pkgId: fields.pkg,
          duration: Number(fields.duration) || 1,
          up4k: formBool(fields.up4k),
          rush: formBool(fields.rush),
        }).total;
      } catch { expectedTotal = 0; }

      // OCR 自动核验（生产默认开启；OCR_MODE=off 仅供测试/调试绕过识别）
      let ocr = { ok: false, note: '' };
      if (config.ocrMode !== 'off') {
        try {
          const { digits, amounts } = await ocrPaymentShot(savedShot.diskPath);
          const noMatch = payNoMatches(fields.payNo, digits);
          const amtMatch = amountMatches(amounts, expectedTotal);
          ocr = {
            ok: noMatch && amtMatch,
            note: `识别单号[${digits.slice(0, 5).join(',')}] 金额[${amounts.join(',')}] 应付¥${expectedTotal} → ${noMatch && amtMatch ? '一致' : noMatch ? '金额不符' : amtMatch ? '单号不符' : '单号+金额不符'}`,
          };
        } catch (e) {
          ocr = { ok: false, note: 'OCR 识别失败，转人工核对' };
          console.warn('[ocr] ' + (e?.message || e));
        }
      } else {
        ocr = { ok: false, note: 'OCR 已关闭（测试模式），转人工核对' };
      }

      const result = await createClaim(fields, {
        ip,
        source: 'web',
        payShot: savedShot.url,
        ocr,
      });
      succeeded = true; // 入库成功，截图保留供后台查看/复核

      reply.code(201);
      return {
        data: result,
        message: result.order
          ? '付款信息与截图核对一致，订单已自动生成，请耐心等待剪辑师接单'
          : '付款信息已提交，核对结果将尽快反馈（也可在下方“查进度”里查看）',
      };
    } finally {
      // 请求失败才清理临时截图；成功入库存证留档
      if (savedShot && !succeeded) {
        try { fs.unlinkSync(savedShot.diskPath); } catch { /* 忽略 */ }
      }
    }
  });

  /** 查询待核对进度：编号 或 联系方式 */
  app.get('/api/public/payment-claims/track', async (req) => {
    const q = str(req.query?.q, { field: '查询内容', required: true, max: 80 });
    return { data: await trackClaims(q) };
  });

  /**
   * 统一查询：输入 XCP-（待核对）或 XC-（订单）或联系方式都能查到
   * 返回 { claims, orders }，前端按状态展示
   */
  app.get('/api/public/track', async (req) => {
    const q = str(req.query?.q, { field: '查询内容', required: true, max: 80 });
    const norm = normalizeContact(q);
    const result = { query: q, claims: [], orders: [] };

    const asClaim = await db().findClaimByNo(q.toUpperCase());
    if (asClaim) result.claims.push(toPublicClaim(asClaim));

    const asOrder = await db().findOrderByNo(q.toUpperCase());
    if (asOrder) result.orders.push(toPublicOrder(asOrder, { mask: true }));

    if (norm.length >= 3) {
      if (!result.claims.length) {
        result.claims = (await db().findClaimsByContact(norm, 20)).map(toPublicClaim);
      }
      if (!result.orders.length) {
        result.orders = (await db().findOrdersByContact(norm, 20)).map((r) => toPublicOrder(r, { mask: true }));
      }
    }

    if (!result.claims.length && !result.orders.length) {
      throw notFound('没有查到记录，请检查编号或下单时填写的联系方式');
    }
    return { data: result };
  });

  /** 查询订单：订单号 或 联系方式 */
  app.get('/api/public/orders/track', async (req) => {
    const q = str(req.query?.q, { field: '查询内容', required: true, max: 80 });
    const res = await trackOrders(q);
    return { data: res };
  });

  /** 单号精确查询（保留 RESTful 路径） */
  app.get('/api/public/orders/:orderNo', async (req) => {
    const row = await getOrderByNo(req.params.orderNo);
    return { data: { order: toPublicOrder(row, { mask: true }) } };
  });

  /** 规格是否可下单 + 可选时长（前端联动用） */
  app.get('/api/public/games/:game/packages/:pkg/options', async (req) => {
    const { game, pkg } = req.params;
    const g = getGame(game);
    if (!g || g.consult) throw bad('该分组不支持自助下单，请联系剪辑师', 'GAME_NOT_SELF_SERVE');
    const p = getPackage(game, pkg);
    if (!p) throw bad('规格不存在', 'PACKAGE_NOT_FOUND');
    return { data: { game: g.key, pkg: p.id, unit: p.unit, price: p.price, options: allowedDurations(game, pkg) } };
  });

  /** 健康检查（部署探活用） */
  app.get('/api/health', async () => ({
    data: { ok: true, uptime: Math.round(process.uptime()), time: new Date().toISOString() },
  }));
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.ip || '';
}

/** multipart 表单布尔值（'true'/'1'/true → true） */
function formBool(v) {
  return v === true || v === 'true' || v === '1';
}
