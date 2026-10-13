/**
 * 单号+付款截图 OCR 核对流程演示（完整 HTTP 链路）
 *
 * 核对逻辑（routes/public.js + lib/ocr.js）：
 *   1. 客户填转账单号 payNo，上传付款截图 payShot
 *   2. OCR 从截图提取「数字/字母连续串」和「¥ 金额」
 *   3. 判定：单号一致（完全相同 或 ≥10 位长串包含填写单号）且 金额一致（|识别-应付| ≤ 1）
 *   4. 一致 → 自动生成正式订单（paid）；否则 → 待人工核对（pending）
 *
 * 三个场景：
 *   A  正确单号 + 正确截图 + 匹配金额规格  → 自动通过 → 生成订单
 *   B  错误单号 + 正确截图                 → 单号不符 → 转人工
 *   C  正确单号 + 金额不符的规格           → 金额不符 → 转人工
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:4598';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOT = path.join(HERE, 'sample-pay.png');
const RUN = String(Date.now()).slice(-8);

async function claim(fields) {
  const fd = new FormData();
  const all = {
    game: 'delta', pkg: 'd-normal', duration: 1, up4k: 'false', rush: 'false',
    contact: 'QQ 988776655',
    payRef: 'TEST' + RUN,
    music: '', material: 'ready', refLink: '', requirement: '',
    ...fields,
  };
  for (const [k, v] of Object.entries(all)) fd.append(k, String(v ?? ''));
  const buf = fs.readFileSync(SHOT);
  fd.append('payShot', new Blob([new Uint8Array(buf)], { type: 'image/png' }), 'pay.png');
  const res = await fetch(BASE + '/api/public/payment-claims', { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function show(name, r) {
  const c = r.json?.data?.claim;
  console.log(`  [HTTP ${r.status}] ${name}`);
  if (r.json?.error) { console.log(`    ✗ 被拒: ${r.json.error.code} — ${r.json.error.message}`); return null; }
  if (c) {
    console.log(`    ✓ 编号 ${c.claimNo}  状态 [${c.status}] ${c.statusLabel}`);
    console.log(`    ✓ OCR 备注: ${c.ocrNote || '(无)'}`);
    if (c.orderNo) console.log(`    → 🎉 自动生成订单 ${c.orderNo}（${c.status}）`);
    else console.log(`    → ⏳ 转人工核对（未生成订单）`);
  }
  return c ?? null;
}

const h = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
if (!h) { console.error('服务不可达：', BASE); process.exit(1); }
console.log('XiCheng 单号+截图 核对流程演示（完整 HTTP 链路）');
console.log('服务:', BASE, ' 测试截图:', path.basename(SHOT), '\n');

// 截图已知内容：单号 4200001743202609308888，金额 ¥15.00
// 用 delta·普通集锦 1分钟 = ¥15 使应付金额与截图一致
const COMBO = { game: 'delta', pkg: 'd-normal', duration: 1, up4k: 'false' };

console.log('── 场景 A：正确单号 + 正确截图 + 金额匹配（15元规格）→ 应自动通过 ──');
const ra = await claim({ ...COMBO, payNo: '4200001743202609308888' });
const ca = show('A', ra);

console.log('\n── 场景 B：错误单号 + 正确截图 → 应单号不符转人工 ──');
const rb = await claim({ ...COMBO, payNo: '12345678901234567890' });
show('B', rb);

console.log('\n── 场景 C：同一正确单号重复提交 → 应被 PAY_NO_USED 拒绝（防一图多用）──');
const rc = await claim({ ...COMBO, pkg: 'd-fx', payNo: '4200001743202609308888' });
show('C', rc);

console.log('\n── 场景 D：新单号（不在截图里）+ 30元特效规格 → 应单号+金额都不符 → 转人工 ──');
const rd = await claim({ ...COMBO, pkg: 'd-fx', payNo: '99000000000000000001' });
show('D', rd);

console.log('\n── 后台复核视角（admin 拉取这三条待核对的 OCR 判定）──');
const tok = await fetch(BASE + '/api/admin/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'test@2026' }),
}).then((r) => r.json()).catch(() => ({}));
if (tok.data?.token) {
  for (const [tag, c] of [['A', ca], ['C', rc]]) {
    if (!c) continue;
    const d = await fetch(`${BASE}/api/admin/payment-claims?status=pending&pageSize=50`, {
      headers: { authorization: 'Bearer ' + tok.data.token },
    }).then((x) => x.json()).catch(() => ({}));
    const row = (d.data?.rows || []).find((r) => r.claimNo === c.claimNo);
    if (row) console.log(`  ${tag} ${c.claimNo}  ocrOk=${row.ocrOk}  记录: ${row.ocrNote || '(无)'}`);
  }
} else {
  console.log('  (后台登录跳过)');
}

console.log('\n演示完成。');