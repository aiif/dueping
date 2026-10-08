# dueping — 超轻量合同到期提醒应用

`dueping` 是一个为个人与小团队设计的超轻量合同到期提醒 Web 应用。只需录入合同与到期日，系统会在到期前按配置的天数档位（默认 30、15、7 天）自动发送中文提醒邮件，提醒及时联系甲方确认**“是否续签、款项是否结清”**。

正式部署入口：**https://dueping.toreal.site**

---

## 1. 架构与设计原则

- **极简无过度设计**：零状态管理库、零 UI 组件库。
- **纯 Cloudflare 原生技术栈**：
  - **计算**：Cloudflare Workers (TypeScript + Hono)
  - **静态资源**：Workers Static Assets (SPA)
  - **数据库**：Cloudflare D1 (纯 SQLite，无 KV)
  - **定时任务**：Cron Triggers (`0 * * * *`，整点调度)
  - **邮件发送**：Cloudflare Email Service Workers 绑定 (`EMAIL`)
  - **智能识别**：支持手机拍照 / 图片上传通过多模态 AI 智能提取合同关键信息并自动回填
  - **前端**：React 19 + Vite 8 + Tailwind CSS v4 + wouter 路由 + 原生 fetch 轻量封装
  - **工程**：单仓库一体化构建（`@cloudflare/vite-plugin`）

---

## 2. 快速上手与命令

### 2.1 安装依赖
```bash
npm install
```

### 2.2 本地数据库迁移
应用本地 D1 数据库迁移（存储于本地 `.wrangler/state/v3/d1`）：
```bash
npm run db:local
```

### 2.3 本地开发运行
启动 Vite 前端与 Worker 开发服务器：
```bash
npm run dev
```
> **注意**：本地开发环境下，Cloudflare Email Service 默认模拟发信（不会向外网真实投递邮件，相关验证码与提醒邮件详情会直接输出在控制台终端日志中）。

### 2.4 代码类型检查与单元测试
```bash
# 全局类型检查（同时覆盖 client、worker 与 tools）
npm run typecheck

# 单元测试（使用 Vitest 覆盖 9 项核心测试用例）
npm run test
```

### 2.5 生产构建与本地 Smoke 验证
```bash
# 生产构建（输出至 dist/dueping 与 dist/client）
npm run build

# 运行完整自动化冒烟测试（端到端验证构建产物）
npm run smoke
```

### 2.6 远端部署
```bash
# 1. 首次部署或表结构变更时，对远端 D1 应用迁移
npm run db:remote

# 2. 构建并部署 Worker 与静态资源
npm run deploy
```

---

## 3. 真实发信测试步骤（上线后）

发信域名 `dueping.toreal.site` 已在 Cloudflare 控制台 Email Service 中完成 Onboard 配置（发件地址：`noreply@dueping.toreal.site`）。

在正式上线部署后，使用您自己的邮箱进行端到端真实发信验证的步骤如下：

