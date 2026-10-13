# XiCheng 下单平台 · 后端

游戏剪辑自助下单平台的 API 服务，同时托管前台页面与管理后台。

- 技术栈：**Node.js + 原生 JavaScript(ESM) + Fastify + MySQL**
- 无构建步骤，改完代码重启即生效
- 数据库不可用时**自动降级为内存驱动**，本地没有 MySQL 也能先把流程跑通

---

## 零、本机现状（已装好，可直接用）

数据库是本机 **MySQL 8.4.11**，已注册为 Windows 服务，**开机自动启动**：

| 项目 | 值 |
|---|---|
| 版本 | MySQL 8.4.11（LTS） |
| Windows 服务 | `MySQL84`（启动类型：自动） |
| 安装目录 | `C:\Program Files\MySQL\MySQL Server 8.4` |
| 配置文件 | `C:\ProgramData\MySQL\MySQL Server 8.4\my.ini` |
| 监听 | `127.0.0.1:3306` |
| 数据库 | `xicheng_ordering`（utf8mb4 / utf8mb4_0900_ai_ci，8 张表） |
| 应用账号 | `xicheng`（只有该库的增删改查权限）/ 密码在 `server/.env` |
| root 账号 | 仅维护用，密码见 `server/.env` 的 `MYSQL_ROOT_PASSWORD` |

### 日常启动

```bat
server\scripts\start.cmd        :: 检查 MySQL 服务 → 启动后端
```

MySQL 是系统服务，**开机自启，平时不用管**。服务没起来时启动脚本会尝试拉起
（`net start MySQL84` 需要管理员权限；失败就手动到「服务」里启动）。

手动管理服务：

```bat
net start MySQL84        :: 需要管理员权限
net stop  MySQL84
sc query  MySQL84        :: 查看状态
```

> 之前装的便携版 MySQL（`C:\Users\Xiao\mysql-8.0.28`）已停用，
> 换成现在这个服务版之后不再需要，确认数据无误后可以删除该目录。

---
## 一、快速开始

```bash
cd server
npm install
npm start
```

启动后：

| 地址 | 说明 |
|---|---|
| http://127.0.0.1:4500/ | 前台自助下单页（即已定稿的设计稿，接了真实接口） |
| http://127.0.0.1:4500/admin | 订单管理后台（待核对付款 + 订单管理 + 账号设置） |
| http://127.0.0.1:4500/api/health | 健康检查 |

默认管理员：**admin / xicheng@2026**（首次启动自动创建，登录后可在「账号设置」里修改）

> `npm start` 不加载 `.env`，会用默认配置并尝试连 MySQL；
> 连不上会自动降级为内存驱动（数据落盘到 `server/data/memory-db.json`）。
> 要走真实数据库请用 `scripts\start.cmd` 或 `node --env-file=.env src/server.js`。

---

## 二、从头安装 MySQL（换机器时参考）

### 方式 A：便携版（推荐，不需要管理员权限）

```powershell
# 1. 下载（阿里云镜像，约 212MB）
#    https://mirrors.aliyun.com/mysql/MySQL-8.0/mysql-8.4.x-winx64.zip
# 2. 解压到 C:\Users\<你>\mysql-8.4
# 3. 写一份 my.ini（参考本机那份，关键是 basedir / datadir / utf8mb4 / default-time-zone）
# 4. 初始化数据目录（root 空密码）
...\bin\mysqld.exe --defaults-file=...\my.ini --initialize-insecure --console
# 5. 启动
...\bin\mysqld.exe --defaults-file=...\my.ini
# 6. 设置 root 密码
...\bin\mysqladmin.exe -h 127.0.0.1 -u root --skip-password password 你的新密码
# 7. 建库建表
...\bin\mysql.exe -h 127.0.0.1 -u root -p < sql\schema.sql
```

### 方式 B：winget 安装（需要管理员权限）

```powershell
winget install Oracle.MySQL
```

安装向导选 Developer Default，记住 root 密码，然后执行 `sql/schema.sql`。

### 建库建表

后端启动时会自动创建数据库和表（`DB_AUTO_MIGRATE=true`）。
也可以手动执行：

```bash
mysql -u root -p < sql/schema.sql
```

`sql/schema.sql` 会创建：`orders`（订单）、`order_logs`（状态流转日志）、
`admins`（后台账号）、`admin_sessions`（登录会话）、
`customers`、`payment_claims`（待核对付款，下单的唯一入口）、
`credit_accounts` / `credit_transactions`（存单，预留）。

