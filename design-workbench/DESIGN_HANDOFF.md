# 《伍力全开》React UI · 数智远征手册设计交接

更新日期：2026-09-02

## 视觉方向

本轮采用“数智远征手册”作为统一方向：深海军蓝代表现场任务场域，暖白纸张代表需要认真阅读和做出判断的决策面，荧光青用于系统状态，珊瑚橙用于主行动，信号黄用于提醒与阶段奖励。界面使用桌游卡套、任务贴纸、地图刻度、纸张层次和印章语义，保留科技感但避免霓虹控制台、廉价科幻和传统后台感。

字体层级以宋体展示标题建立“阅读与判断”的内容气质，以清晰黑体承担操作和数据。Logo 沿用 `assets/logo.png`，未重绘、未反色。

## 已落地范围

- 欢迎：进入动作升级为“启动本次任务”，加入三步任务预告和远征世界插画。
- 登录：移除长按交互，改为第三方验证入口式交互；加入字段即时反馈、隐私说明与错误恢复。
- 开局配置：活动卡与活动码明确为同一配置的两种入口；加入列表加载、空态、错误重试、权限说明和卡牌数/时长联动。
- 桌游待选：重构空态、卡牌工作台、伍力技能和录音状态；暂停成为全局状态并冻结写操作。
- 卡牌决策/反馈：仅被提交的选项显示进行中；反馈与题面保持连续；加入显性“完成本张 · 选择下一张”。
- 创心力：加入麦克风权限前置说明、键盘回退、280 字护栏和“小伍确认”角色语义。
- 时期结算：使用“抵达下一站”的克制奖励感，展示伍力总分和下一步方向。
- 监督模式：加入监控状态条、综合百分比及计算口径、伍力条形辅助表达和可审计控制说明。
- 我的：五个子页使用 `#me/account` 等可分享片段路由；身份来自真实用户；权益直接说明影响；产品反馈和技术求助合并为帮助中心。
- 停止/复盘：拆为“确认结束本局”和“生成复盘报告”两步；生成中可以关闭窗口继续浏览。
- 全局反馈：统一在线、离线、暂停、录音、自动保存、加载、空态、错误、成功和禁用状态。

## 生成资产

使用内置 `image_gen` 生成，并压缩为 WebP 后接入项目：

- `assets/five-powers-expedition-v2.webp`（243 KB）：欢迎页五力远征世界。
- `assets/mission-map-stilllife-v2.webp`（159 KB）：登录、待选卡空态的任务地图静物。

### 最终提示词 1

```text
Use case: stylized-concept
Asset type: desktop web app welcome hero illustration for a children's digital-safety tabletop game
Primary request: an expansive imaginative "Five Powers expedition" world that feels like a physical tabletop game coming alive, with five distinct pathways converging toward a luminous central beacon; abstract landscapes suggest safety, critical thinking, real-world sensing, creativity, and communication without literal labels
Scene/backdrop: a midnight-blue tabletop world viewed at a cinematic shallow angle, layered paper-cut islands, translucent acrylic route markers, tactile card-stock terrain, subtle constellation pins and folded map geometry
Subject: the central mission beacon and five colored routes are the focus; no characters and no logos
Style/medium: premium editorial 3D paper-craft illustration mixed with screen-printed board-game textures; sophisticated and energetic, suitable for children age 9–16 but not childish
Composition/framing: wide 16:9 landscape, focal world occupying the right two-thirds, calmer dark negative space on the left for real HTML copy and CTA, clear depth from foreground to horizon
Lighting/mood: hopeful night expedition, soft volumetric glow, tactile studio lighting, adventurous rather than ominous
Color palette: deep navy and ink blue dominant, warm ivory paper, electric cyan, coral orange, signal yellow, violet and mint accents
Materials/textures: thick card stock, matte paper fibers, translucent colored acrylic, subtle foil edge highlights
Constraints: no text, no letters, no numbers, no logos, no interface mockup, no people, no robot, no watermark; avoid neon cyberpunk city, spaceship cockpit, hologram HUD, glossy generic sci-fi, purple-gradient SaaS look
```

### 最终提示词 2

```text
Use case: stylized-concept
Asset type: reusable vertical side-panel illustration for login, setup and empty states in a children's digital-safety tabletop web app
Primary request: a tactile mission-planning still life built from a folded dark-blue map, five color-coded acrylic tokens, a small compass-like mission dial, blank index cards and a warm ivory field notebook; the objects imply choosing an activity and beginning a safe expedition
Scene/backdrop: premium tabletop surface with subtle paper fibers and screen-printed contour lines
Subject: mission map and five tokens, no characters
Style/medium: refined editorial 3D paper-craft and product still-life, physical board-game materials, crisp but warm
Composition/framing: portrait 4:5 composition, focal cluster in the lower-middle with generous darker negative space toward the top for real HTML headings; edges safe for responsive cropping
Lighting/mood: soft directional desk light, confident, welcoming, exploratory
Color palette: deep ink navy dominant, warm ivory, electric cyan, coral orange, signal yellow, violet and mint accents
Materials/textures: matte card stock, woven paper, translucent acrylic tokens, subtle stamped ink
Constraints: no text, no readable letters or numbers, no logos, no people, no robots, no UI mockup, no watermark; avoid cyberpunk, holograms, control-room panels, glossy plastic toy look, childish cartoon style
```

## 验证

`npm run build` 通过。Playwright 端到端走查了欢迎 → 登录 → 配置 → 开局 → 选卡 → 作答反馈 → 停止确认 → 监督模式 → 我的，控制台错误为 0。

截图位于 `artifacts/ui-verification/`：

- `01-welcome-1440x900.png`
- `02-login-1440x900.png`
- `03-setup-1366x768.png`
- `04-game-empty-1920x1080.png`
- `05-card-feedback-1920x1080.png`
- `06-review-stop-1440x900.png`
- `07-supervisor-1440x900.png`
- `08-profile-1440x900.png`
- `verification.json`

所有截图均无横向溢出。1366×768 的配置弹窗使用弹窗内部滚动，低高度不会遮挡底部主操作。

## 真实 API 仍需确认

- 当前 Workbench 的人机验证适配器仍返回 900ms 最小校验窗口；UI 已改成第三方服务入口形态，生产迁移时需接真实供应商组件。
- 离线状态已提供统一视觉和恢复文案，但事件重放/幂等重试仍依赖生产 API 与会话 store。
- “后台生成复盘”在当前页面生命周期中会让已发出的请求继续完成；跨刷新、跨设备的真正后台任务和完成通知需要服务端任务状态接口。
- 监督调整已经在 Workbench 本地历史中体现审计语义；生产端仍需保证操作者、前后值和时间戳落库。
- 我的子页已有可分享 URL 片段；生产接入正式路由时应由 SPA Router 处理直达和鉴权恢复。
