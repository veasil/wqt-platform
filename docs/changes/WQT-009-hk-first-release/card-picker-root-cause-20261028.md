# 选择当前卡牌：WebKit 列表高度塌缩诊断

状态：根因已复现；诊断工作稿，未提交、未修改业务代码、未发布修复。

## 来源与范围

2026-10-28 用户提供 iPhone Safari 截图，反馈“选择当前卡牌”只显示筛选栏和“找到15张卡牌”，卡牌被裁掉且无法下滑，要求找根因。本次只做公开资源核对和隔离浏览器复现，不访问业务数据库，不使用真实用户会话。

## 运行版本与证据

正式 scoring 域名 `/api/health` 返回 c466f02481ee7e8dc0afbb2234859034f483ae7f。通过香港机器验证正式 HTTPS，player.js、player.css、flow.css、flow-controls.css 均 HTTP200，原始字节 SHA256 与 `C:/ArdenDev/wqt-aliyun-captcha-20261027` 的发布代码一致。

- player.css：31e39472ef96c4be84d661b9afe8826f853c0e89e5e701d97f56bf68d20cf9d6
- player.js：99e43d25aa22b5168f21b1099079bf65527c010868537119603fbcb54ee9a3ea
- flow.css：c93052aaaaf53dbec69312c88adc4efb5927e8cb93abe09dbd98baed8bcc0a00
- flow-controls.css：24a2363a9f517abdc94d6b6f25735a5d5f84a6de5630c195f67bcbd3a66d39ba

主工作区 player.css 与发布版不同，诊断以发布工作树为准。

## 假设与实验

1. 卡牌数据没有加载：`player.js:583–621` 先生成按钮，再用 DOM 按钮数显示“找到 N 张卡牌”；截图中的15对应已生成按钮。复现使用15张合成卡牌，排除真实接口、账号权限与网络影响。
2. 移动端列表滚动事件失效：测量实际布局并设置 scrollTop。WebKit 中 scrollTop 可以变化，但列表可触摸区域仅6px，因此不能将问题归因于监听器阻止触摸。
3. 自动高度与 flex 尺寸计算导致塌缩：相同源文件、相同合成数据分别运行 Chromium 和 WebKit；随后只在隔离页面注入明确弹窗高度，比较前后。

Python Playwright 路由拦截本站全部资源；只提供发布工作树静态文件，API 均返回合成响应，外站请求全部拦截。将 player.js 最后 `safe(resumeLogin)` 替换为合成15张卡牌、practice=true、直接调用实际 pick()，保留真实弹窗实现和全部样式。浏览器无 pageerror。

| 引擎 | 视口 CSS px | 原列表高度 | 注入明确弹窗高度后 |
|---|---|---:|---:|
| Chromium | 393×740 | 250.42px | 250.42px |
| WebKit 26.0 / Playwright v2248 | 393×740 | 6px | 245.5px |
| Chromium | 393×852 | 362.42px | 362.42px |
| WebKit | 393×852 | 6px | 357.5px |
| Chromium | 390×600 | 110.42px | 110.42px |
| WebKit | 390×600 | 6px | 105.5px |
| Chromium | 1365×1000 | 440px | 440px |
| WebKit | 1365×1000 | 6px | 440px |

393×740 的 WebKit 弹窗原高度452.5px，列表 scrollHeight=1927px、clientHeight=6px；设置 scrollTop=500 可读回500。明确弹窗高度后外框692px，列表245.5px。桌面宽度 WebKit 也复现，说明不是仅由手机断点触发。

本机原始证据：`C:/ArdenDev/tmp/wqt-card-picker-20261028/evidence.json`、`C:/ArdenDev/tmp/wqt-card-picker-webkit-20261028/evidence.json`。一次性复现脚本位于同级 tmp 的 diagnose-card-picker.py / diagnose-card-picker-webkit.py，可再次运行；这些是本机诊断产物，未作为仓库回归测试交付。Windows WebKit 截图产物为空，不作为视觉证据；结论依据 DOM 几何测量和用户截图，尚未在用户物理设备复测。

## 根因

发布版 `public/player/player.css:133`：弹窗为纵向 flex，仅约束 max-height，外层 overflow:hidden；列表 flex:1（实际为1 1 0%）且 min-height:0，并带3px上下内边距。`:145` 又使通用弹窗 height:fit-content。

WebKit 在这一组合下按内容计算弹窗高度时，没有为弹性卡牌区分配可见内容高度。列表内容高度缩为0，最终只剩上下内边距合计6px。外层 overflow:hidden 使弹窗也不能承担滚动；上方筛选栏正常，下面只能看见卡牌边缘，与用户现象一致。

这属于页面尺寸约束的跨引擎兼容缺陷。Chromium 对同一组合的结果不同，原有 Chromium 布局用例又没有打开卡牌选择弹窗，因此未覆盖该缺陷。

## 修复方向与回归边界

隔离页面注入 `.game-drawer.flow-card-picker { height:calc(100dvh - 48px) }` 已证明明确高度可解除塌缩，但该实验不是已交付修复。正式实现应只作用于卡牌选择器，保证可见列表最小空间，并考虑短屏、横屏和软键盘挤占高度时筛选区域如何滚动。相同 flow-card-picker 类也用于“卡牌预习资料”，不能无测试地给所有使用者统一固定布局。

回归应覆盖 Chromium + WebKit，手机/桌面/短屏，断言列表可见高度、滚动至末张并能选中、搜索与风险筛选后继续可用，以及关闭面板与卡牌预习资料不受影响。真实 iPhone 上最终触摸验证仍需进行。

本次改变的假设：卡牌存在，失败在渲染尺寸，不在数据获取。新增工程认知：max-height 只限制上限，不能保证 flex 子区获得实际高度；有 overflow:auto 也不保证存在可用的滚动触摸区域。未引入代码、架构、权限或数据迁移变更；待修复和补跨引擎回归。
