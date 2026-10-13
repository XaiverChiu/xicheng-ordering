/**
 * 订单状态机
 * wait  待确认付款
 * paid  已付款 · 待开始
 * doing 剪辑中
 * done  已完成 · 已交付
 * canceled 已取消
 */
export const ORDER_STATUS = ['wait', 'paid', 'doing', 'done', 'canceled'];

export const STATUS_LABEL = {
  wait: '待确认付款',
  paid: '已付款 · 待开始',
  doing: '剪辑中',
  done: '已完成 · 已交付',
  canceled: '已取消',
};

/** 允许的状态流转（管理后台用） */
export const STATUS_FLOW = {
  wait: ['paid', 'canceled'],
  paid: ['doing', 'canceled'],
  doing: ['done'],
  done: [],
  canceled: ['wait'],
};

/** 前端进度条对应的节点序号（1 已提交 / 2 剪辑中 / 3 已交付） */
export const STATUS_STEP = {
  wait: 1,
  paid: 2,
  doing: 2,
  done: 3,
  canceled: 0,
};

export function canTransit(from, to) {
  if (from === to) return true;
  const allowed = STATUS_FLOW[from] || [];
  return allowed.includes(to);
}

export function statusLabel(s) {
  return STATUS_LABEL[s] || s;
}

/** 生成订单号：XC-YYMMDD-XXXX */
export function makeOrderNo(prefix = 'XC') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const date = String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate());
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `${prefix}-${date}-${rand}`;
}

/** 发货截止时间：付款到账时间 + 交付时效 */
export function dueAt(fromDate, ttlMinutes) {
  if (!ttlMinutes) return null;
  return new Date(new Date(fromDate).getTime() + ttlMinutes * 60_000);
}