1. **访问线上地址**：在浏览器打开 [https://dueping.toreal.site](https://dueping.toreal.site)。
2. **邮箱验证码登录**：
   - 输入您个人的真实邮箱，点击“获取验证码”。
   - 查看您的个人邮箱收件箱（或垃圾箱），获取 6 位数字验证码。
   - 输入验证码完成无密码登录（首次使用将自动注册账户）。
3. **进入提醒设置**：
   - 点击顶部导航栏的“**提醒设置**”（`/settings`）。
4. **触发测试邮件**：
   - 找到“**发送测试邮件**”卡片，点击“**向我发送一封测试邮件**”按钮。
   - 系统将通过 Cloudflare Email Service 向当前登录邮箱发送一封测试提醒邮件（单用户每小时频控限流 3 次）。
   - 检查您的收件箱，确认邮件主题、正文格式及发件人 `dueping <noreply@dueping.toreal.site>` 送达正常。

---

## 4. 数据模型与设计说明

数据库 schema 位于 `migrations/0001_init.sql`，严格遵循 SPEC 规格定义：

1. **`users`**：
   - `id TEXT PRIMARY KEY`
   - `email TEXT UNIQUE NOT NULL`
   - `reminder_days TEXT NOT NULL DEFAULT '[30,15,7]'`
   - `send_hour INTEGER NOT NULL DEFAULT 9`
   - `timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai'`
   - `ai_api_key TEXT DEFAULT NULL`（迁移 0002：可选自定义大模型密钥）
   - `ai_base_url TEXT DEFAULT NULL`（迁移 0002：可选自定义大模型 Base URL）
   - `ai_model TEXT DEFAULT NULL`（迁移 0002：可选自定义视觉模型名称）
   - `created_at TEXT NOT NULL`
   - *设计理由*：`reminder_days` 存为标准 JSON 整数数组；时区存为 IANA 时区标识符（如 `Asia/Shanghai`）；AI 配置支持用户私有模型扩展，未配置时自动回退系统默认/演示模式。
2. **`sessions`**：
   - `token_hash TEXT PRIMARY KEY`
   - `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `expires_at TEXT NOT NULL`
   - *设计理由*：前端 Cookie 中存储 32 字节高强度随机 Token，数据库仅持久化其 SHA-256 哈希值，保障 Cookie 泄露时数据库凭证不逆向。
3. **`otp_codes`**：
   - `id TEXT PRIMARY KEY`
   - `email TEXT NOT NULL`
   - `salt TEXT NOT NULL`
   - `code_hash TEXT NOT NULL`
   - `expires_at TEXT NOT NULL`
   - `attempts INTEGER NOT NULL DEFAULT 0`
   - `created_at TEXT NOT NULL`
   - *设计理由*：加盐 SHA-256 存储 6 位验证码，10 分钟有效期，最大尝试 5 次，比对采用恒定时间（Constant-Time）防时序攻击。
4. **`contracts`**：
   - `id TEXT PRIMARY KEY`
   - `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `name TEXT NOT NULL`
   - `client TEXT NOT NULL`
   - `start_date TEXT`
   - `end_date TEXT NOT NULL`
   - `amount REAL`
   - `note TEXT`
   - `status TEXT NOT NULL DEFAULT 'active'`
   - `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`
   - *设计理由*：所有增删改查强制 `WHERE user_id = ?`，越权访问一律返回 HTTP 404；日期统一存 `YYYY-MM-DD` 纯字符串。
5. **`reminders_sent`**：
   - `contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE`
   - `tier INTEGER NOT NULL`
   - `end_date TEXT NOT NULL`
   - `sent_at TEXT NOT NULL`
   - `PRIMARY KEY(contract_id, tier, end_date)`
   - *设计理由*：联合主键严格保证同一合同在同一到期日下每个提醒档位只发一次；修改到期日或续签重置时级联清空。
6. **`rate_limits`**：
   - `key TEXT NOT NULL`
   - `window_start INTEGER NOT NULL`
   - `count INTEGER NOT NULL`
   - `PRIMARY KEY(key, window_start)`
   - *设计理由*：统一滑动/固定时间窗口计数，覆盖 60s 冷却、邮箱/IP 小时频控及测试邮件限制。

---

## 5. 核心逻辑与算法保障

- **日历日无漂移计算**：
  不采用粗暴的毫秒除以 86400000，使用 `Date.UTC(y, m - 1, d)` 拆分纯日历天数差，杜绝夏令时切换产生的 1 小时误差。
- **阶梯提醒与多档收敛**：
  `tier = min(x in reminder_days where days_left <= x)`。当合同临近或跳档时，仅取最紧档位，同一到期日同一档位绝不重复。
- **时区感知的整点门控与补发**：
  `0 * * * *` Cron 每小时运行。使用用户配置的时区计算其本地日期与当前小时；当本地小时 `current_hour >= send_hour` 触发检查。使用 `>=` 确保即使某整点调度波动，当天后续小时也会自动补发。
- **汇总邮件与写前保障**：
  同一用户多份到期合同合并为一封中文汇总邮件，并在邮件标题标明最紧迫剩余天数；必须在邮件发送成功后才批量写入 `reminders_sent`，发信失败不会被标记为已发送。
- **自动垃圾清理**：
  每小时定时任务顺带清理过期的 OTP 验证码、过期会话以及历史限流记录，保持 D1 存储清爽。

---

## 6. 已知限制与假设

1. **时区解析支持**：
   依赖 JavaScript 标准 `Intl.DateTimeFormat` 进行 IANA 时区解析（Cloudflare Workers 运行时完整支持）。若用户填写无效时区，前端与后端校验均会拒绝。
2. **Cron 触发频率**：
   Cloudflare Workers Cron 触发器最小调度粒度为分钟级，本项目配置为每小时整点（`0 * * * *`）。因此每天提醒的实际发送时间将在到达 `send_hour` 后的首个整点（通常为该小时整点 0 分）。
3. **发件服务配额与频控**：
   Cloudflare Email Service 处于公测期，发信行为受 Cloudflare 平台日限额及反垃圾邮件信誉保护。应用内对 OTP 申请、测试邮件及定时调度均已实施严密限流防护。
4. **多设备会话管理**：
   用户每次在不同设备通过验证码登录会生成独立的会话 Token，各自保持 30 天有效；在任一设备点击“退出登录”仅清除当前设备会话。
