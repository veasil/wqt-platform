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


---

### [2026-10-12] 商业操作恢复与换号会话撤销

平台套餐交付可能在PG提交后丢失HTTP响应；前端重试若重新生成编号，会再交付一次。保留原输入与编号，并在刷新后恢复同一操作；401/403出现在结果未知之后也不证明原操作没有提交。密码和短信不写入恢复缓存。

同一人换号还包含两个易遗漏的副作用：短信一次性消费不能放在已提交结果重放之前；重放不能无条件删除用户后来新登录的会话。新操作才验证短信，重放仍实时核验boss；Redis撤销按旧凭据版本匹配，PG版本变化仍保障旧JWT失效。平台业务仍由后端授权，前端按钮只是交互提示。

回归包含真实浏览器→HTTP→隔离PG/Redis的交付响应丢失与刷新恢复、首次绑定、固定一年续费，以及换号后新登录在重放时保留。证据和剩余边界见[平台管理端交付](changes/WQT-006-account-permissions/admin-delivery.md)。


2026-10-12 WQT-006平台运营v2：账号权益与用户汇总标签分开，用户标签不用于扩大所选账号权限。密码单独验证取消了短信发码配额的间接约束，因此沿用Redis增加跨进程验证限额。邀请码绑定仍核验当前身份及凭据版本，重试回执不能代替身份验证。验收环境更新先备份再恢复到独占PG库，沿用Redis命名空间以保留会话；不重复播种，不重建用户。详细证据见[运营修订v2](changes/WQT-006-account-permissions/admin-operations-v2.md)。


### [2026-10-16] 复盘资格与启动恢复的两个不同问题

复盘入口仍读取 REVIEW_MIN_CARDS，取不到设置时回退7；即便其他入口允许短局，报告仍被旧门槛拦住。此次移除报告入口的张数资格检查，以0/1/6张实际运行浏览器脚本到生成请求作为回归。没有证据把复现归因于规范文档；已将产品规则同步领域文档，避免把遗留自由模式设置继续用于报告。

2026-10-16本机验收收尾：旧UAT父启动器退出会删除其数据库/OSS前缀，因此恢复已有验收数据必须使用不播种、不清理的独立启动路径。先将外部备份恢复到新独占库，验证迁移、幂等和实际回退，再对原库逐项结束无业务遗留的重复绑定，历史逐行摘要保持不变。活动归属以activity_sessions实际关联为准，不能从游戏主表没有activity_id或活动未设组织推断“没有历史”；旧WQTUAT保持原状，另建组织明确的演示活动。

停止录音的Blob可以本机持久化，但凭据不能随录音持久化。恢复后上传要重新用当前会话核对原身份/账号；本机成功暂存、服务端上传完成和用户下载完成是不同状态。存储不支持/超时/冲突时仍保留内存并提供下载，不以此阻止开新局。见[本机收尾证据](changes/WQT-006-account-permissions/uat-completion-20261016.md)。

2026-10-16登录与布局修订：隔离启动器白名单漏载Bmob导致已存在本机凭据却仍用模拟验证码，修复为显式live-sms并公开服务模式，真实收件另验。验证码从点击后才加载改为预热，加载超时可重试、票据不共享、后端校验不放松。固定面板必须验证外框与页脚在展开后不变，只检查子表单overflow不足；此次补上1365/1920/390亮暗几何断言。腾讯SDK自动创建离屏透明iframe，不能用iframe数量判断可见弹窗。证据见[登录与视觉修订](changes/WQT-006-account-permissions/login-visual-followup-20261016.md)。

完整玩家回归还发现测试把监听成功当成过期场次恢复已完成：runtime在监听后调度后台清理，首次立即查询可能读到尚未结算。测试改为有时限地观察落库结果，保留ended_at、状态ended和final_score断言，不用固定延时冒充恢复保证。监听可用与后台恢复完成是不同的就绪状态。
