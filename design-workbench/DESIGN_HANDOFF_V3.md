# 《伍力全开》React UI V3 设计交接

交接日期：2026-09-02
方向：**Future Guardian Deck / 未来守望舱**

## 结果

V3 保留 V2 已确认的页面结构、信息层级、交互节奏、中文文案和业务状态机，只将视觉回归到现有城市封面与小伍 IP 所定义的深蓝紫未来世界。

- 欢迎页直接使用现有 `future-city-welcome.webp`，未生成替代封面。
- 顶部继续使用项目现有 Logo，未沿用母版占位字样，未重绘 Logo。
- 官方 6–11 岁小伍原图只用于登录侧视觉锚点，未修改角色造型。
- 主要 CTA 使用蓝紫；青色只承担交互高光；洋红只用于停止、录音和高风险信号。
- 卡牌正文、监督数据和个人资料全部使用实色深靛面板，不在复杂城市背景上使用透明玻璃。

完整视觉提取与规则见 [`DESIGN_DIRECTION_V3.md`](./DESIGN_DIRECTION_V3.md)。

## 视觉母版

- 1440×900 对照母版：[`assets/v3-masters/future-guardian-deck-master-1440x900.webp`](./assets/v3-masters/future-guardian-deck-master-1440x900.webp)
- 原始输出：[`assets/v3-masters/future-guardian-deck-master-source.png`](./assets/v3-masters/future-guardian-deck-master-source.png)
- 完整 imagegen 提示词：[`assets/v3-masters/PROMPTS.md`](./assets/v3-masters/PROMPTS.md)

母版以城市封面、6–11 岁小伍和 V2 核心对局为三类参考。一次生成即通过以下检查，因此没有做无意义的第二次迭代：

- 三栏结构和信息密度保持不变。
- 深靛背景与实色面板属于同一 hue family。
- 蓝紫 CTA、青色交互、洋红高风险职责明确。
- 正文区域没有玻璃透景。
- 五力色仅在小型 R/A/S/P/E chip 与局部数据中出现。
- 输出没有小伍重绘或替代 Logo。

## 单一 V3 token 来源

运行时 V3 颜色与表面由 `src/guardian-v3.css` 的 `@layer guardian-v3` 根 token 统一定义：

| 角色 | Token | 值 |
|---|---|---|
| 最深场域 | `--space-0` | `#050824` |
| 导航场域 | `--space-1` | `#080D36` |
| 次级场域 | `--space-2` | `#0D1648` |
| 普通面板 | `--surface-panel` | `#111B48` |
| Raised 面板 | `--surface-raised` | `#172557` |
| Selected | `--surface-selected` | `#202568` |
| Feedback | `--surface-feedback` | `#17295E` |
| 主文字 | `--text-primary` | `#F4F6FF` |
| 次级文字 | `--text-secondary` | `#BBC6E4` |
| 主行动 | `--action-primary` | `#625BFF` |
| 交互高光 | `--action-highlight` | `#2BD9FF` |
| 能量/高风险 | `--energy-magenta` | `#F05BDA` |

`styles.css` 和 `expedition.css` 继续保留已验证的结构与尺寸规则；V3 视觉全部在更高的 `guardian-v3` cascade layer 内集中管理，避免改动业务组件结构。

## 视觉规则

- 圆角：大面板 18px，按钮/输入 10–14px，状态为胶囊形。
- 材质：深靛实色数字面板、1px 蓝紫描边、轻量内高光；无毛玻璃正文卡。
- 空间：背景可有远处星点/轨道，内容面板不承载复杂纹理。
- 光效：active/CTA 使用局部蓝紫光；focus/search/audio 边缘使用青色；洋红不扩散到普通组件。
- 中文：保留当前标题、正文、选项和反馈字号/行高；母版英文只是结构示意。
- 小伍：形态语言进入胶囊按钮、圆润设备外壳和运动轨道；角色原图不被重绘。

## 覆盖页面与状态

最终截图目录：[`artifacts/ui-v3/final`](./artifacts/ui-v3/final)

- `01-welcome-1440x900.png`：现有未来城市封面欢迎页。
- `02-login-1440x900.png`：登录与官方小伍。
- `03-setup-1440x900.png`：开局未载入/禁用态。
- `03b-setup-loaded-1440x900.png`：开局已载入/成功/可提交态。
- `04-game-empty-1440x900.png`：对局空态。
- `05-card-feedback-1440x900.png`：卡牌、选项与反馈。
- `05b-review-stop-1440x900.png`：停止与冻结确认。
- `06-supervisor-1440x900.png`：监督数据、警告、控制与历史。
- `07-profile-1440x900.png`：账户资料。
- `07-membership-1440x900.png`：权益与期限。
- `07-security-1440x900.png`：安全设置。
- `07-learning-1440x900.png`：我的学习。
- `07-files-feedback-1440x900.png`：文件与反馈空态。
- `size-game-1366x768.png`、`size-game-1440x900.png`、`size-game-1920x1080.png`：三尺寸核心对局。

全局已覆盖在线、离线、自动保存、暂停、录音、成功、警告、危险、loading、empty、error 和 disabled 的统一表达；颜色均同时配合图标或文字。

