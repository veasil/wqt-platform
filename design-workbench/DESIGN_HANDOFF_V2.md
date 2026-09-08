# 《伍力全开》React UI V2 设计交接

交接日期：2026-09-02

## 结论

V2 已从“数智远征手册”的深蓝场域 + 米白纸卡 + 珊瑚 CTA，完整切换为 **Cobalt Signal / 钴蓝信号**。它以冷白/雾蓝为稳定基底、墨蓝承载阅读、钴蓝独占主行动；五力色只保留在字母 chip、细线和局部数据标记。欢迎、登录、桌游、反馈、监督与“我的”现在使用同一色温、同一数字材质和同一表面层级。

研究依据与 10 个可追溯案例见 [`DESIGN_RESEARCH_V2.md`](./DESIGN_RESEARCH_V2.md)。

## 为什么选择 Cobalt Signal

候选 A、B、C 分别为 Cobalt Signal、Tonal Midnight、Soft Lab。A 被选中，因为：

- 继承现有 Logo 的蓝色识别，不需要重绘品牌。
- 能覆盖长文本卡牌、现场三栏工作台和数据监督，而不会回到科幻控制台。
- 与 Duolingo 的单核心色、Carbon 的中性层级、Fluent 的颜色职责、Xbox companion 的观察/控制分层一致。
- 对比生成的 Tonal Midnight 虽统一，但长时间阅读更疲劳，也更像深色监控后台。

两版可发货 UI 母版：

- [`assets/v2-masters/cobalt-signal-master.png`](./assets/v2-masters/cobalt-signal-master.png) — 最终权威
- [`assets/v2-masters/tonal-midnight-master.png`](./assets/v2-masters/tonal-midnight-master.png) — 未选对照

## Palette 与 token

目标面积比例：72% 冷白/雾蓝，18% 墨蓝文字与结构，7% 钴蓝行动，最多 3% 语义/五力色。

| 角色 | Token / 色值 | 用途 |
|---|---|---|
| App background | `--surface-app #F4F7FB` | 全局基底 |
| Panel | `--surface-panel #FFFFFF` | 侧栏、卡片、监督模块 |
| Raised | `--surface-raised #FFFFFF` | 情境卡、弹窗 |
| Selected | `--surface-selected #EAF2FF` | 导航、阶段、选择态 |
| Feedback | `--surface-feedback #EEF5FF` | 卡牌反馈与综合摘要 |
| Primary action | `--cyan #176BFF` | CTA、selected、progress、焦点行动 |
| Primary text | `--ink #10233F` | 正文与标题 |
| Secondary text | `--ink-soft #53657C` | 说明和次级信息 |
| Border | `--line #D7E0EB` | 所有中性分隔 |
| Success | `--success #16825D` | 在线、完成 |
| Warning | `--warning #B7791F` | 警告，不作装饰 |
| Danger | `--danger #D93838` | 停止、录音错误 |

`styles.css` 被隔离在 `@layer legacy` 作为既有结构层；V2 组件视觉在 `expedition.css` 的 `@layer cobalt` 中重写。主要组件定义本身已直接换为 V2 token，并非只在文件尾用一组颜色覆盖。最后一段 calibration 只负责清理监督/资料卡的残余暖色。

## 视觉资产

- [`assets/cobalt-route-hero-v2.webp`](./assets/cobalt-route-hero-v2.webp)：欢迎、登录和空态实际加载的高质量 WebP（约 58 KB）；以选定 UI 母版为色彩/材质参考。
- [`assets/v2-masters/cobalt-route-hero-v2-master.png`](./assets/v2-masters/cobalt-route-hero-v2-master.png)：保留的 1920×1080 PNG 母版，不进入运行时构建引用。
- [`assets/v2-masters/PROMPTS.md`](./assets/v2-masters/PROMPTS.md)：两版 UI 母版和最终欢迎资产的完整实际提示词。
- Logo 继续使用 `assets/logo.png`，未重绘、未生成替代。

