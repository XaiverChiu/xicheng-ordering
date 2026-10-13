/** 新 Vue 前端 /new 路由验收：页面、Vite 资源、同源 API、报价。 */
const BASE = process.argv[2] || 'http://127.0.0.1:4500';

function ok(name, condition, detail = '') {
  if (!condition) throw new Error(`${name}${detail ? ` → ${detail}` : ''}`);
  console.log(`  ✓ ${name}`);
}

const oldPage = await fetch(`${BASE}/`);
ok('旧首页仍可访问', oldPage.status === 200, String(oldPage.status));
const oldHtml = await oldPage.text();
ok('旧首页仍注入 api-bridge', oldHtml.includes('/api-bridge.js'));

const page = await fetch(`${BASE}/new/`);
ok('/new/ 返回 200', page.status === 200, String(page.status));
const html = await page.text();
ok('/new/ 使用 Vite base 路径', html.includes('/new/assets/'));
ok('/new/ 不注入旧 api-bridge', !html.includes('/api-bridge.js'));

const assetMatch = html.match(/\/new\/assets\/[^"']+\.(?:js|css)/g) || [];
ok('Vite JS/CSS 资源存在', assetMatch.length >= 2, assetMatch.join(', '));
for (const asset of [...new Set(assetMatch)]) {
  const response = await fetch(`${BASE}${asset}`);
  ok(`资源可访问 ${asset.split('/').pop()}`, response.status === 200, String(response.status));
}

const configRes = await fetch(`${BASE}/api/public/config`);
ok('新页面同源配置 API 200', configRes.status === 200, String(configRes.status));
const config = await configRes.json();
ok('配置含 3 个游戏', config?.data?.games?.length === 3, JSON.stringify(config?.data?.games?.length));

const quoteRes = await fetch(`${BASE}/api/public/quote`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ game: 'delta', pkg: 'd-fx', duration: 3, up4k: true }),
});
const quote = await quoteRes.json();
ok('新页面同源报价 API 200', quoteRes.status === 200, String(quoteRes.status));
ok('报价算法结果 129', quote?.data?.total === 129, String(quote?.data?.total));

console.log('新前端 /new 路由验收全部通过 ✓');
