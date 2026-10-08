# dueping — 合同到期提醒应用（规格）

## 目标与原则

个人/小团队使用的超轻量 Web 应用：录入合同与到期日，系统在到期前按配置的天数（默认 30/15/7 天）发邮件，提醒我联系甲方确认"是否续签、款项是否结清"。
原则：能少一个依赖就少一个，能少一张表就少一张表；不过度设计。前端用 React；依赖保持精简，不安装用不到的库（不要状态管理库、不要 UI 组件库）。

## 固定环境（不要替换）

- Mac 开发，wrangler 已登录；账户已订阅 Workers Paid；域名 toreal.site 由该账户管理
- 正式入口：https://dueping.toreal.site（Workers Custom Domain，用 wrangler 配置 routes + custom_domain，部署时自动建 DNS）。不要把 workers.dev 当正式入口。
- 栈：Cloudflare Workers + Workers Static Assets + D1（只用 D1，不用 KV）+ Cron Triggers；全部 TypeScript
- 后端：Hono；前端：React + Vite + Tailwind CSS，路由用 wouter，请求用原生 fetch 简单封装
- 工程：单仓库单项目，使用 @cloudflare/vite-plugin（Vite 前端与 Worker 一体构建）。写配置前必须先读官方文档（Vite + React on Workers）并以文档为准。目录：src/client（前端）、src/worker（后端与 Cron）、src/shared（共享类型与校验）
- 路由：前端为 SPA（未命中静态资源时回退到 index.html）；/api/\* 一律先走 Worker，具体配置项按官方文档
- 邮件：Cloudflare Email Service 的 Workers 绑定（binding 名 EMAIL，wrangler 里的 send_email 配置）。它是公测功能，写代码前必须先读官方文档并以文档为准：
  - https://developers.cloudflare.com/email-service/get-started/send-emails/
  - https://developers.cloudflare.com/email-service/local-development/sending/
- 发件地址放 wrangler vars：FROM_ADDRESS = "noreply@dueping.toreal.site"，发件名 "dueping"
- 本地 wrangler dev 默认模拟邮件（只打印到控制台），不要默认开 remote: true

## 功能

1. 邮箱验证码登录（无密码，首次自动注册）
   - 邮箱统一转小写；对"邮箱是否已注册"不做区分（防枚举）
   - 6 位验证码用 crypto.getRandomValues 生成；库里只存加盐哈希；10 分钟过期；一次性；单个验证码最多尝试 5 次；比较用常量时间
   - 限流（用 D1 的 rate_limits 表）：同邮箱 60 秒冷却、每小时 ≤5 次；同 IP 每小时 ≤20 次
   - 会话：32 字节随机 token，库里存其哈希；HttpOnly + SameSite=Lax Cookie，HTTPS 下加 Secure；30 天过期；提供退出登录
   - 所有写接口校验 Origin/Content-Type: application/json（基础 CSRF 防护）
2. 合同管理（数据按用户隔离，所有 SQL 必须带 user_id 条件，越权访问返回 404）
   - 字段：名称、甲方、起始日（可选）、到期日、金额（可选）、备注（可选）、状态（进行中/已续签/已终止）
   - 增删改查；列表默认按到期日升序；≤ 最大提醒档位的合同高亮；已过期但仍"进行中"的合同标红
   - 标记"已续签"时必须填新到期日，并清空该合同的 reminders_sent；修改到期日同样清空
3. 可配置的提醒（每个用户一份，存在 users 表）
   - reminder_days：整数数组，每项 1–365，去重，1–6 项，默认 [30,15,7]
   - send_hour：0–23，默认 9
   - timezone：IANA 时区，默认 Asia/Shanghai，用 Intl.DateTimeFormat 校验
   - 设置页：可修改以上三项；并提供"向我发送一封测试邮件"按钮（限流：每小时 3 次）
4. 页面（React 组件）：登录页、合同列表（含新增/编辑弹窗）、设置页；手机端可用即可；表单有加载中/错误提示；未登录访问任何页面都跳转登录页

## 提醒算法

- Cron：`0 * * * *`（每小时整点，UTC）
- 对每个用户：用其 timezone 取本地"今天"和"当前小时"；仅当本地小时 ≥ send_hour 才处理（用 ≥ 而非 ==：当天失败的邮件会在后续每小时自动重试，也容忍 Cron 偶发漏跑）
- 对该用户每个"进行中"的合同：days_left = 到期日 − 本地今天（按日历日做纯日期运算，不要用毫秒数除以 86400000）；days_left < 0 则跳过
- 档位：tier = reminder_days 中满足 days_left ≤ x 的最小 x；没有则跳过。若 reminders_sent 中没有 (contract_id, tier, end_date)，则加入待发送
- 同一用户一次扫描的多条提醒合并成一封汇总邮件；主题体现最紧迫的剩余天数；邮件为中文，列出合同名、甲方、到期日、剩余天数、金额，并明确写"请联系甲方确认：是否续签？款项是否已结清？"；HTML 邮件必须对用户输入做转义，同时带 text 版本
- 发送成功后才批量写 reminders_sent；单个用户失败只记日志，不影响其他用户
- 扫描时顺带清理过期的验证码、会话、限流记录

## 数据模型（可微调，需在最终说明里写理由）

users(id, email UNIQUE, reminder_days TEXT DEFAULT '[30,15,7]', send_hour INTEGER DEFAULT 9, timezone TEXT DEFAULT 'Asia/Shanghai', created_at)
sessions(token_hash PK, user_id, expires_at)
otp_codes(id, email, salt, code_hash, expires_at, attempts, created_at)
contracts(id, user_id, name, client, start_date, end_date, amount, note, status, created_at, updated_at)
reminders_sent(contract_id, tier, end_date, sent_at, PRIMARY KEY(contract_id, tier, end_date))
rate_limits(key, window_start, count, PRIMARY KEY(key, window_start))
日期统一存 YYYY-MM-DD 字符串；迁移文件放 migrations/。

## 质量要求

- 纯逻辑（日期差、档位选择、设置校验、验证码校验）抽成独立模块，用 vitest 写单元测试，至少覆盖：新建合同时已进入某档位、一次跨多档只取最紧的、修改到期日后重新提醒、重复扫描不重复发送、send_hour 门控与失败重试、时区边界、设置校验、验证码过期/超次数、用户 A 无法读写用户 B 的合同
- package.json 提供 scripts：dev、build、typecheck（同时覆盖 client 与 worker）、test、deploy（先 build 再 wrangler deploy）、smoke
- scripts/smoke.sh：对本地服务跑完整流程（请求验证码 → 从控制台日志取码登录 → 建合同 → 改设置 → 触发 scheduled → 日志中出现提醒邮件 → 再触发一次确认不重复 → 另一用户越权访问被拒）
- 本地触发 scheduled 处理器的方式以官方文档为准（`wrangler dev --test-scheduled`，或使用 /cdn-cgi/handler/scheduled 之类的文档化入口）；smoke 对 build 产物起的本地服务运行，避免开发服务器差异
- 不得把任何密钥、数据库 ID 以外的敏感信息写进仓库；.gitignore 含 node_modules、.wrangler、.dev.vars；git init 并提交

## README（必须包含）

- 本地开发、迁移、部署命令
- 我已在 Cloudflare 控制台 Email Service 里 Onboard 发信域名 dueping.toreal.site
- 部署后用我自己的邮箱做真实发信测试的步骤（登录 → 设置页点"发送测试邮件"）
- 已知限制与假设