### 配置连接

```bash
cp .env.example .env
# 编辑 .env：填写 DB_USER / DB_PASSWORD
```

加载 `.env` 启动：

```bash
node --env-file=.env src/server.js
```

启动日志出现 `[db] 驱动：mysql` 即接库成功。

---

## 三、目录结构

```
server/
├── src/
│   ├── server.js              入口：Fastify 实例、统一返回/错误、静态托管、桥接注入
│   ├── config.js              配置（全部可用环境变量覆盖）
│   ├── db/
│   │   ├── index.js           驱动选择（mysql / memory，失败自动降级）
│   │   ├── mysql.js           MySQL 连接池、自动建表、迁移、仓储方法
│   │   └── memory.js          内存驱动（同一套方法签名）
│   ├── domain/
│   │   ├── catalog.js         价目表与计价规则（改价格只改这里）
│   │   └── order.js           订单状态机、订单号生成
│   ├── services/
│   │   ├── orderService.js    业务：订单查询、状态流转、登录、脱敏
│   │   └── claimService.js    待核对付款：提交、核对、驳回、OCR 自动转订单
│   ├── lib/
│   │   ├── util.js            校验/散列/限流
│   │   └── ocr.js             付款截图 OCR（tesseract.js，识别单号与金额）
│   ├── routes/public.js       公开接口
│   ├── routes/admin.js        管理后台接口
│   └── middleware/auth.js     Bearer Token 鉴权
├── public/
│   ├── admin.html             管理后台（单文件，无构建）
│   └── api-bridge.js          前台页面与后端的桥接层（注入到页面）
├── tessdata/eng.traineddata.gz  OCR 英文语言包（离线识别，避免每次启动联网下载）
├── uploads/                   付款截图存证（运行期生成）
├── scripts/
│   └── start.cmd              一键启动（检查 MySQL 服务 → 启动后端）
├── sql/schema.sql             建表脚本
├── test/smoke.js              接口冒烟测试
├── .env                       本机实际配置（含密码，已在 .gitignore 中）
└── .env.example               配置模板
```

前台页面在仓库根的 `design/` 目录，由后端直接托管：

```
design/
├── index.html                 前台页面（已定稿的设计稿，后端注入 api-bridge.js）
├── log.jpg                    站点 logo / favicon
├── pay-wechat.png             微信收款码
├── pay-alipay.png             支付宝收款码
└── pay-all.png                收款码原始合并图（备用）
```

服务端返回 `index.html` 时会注入 `api-bridge.js`，把页面里的本地存储调用换成真实接口 —— 设计稿本身一行都不用改。

---

## 四、测试

```bash
# 先启动服务，另开一个终端
npm run smoke
```

覆盖：站点配置、计价（含 4K 与超时长）、待核对付款提交与校验（转账单号格式 / 截图必填 /
重复单号拦截 / OCR 自动核验直接生成订单）、统一查询与脱敏、限流、后台登录鉴权、
核对到账转订单、状态流转合法性、统计、CSV 导出、账号管理与改密码、静态托管。

> 冒烟测试默认连的是运行中的服务；建议以 `OCR_MODE=off` 启动测试实例，
> 避免每条用例都跑真实 OCR（会慢 1~3 秒）。OCR 自动通过分支由服务层直测覆盖。

> 限流桶在服务进程内，连续跑多次冒烟测试可能触发限流；
> 测试脚本会自动等待窗口过期后重试。

输出示例：

```
通过 125 项，失败 0 项
全部通过 ✓
```

> 限流桶在服务进程内，连续跑多次冒烟测试可能触发限流；
> 测试脚本会自动等待窗口过期后重试。

---

## 五、API 一览

统一返回格式：

```json
{ "ok": true, "data": { ... }, "message": "可选提示" }
{ "ok": false, "error": { "code": "INVALID_CONTACT", "message": "联系方式格式不正确" } }
```

### 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/public/config` | 价目表 + 联系方式 + 平台规则 + 可选时长 |
| POST | `/api/public/quote` | 计价试算（与下单同一套逻辑） |
| POST | `/api/public/payment-claims` | **提交付款待核对（下单的唯一入口）**，multipart：转账单号 + 付款截图，OCR 自动核对，一致即自动生成订单 |
| GET | `/api/public/payment-claims/track?q=` | 按待核对编号或联系方式查询 |
| GET | `/api/public/track?q=` | 统一查询：`XCP-` 待核对 / `XC-` 订单 / 联系方式（脱敏） |
| GET | `/api/public/orders/track?q=` | 按订单号或联系方式查询（联系方式脱敏） |
| GET | `/api/public/orders/:orderNo` | 按订单号查询 |
| GET | `/api/public/games/:game/packages/:pkg/options` | 规格可选项 |
| GET | `/api/health` | 健康检查 |

