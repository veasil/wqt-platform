# WQT 项目知识库

> 此文件由 Codex 自动维护。开发前必读。
> 每次修复 bug 后说"记录一下"即可自动追加踩坑记录。

---

## 项目简介

**《AI在5000天·伍力全开》伍力值计分系统**
一个儿童安全教育桌游的数字化计分平台。玩家（守望者）通过微信扫码/手机号登录，参与情境卡牌游戏，每次选择影响五维属性值（安全力/脑波力/实感力/创心力/沟通力）。运营人员通过 admin-panel 管理卡牌内容、用户等级和活动场次。

---

## 技术栈

| 层 | 技术 | 启动方式 |
|----|------|----------|
| 后端 API | Node.js + Express (ESM) | `node server.js`（端口 8080）|
| 管理后台 | Python 3.12 + Streamlit | `streamlit run admin-panel/app.py` |
| 组织管理面板 | Vue 3 + Element Plus + Pinia | `cd enterprise-panel && npm run dev`（5173），生产走 `/enterprise/` |
| 前端 | 原生 HTML/CSS/JS | Express 静态托管 `public/` |
| 数据库 | SQLite × 2 | 自动初始化 |
| 对象存储 | 阿里云 OSS（香港区）| ali-oss SDK |
| 短信验证 | Bmob SMS | `src/bmob.js` |
| 认证 | JWT（7天有效）| Bearer Token |
| 加密 | AES-256-CBC | 敏感系统设置落库加密 |

---

## 目录结构

```
wqt-auth-backend/
├── server.js              # 后端主入口，大部分 API 路由（登录/账号资产已拆到 src/routes/）
├── src/
│   ├── db.js              # 主库（wqt.db）初始化 + 工具函数
│   ├── cards-db.js        # 卡牌库（cards.db），工厂模式，支持 SQLite/飞书切换
│   ├── bmob.js            # Bmob 短信服务封装
│   ├── config.js          # 运行期配置 + AES 加解密（config / decryptVal / loadConfig）
│   ├── paths.js           # ROOT_DIR 等路径常量
│   ├── account.js         # 账号有效期/会员资产核心逻辑（组织统一到期判定）
│   ├── middleware/        # auth.js（JWT 校验）、rbac.js（角色/组织权限）
│   ├── services/          # sessions.js（单设备会话）、sms.js（短信验证码）
│   └── routes/            # auth.routes.js（认证）、account-admin.routes.js（账号资产）
├── admin-panel/
│   ├── app.py             # Streamlit 管理后台（含组织管理页面）
│   └── db_utils.py        # 直连 wqt.db 的查询工具，含 AES 解密
├── enterprise-panel/      # 组织管理员 Vue 3 SPA
│   ├── vite.config.js     # base: '/enterprise/', proxy→8080
│   ├── src/views/         # Dashboard/Members/Activities/Sessions/InviteCodes/Settings
│   ├── src/api/           # Axios 封装（auth/members/dashboard/activities/sessions/invite-codes）
│   ├── src/stores/auth.js # Pinia 认证状态
│   └── src/components/AppLayout.vue  # 侧栏+顶栏布局
├── public/                # 前端静态文件（Express 托管）
│   ├── index.html         # 主页（桌游模式 + 监督模式）
│   ├── complete-profile.html  # 新用户填守望师名页
│   ├── js/starfield.js    # 星空穿越欢迎动画
│   ├── cards-data.js      # 卡牌数据（前端用，与 cards.db 同步）
│   ├── css/               # 模块化样式（base/auth/game/header/modal...）
│   └── 23/2.webp          # 卡牌背景图（蓝黄渐变电路板纹理）
├── data/
│   ├── wqt.db             # 主数据库
│   └── cards.db           # 卡牌数据库（独立，可切换数据源）
├── scripts/               # 部署脚本、迁移脚本、nginx 配置
├── implementation_plan.md # 当前迭代详细规划（Task 1-6）
└── .env                   # 环境变量（不提交）
```

---

## 数据库 Schema（当前）