## 三轮截图迭代

### Round 1 · baseline diagnosis

目录：[`artifacts/ui-v2/round-1-baseline`](./artifacts/ui-v2/round-1-baseline)

- 记录 V1 欢迎、卡牌反馈、监督、我的。
- 发现深蓝/米白色温断裂、暖棕插画与平面卡片材质断裂、青/橙/五力色竞争。

### Round 2 · master alignment

目录：[`artifacts/ui-v2/round-2-master-align`](./artifacts/ui-v2/round-2-master-align)

- 欢迎/登录替换为同母版路线插画。
- Header、状态栏、工作台、情境卡、反馈、CTA 和弹窗对齐 Cobalt Signal。
- 实际截图发现监督控制、雷达、资料卡仍有 V1 暖米色；Round 2 profile 的测试数据 fixture 形状不完整，触发了明确错误态，未作为最终结果。

### Round 3 · detail calibration

目录：[`artifacts/ui-v2/round-3-calibrated`](./artifacts/ui-v2/round-3-calibrated)

- 清除监督控制与资料卡残余暖色；综合雷达从青色改为钴蓝。
- 黄色只保留警告，绿色只保留在线/成功，红色只保留停止/录音异常。
- 修正 Playwright 的 profile fixture 映射，输出正常 profile 截图 `07-profile-1440x900.png`。
- 卡牌反馈、监督、资料页和 1366/1440/1920 游戏屏均已人工查看。

## 修改文件

- `src/expedition.css`：V2 token、表面层级与全页面组件视觉。
- `src/styles.css`：旧结构样式进入独立 cascade layer，避免无序覆盖。
- `src/components/Overlays.jsx`：欢迎/登录接入同一 Cobalt Route 资产。
- `scripts/ui_v2_verify.py`：可重复的 Playwright 走查、fixture 和三尺寸截图。
- `DESIGN_RESEARCH_V2.md`：研究、诊断、候选体系、选择与可访问性。
- `DESIGN_HANDOFF_V2.md`：本交接。
- `assets/cobalt-route-hero-v2.webp`、`assets/v2-masters/*`：运行时压缩资产、PNG 母版、UI 母版与提示词。

没有修改后端、生产 `public`、API、计分、权限或业务状态机；没有提交 git commit。

## 验证

`npm run build`：通过，46 modules transformed。

Playwright 全流程：欢迎 → 登录 → 开局配置 → 游戏空态 → 卡牌调取 → 选择与反馈 → 监督模式 → 我的。

- console errors：0
- page errors：0
- 1366×768：无 body 横向溢出
- 1440×900：无 body 横向溢出
- 1920×1080：无 body 横向溢出
- 结果：[`artifacts/ui-v2/round-3-calibrated/verification.json`](./artifacts/ui-v2/round-3-calibrated/verification.json)

## 可访问性

- 五力同时显示 R/A/S/P/E 与中文名称，不依赖颜色识别。
- 在线、暂停、录音、错误均使用文字/图标/颜色三重表达。
- 主焦点环使用高可见钴蓝半透明外圈，与填充 selected state 的形态不同。
- `prefers-reduced-motion` 关闭非必要动画。
- Disabled 同时使用低饱和、明度、禁用 cursor 和按钮文案。

## 仍受真实 API / 设备限制

- 最终自动化使用受控 API fixture，以避免真实测试账号单设备会话被自动化踢下线；业务 service 调用路径和交互状态机保持不变。
- 真实卡牌发布快照、活动权限、登录失效、文件下载、DeepSeek 复盘、火山 TTS、Bmob 短信仍需在对应联调环境验证。
- 真实麦克风授权与录音上传受浏览器/系统权限限制；本轮只验证了 UI 状态表达与按钮链路。
- 离线/恢复文案和视觉已覆盖，事件重放及服务端幂等仍依赖生产 API。
