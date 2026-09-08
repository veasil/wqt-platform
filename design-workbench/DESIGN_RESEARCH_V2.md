# 《伍力全开》React UI 第二轮设计研究

研究日期：2026-09-02

## 研究目的

本轮不从“喜欢哪组颜色”出发，而是研究成熟儿童教育、游戏 companion、数字安全学习和数据监控产品如何建立稳定的色彩秩序。分析维度包括：核心色彩比例、表面层级、语义色、插画与产品 UI 的衔接、儿童/青少年场景下的可访问性。

以下比例为基于官方页面与产品截图的视觉观察，不是品牌方公开的精确面积统计；明确的色值或规则只在官方指南给出时引用。

## 可追溯案例

### 1. Duolingo Brand Guidelines：一个核心品牌色，其余颜色服务“点亮”

来源：[Duolingo Color](https://design.duolingo.com/identity/color)、[Shape Language](https://design.duolingo.com/illustration/shape-language)

- 官方明确 Feather Green 为核心色，Snow 为主背景，Eel 为文字；secondary colors 用于 UI 与插画中的“小范围 delight”。中性色承担 utility 与 hierarchy。
- 官方插画指南要求减少同时出现的颜色数量；过多颜色会在缩小时损害可读性。插画基于白底和浅 pastel，而不是额外引入冷灰或另一套材质。
- 视觉观察：产品主任务通常约 70–80% 白/浅灰表面，10–15% 文字与边框，5–10% 核心绿，其他色只在课程节点、角色或状态中出现。
- 可借鉴：伍力色只做编码；主 CTA、选中态和进度归属于一个品牌色；插画必须使用与 UI 同一套中性色和品牌色。
- 不可照搬：高饱和绿和圆润幼态角色会降低桌游现场的判断感，也与现有 Logo 的蓝色识别冲突。

### 2. Kahoot! Brand Guidelines：高能量不等于全屏多色

来源：[Kahoot! Brand Guidelines](https://kahoot.com/library/kahoot-logo/)、[官方品牌指南 PDF](https://kahoot.com/files/2019/08/Kahoot-BrandGuide-August2019.pdf)

- 官方要求插画围绕同一组颜色组织以避免视觉杂乱，并强调插画必须服务明确目的；不应无理由放置。
- Kahoot 的答题四色用于“答案身份”，但页面其他区域由单一品牌紫、白色留白和深色文字稳定承载。
- 可借鉴：A/B/C/D 或五力色只能在需要识别的局部出现；同一屏不可让五色按钮、橙 CTA、青状态和蓝背景争夺主视觉。
- 不可照搬：Kahoot 的四色大按钮适合快速抢答，不适合本项目长文本情境阅读、现场讲解和监督数据。

### 3. Google Be Internet Awesome / Interland：安全主题通过世界分区，而非系统层全彩

来源：[Be Internet Awesome](https://www.beinternetawesome.withgoogle.com/en_us)、[Interland](https://beinternetawesome.withgoogle.com/en_us/interland/)

- 官方产品把数字安全知识拆为多个游戏岛屿；游戏世界可鲜艳，但导航、说明和教学资源保持清晰的 Google 白底与克制层级。
- 色彩承担“关卡世界”和“知识主题”映射，不同时承担所有交互状态。
- 可借鉴：伍力色可作为局部标签、进度点和雷达线；主界面基底保持单一。插画可以更丰富，但进入工作台后应逐步收束。
- 不可照搬：Interland 的低龄 3D 岛屿和全屏冒险节奏不适合 9–16 岁混合群体及现场监督场景。

### 4. LEGO Education SPIKE App：物理积木鲜艳，软件画布保持中性

来源：[LEGO Education SPIKE App](https://education.lego.com/en-gb/downloads/spike-app/software/)、[SPIKE App Privacy](https://education.lego.com/en-us/app-privacy-policy/)

- 产品定位强调 playful STEAM，但软件同时承载课程、搭建说明、图形编程和 Python，必须让内容块成为焦点。
- 视觉观察：高饱和色主要来自积木、代码块和关键工具；大面积画布、导航和说明区保持浅中性。连接/隐私状态使用明确文字而非装饰色。
- 可借鉴：让卡牌和技能本身带少量色，系统外壳和文字阅读面保持冷中性；录音和数据状态要写清楚“发生了什么”。
- 不可照搬：LEGO 的积木原色和黄色品牌面过强，会把伍力全开变成另一个玩具品牌。

### 5. Minecraft Education：内容世界保留强风格，教学 UI 使用功能性覆盖层

来源：[What is Minecraft Education](https://education.minecraft.net/en-us/discover/what-is-minecraft)、[Minecraft Education Design Guide](https://education.minecraft.net/content/dam/education-edition/software-downloads/Minecraft_Education_Edition_Design_Guide_June_2021.pdf)

- 游戏世界可以高度纹理化，但教学工具、NPC 指令、相机/作品集和 Code Builder 通过稳定、可预测的 UI 层覆盖在世界之上。
- 可借鉴：欢迎页插画可以承担世界观，进入计分系统后应切换到同色系、低纹理的工作表面；不能把插画材质复制成每个面板的装饰。
- 不可照搬：像素化、厚重游戏 HUD 和沙盒自由度会分散桌游现场对卡牌文案的注意力。

### 6. Xbox Family Settings：监控产品靠层级和摘要，不靠更多颜色

来源：[Xbox Family Settings App](https://www.xbox.com/en-US/apps/family-settings-app)

- 家庭安全 companion 同时管理屏幕时间、内容、好友和权限。视觉重点是人物、摘要数字、开关与请求；品牌绿并不铺满所有数据模块。
- 观察与控制被分层：摘要先于设置，风险和批准请求才获得高强调。
- 可借鉴：监督模式中综合值、连接、录音和本局状态先形成观察区；数值加减作为控制区并附审计说明。绿色只表示成功/在线，不作为装饰。
- 不可照搬：移动端单列卡片不适合桌面现场三栏密度，但其信息优先级可直接借鉴。

### 7. Nintendo Switch Parental Controls：companion 需要继承主机识别，但降低游戏噪声

来源：[Nintendo 官方 IR：Mobile Apps That Enhance Gameplay Experiences](https://www.nintendo.co.jp/ir/pdf/2025/251105e.pdf)

- 官方把 Parental Controls 定义为连接主机、增强游戏体验的 app。活动摘要继承 Nintendo 的清晰红色识别，但数据阅读面保持白色和中性灰。
- 可借鉴：Logo/品牌色提供“这是同一个产品”的锚点；监督数据不需要继承欢迎插画的全部色彩和材质。
- 不可照搬：Nintendo 红适合品牌入口，不适合本项目长时间使用的主行动色和监控状态。

### 8. IBM Carbon：中性色主导，层级靠相邻表面明度差

来源：[Carbon Color Overview](https://carbondesignsystem.com/elements/color/overview/)

- 官方说明 neutral gray family 在默认主题中占主导，Blue 是主行动色，其他颜色“sparingly and purposefully”。
- Light theme 通过 White 与 Gray 10 交替建立 layer；Dark theme 每升一层变亮一级。层级不依赖每张卡换颜色。
- 可借鉴：整个应用只保留 background、surface、surface-raised、surface-overlay 四个明确表面；卡牌、监督、我的都使用同一层级逻辑。
- 不可照搬：纯企业灰会削弱儿童桌游的亲和力，需要以微蓝中性色和柔和几何细节保留活力。

### 9. Microsoft Fluent 2：neutral / brand / shared 三种职责不可混用

来源：[Fluent 2 Color](https://fluent2.microsoft.design/color)、[Fluent Typography](https://fluent2.microsoft.design/typography)

- Neutral 用于 surface、text 和 layout；brand 用于 CTA 与 selected state；shared colors 应少量使用；semantic colors 只表达重要反馈，不用于装饰。
- 官方要求不能只靠颜色传达含义，并给出正文 4.5:1、大字 3:1 的对比度要求。
- 可借鉴：五力色必须同时带字母与中文名；成功/警告/危险必须有图标和文字；主品牌蓝只用于行动和选中。
- 不可照搬：Fluent 的办公产品气质偏理性，需加入更大的情境标题和轻微游戏动势。

### 10. Material 3 / Atlassian：使用角色 token，而非在组件里直接选色

来源：[Material 3 Color Roles](https://developer.android.google.cn/design/ui/mobile/guides/styles/color?hl=en)、[Atlassian Color](https://atlassian.design/foundations/color-new/)、[Atlassian Design Tokens](https://atlassian.design/tokens/design-tokens)

- Material 说明 surface colors 应占应用大多数，并用 surface/container/on-container 配对保证对比；Atlassian 用 role、emphasis、interaction state 组织 token。
- Atlassian 明确区分 discovery、accent、danger、input 等角色，避免用“无意义 accent”表达语义。
- 可借鉴：本项目必须从 `--blue-500` 这类原始色转为 `--action-primary`、`--surface-raised`、`--status-warning`、`--power-safety` 等角色 token。
- 不可照搬：Material 的动态色和大量 tonal container 对固定品牌、桌面工作台而言过于复杂；本轮只保留必要角色。

## 当前 V1 诊断

### 客观色块占比

对 `artifacts/ui-verification` 四张核心截图进行 8 色中值量化：

- 欢迎页：约 66% 极深蓝黑，约 25% 插画中的灰褐/暖棕，CTA 珊瑚橙面积很小但饱和度最高。
- 卡牌反馈：约 56% 米白/暖白，约 40% 深蓝，青绿反馈区约 10%。
- 监督模式：约 40% 深蓝、约 57% 米白/暖白。
- 我的：约 31% 深蓝、约 65% 米白/暖白。

### 为什么不协调

1. **基底温度断裂**：欢迎插画的蓝黑 + 金棕是电影概念图温度；工作台的米白偏黄，深蓝偏冷，两者并非同一色相体系的明暗层级，而是两个主题拼接。
2. **表面语义不稳定**：深蓝既是背景、导航、按钮、数据卡；米白既是主卡、侧栏、监控容器。用户无法仅靠表面判断“这是基础层还是可操作层”。
3. **主行动色没有唯一所有权**：青色承担连接、搜索、进度和按钮；珊瑚橙只在欢迎 CTA；五力色又在技能、雷达与结算出现。系统没有一个贯穿全程的行动色。
4. **五力色面积虽不算大，但视觉对比过强**：它们被放在高对比白卡上，每个都像独立 CTA；再叠加成功绿、录音红和警告黄，产生“彩色按钮墙”。
5. **插画与 UI 材质断裂**：欢迎页是复杂 3D 纸艺 + 金属发光路线；UI 是平面米白卡 + 深蓝框。纸艺概念没有转化为统一的圆角、边框、阴影或几何语言。
6. **页面间密度不一致**：游戏页是高密度三栏，监督页和我的使用大片空米白；相同 `panel-shell` 在不同页产生截然不同的视觉重量。

## 候选体系

### A. Cobalt Signal / 钴蓝信号（推荐）

- 72% 冷白与雾蓝中性色：`#F4F7FB` / `#FFFFFF` / `#E8EEF6`
- 18% 深墨蓝文字与顶栏：`#10233F` / `#183556`
- 7% 唯一品牌行动蓝：`#176BFF`，selected / CTA / progress
- 3% 语义与伍力色：成功、警告、危险及五力编码
- 插画：低纹理、同色系的钴蓝空间 + 透明青色结构；禁止金棕、米黄纸张和珊瑚 CTA。
- 优点：与现有 Logo 蓝色系统一致；适合长文本；可同时覆盖游戏与监控；能让五力色退回编码角色。

### B. Tonal Midnight / 单色夜航

- 76% 同一 hue 的深浅海军蓝表面：`#081728` / `#10263F` / `#173552`
- 16% 冷白文字与浅蓝边框
- 6% 青蓝行动色：`#37B8FF`
- 2% 语义/伍力色
- 插画：深色透明几何、无金色和纸张。
- 优点：现场沉浸、屏幕眩光低、视觉统一最强。
- 风险：长时阅读和监督数据密度下更易疲劳；儿童/青少年产品容易回到“科幻控制台”。

### C. Soft Lab / 柔光实验室

- 78% 冷灰白：`#F7F8FA` / `#FFFFFF` / `#EEF1F4`
- 14% 石墨文字：`#273447`
- 6% 蓝绿色行动色：`#078F9A`
- 2% 伍力与语义色
- 插画：扁平、圆润、低对比的实验室模块。
- 优点：最平静、最接近教育工具。
- 风险：品牌记忆和桌游现场仪式感不足，容易滑向普通后台。

## 选择

选择 **A. Cobalt Signal / 钴蓝信号**。

它结合了 Duolingo 的“单一核心品牌色”、Carbon 的中性层级、Fluent 的颜色职责和 Xbox companion 的观察/控制分层。它也能直接继承现有 Logo 中的蓝色，而不需要重绘品牌资产。视觉母版阶段需要验证：钴蓝行动色是否足以形成游戏感；五力色是否能降到不超过单屏 3%；欢迎插画能否与冷白工作台在同一材质体系内衔接。

## 可访问性策略

- 正文和图标目标对比度不低于 4.5:1；24px 以上或 18.5px 粗体标题不低于 3:1。
- 伍力永远同时显示字母 R/A/S/P/E 与中文名，颜色不是唯一识别手段。
- 成功、警告、危险同时使用图标、文字和色彩；在线状态不只显示绿点。
- Focus ring 使用 3px 半透明钴蓝外圈并保留 3px offset；它与 selected state 的浅蓝填充、底部实线形态不同。
- Disabled 通过明度、描边和文案共同表达，不仅降低透明度。
- `prefers-reduced-motion` 下关闭背景漂移、卡牌入场和脉冲；异步状态保持静态文字可读。