> 已移除直接下单接口（`POST /api/public/orders`）：**没有付款就不会产生任何后台记录**。
> 客户在向导内扫码付款 → 付款完成后填写转账单号 + 上传付款截图 → 系统 OCR 自动核对（单号、金额一致）→
> 自动生成正式订单（`XC-`）；不一致或识别失败则转人工核对。

提交付款待核对（**multipart 表单**，不是 JSON）请求示例：

```
POST /api/public/payment-claims
Content-Type: multipart/form-data

game=valorant        pkg=v-fx        duration=3        up4k=true
contact=QQ 3493548230               payRef=WXTEST8888
payNo=4200001743202609301234567      ← 微信/支付宝账单里的交易单号（必填，10~64 位数字/字母，全局唯一）
payShot=<付款截图文件>               ← PNG/JPG/WebP，≤5MB（必填，OCR 识别单号与金额）
music=self          material=ready
link=https://music.163.com/xxx      note=卡点 + 击杀集锦，偏电影感调色
```

后端自动核验规则：
- **单号一致**：截图 OCR 识别出的某串 == 客户填写的转账单号，或截图里某个 ≥10 位的串完整包含填写单号（不做模糊容差——差一位也视为不符，转人工复核）
- **金额一致**：截图 OCR 识别出的金额 ≈ 系统算出的应付金额（容差 ±1 元）
- 两条都满足 → 待核对直接 `confirmed`，**自动生成 `XC-` 正式订单（paid）继续下单**
- 任一不满足 / OCR 无法识别 → 保持 `pending`，转后台人工复核（列表展示 OCR 摘要与截图）

`pay_no` 建了 **UNIQUE 唯一索引**：同一笔转账单号只能下一次单，防一图多用 / 单号复用。

### OCR 开关（测试用）

| 环境变量 | 值 | 说明 |
|---|---|---|
| `OCR_MODE` | `auto`（默认） | 生产模式，提交付款即 OCR 自动核对 |
| `OCR_MODE` | `off` | 跳过 OCR，全部转人工核对（仅供测试/调试，生产环境不推荐） |

语言包在 `server/tessdata/eng.traineddata.gz`（离线，首次识别自动解压）。
`payRef` 是客户付款时在转账备注里写的号，剪辑师在后台按它对账（必填，至少 4 位）。

### 管理接口（需 `Authorization: Bearer <token>`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/login` | 登录，返回 token |
| POST | `/api/admin/logout` | 退出 |
| GET | `/api/admin/me` | 当前账号 |
| GET | `/api/admin/orders` | 订单列表（`status` / `game` / `keyword` / `page` / `pageSize`） |
| GET | `/api/admin/orders/:orderNo` | 订单详情（含流转日志） |
| PATCH | `/api/admin/orders/:orderNo/status` | 状态流转 |
| PATCH | `/api/admin/orders/:orderNo` | 改内部备注 / 已付金额 / 剪辑要求 |
| DELETE | `/api/admin/orders/:orderNo` | 删除订单 |
| GET | `/api/admin/stats` | 各状态单量与金额、今日、超时未交付 |
| GET | `/api/admin/orders-export.csv` | 导出 CSV（带 BOM，Excel 中文不乱码） |
| GET | `/api/admin/meta` | 状态与分组字典 |
| GET | `/api/admin/payment-claims` | 待核对付款列表（`status` / `keyword` / `page` / `pageSize`） |
| POST | `/api/admin/payment-claims/:claimNo/confirm` | 核对到账 → 生成正式订单（`XC-`） |
| POST | `/api/admin/payment-claims/:claimNo/reject` | 驳回（记录原因） |

---

## 六、计费规则（与 1.md 一致）

| 分组 | 规格 | 价格 |
|---|---|---|
| 三角洲行动 | 普通集锦 / 特效集锦 | 15 / 30 元每分钟 |
| 无畏契约 / CS2 | 单回合 | 9.9 元每回合 |
| 无畏契约 / CS2 | 普通集锦 / 特效集锦 / 卡点剪辑 | 15 / 20 / 60 元每分钟 |
| 其他游戏 | — | 不列价格，联系剪辑师 |

