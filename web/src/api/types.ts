/** 对齐 server/src/domain/catalog.js + services 输出的类型 */

export interface Pkg {
  id: string;
  name: string;
  price: number;
  unit: string;
  mode: string;
  desc: string;
  chip?: string;
  flag?: 'HOT' | 'SELF';
}

export interface Game {
  key: string;
  name: string;
  title: string;
  sub: string;
  consult: boolean;
  ttlMinutes: number | null;
  packages: Pkg[];
}

export interface Contact {
  qq: string;
  wechat: string;
}

export interface Payment {
  wechatQr: string;
  alipayQr: string;
  wechatLabel: string;
  alipayLabel: string;
  wechatName: string;
  alipayName: string;
  steps: string[];
  note: string;
}

export interface Rules {
  payFirst: boolean;
  deliveryTtlMinutes: number;
  extraMinuteFee: number;
  upscale4kFee: number;
  notes: string[];
}

export interface SiteConfig {
  games: Game[];
  contact: Contact;
  payment: Payment;
  rules: Rules;
  durations: number[];
  rounds: number[];
  serverTime?: string;
}

/** /api/public/quote 返回 */
export interface Quote {
  gameKey: string;
  gameName: string;
  pkgId: string;
  pkgName: string;
  unit: string;
  mode: string;
  unitPrice: number;
  qty: number;
  base: number;
  overUnit: number;
  over: number;
  up4k: number;
  rush: boolean;
  total: number;
  payable: number;
  ttlMinutes: number;
  allowedDurations?: number[];
}

/** claim（付款待核对）—— toPublicClaim */
export interface Claim {
  claimNo: string;
  status: string;
  statusLabel: string;
  game: string;
  gameName: string;
  pkg: string;
  pkgName: string;
  pricingMode: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  baseAmount: number;
  overtimeUnits: number;
  overtimeAmount: number;
  upscale4k: boolean;
  upscaleAmount: number;
  rush: boolean;
  totalAmount: number;
  contact?: string;
  payRef?: string;
  payNo?: string;
  payShot?: string;
  ocrOk?: boolean;
  ocrNote?: string;
  music?: string;
  material?: string;
  refLink?: string;
  requirement?: string;
  orderNo?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

/** order（订单）—— toPublicOrder({mask:true}) */
export interface Order {
  orderNo: string;
  game: string;
  gameName: string;
  pkg: string;
  pkgName: string;
  pricingMode: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  baseAmount: number;
  overtimeUnits: number;
  overtimeAmount: number;
  upscale4k: boolean;
  upscaleAmount: number;
  rush: boolean;
  totalAmount: number;
  paidAmount: number;
  contact: string;
  music: string;
  material: string;
  refLink: string;
  requirement: string;
  status: string;
  statusLabel: string;
  step: number;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  dueAt: string | null;
  updatedAt: string;
  ttlMinutes?: number;
}

/** /api/public/track 返回 */
export interface TrackResult {
  query: string;
  claims: Claim[];
  orders: Order[];
}

/** 统一 返回包装 {ok,data,message,error} */
export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  message?: string;
  error?: { code: string; message: string };
}

/** 提交付款表单字段（multipart） */
export interface ClaimForm {
  game: string;
  pkg: string;
  duration: number | string;
  up4k?: boolean;
  rush?: boolean;
  payNo: string;
  contact: string;
  music?: string;
  material?: string;
  refLink?: string;
  requirement?: string;
}