## 修改文件

- `DESIGN_DIRECTION_V3.md`：参考提取与最终方向。
- `DESIGN_HANDOFF_V3.md`：本交接。
- `src/guardian-v3.css`：V3 token 与全页面视觉系统。
- `src/main.jsx`：加载 V3 视觉层。
- `src/components/Overlays.jsx`：欢迎/登录恢复现有城市封面。
- `src/expedition.css`：清除会让 V2 旧资源继续进入构建的引用，并移除旧空态 `!important` 冲突。
- `scripts/ui_v2_verify.py`：补充已载入开局、停止复盘和“我的”五子页走查。
- `scripts/ui_v3_verify.py`：V3 验证入口。
- `assets/v3-masters/*`：母版与 prompt。
- `assets/wu-6-11-v3.webp`：官方小伍原图的运行时 WebP，视觉内容未修改。
- `assets/banner-bg-v3.webp`：官方 banner 的运行时 WebP。

未修改后端、API、生产 `public`、计分、权限、业务文案或 React 状态机；未提交 git commit。

## 构建与浏览器验证

`npm run build`：通过，47 modules transformed。

构建关键资产：

- `future-city-welcome`：146.84 KB
- `wu-6-11-v3`：39.01 KB
- `banner-bg-v3`：28.41 KB

Playwright 流程：欢迎 → 登录 → 开局未载入 → 开局已载入 → 对局空态 → 调取卡牌 → 选择与反馈 → 停止确认 → 监督 → 我的五个子页 → 三尺寸核心对局。

- console errors：0
- page errors：0
- 1366×768：无 body 横向溢出
- 1440×900：无 body 横向溢出
- 1920×1080：无 body 横向溢出
- 机器结果：[`artifacts/ui-v3/final/verification.json`](./artifacts/ui-v3/final/verification.json)

## 原版复盘引擎接入

- React 现在按需加载后端 `public/game-review.js`，直接复用原提示词、伍力/风险雷达、三张故事插画、卡面、品牌素材和 HTML 海报生成链路；不再请求不存在的 `/api/game/review`。
- 适配层同步 React 与原版的 token/sessionStorage 键名，并在当前 session 失效时回退到账号最近一局。
- `artifacts/ui-v3/original-review/verification.json` 已断言 `/api/llm/story` 1 次、`/api/llm/image` 3 次、`/api/upload/report` 1 次。

## 已知限制

- 自动化使用受控 API fixture，避免真实测试账号的单设备会话被测试流程踢下线；React service 调用链、交互和状态机没有被替换。
- Bmob 短信、人机验证、真实活动权限、发布卡牌快照、DeepSeek 复盘、火山 TTS、文件下载仍需在对应联调环境验证。
- 麦克风授权与录音上传受浏览器/操作系统权限限制；本轮验证 UI 状态和操作入口，不伪造设备授权成功。
- V2 样式层保留作为结构兼容层；后续若业务组件完成独立布局迁移，可删除该兼容层，但不影响当前 V3 视觉与构建。

## Liquid Glass 组件校准

在 V3 深蓝紫方向确认后，主内容框、三栏面板、监督模块、个人中心和弹窗进一步切换为 Apple 风格的深色 Liquid Glass：取消可见硬描边，改由顶部内高光、蓝紫折射、分级背景模糊和悬浮阴影表达边界。情境正文及嵌套数据块仍使用高不透明度承载层，避免玻璃叠玻璃降低中文可读性。

- 实现：`src/guardian-v3.css` 的 `--glass-*` token 与 liquid glass 组件段。
- 按压反馈：按钮在 pointer down 时即时缩放，禁用态不响应。
- 兼容：不支持 `backdrop-filter` 时回退到实色面板。
- 可访问性：支持 `prefers-reduced-transparency`、`prefers-contrast` 与既有 `prefers-reduced-motion`。
- 回归截图：`artifacts/ui-v3/glass/`。
- 回归结果：0 console errors、0 page errors；1366×768、1440×900、1920×1080 无横向溢出。

### 真实折射与 Apple 动效增强

核心情境卡进一步接入 `liquid-glass-react@1.1.1`，由组件内 SVG displacement filter 提供边缘折射、色差与底色采样；`motion` 提供可中断的无弹跳 spring 入场。玻璃层从父容器追踪鼠标，因此不会拦截卡牌内的选项、语音和“下一张”操作。

- 组件：`src/components/LiquidScenarioFrame.jsx`。
- 接入点：`src/components/GameMode.jsx`。
- 参数：`displacementScale=42`、`blurAmount=.16`、`saturation=148`、`aberrationIntensity=1.15`、`elasticity=.045`、`mode=standard`。
- 性能：依赖被拆为按需 chunk；初始 JS gzip 约 87.31 KB，打开卡牌前浏览器空闲时预加载约 73.55 KB 的玻璃 chunk。
- Reduced Motion：关闭位移、色差和弹性，只保留 160ms 淡入。
- 自动检查：确认 SVG filter 已挂载、背景滤镜生效、指针移动会更新 transform，并保持内部按钮可点击。
- 最终截图与机器结果：`artifacts/ui-v3/liquid-glass-react/`。