- 名义单价按**基准 1 分钟（或 1 回合）**计
- 超出部分：**每加一分钟 +12 元**
- **超分服务 +15** 解锁 4K
- 付款到账后 **48 小时内**交付（写入 `due_at`）

改价格只需改 `src/domain/catalog.js`，接口与前台展示会同步变化。

---

## 七、订单状态流转

```
wait 待确认付款 ──▶ paid 已付款 ──▶ doing 剪辑中 ──▶ done 已完成
   │                  │                │
   └──────────────────┴────────────────┴──▶ canceled 已取消
```

- 订单由「核对到账」生成（后台 `待核对付款` → 确认），**初始状态即 `paid`**；
  `wait` 仅历史兼容（早期直接下单模式遗留），新流程不会产生 `wait` 订单
- 非法流转会被拒绝（如 `paid` 回退 `wait`）
- 每次流转写入 `order_logs`（操作人 + 备注）
- 标记 `paid` 时自动写入付款时间、已付金额与承诺交付时间

---

## 八、部署提醒

1. **改默认密码**：`ADMIN_PASSWORD`，或登录后另建账号
2. **`HOST=0.0.0.0`** 才能被外网访问，同时前面建议挂 Nginx 并配 HTTPS
3. **限流是进程内的**，多实例部署时请改用 Redis 或网关层限流
4. **备份**：`mysqldump -u root -p xicheng_ordering > backup.sql`
5. 生产建议 `NODE_ENV=production`、`DB_AUTO_MIGRATE=false`（改用手动执行 schema）

### Nginx 反代示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:4500;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 九、后台账号与权限

| 角色 | 能做什么 |
|---|---|
| `admin`（超级管理员） | 订单管理 + 账号管理（新建/停用/重置密码/删除账号） |
| `operator`（剪辑师） | 只能查看与流转订单，看不到账号管理 |

- 登录后点顶栏 **账号设置** 可改自己的密码（需原密码，改完其它设备登录失效）
- 系统会阻止把最后一个可用的超级管理员停用或删除
- 不能停用/降权/删除当前登录的账号

---

## 十、收款码（付款方式）

**收款码只在下单流程内展示**：客户点「立即下单」，走到向导第 4 步（扫码付款）才会看到微信/支付宝收款码与实时金额；主界面（首页）不展示任何收款码或付款区块。

| 文件 | 说明 |
|---|---|
| `design/pay-wechat.png` | 微信收款码（向导第 4 步与放大层共用） |
| `design/pay-alipay.png` | 支付宝收款码 |
| `design/pay-all.png` | 原始合并图（备用，页面未引用） |

**换成自己的收款码**：直接替换上面两个 png（保持文件名不变）即可，前台立即可见。
也可以在 `src/domain/catalog.js` 的 `PAYMENT` 里改图片路径与文案：

```js
export const PAYMENT = {
  wechatQr: '/pay-wechat.png',
  alipayQr: '/pay-alipay.png',
  wechatName: 'xichen(**权)',
  alipayName: '肖**权',
  steps: ['扫码支付对应金额…', '付款时在备注里写上订单号…', '付完把付款截图发给剪辑师…'],
  note: '先付后剪：付款到账后才开始剪辑。存单/预存也请先联系剪辑师。',
};
```

页面上的付款引导：

- 向导第 4 步显示 **实时金额 + 收款码 + 放大查看**（方便手机长按识别）
- 第 3 步填写的**付款备注**（`payRef`）会同步展示在付款步骤，提示客户转账备注里写同一串号
- 查询待核对记录时，未核对的显示「再付款/查看收款码」，点击回到向导第 4 步

> 当前是**转账单号 + 付款截图自动核验**模式：客户在向导内扫码付款 → **付款完成后（第 4 步下方）**
> 填写转账单号并上传付款截图 → 系统 OCR 自动核对（单号、金额一致）→ 一致直接生成订单并开始剪辑；
> 不一致 / 识别失败转后台人工复核（点开截图与支付账单比对）。
> 这也是没有商户号时唯一可行的方式。

---

## 十一、后续可做

- 微信/支付宝商户号接入，实现付款自动回调置为 `paid`（可完全替代 OCR 核验）
- 存单/余额（表已建好，缺充值入口与下单抵扣；规则已确认：不设赠送）
- 素材上传（目前是填链接/发 QQ）
- 订单消息通知（企业微信 / 邮件）
- 便携版 MySQL 注册为系统服务（需管理员权限，可实现开机自启）