### wqt.db（主库）
```
users            id, username, phone, wechat_openid, unionid,
                 password_hash, guardian_name, real_name,
                 is_profile_complete, enterprise_id(FK→organizations.id),
                 created_at, role('boss'|'operator'|'watcher'|'enterprise'),
                 valid_until(毫秒时间戳, 仅独立个人用户用; NULL=永久)

organizations    id, name, owner_user_id(FK→users.id), max_members,
                 description, status('active'|'suspended'),
                 created_at, updated_at,
                 valid_until(毫秒时间戳, 组织统一到期; NULL=永久)

invite_codes     id, code(UNIQUE), type('general'|'organization'),
                 organization_id(nullable FK→organizations.id),
                 created_by(FK→users.id), max_uses, used_count,
                 expires_at, status('active'), created_at

game_sessions    id, user_id, started_at, ended_at, final_score,
                 payload_json, location, players_json, game_mode,
                 game_settings_json, status('active'|'flagged'...)

game_events      id, session_id, ts, type, payload
                 [type 枚举见下方"关键约定"]

activities       ..., enterprise_id(nullable FK→organizations.id)

system_settings  key, value(AES加密), description, updated_at
                 [含 ALLOW_SELF_REGISTRATION 开关，默认 false]
sms_codes        phone, code_hash, expires_at, created_at

user_sessions    id, user_id, jti(UNIQUE), device_info, ip,
                 created_at, last_seen_at
                 [单设备登录：每用户仅保留一条有效会话，新登录覆盖旧的]
```

### cards.db（卡牌库 — 三表架构）
```
cards (沙盒/详情表，admin panel 读写)
  id, key(UNIQUE), safety_type, event, phase, options_json,
  audio_url, status('pending'|'active'|'deleted'),
  current_version_id(FK→card_versions.id), notes(JSON), author_id,
  created_at, updated_at, deleted_at

card_versions (版本库，append-only)
  id, card_id(FK→cards.id), key, safety_type, event, phase,
  options_json, audio_url, version, version_label, note,
  branch(默认'main'), parent_id(FK→card_versions.id),
  author_id, promoted_at, created_at

cards_released (游戏发布快照，append-only，前端读取)
  id, card_id(FK→cards.id), key, safety_type, event, phase,
  options_json, audio_url, version_label,
  from_version_id(FK→card_versions.id),
  released_by, released_at
```
`options_json` 结构：`{"A":{"text":"...","consequence":"...","attributeEffects":{"安全力":1,...}},...}`

**三表流程**：`card_versions` →promote→ `cards` →release→ `cards_released` → 前端游戏

```
card_groups (卡牌组/版本套装，绑定 cards_released 快照)
  id, name, description, released_ids_json(有序JSON数组),
  is_default(0/1，全表唯一), created_by, created_at, updated_at
```
游戏前端通过 `GET /api/cards?group_id=X` 拉取指定组的有序卡牌；未指定时使用 `is_default=1` 的组；若无任何组则回退到"每个 key 最新快照"的旧行为。

**发布即加入卡牌组**：admin 创建/编辑卡牌组时直接选 `cards`（active）→ 保存时后端自动 snapshot 到 `cards_released` 并把新 released_id 写入 `released_ids_json`。复用规则：若该 card 的 `current_version_id` 已有对应快照则直接复用，避免重复落行。**已废弃**：bulk-release UI 入口（端点保留以防外部调用）。

---

## Admin Panel 页面一览

| 导航项 | 函数 | 功能 |
|--------|------|------|
| 🎛️ 驾驶舱 | `overview_page()` | 核心指标概览 |
| 👤 用户管理 | `user_management_page()` | 用户列表、角色设置、OSS关联 |
| 🏢 组织管理 | `org_management_page()` | 组织CRUD、邀请码、批量建号（boss专属）|
| 🎴 卡牌管理 | `card_management_page()` | 卡牌增删改、状态流转 |
| 📅 活动管理 | `activity_management_page()` | 活动创建/编辑/归档、场次查看 |
| 📂 OSS 文件管理 | `oss_management_page()` | 阿里云 OSS 文件浏览/删除 |
| 🎮 游戏分析 | `game_analysis_page()` | 场次统计、卡牌分析 |
| 🧹 数据审计 | `data_audit_page()` | 逐场次审查 |
| 🔬 复盘测试 | `review_testing_page()` | LLM 复盘报告生成测试 |
| ⚙️ 系统设置 | `system_settings_page()` | 系统配置（AES加密存储）|

