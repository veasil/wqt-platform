# WQT 历史修复记录

> 从 AGENTS.md 迁出，保留原始修复背景。文件路径、行号和实现状态属于记录当时；当前开发规则见 [AGENTS.md](../AGENTS.md)。历史修复不替代当前回归验证。

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
