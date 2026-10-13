/**
 * 管理后台鉴权：Bearer Token
 */
import { resolveSession } from '../services/orderService.js';
import { unauthorized } from '../lib/util.js';

export function bearerToken(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

/** 必须登录 */
export function requireAdmin() {
  return async (req) => {
    const token = bearerToken(req);
    const admin = await resolveSession(token);
    if (!admin) throw unauthorized();
    req.admin = { ...admin, token };
  };
}

/** 仅超级管理员 */
export function requireRole(...roles) {
  return async (req) => {
    await requireAdmin()(req);
    if (!roles.includes(req.admin.role)) throw unauthorized('当前账号权限不足');
  };
}