**登录**：`admin`/`boss` 账号用 DEV_KEY；普通用户用手机号 + 密码，role=boss/operator 才进入后台。
**数据访问**：admin-panel 直连 `wqt.db`（`db_utils.py`），同时调用 `BACKEND_URL` 的 REST API 操作卡牌。

---

## 关键 API 端点（登录相关已移至 src/routes/auth.routes.js）

```
认证：POST /api/auth/login（手机号+密码+验证码 三要素 + 单设备会话轮换）
      POST /api/auth/sms/send（发码）  POST /api/auth/sms/verify（仅预校验，不签发 token）
      POST /api/auth/dev-login|admin-login|logout|register（默认关闭）
      POST /api/auth/register-with-invite（邀请码注册）
      POST /api/auth/reset-password（忘记密码：手机号须为已注册账号 + 验证码 → 改密 + 踢下线）
      ⚠️ /api/auth/wechat/* 已删除（无微信通道）
账号资产（boss, src/routes/account-admin.routes.js）：
      PUT /api/admin/organizations/:id/validity   PUT /api/admin/users/:id/validity
      GET/DELETE /api/admin/users/:id/sessions（查看在线设备 / 强制下线）
用户：GET  /api/me   PUT /api/me/password   POST /api/auth/complete-profile
游戏：POST /api/game/start|finish|event   GET /api/game/last-session|session/:id
卡牌（公开）：GET /api/cards[?group_id=:id]（默认走 is_default 卡牌组，无组回退最新快照）
卡牌组（公开）：GET /api/card-groups
卡牌组（admin）：GET/POST /api/admin/card-groups   GET/PUT/DELETE /api/admin/card-groups/:id
卡牌（admin）：GET/POST /api/admin/cards   PUT/DELETE /api/cards/:id
版本：POST /api/admin/cards/:id/branch   PUT /api/admin/card-versions/:id   GET /api/admin/cards/:id/versions
推送：POST /api/admin/card-versions/:id/promote
发布：POST /api/admin/cards/:id/release   POST /api/admin/cards/bulk-release
批注：GET/POST /api/admin/cards/:id/notes
组织（boss）：POST/GET/PUT/DELETE /api/admin/organizations   POST /api/admin/organizations/:id/members
邀请码（boss）：POST/GET /api/admin/invite-codes
组织管理员：GET /api/enterprise/info|dashboard|sessions|members|activities|invite-codes
           POST /api/enterprise/members|activities|invite-codes
           PUT/DELETE /api/enterprise/members/:id   PUT /api/enterprise/activities/:id
           GET /api/enterprise/members/:id/stats   GET /api/enterprise/activities/:id/sessions
OSS：GET  /api/admin/oss/files   DELETE /api/admin/oss/files
上传：POST /api/upload/audio|report
LLM：POST /api/llm/story   POST /api/admin/generate-card
设置：GET  /api/settings
```

---

## 项目关键约定

### 事件类型枚举（game_events.type）

| 值 | 含义 |
|----|------|
| `card_choice` | 玩家选择了一张卡牌的选项 |
| `skill_used` | 玩家使用了数智技能 |
| `game_start` | 游戏开始 |
| `game_end` | 游戏结束 |

> 新增事件类型时同步更新此表，并检查 `admin-panel/app.py` 所有 SQL 查询。

### 卡牌三表生命周期
```
新建 → cards(pending) + card_versions(v1)
编辑 → card_versions 插入新行
推送 → card_versions →promote→ cards(active)
发布 → cards →release→ cards_released（前端可见）
```
`cards.status` 合法值：`pending` / `active` / `deleted`

### 双数据库路径

| 数据库 | 默认路径 | 环境变量 |
|--------|----------|----------|
| 主库 | `./data/wqt.db` | `DB_PATH` |
| 卡牌库 | `./data/cards.db` | `CARDS_DB_PATH` |

