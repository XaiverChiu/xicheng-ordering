/**
 * 价目表与计价规则
 * 口径与 1.md《收费标准》一致，并与前端 design/index.html 的 GAMES 常量保持同步。
 * 以后改价格只改这个文件（前端展示数据也由接口返回）。
 */

export const ADDON_4K = 15;   // 超分服务 +15 解锁 4K
export const EXTRA_MIN = 12;  // 每加一分钟 +12

/** 分组：能自助下单的只有 delta / valorant；other 只做询价展示 */
export const CATALOG = [
  {
    key: 'delta',
    name: '三角洲行动',
    title: '三角洲行动',
    sub: '集锦剪辑，素材自备',
    consult: false,
    ttlMinutes: 2880,                     // 48h
    packages: [
      { id: 'd-normal', name: '普通集锦', price: 15, unit: '分钟', mode: '按时长 · 15 元/分钟', desc: '常规节奏剪辑，含基础调色与字幕包装' },
      { id: 'd-fx',     name: '特效集锦', price: 30, unit: '分钟', mode: '按时长 · 30 元/分钟', desc: '特效包装、转场与音效设计，视觉冲击更强', flag: 'HOT' },
    ],
  },
  {
    key: 'valorant',
    name: '无畏契约 / CS2',
    title: '无畏契约 / CS2',
    sub: '同一收费标准 · 含单回合 / 卡点',
    consult: false,
    ttlMinutes: 2880,
    packages: [
      { id: 'v-round',  name: '单回合',   price: 9.9, unit: '回合', chip: '单回合 9.9', mode: '按回合 · 9.9 元/回合', desc: '单个高光回合独立成片，适合单局高光投稿' },
      { id: 'v-normal', name: '普通集锦', price: 15,  unit: '分钟', mode: '按时长 · 15 元/分钟', desc: '多回合高光串剪，常规节奏' },
      { id: 'v-fx',     name: '特效集锦', price: 20,  unit: '分钟', mode: '按时长 · 20 元/分钟', desc: '特效包装与镜头设计，观感更“大片”', flag: 'HOT' },
      { id: 'v-beat',   name: '卡点剪辑', price: 60,  unit: '分钟', mode: '按时长 · 60 元/分钟', desc: '严格跟拍卡点，需自备素材（推荐“求偶”素材）', flag: 'SELF' },
    ],
  },
  {
    key: 'other',
    name: '其他游戏',
    title: '其他游戏',
    sub: '',
    consult: true,                        // 不列价格，引导联系剪辑师
    ttlMinutes: null,
    packages: [],
  },
];

/** 联系方式：QQ / 微信，改这里即可全站生效 */
export const CONTACT = {
  qq: process.env.CONTACT_QQ || '3493548230',
  wechat: process.env.CONTACT_WECHAT || 'xcq7689OnO',
};

/**
 * 收款方式
 * 图片与前台页面同源（design/ 目录），换自己的收款码就替换这两个文件：
 *   design/pay-wechat.png、design/pay-alipay.png
 */
export const PAYMENT = {
  wechatQr: '/pay-wechat.png',
  alipayQr: '/pay-alipay.png',
  wechatLabel: '微信支付',
  alipayLabel: '支付宝',
  wechatName: 'xichen(**权)',
  alipayName: '肖**权',
  steps: [
    '扫码支付对应金额，微信 / 支付宝都可以',
    '付款时在备注里写上订单号，方便对账',
    '付款完成后，在付款步骤下方填转账单号、上传付款截图，系统自动核对后立即开始剪辑',
  ],
  note: '先付后剪：付款到账后才开始剪辑。存单/预存也请先联系剪辑师。',
};

/** 平台规则文案（前端「下单须知」区域使用） */
export const RULES = {
  payFirst: true,
  deliveryTtlMinutes: 2880,
  extraMinuteFee: EXTRA_MIN,
  upscale4kFee: ADDON_4K,
  notes: [
    '先付后剪：付款到账后开始剪辑',
    '提交时需填转账单号并上传付款截图，系统自动核对，一致即生成订单',
    '正常 48h 内出片，加急请先咨询剪辑师',
    '每加一分钟 +12 元',
    '超分服务 +15 解锁 4K 画质',
    '配乐请自备，未指定由剪辑师自选且成品不支持更换',
    '没有详细要求的成品不支持修改',
    '无畏契约卡点剪辑需自备素材（推荐“求偶”素材）',
  ],
};

/** 可选时长（分钟）与回合数 */
export const DURATION_OPTIONS = [1, 2, 3, 5, 8, 10, 15, 20];
export const ROUND_OPTIONS = [1, 2, 3, 5];

const byKey = new Map(CATALOG.map((g) => [g.key, g]));

export function listGames() {
  return CATALOG;
}

export function getGame(key) {
  return byKey.get(String(key || ''));
}

export function getPackage(gameKey, pkgId) {
  const g = getGame(gameKey);
  if (!g) return null;
  return g.packages.find((p) => p.id === pkgId) || null;
}

/** 可自助下单的分组 */
export function selfServeGames() {
  return CATALOG.filter((g) => !g.consult);
}

/**
 * 计价：与前端 calc() 完全一致
 * 名义单价 pkg.price 按「基准 1 分钟/1 回合」计，超出部分每分钟加收 EXTRA_MIN；
 * 4K 超分为一次性加项。
 */
export function calculatePrice({ gameKey, pkgId, duration = 1, up4k = false, rush = false }) {
  const game = getGame(gameKey);
  if (!game || game.consult) {
    const err = new Error('该分组不支持自助下单，请联系剪辑师');
    err.statusCode = 400;
    err.code = 'GAME_NOT_SELF_SERVE';
    throw err;
  }
  const pkg = getPackage(gameKey, pkgId);
  if (!pkg) {
    const err = new Error('规格不存在');
    err.statusCode = 400;
    err.code = 'PACKAGE_NOT_FOUND';
    throw err;
  }

  const isRound = pkg.unit === '回合';
  const qty = isRound ? 1 : Number(duration);
  if (!Number.isFinite(qty) || qty <= 0) {
    const err = new Error('成品时长/回合数不合法');
    err.statusCode = 400;
    err.code = 'INVALID_DURATION';
    throw err;
  }

  const base = isRound ? pkg.price : pkg.price * qty;
  const overUnit = !isRound && qty > 1 ? qty - 1 : 0;
  const over = overUnit * EXTRA_MIN;
  const up4kFee = up4k ? ADDON_4K : 0;

  return {
    gameKey: game.key,
    gameName: game.name,
    pkgId: pkg.id,
    pkgName: pkg.name,
    unit: pkg.unit,
    mode: pkg.mode,
    unitPrice: pkg.price,
    qty,
    base: round2(base),
    overUnit,
    over: round2(over),
    up4k: up4kFee,
    rush: !!rush,
    total: round2(base + over + up4kFee),
    /** 应付定金按全款计（先付后剪） */
    payable: round2(base + over + up4kFee),
    ttlMinutes: game.ttlMinutes,
  };
}

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** 合法的时长/回合取值，用于入参校验 */
export function allowedDurations(gameKey, pkgId) {
  const pkg = getPackage(gameKey, pkgId);
  if (!pkg) return [];
  return pkg.unit === '回合' ? ROUND_OPTIONS : DURATION_OPTIONS;
}
