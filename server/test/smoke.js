/**
 * 接口冒烟测试：node test/smoke.js [baseUrl]
 * 覆盖：配置 / 计价 / 下单 / 查单 / 登录 / 状态流转 / 列表 / 统计 / CSV / 异常分支
 * 退出码 0 = 全部通过
 */
const BASE = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:4500';
// 转账单号全局唯一且跨轮次保留：每轮测试用独立前缀，避免撞历史数据
const RUN = String(Date.now());

// 服务层直测需要连同一个数据库：先加载 server/.env（不覆盖已有环境变量）
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
{
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    });
  } else {
    console.warn('   [warn] 未找到 server/.env，服务层直测可能连不上 MySQL');
  }
}

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log(`  \u2717 ${name}${extra ? ' → ' + extra : ''}`); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function section(t) { console.log(`\n${t}`); }

async function call(method, path, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON（CSV/HTML） */ }
  return { status: res.status, json, text, headers: res.headers };
}

/* 1×1 透明 PNG（足够触发上传与 OCR 通道，不影响断言） */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** multipart 提交付款待核对：业务字段 + 付款截图 */
async function callClaim(fields, { file = TINY_PNG, fileName = 'pay.png', fileType = 'image/png' } = {}) {
  const fd = new FormData();
  Object.keys(fields || {}).forEach((k) => fd.append(k, fields[k] == null ? '' : fields[k]));
  if (file) fd.append('payShot', new Blob([file], { type: fileType }), fileName);
  const res = await fetch(BASE + '/api/public/payment-claims', { method: 'POST', body: fd });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json, text };
}

/**
 * 提交付款待核对：自动等待并重试限流（multipart 版本）
 * 限流桶是服务端进程内的，重复跑测试时需要等窗口过期
 */
async function createClaim(fields, { retries = 3, ...rest } = {}) {
  for (let i = 0; ; i++) {
    const r = await callClaim(fields, rest);
    const limited = r.status === 400 && r.json?.error?.code === 'RATE_LIMITED';
    if (!limited || i >= retries) return r;
    const wait = 61_000; // 限流窗口 60s，等满一轮再试
    console.log(`    （触发限流，等待 ${wait / 1000}s 后重试…）`);
    await new Promise((res) => setTimeout(res, wait));
  }
}

/**
 * 登录：自动等待并重试限流
 * 登录限流窗口是 5 分钟 / 10 次，连续跑多轮测试很容易撞上
 */
async function loginAs(username, password, { retries = 3 } = {}) {
  for (let i = 0; ; i++) {
    const r = await call('POST', '/api/admin/login', { body: { username, password } });
    const limited = r.status === 400 && r.json?.error?.code === 'RATE_LIMITED';
    if (!limited || i >= retries) return r;
    const wait = 61_000;
    console.log(`    （登录被限流，等待 ${wait / 1000}s 后重试…）`);
    await new Promise((res) => setTimeout(res, wait));
  }
}