卡牌库数据源可通过 `CARDS_SOURCE=feishu` 切换到飞书多维表格（当前为占位实现）。

### 时间戳规范
全库统一用 **毫秒级 Unix 时间戳**（`strftime('%s','now')*1000`）。
admin-panel 显示时统一转北京时间（UTC+8，`BEIJING_TZ`）。

### Session 命名规范
展示格式：`时间-守望师名`，如 `2025-03-01 张三`

---

## 组织号体系（已实现）

### 角色模型
- `role='boss'` → 超级管理员，全权限
- `role='operator'` → 运营，模块级权限（`system_settings.operator_permissions`）
- `role='enterprise'` + `enterprise_id=X` → 组织 X 的管理员
- `role='watcher'` + `enterprise_id=X` → 组织 X 的成员
- `role='watcher'` + `enterprise_id=NULL` → 独立个人用户

### 账号创建路径
1. **Boss 直接创建**：Streamlit 后台或 API 创建组织 + 管理员 + 成员
2. **邀请码注册**：Boss/组织管理员生成邀请码 → 用户通过 `/api/auth/register-with-invite` 自注册
   - 邀请码类型：`general`（通用）或 `organization`（绑定组织，注册后自动加入）
3. **自助注册已关闭**：`ALLOW_SELF_REGISTRATION=false`，验证码登录不再自动建号

### 数据隔离
- 组织管理员只能访问 `enterprise_id = 自己组织ID` 的用户和活动数据
- `requireEnterprise` 中间件统一校验
- JWT payload 含 `enterpriseId` 字段

### 组织管理面板（enterprise-panel）
- 路径：`/enterprise/`（Express 托管 `enterprise-panel/dist/`）
- 开发：`cd enterprise-panel && npm run dev`（Vite proxy → 8080）
- 构建：`cd enterprise-panel && npx vite build`
- 页面：Dashboard / Members / Activities / Sessions / InviteCodes / Settings

---

## 踩坑记录

<!-- entries below -->

### 🔧 [2026-02-26] admin 卡牌数显示为 0

**现象**: 管理后台"数据审计"页面所有场次的卡牌数均显示为 0，但数据库中有实际的选牌记录。
**根因**: `admin-panel/app.py` 的 SQL 查询中事件类型写的是 `card_selected`，但 `game_events` 表实际存储的是 `card_choice`。
**修复**: 将两处 SQL 中 `type = 'card_selected'` 改为 `type = 'card_choice'`（`data_audit_page` 的 `tab_review` 和 `tab_all`）。
**关键点**: 前后端事件类型字符串必须以本表"事件类型枚举"为准；admin panel 的统计查询改动后用 `inspect_db.py` 验证。

---

### 🔧 [2026-02-26] 完善资料后返回首页重播欢迎动画

**现象**: 新用户在 `complete-profile.html` 填完守望师名字跳回首页时，星空穿越欢迎动画再次播放。
**根因**: `js/starfield.js` 没有区分"首次加载"和"从其他页面跳转回来"两种场景。
**修复**: 在 `complete-profile.html` 提交成功后跳转前写入 `sessionStorage.setItem('skip_intro', 'true')`；`starfield.js` 初始化时检测该标记，存在则直接隐藏 `#welcome-screen` 并清除标记。
**关键点**: 页面间传递"一次性状态"用 `sessionStorage`（关闭 Tab 即清除），不要用 `localStorage`。

---

### 🔧 [2026-05-31] 多标签页复盘串号

**现象**: 开新标签页打一局后，切回原标签页点"复盘"，输出的却是新标签页那局的数据。
**根因**: `game-review.js` 把会话 ID 存在 `localStorage`（同源全标签页共享），新标签页 `setSessionId` 覆盖了 `WQT_SESSION_ID`，原标签页 `getSessionId` 读到的就是别人的对局。
**修复**: 将 `getSessionId/setSessionId` 改用 `sessionStorage`（按标签页隔离）；token 仍留 `localStorage`（`game-review.js:13-24`）。
**关键点**: 凡是"每个标签页一份"的运行态（会话 ID、进行中对局）必须用 `sessionStorage`，不能用 `localStorage`；只有跨标签共享的东西（登录 token）才放 `localStorage`。

