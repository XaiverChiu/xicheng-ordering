/**
 * 内存驱动：与 MySQL 驱动实现同一套方法，用于本地无 MySQL 时跑通全流程
 * 可选落盘到 server/data/memory-db.json，重启不丢单
 */
import fs from 'node:fs';
import path from 'node:path';
import config, { ROOT } from '../config.js';
import { toMysqlDate } from '../lib/util.js';

const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'memory-db.json');

function loadState() {
  const empty = { orders: [], logs: [], admins: [], sessions: [], claims: [], seq: { orders: 0, logs: 0, admins: 0, sessions: 0, claims: 0 } };
  if (!config.db.persistMemory) return empty;
  try {
    if (!fs.existsSync(DATA_FILE)) return empty;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { ...empty, ...raw, seq: { ...empty.seq, ...(raw.seq || {}) } };
  } catch {
    return empty;
  }
}

export async function createMemoryDriver({ log = console } = {}) {
  const state = loadState();

  const persist = () => {
    if (!config.db.persistMemory) return;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
      log.warn?.('[db] 内存数据落盘失败：' + e.message);
    }
  };

  const nextId = (t) => (state.seq[t] = (state.seq[t] || 0) + 1);
  const now = () => toMysqlDate(new Date());
  const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

  const cmpDescByCreated = (a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id;

  log.warn?.('[db] 使用内存驱动（未连接 MySQL）。数据' + (config.db.persistMemory ? '会落盘到 server/data/memory-db.json' : '仅存在于进程内'));

  return {
    kind: 'memory',

    async close() {
      persist();
    },

    /* ---------------- 订单 ---------------- */

    async createOrder(o) {
      const row = { ...o };
      row.id = nextId('orders');
      row.created_at = row.created_at || now();
      row.updated_at = row.created_at;
      state.orders.push(row);
      persist();
      return { id: row.id, orderNo: row.order_no };
    },

    async findOrderByNo(orderNo) {
      return clone(state.orders.find((o) => o.order_no === orderNo) || null);
    },

    async findOrderById(id) {
      return clone(state.orders.find((o) => o.id === Number(id)) || null);
    },

    async findOrdersByContact(contactNorm, limit = 20) {
      return state.orders
        .filter((o) => o.contact_norm === contactNorm)
        .sort(cmpDescByCreated)
        .slice(0, limit)
        .map(clone);
    },

    async listOrders({ status, keyword, gameKey, from, to, page = 1, pageSize = 20 } = {}) {
      let rows = [...state.orders];
      if (status) rows = rows.filter((o) => o.status === status);
      if (gameKey) rows = rows.filter((o) => o.game_key === gameKey);
      if (from) rows = rows.filter((o) => new Date(o.created_at) >= new Date(from));
      if (to) rows = rows.filter((o) => new Date(o.created_at) <= new Date(to));
      if (keyword) {
        const k = String(keyword).toLowerCase();
        rows = rows.filter((o) =>
          String(o.order_no).toLowerCase().includes(k) ||
          String(o.contact).toLowerCase().includes(k) ||
          String(o.contact_norm).includes(k)
        );
      }
      rows.sort(cmpDescByCreated);
      const total = rows.length;
      const size = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
      const p = Math.max(Number(page) || 1, 1);
      return { rows: rows.slice((p - 1) * size, p * size).map(clone), total, page: p, pageSize: size };
    },

    async updateOrder(id, patch) {
      const row = state.orders.find((o) => o.id === Number(id));
      if (!row) return 0;
      Object.assign(row, patch, { updated_at: now() });
      persist();
      return 1;
    },

    async deleteOrder(id) {
      const i = state.orders.findIndex((o) => o.id === Number(id));
      if (i < 0) return 0;
      const [removed] = state.orders.splice(i, 1);
      state.logs = state.logs.filter((l) => l.order_id !== removed.id);
      persist();
      return 1;
    },

    async countOrders({ status } = {}) {
      return status ? state.orders.filter((o) => o.status === status).length : state.orders.length;
    },

    async stats() {
      const group = new Map();
      for (const o of state.orders) {
        const g = group.get(o.status) || { status: o.status, n: 0, amount: 0 };
        g.n += 1;
        g.amount += Number(o.total_amount || 0);
        group.set(o.status, g);
      }
      const todayStr = toMysqlDate(new Date()).slice(0, 10);
      const todayRows = state.orders.filter((o) => String(o.created_at).slice(0, 10) === todayStr);
      const nowMs = Date.now();
      const overdue = state.orders.filter(
        (o) => o.due_at && new Date(o.due_at).getTime() < nowMs && ['paid', 'doing'].includes(o.status)
      ).length;
      return {
        byStatus: [...group.values()],
        today: { count: todayRows.length, amount: todayRows.reduce((s, o) => s + Number(o.total_amount || 0), 0) },
        total: {
          count: state.orders.length,
          amount: state.orders.reduce((s, o) => s + Number(o.total_amount || 0), 0),
        },
        paidAmount: state.orders
          .filter((o) => o.status !== 'canceled')
          .reduce((s, o) => s + Number(o.paid_amount || 0), 0),
        overdue,
      };
    },

    /* ---------------- 日志 ---------------- */

    async addLog({ orderId, orderNo, fromStatus = '', toStatus, operator = 'system', note = '' }) {
      state.logs.push({
        id: nextId('logs'),
        order_id: Number(orderId),
        order_no: orderNo,
        from_status: fromStatus,
        to_status: toStatus,
        operator,
        note,
        created_at: now(),
      });
      persist();
    },

    async listLogs(orderId) {
      return state.logs
        .filter((l) => l.order_id === Number(orderId))
        .sort((a, b) => a.id - b.id)
        .map(clone);
    },

    /* ---------------- 待核对付款 ---------------- */

    async createClaim(c) {
      const row = { ...c };
      row.id = nextId('claims');
      row.created_at = row.created_at || now();
      row.updated_at = row.created_at;
      state.claims.push(row);
      persist();
      return { id: row.id, claimNo: row.claim_no };
    },

    async findClaimByNo(claimNo) {
      return clone(state.claims.find((c) => c.claim_no === claimNo) || null);
    },

    async findClaimById(id) {
      return clone(state.claims.find((c) => c.id === Number(id)) || null);
    },

    /** 按转账单号查（唯一性校验） */
    async findClaimByPayNo(payNo) {
      return clone(state.claims.find((c) => c.pay_no === payNo) || null);
    },

    async findClaimsByContact(contactNorm, limit = 20) {
      return state.claims
        .filter((c) => c.contact_norm === contactNorm)
        .sort(cmpDescByCreated)
        .slice(0, limit)
        .map(clone);
    },

    async listClaims({ status, keyword, page = 1, pageSize = 20 } = {}) {
      let rows = [...state.claims];
      if (status) rows = rows.filter((c) => c.status === status);
      if (keyword) {
        const k = String(keyword).toLowerCase();
        rows = rows.filter((c) =>
          String(c.claim_no).toLowerCase().includes(k) ||
          String(c.contact).toLowerCase().includes(k) ||
          String(c.contact_norm).includes(k) ||
          String(c.pay_ref).toLowerCase().includes(k) ||
          String(c.pay_no || '').toLowerCase().includes(k)
        );
      }
      rows.sort(cmpDescByCreated);
      const total = rows.length;
      const size = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
      const p = Math.max(Number(page) || 1, 1);
      return { rows: rows.slice((p - 1) * size, p * size).map(clone), total, page: p, pageSize: size };
    },

    async updateClaim(id, patch) {
      const row = state.claims.find((c) => c.id === Number(id));
      if (!row) return 0;
      Object.assign(row, patch, { updated_at: now() });
      persist();
      return 1;
    },

    async countClaimsByStatus() {
      const group = new Map();
      for (const c of state.claims) {
        const g = group.get(c.status) || { status: c.status, n: 0, amount: 0 };
        g.n += 1;
        g.amount += Number(c.total_amount || 0);
        group.set(c.status, g);
      }
      return [...group.values()];
    },

    /* ---------------- 管理员 / 会话 ---------------- */

    async findAdminByUsername(username) {
      return clone(state.admins.find((a) => a.username === username) || null);
    },

    async findAdminById(id) {
      return clone(state.admins.find((a) => a.id === Number(id)) || null);
    },

    async listAdmins() {
      return state.admins.map(clone);
    },

    async updateAdmin(id, patch) {
      const a = state.admins.find((x) => x.id === Number(id));
      if (!a) return 0;
      Object.assign(a, patch);
      persist();
      return 1;
    },

    async deleteAdmin(id) {
      const i = state.admins.findIndex((x) => x.id === Number(id));
      if (i < 0) return 0;
      const [gone] = state.admins.splice(i, 1);
      state.sessions = state.sessions.filter((s) => s.admin_id !== gone.id);
      persist();
      return 1;
    },

    async deleteSessionsByAdmin(adminId, exceptTokenHash = '') {
      const before = state.sessions.length;
      state.sessions = state.sessions.filter(
        (s) => !(s.admin_id === Number(adminId) && (!exceptTokenHash || s.token_hash !== exceptTokenHash))
      );
      persist();
      return before - state.sessions.length;
    },

    async createAdmin({ username, passwordHash, displayName = '', role = 'admin' }) {
      const row = {
        id: nextId('admins'),
        username,
        password_hash: passwordHash,
        display_name: displayName,
        role,
        enabled: 1,
        last_login_at: null,
        created_at: now(),
      };
      state.admins.push(row);
      persist();
      return row.id;
    },

    async countAdmins() {
      return state.admins.length;
    },

    async touchAdminLogin(id) {
      const a = state.admins.find((x) => x.id === Number(id));
      if (a) { a.last_login_at = now(); persist(); }
    },

    async createSession({ adminId, tokenHash, expiresAt }) {
      state.sessions.push({
        id: nextId('sessions'),
        admin_id: Number(adminId),
        token_hash: tokenHash,
        expires_at: toMysqlDate(expiresAt),
        created_at: now(),
      });
      persist();
    },

    async findSession(tokenHash) {
      const s = state.sessions.find((x) => x.token_hash === tokenHash);
      if (!s) return null;
      const a = state.admins.find((x) => x.id === s.admin_id);
      if (!a) return null;
      return { ...clone(s), username: a.username, display_name: a.display_name, role: a.role, enabled: a.enabled };
    },

    async deleteSession(tokenHash) {
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((x) => x.token_hash !== tokenHash);
      persist();
      return before - state.sessions.length;
    },

    async purgeExpiredSessions() {
      const nowMs = Date.now();
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((s) => new Date(s.expires_at).getTime() > nowMs);
      persist();
      return before - state.sessions.length;
    },

    async runSchemaFile() {
      throw new Error('内存驱动不需要执行 schema.sql，请设置 DB_DRIVER=mysql');
    },
  };
}