async function main() {
  console.log(`冒烟测试目标：${BASE}`);

  // 先探活，避免服务没起时抛一堆看不懂的错误
  const health = await call('GET', '/api/health').catch(() => null);
  if (!health || health.status !== 200) {
    console.error(`\n无法连接服务 ${BASE}，请先启动：npm start\n`);
    process.exit(1);
  }
  console.log(`服务在线（uptime ${health.json?.data?.uptime}s）`);

  /* ---------- 公共配置 ---------- */
  section('1. 站点配置');
  const cfg = await call('GET', '/api/public/config');
  eq('HTTP 200', cfg.status, 200);
  ok('返回 ok:true 包装', cfg.json?.ok === true);
  const games = cfg.json?.data?.games || [];
  eq('三个分组', games.length, 3);
  eq('三角洲 2 个规格', games.find((g) => g.key === 'delta')?.packages.length, 2);
  eq('无畏契约 4 个规格', games.find((g) => g.key === 'valorant')?.packages.length, 4);
  ok('其他游戏标记为询价', games.find((g) => g.key === 'other')?.consult === true);
  ok('返回联系方式', /^\d+$/.test(cfg.json?.data?.contact?.qq || ''));

  /* ---------- 计价 ---------- */
  section('2. 计价试算');
  const q1 = await call('POST', '/api/public/quote', { body: { game: 'valorant', pkg: 'v-fx', duration: 3, up4k: true } });
  eq('特效集锦 3 分钟 + 4K = 99', q1.json?.data?.total, 99);
  eq('小计 20×3', q1.json?.data?.base, 60);
  eq('超时 2 分钟 ×12', q1.json?.data?.over, 24);
  eq('4K 加项 15', q1.json?.data?.up4k, 15);

  const q2 = await call('POST', '/api/public/quote', { body: { game: 'delta', pkg: 'd-normal', duration: 1 } });
  eq('三角洲 1 分钟 = 15', q2.json?.data?.total, 15);
  eq('无超时长', q2.json?.data?.overUnit, 0);

  const q3 = await call('POST', '/api/public/quote', { body: { game: 'valorant', pkg: 'v-beat', duration: 2 } });
  eq('卡点剪辑 2 分钟 = 132', q3.json?.data?.total, 132);

  const q4 = await call('POST', '/api/public/quote', { body: { game: 'valorant', pkg: 'v-round', duration: 1 } });
  eq('单回合 = 9.9', q4.json?.data?.total, 9.9);
  eq('回合规格不带超时长', q4.json?.data?.overUnit, 0);

  const qBad = await call('POST', '/api/public/quote', { body: { game: 'other', pkg: 'x' } });
  eq('询价分组计价被拒 400', qBad.status, 400);
  ok('错误码正确', qBad.json?.error?.code === 'GAME_NOT_SELF_SERVE', qBad.json?.error?.code);

  /* ---------- 提交付款待核对（唯一的下单入口：转账单号 + 付款截图 + 自动核验） ---------- */
  section('3. 提交付款待核对（multipart：转账单号 + 截图）');
  const cust = {
    game: 'valorant', pkg: 'v-fx', duration: 3, up4k: true, contact: 'QQ 3493548230',
    payRef: 'WXTEST8888', payNo: '42' + RUN + '01', music: 'self', material: 'ready',
    link: 'https://music.163.com/x', note: '卡点 + 击杀集锦，偏电影感调色',
  };

  // 缺截图 / 单号格式 / 文件类型 的硬校验（先于成功用例，避免撞限流）
  const noShot = await callClaim({ ...cust, payNo: '42' + RUN + '02' }, { file: null });
  eq('缺付款截图被拒 400', noShot.status, 400);
  ok('错误码 NO_PAY_SHOT', noShot.json?.error?.code === 'NO_PAY_SHOT', noShot.json?.error?.code);

  const shortPayNo = await callClaim({ ...cust, payNo: 'ABC123' });
  eq('转账单号过短被拒 400', shortPayNo.status, 400);
  ok('错误码 INVALID_PAY_NO', shortPayNo.json?.error?.code === 'INVALID_PAY_NO', shortPayNo.json?.error?.code);

  const badType = await callClaim({ ...cust, payNo: '42' + RUN + '03' }, { fileName: 'x.txt', fileType: 'text/plain' });
  eq('非图片文件被拒 400', badType.status, 400);
  ok('错误码 BAD_FILE_TYPE', badType.json?.error?.code === 'BAD_FILE_TYPE', badType.json?.error?.code);

  const badContact = await callClaim({ ...cust, contact: '啊', payNo: '42' + RUN + '04' });
  eq('无效联系方式被拒 400', badContact.status, 400);
  ok('错误码 INVALID_CONTACT', badContact.json?.error?.code === 'INVALID_CONTACT', badContact.json?.error?.code);

  const badPkg = await callClaim({ ...cust, pkg: 'not-exist', payNo: '42' + RUN + '05' });
  eq('无效规格被拒 400', badPkg.status, 400);

  const noRef = await createClaim({ ...cust, payRef: '', payNo: '42' + RUN + '06' });
  eq('缺付款备注被拒 400', noRef.status, 400);
  ok('错误码提示缺失', ['REQUIRED', 'TOO_SHORT'].includes(noRef.json?.error?.code), noRef.json?.error?.code);

  const created = await createClaim(cust);
  eq('HTTP 201', created.status, 201);
  const claim = created.json?.data?.claim || {};
  ok('待核对编号格式 XCP-YYMMDD-XXXX', /^XCP-\d{6}-\d{4}$/.test(claim?.claimNo || ''), claim?.claimNo);
  eq('金额 99', claim?.totalAmount, 99);
  eq('初始状态 pending', claim?.status, 'pending');
  eq('状态文案', claim?.statusLabel, '待核对到账');
  ok('中文要求未被破坏', claim?.requirement === cust.note, claim?.requirement);
  ok('中文分组名正确', claim?.gameName === '无畏契约 / CS2', claim?.gameName);
  eq('付款备注已保存', claim?.payRef, 'WXTEST8888');
  eq('转账单号已保存', claim?.payNo, cust.payNo.toUpperCase());
  ok('核对前还没有正式订单', !claim?.orderNo);

  // 同一转账单号不能重复下单（防一图多用 / 单号复用）
  const dupPayNo = await createClaim({ ...cust, contact: 'QQ 999888777', payNo: cust.payNo });
  eq('重复转账单号被拒 400', dupPayNo.status, 400);
  ok('错误码 PAY_NO_USED', dupPayNo.json?.error?.code === 'PAY_NO_USED', dupPayNo.json?.error?.code);

  // 直接下单接口已移除：没有付款（无转账单号+截图）就不能产生任何后台记录
  const direct = await call('POST', '/api/public/orders', { body: { ...cust } });
  eq('直接下单接口已禁用 404', direct.status, 404);
  ok('错误码 NOT_FOUND', direct.json?.error?.code === 'NOT_FOUND', direct.json?.error?.code);

  /* ---------- OCR 自动核验（服务层直测：不依赖真实 OCR 引擎与图片） ---------- */
  section('3b. 自动核验通过 → 直接生成正式订单');
  try {
    const { initDb, closeDb } = await import('../src/db/index.js');
    const cfgMod = await import('../src/config.js');
    // 直测进程必须与运行中的服务连同一个 MySQL，否则“单号复用”断言会打到不同库
    ok('服务层直测使用 MySQL 驱动', cfgMod.config.db.driver === 'mysql', cfgMod.config.db.driver);
    await initDb(); // 服务层直测需要自己的连接池（与运行中的服务连同一个 MySQL）
    try {
      const { createClaim: svcCreate } = await import('../src/services/claimService.js');
      const auto = await svcCreate(
        { ...cust, contact: 'QQ 777666555', payNo: '42' + RUN + '99', duration: 1 },
        { ip: '127.0.0.1', source: 'smoke', payShot: '/uploads/smoke-test.png', ocr: { ok: true, note: '识别单号[42' + RUN + '99] 金额[15] 应付¥15 → 一致' } }
      );
      eq('自动通过返回正式订单', !!auto.order, true);
      ok('自动通过订单号格式 XC-YYMMDD-XXXX', /^XC-\d{6}-\d{4}$/.test(auto?.order?.orderNo || ''), auto?.order?.orderNo);
      eq('订单状态 paid', auto?.order?.status, 'paid');
      eq('待核对状态已 confirmed', auto?.claim?.status, 'confirmed');
      eq('待核对回写订单号', auto?.claim?.orderNo, auto?.order?.orderNo);
      ok('待核对标记 OCR 通过', auto?.claim?.ocrOk === true);
      ok('备注含自动核验摘要', /识别单号/.test(auto?.claim?.ocrNote || ''), auto?.claim?.ocrNote);
      // 自动通过后，该单号也不能再被复用
      const dupAfterAuto = await createClaim({ ...cust, contact: 'QQ 555444333', payNo: '42' + RUN + '99' });
      eq('自动通过后单号复用被拒 400', dupAfterAuto.status, 400);
      ok('错误码 PAY_NO_USED', dupAfterAuto.json?.error?.code === 'PAY_NO_USED', dupAfterAuto.json?.error?.code);
    } finally {
      await closeDb();
    }
  } catch (e) {
    ok('自动核验服务层测试可执行', false, e?.message || String(e));
  }

  /* ---------- 查单（统一查询：待核对 / 订单 / 联系方式） ---------- */
  section('4. 查询待核对记录');
  const byNo = await call('GET', `/api/public/track?q=${claim.claimNo}`);
  eq('按待核对编号查询 200', byNo.status, 200);
  eq('命中 1 条待核对', byNo.json?.data?.claims?.length, 1);
  eq('尚未命中订单', byNo.json?.data?.orders?.length, 0);

  const byContact = await call('GET', '/api/public/track?q=' + encodeURIComponent(cust.contact));
  eq('按完整联系方式查询 200', byContact.status, 200);
  ok('至少命中 1 条待核对', (byContact.json?.data?.claims?.length || 0) >= 1);

  // 用不可能存在的号码（基于时间戳生成，避免历史测试残留导致误命中）
  const ghostQ = '88' + String(Date.now()).slice(-10);
  const partial = await call('GET', '/api/public/track?q=' + encodeURIComponent(ghostQ));
  eq('未下单的号码（缺前缀）查不到 404', partial.status, 404);

  const notFound = await call('GET', '/api/public/track?q=XCP-000000-0000');
  eq('不存在的编号 404', notFound.status, 404);
  ok('提示文案友好', /没有找到|没有查到/.test(notFound.json?.error?.message || ''), notFound.json?.error?.message);

  /* ---------- 频率限制 ---------- */
  section('5. 待核对提交频率限制');
  let limited = false;
  const claimNos = [];
  for (let i = 0; i < 8; i++) {
    const r = await createClaim({ ...cust, contact: 'QQ 999000' + i, payRef: 'REF' + i + '0000', payNo: '42' + RUN + '1' + i }, { retries: 0 });
    if (r.json?.data?.claim?.claimNo) claimNos.push(r.json.data.claim.claimNo);
    if (r.status === 400 && r.json?.error?.code === 'RATE_LIMITED') { limited = true; break; }
  }
  ok('高频提交被限流', limited);
  ok('限流前已生成待核对记录', claimNos.length >= 1);

  /* ---------- 管理后台 ---------- */
  section('6. 管理后台');
  const badLogin = await loginAs('admin', 'wrong-password');
  eq('错误密码被拒 400', badLogin.status, 400);

  const login = await loginAs('admin', 'xicheng@2026');
  eq('登录成功 200', login.status, 200);
  const token = login.json?.data?.token;
  if (!token) {
    const why = login.json?.error?.message || '未知错误';
    console.error('\n后台登录失败（HTTP ' + login.status + '）：' + why);
    console.error('无法继续管理后台相关断言，测试终止。');
    process.exit(1);
  }
  ok('返回 token', typeof token === 'string' && token.length > 20);

  const me = await call('GET', '/api/admin/me', { token });
  eq('鉴权通过', me.status, 200);
  eq('账号名正确', me.json?.data?.admin?.username, 'admin');

  const noAuth = await call('GET', '/api/admin/orders');
  eq('未带 token 访问被拒 401', noAuth.status, 401);

  /* 核对到账 → 生成正式订单（后台记录只来自已付款） */
  const claimList = await call('GET', '/api/admin/payment-claims?status=pending&pageSize=5', { token });
  eq('待核对列表 200', claimList.status, 200);
  ok('有待核对记录', (claimList.json?.data?.rows?.length || 0) > 0);
  ok('待核对含付款备注', 'payRef' in (claimList.json.data.rows[0] || {}));

  const confirmRes = await call('POST', `/api/admin/payment-claims/${claim.claimNo}/confirm`, { token, body: { note: '微信到账 99 元，尾号 8888' } });
  eq('核对通过 200', confirmRes.status, 200);
  const order = confirmRes.json?.data?.order || {};
  ok('生成正式订单号 XC-YYMMDD-XXXX', /^XC-\d{6}-\d{4}$/.test(order?.orderNo || ''), order?.orderNo);
  eq('订单初始状态 paid', order?.status, 'paid');
  eq('已付金额=应付 99', order?.paidAmount, 99);
  ok('记录付款时间', !!order?.paidAt);
  ok('写入承诺交付时间（48h）', !!order?.dueAt);
  eq('待核对回写订单号', confirmRes.json?.data?.claim?.orderNo, order?.orderNo);

  // 订单此时才进入列表 —— 未付款的待核对记录不占订单位
  const list = await call('GET', '/api/admin/orders?page=1&pageSize=5', { token });
  eq('订单列表 200', list.status, 200);
  ok('订单列表包含新订单', (list.json?.data?.rows || []).some((r) => r.orderNo === order.orderNo));
  ok('列表含内部备注字段', 'adminNote' in (list.json.data.rows[0] || {}));

  /* 公开查单：订单号可查、联系方式脱敏 */
  const byOrderNo = await call('GET', `/api/public/orders/track?q=${order.orderNo}`);
  eq('按订单号查询 200', byOrderNo.status, 200);
  eq('命中 1 单', byOrderNo.json?.data?.orders?.length, 1);
  ok('联系方式已脱敏', !byOrderNo.json.data.orders[0].contact.includes('3493548230'), byOrderNo.json.data.orders[0].contact);

  /* 状态流转：paid → doing → done；paid 不能回退 wait */
  const illegal = await call('PATCH', `/api/admin/orders/${order.orderNo}/status`, { token, body: { status: 'wait' } });
  eq('已付款订单不能回退 wait 400', illegal.status, 400);
  ok('错误码 INVALID_TRANSITION', illegal.json?.error?.code === 'INVALID_TRANSITION', illegal.json?.error?.code);

  const toDoing = await call('PATCH', `/api/admin/orders/${order.orderNo}/status`, { token, body: { status: 'doing' } });
  eq('开始剪辑 200', toDoing.status, 200);
  const toDone = await call('PATCH', `/api/admin/orders/${order.orderNo}/status`, { token, body: { status: 'done' } });
  eq('标记交付 200', toDone.status, 200);
  ok('记录交付时间', !!toDone.json?.data?.order?.deliveredAt);
  eq('进度 step=3', toDone.json?.data?.order?.step, 3);

  const notePatch = await call('PATCH', `/api/admin/orders/${order.orderNo}`, { token, body: { adminNote: '客户已确认配乐' } });
  eq('写入内部备注 200', notePatch.status, 200);
  eq('备注已保存', notePatch.json?.data?.order?.adminNote, '客户已确认配乐');

  const logs = await call('GET', `/api/admin/orders/${order.orderNo}`, { token });
  ok('有流转日志', (logs.json?.data?.order?.logs?.length || 0) >= 3, String(logs.json?.data?.order?.logs?.length));

  /* 统计 */
  const stats = await call('GET', '/api/admin/stats', { token });
  eq('统计 200', stats.status, 200);
  ok('完成单数 ≥1', stats.json?.data?.byStatus?.done?.count >= 1);
  ok('今日单数 ≥1', stats.json?.data?.today?.count >= 1);
  ok('统计含全部状态', Object.keys(stats.json.data.byStatus).length === 5);

  /* CSV */
  const csv = await call('GET', '/api/admin/orders-export.csv', { token });
  eq('导出 200', csv.status, 200);
  ok('CSV 含中文表头', csv.text.includes('订单号') && csv.text.includes('应付合计'));
  ok('CSV 含该订单', csv.text.includes(order.orderNo));
  // BOM 必须按字节校验：fetch 的 text() 解码时会自动吃掉 BOM
  const csvBytes = new Uint8Array(await (await fetch(BASE + '/api/admin/orders-export.csv', { headers: { authorization: 'Bearer ' + token } })).arrayBuffer());
  ok('CSV 带 UTF-8 BOM（Excel 不乱码）', csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
    `前 3 字节 ${csvBytes[0]},${csvBytes[1]},${csvBytes[2]}`);
  ok('CSV content-type 正确', (await fetch(BASE + '/api/admin/orders-export.csv', { headers: { authorization: 'Bearer ' + token } })).headers.get('content-type')?.includes('text/csv'));

  /* 删除：复用限流测试里已创建的待核对 → 核对生成订单 → 删除 */
  const delClaimNo = claimNos[0];
  ok('删除测试有待核对编号', !!delClaimNo, String(delClaimNo));
  const confirm2 = await call('POST', `/api/admin/payment-claims/${delClaimNo}/confirm`, { token, body: {} });
  const no2 = confirm2.json?.data?.order?.orderNo || '';
  ok('删除测试有目标订单', !!no2, String(no2));
  const del = await call('DELETE', `/api/admin/orders/${no2}`, { token });
  eq('删除订单 200', del.status, 200);
  const gone = await call('GET', `/api/public/orders/${no2}`);
  eq('删除后查询 404', gone.status, 404);

  /* ---------- 账号管理 ---------- */
  section('7. 后台账号管理');
  const accounts = await call('GET', '/api/admin/accounts', { token });
  eq('账号列表 200', accounts.status, 200);
  ok('至少一个管理员', (accounts.json?.data?.accounts?.length || 0) >= 1);
  ok('默认管理员角色为 admin', accounts.json.data.accounts.some((a) => a.username === 'admin' && a.role === 'admin'));

  const weakPwd = await call('POST', '/api/admin/accounts', { token, body: { username: 'op1', password: '123' } });
  eq('弱密码被拒 400', weakPwd.status, 400);
  ok('错误码 TOO_SHORT', weakPwd.json?.error?.code === 'TOO_SHORT', weakPwd.json?.error?.code);

  const badName = await call('POST', '/api/admin/accounts', { token, body: { username: '张三', password: 'xicheng@2026' } });
  eq('非法账号名被拒 400', badName.status, 400);
  ok('错误码 INVALID_USERNAME', badName.json?.error?.code === 'INVALID_USERNAME', badName.json?.error?.code);

  const newOp = await call('POST', '/api/admin/accounts', { token, body: { username: 'operator1', password: 'op12345678', displayName: '剪辑师小王', role: 'operator' } });
  eq('新建 operator 账号 200', newOp.status, 200);
  const opId = newOp.json?.data?.account?.id;
  eq('角色正确', newOp.json?.data?.account?.role, 'operator');
  eq('显示名正确', newOp.json?.data?.account?.displayName, '剪辑师小王');

  const dup = await call('POST', '/api/admin/accounts', { token, body: { username: 'operator1', password: 'op12345678' } });
  eq('重复账号名被拒 400', dup.status, 400);
  ok('错误码 USERNAME_TAKEN', dup.json?.error?.code === 'USERNAME_TAKEN', dup.json?.error?.code);

  const opLogin = await loginAs('operator1', 'op12345678');
  eq('新账号可登录', opLogin.status, 200);
  const opToken = opLogin.json?.data?.token;

  const opListOrders = await call('GET', '/api/admin/orders?pageSize=1', { token: opToken });
  eq('operator 可看订单', opListOrders.status, 200);
  const opManage = await call('GET', '/api/admin/accounts', { token: opToken });
  eq('operator 无权管理账号 403', opManage.status, 403);

  const disable = await call('PATCH', `/api/admin/accounts/${opId}`, { token, body: { enabled: false } });
  eq('停用账号 200', disable.status, 200);
  eq('账号已停用', disable.json?.data?.account?.enabled, false);
  const opAfterDisable = await loginAs('operator1', 'op12345678');
  eq('停用后无法登录 400', opAfterDisable.status, 400);

  const reEnable = await call('PATCH', `/api/admin/accounts/${opId}`, { token, body: { enabled: true, displayName: '剪辑师小李' } });
  eq('重新启用 200', reEnable.status, 200);
  eq('显示名已更新', reEnable.json?.data?.account?.displayName, '剪辑师小李');

  const myId = accounts.json.data.accounts.find((a) => a.username === 'admin').id;
  const selfDisable = await call('PATCH', `/api/admin/accounts/${myId}`, { token, body: { enabled: false } });
  eq('不能停用自己 400', selfDisable.status, 400);
  ok('错误码 CANNOT_DISABLE_SELF', selfDisable.json?.error?.code === 'CANNOT_DISABLE_SELF', selfDisable.json?.error?.code);

  /* 改密码 */
  const wrongOld = await call('PATCH', '/api/admin/password', { token, body: { currentPassword: 'wrong', newPassword: 'newpass12345' } });
  eq('原密码错误被拒 400', wrongOld.status, 400);
  ok('错误码 BAD_CREDENTIALS', wrongOld.json?.error?.code === 'BAD_CREDENTIALS', wrongOld.json?.error?.code);

  const samePwd = await call('PATCH', '/api/admin/password', { token, body: { currentPassword: 'xicheng@2026', newPassword: 'xicheng@2026' } });
  eq('新旧密码相同被拒 400', samePwd.status, 400);

  const changed = await call('PATCH', '/api/admin/password', { token, body: { currentPassword: 'xicheng@2026', newPassword: 'xicheng@2027' } });
  eq('改密码成功 200', changed.status, 200);
  const oldLogin = await loginAs('admin', 'xicheng@2026');
  eq('旧密码失效 400', oldLogin.status, 400);
  const newLogin = await loginAs('admin', 'xicheng@2027');
  eq('新密码可登录', newLogin.status, 200);
  const newToken = newLogin.json?.data?.token;
  const stillValid = await call('GET', '/api/admin/me', { token });
  eq('改密后当前会话保留', stillValid.status, 200);

  /* 恢复默认密码，便于重复跑测试 */
  const restore = await call('PATCH', '/api/admin/password', { token: newToken, body: { currentPassword: 'xicheng@2027', newPassword: 'xicheng@2026' } });
  eq('密码已恢复为默认（便于复测）', restore.status, 200);

  const delOp = await call('DELETE', `/api/admin/accounts/${opId}`, { token: newToken });
  eq('删除账号 200', delOp.status, 200);

  /* ---------- 静态页面 ---------- */
  section('8. 页面托管');
  const page = await fetch(BASE + '/');
  const html = await page.text();
  eq('首页 200', page.status, 200);
  ok('返回设计稿页面', html.includes('XiCheng') && html.includes('三组收费'));
  ok('已注入 API 桥接脚本', html.includes('/api-bridge.js'));
  const adminPage = await fetch(BASE + '/admin');
  eq('后台页 200', adminPage.status, 200);
  ok('后台页含登录表单', (await adminPage.text()).includes('订单管理后台'));
  const logo = await fetch(BASE + '/log.jpg');
  eq('logo 可访问', logo.status, 200);

  /* ---------- 汇总 ---------- */
  console.log(`\n${'='.repeat(52)}`);
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('全部通过 ✓');
}

main().catch((e) => {
  console.error('\n冒烟测试异常终止：', e);
  process.exit(1);
});