---

### 🔧 [2026-05-31] 通关后无反馈/继续计分

**现象**: 最后一张卡选完只弹"恭喜通关"看不到该卡反馈；通关后继续选牌仍在加分、进操作历史、回传后端。
**根因**: `submit-choice` 通关分支只写 `progress-display` 不写 `choice-display`；且无"对局结束"标志，结束后照跑完整计分逻辑。
**修复**: 通关分支补渲染 `choice-display` 反馈；新增 `gameEnded` 标志（`finalizeSession` 置 true，开局/恢复置 false），结束后 `submit-choice`/技能进入自由体验分支：只出反馈、不计分、不记历史、不回传（`index.html:1097/1221/1712`）。
**关键点**: "游戏结束"是一个独立状态，要用显式标志统一拦截后续所有写操作（计分、历史、`recordEvent`、`saveGameState`），不能只靠 `hasFinishedSession` 防重复结算。

---

### 🔧 [2026-05-31] 起始阶段硬编码启蒙期

**现象**: 模式分布若先排青春期，开局仍显示并从"启蒙期"算起，阶段进度/回退错位。
**根因**: `startGameWithConfig` 把 `currentPhase` 写死为 `'启蒙期'`，`resetAttributes` 也硬编码 启蒙期/成长期/青春期 三阶段阈值。
**修复**: 起始阶段改取 `cardsPerPhase` 中第一个数量>0 的阶段；`resetAttributes` 按 `cardsPerPhase` 配置顺序累计阈值回退（`index.html:2119`、`2200-2212`）。
**关键点**: 阶段顺序/数量一律以本局 `cardsPerPhase`（模式分布）为准遍历，不要在逻辑里写死阶段名；`checkPhaseCompletion` 已是配置驱动可参考。

---

### 🔧 [2026-06-06] PG 迁移后活动码唯一约束冲突

**现象**: 企业面板新建活动报 `duplicate key value violates unique constraint "activities_activity_code_key"`。
**根因**: `generateActivityCode()`（`server.js:1921`）用全局 `MAX(id)+1` 拼活动码，隐含「id 序号==活动码序号」假设；SQLite→PG 迁移后 id 序列重排 + 历史删除留空洞，算出的 `ACT-00X` 撞上已存在的码，且函数无任何唯一性校验。
**修复**: 改为从现有 `activity_code` 解析真实最大序号，逐个递增并 `SELECT` 校验唯一后返回，带时间戳兜底——与 id 序列彻底解耦（`server.js:1921`）。
**关键点**: 业务唯一码不要用 `MAX(id)+1` 这种依赖自增序列的方式生成；迁移到 PG 后凡是「靠 id 推导其它值」的逻辑都要重新审视（序列/删除空洞会打破假设）。参考 `generateInviteCode` 的「随机+查重循环」范式。

---

### 🔧 [2026-06-06] 短信发码限流只在 mock 分支

**现象**: 配了 Bmob 的生产环境，短信发送接口零防护，换手机号即可无限刷（轰炸 + 话费欺诈）。
**根因**: `src/services/sms.js` 的 60s 重发间隔只写在 `!bmobSMS`（开发模拟）分支里；真实 `bmobSMS.sendSmsCode` 分支没有任何限流/人机校验。
**修复**: 把限流抽成 `checkSendQuota(phone, ip)` 前置守卫，对 mock 与 Bmob 两个分支统一生效（同号 60s/每日≤10、同 IP 每小时≤20）；新增 `src/services/captcha.js`（腾讯天御 TC3 签名，`CAPTCHA_ENABLED` 开关）；`server.js` 设 `trust proxy` 让 `req.ip` 取真实 IP。
**关键点**: 防护逻辑（限流/鉴权）必须放在 mock 与真实分支的**公共前置路径**，不能只挂在某一分支；新增「生产才走」的分支时，回头检查开发分支里的防护是否也要带过去。内存限流默认单实例，多副本需换 Redis。
