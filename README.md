# XiCheng · 游戏剪辑自助下单平台

三角洲行动 / 无畏契约 / CS2 高光集锦剪辑的自助下单平台：客户在线选规格、实时计价、扫码付款、上传付款截图，系统 OCR 自动核对（单号 + 金额）后自动生成订单，剪辑师后台接单交付。

> 技术栈：**原生 HTML/CSS/JS 前端（零构建）＋ Fastify 5 后端（Node ≥20, ESM）＋ MySQL 8.4＋ tesseract.js OCR**，单体同源托管，无框架、无打包器。

---

## 目录结构

```
Self-service ordering platform/
├── design/                   前台页面（三版并存，见下表）
│   ├── index.html            霓虹青/品红版（定稿 + 第二轮视觉升级）
│   ├── index-v2.html         黑金版（全新设计 · 纯黑金 · 细金描边）← 推荐
│   ├── index.backup.html     最初定稿原版（备份）
│   ├── log.jpg               站点 logo / favicon
│   └── pay-*.png             微信/支付宝收款码
├── server/                   后端（详细文档见 server/README.md）
│   ├── src/                  Fastify 应用：路由 / 服务 / 双驱动数据库 / OCR / 限流
│   ├── public/               管理后台 admin.html + api-bridge.js 桥接层
│   ├── sql/schema.sql        建表脚本（orders / payment_claims / admins 等 8 表）
│   ├── tessdata/             OCR 离线语言包
│   ├── test/smoke.js         接口冒烟测试（125 项）
│   └── scripts/start.cmd     一键启动（检查 MySQL 服务 → 启动后端）
└── 1.md                      收费标准原始文档
```

## 前台页面三版对照

| 文件 | 风格 | 状态 |
|---|---|---|
| `design/index-v2.html` | **黑金 · 产品级质感**（纯黑金、金色降频、细金描边、电竞数字字体） | 最新推荐版 |
| `design/index.html` | 暗场霓虹青/品红 + 第二轮升级（水印/流光/数字滚动） | 历史版 |
| `design/index.backup.html` | 最初定稿原版 | 备份 |

三版共用同一份 JS 业务逻辑与 `api-bridge.js` 契约，可随时切换，互相独立。

## 快速启动

```bash
cd server
npm install
npm start          # 或 Windows 下运行 scripts\start.cmd（自动拉起 MySQL 服务）
```

| 地址 | 说明 |
|---|---|
| http://127.0.0.1:4500/ | 前台自助下单页 |
| http://127.0.0.1:4500/admin | 管理后台（默认 admin / xicheng@2026，首次启动自动创建） |
| http://127.0.0.1:4500/api/health | 健康检查 |

- 无 MySQL 也能跑：数据库连不上会自动降级为**内存驱动**（数据落盘 `server/data/memory-db.json`）
- 换前台页面版本：把对应文件复制为 `design/index.html` 即可

## 核心业务规则

- **先付后剪**：付款截图 OCR 核对（转账单号唯一 + 金额容差 ±1 元）通过后自动生成订单
- 三角洲：普通/特效集锦 15/30 元每分钟；无畏契约/CS2：单回合 9.9、普通/特效/卡点 15/20/60 元每分钟
- 每加一分钟 +12 元；超分服务 +15 解锁 4K；付款后 48h 内交付
- 改价格只改 `server/src/domain/catalog.js`

详细说明（部署 / API / 状态机 / OCR 核验 / 收款码替换）见 **[server/README.md](server/README.md)**。