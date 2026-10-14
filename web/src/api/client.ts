import type {
  ApiEnvelope, Claim, ClaimForm, Order, Quote, SiteConfig, TrackResult,
} from './types';

/** 后端基础地址：同源时为空串（由托管方反代）；开发期 vite proxy 转发 */
const BASE = '';

export class ApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  let json: ApiEnvelope<T> | null = null;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok || !json || json.ok === false) {
    const msg = json?.error?.message || `请求失败（HTTP ${res.status}）`;
    throw new ApiError(msg, json?.error?.code, res.status);
  }
  return json.data;
}

export const api = {
  /** 站点配置：价目表 + 联系方式 + 收款方式 + 规则 */
  config(): Promise<SiteConfig> {
    return request<SiteConfig>('/api/public/config');
  },

  /** 计价试算（与下单同一套逻辑） */
  quote(body: {
    game: string; pkg: string; duration: number; up4k?: boolean; rush?: boolean;
  }): Promise<Quote> {
    return request<Quote>('/api/public/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  /** 提交付款待核对(multipart)：payNo + payShot 截图 + 业务字段 */
  submitClaim(form: ClaimForm, shot: File): Promise<{ claim: Claim; order?: Order }> {
    const fd = new FormData();
    fd.append('game', form.game);
    fd.append('pkg', form.pkg);
    fd.append('duration', String(form.duration));
    fd.append('up4k', form.up4k ? 'true' : 'false');
    fd.append('rush', form.rush ? 'true' : 'false');
    fd.append('payNo', form.payNo);
    // 后端对账契约要求付款备注；当前 UI 只有一个转账单号输入框，复用该值即可。
    fd.append('payRef', form.payRef || form.payNo);
    fd.append('contact', form.contact);
    if (form.music) fd.append('music', form.music);
    if (form.material) fd.append('material', form.material);
    // 后端字段名是 link / note，前端表单仍保留更易读的 refLink / requirement。
    if (form.refLink) fd.append('link', form.refLink);
    if (form.requirement) fd.append('note', form.requirement);
    fd.append('payShot', shot);
    return request<{ claim: Claim; order?: Order }>('/api/public/payment-claims', {
      method: 'POST',
      body: fd,
    });
  },

  /** 统一查询：XCP- 待核对 / XC- 订单 / 联系方式 */
  track(q: string): Promise<TrackResult> {
    return request<TrackResult>(`/api/public/track?q=${encodeURIComponent(q)}`);
  },
};