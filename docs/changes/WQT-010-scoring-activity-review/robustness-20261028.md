# Safari 导出与玩家错误恢复 · 2026-10-28

状态：导出与错误恢复已完成本地技术验证，待验收；length 原始异常待复现。工作区变更，未提交、未发布。需求来源：本聊天用户报告 UNSDG Wi-Fi 连接重置、MKTforGOOD 可访问，Safari 偶现关于 length 的小红字，并明确要求处理 robustness。

范围：报告图片导出的依赖、失败恢复和玩家页面技术异常提示。不改认证、租户、数据归属、DNS、生产配置；不自动重试可能计费的报告生成。

证据：指定源 IP 8.217.44.101、绕过 HTTP 代理的 curl 请求返回 200；用户换 Wi-Fi 恢复，故障网络尚未抓包，不能确定是 DNS、防火墙或出口链路。线上 game-review.js 依赖 jsDelivr html2canvas 1.4.1；合成报告 Chromium/WebKit 均有成功下载，另一次 WebKit 外部脚本 SSL connect error 后弹出 Can't find variable: html2canvas。用户 length 原文、调用栈和触发步骤未知，不把此异常归因于 CDN。

验收（用户要求的技术化表达）：
- 新生成的下载报告具备内嵌图片渲染器，离线导出不依赖第三方 CDN；依赖准备失败仍可阅读/打印报告。
- 生成图片失败有可理解的提示、可再次尝试；提供明确的保存入口，避免只依赖异步自动下载。
- 限制画布面积/边长、释放画布；失败不丢失原报告。
- 玩家 TypeError/ReferenceError 不直接以 length 等内部属性名作为用户提示，保留控制台诊断；已有业务拒绝提示保留。
- 合成浏览器验证成功、依赖缺失、渲染失败、重复导出及长报告；不调用真实短信、AI或业务库。

方案：同源固定版本渲染器随报告打包；有界准备请求失败时保留阅读与 PDF 出口。图片生成和用户保存拆为两步；PNG Blob 代替巨大的 data URL，按尺寸调整缩放。只处理已证实的边界失败，不用默认空数组掩盖未知 length 契约错误。

用户补充：length 红字出现在“其他操作时”，不是已确认的生成报告或导出图片步骤。已请求所在页面、前一步按钮和 Safari 版本，尚无调用栈；此根因保持未定位。

## 实现与证据

- `public/vendor/html2canvas-1.4.1/` 保存未修改的 198,689 字节发行文件、MIT LICENSE 和来源/摘要。生成报告时以 8 秒上限准备同源渲染器并内嵌；准备失败仍生成文字报告，可在导出时再次尝试同源加载。
- `public/game-review.js` 使用 PNG Blob 和用户点击的保存链接；有预览、失败提示、8,000,000 像素/8192 边长限制、画布释放及重复导出。长报告缩放并提示 PDF 更清晰；不是分页导出。截图发现旧渲染器不支持底栏渐变文字，克隆导出节点时用纯色保留字标。
- 上传返回成功但缺少文件 URL 时回退本地 HTML；取消或重复下载不会提前撤销本地副本。替换报告时释放上一个本地副本。
- `public/player/errors.js` 与 `player.js`：TypeError/ReferenceError/SyntaxError、5xx、连接未完成分别提供恢复提示；具体业务拒绝仍显示原文。控制台保留原始异常及页面上下文，未增加远端遥测。没有用缺省空数组掩盖契约异常。

验证命令与结果：

| 检查 | 实际结果 |
|---|---|
| `node --test tests/frontend/report-export.test.mjs` | 最终 7/7；包含真实离线 PNG 签名、可解码预览、再次保存、依赖失败恢复、渲染/编码失败、画布尺寸释放、实际玩家错误边界和本地 HTML 重复下载 |
| `node --test tests/frontend/review-eligibility.test.mjs` | 4/4；指定场次不回退其他场次，生成资格不受卡数影响 |
| `node --test tests/frontend/*.test.mjs` | 中间版本 71 通过、2 既有条件跳过、0 失败；随后新增的两项测试及最终调整由上面的最终专项覆盖，没有把中间批次冒充最终全量批次 |
| `python -u tests/browser/verify-report-export.py --browser webkit --output C:/ArdenDev/tmp/wqt-connectivity-20261028/webkit-final-render` | 成功；拒绝所有 HTTP(S)，连续两张 PNG 下载、预览解码及故障后保留前一张图片，pageerror 为空、外部请求为零 |
| JS `node --check` 与 `git diff --check -- public/game-review.js` | 通过 |
| 制品结构检查 | 通过；不代表业务验收或已发布 |

WebKit 验证过程的限制：最初的 Playwright offline 模式会使本地 Blob 预览破图，原来仅检查 PNG 下载不足以发现；增强为预览必须可解码后该场景失败。改用阻断 HTTP(S) 的方式保持外网不可用并保留本地 Blob，断言通过。Windows WebKit 的 file 导航也有超时，未当作成功；最终从合成页面呈现报告，不以此替代真实 Mac 打开下载文件的验收。最终 PNG 与页面截图已人工查看，不能把模拟内核当成真实 Safari。

## 工程复核与交付

改变的假设：页面可访问不等于所有 Wi-Fi 可访问；触发下载不等于图片与预览可用；length 异常与导出依赖失败没有证据关联。

新增保证：导出失败保留原文与此前成功图片；生成与保存分别确认；业务错误、技术诊断和用户恢复提示各自可验证。没有 schema、权限或部署变更。

新增维护成本：每份正常新报告增加约 199 KB 渲染器，固定版本需要维护；极长报告降低图片分辨率，PDF 是清晰度出口。旧报告不自动更新，需重新生成。控制台诊断仍依赖现场采集，没有新增跨设备错误上报系统。

待办责任：用户补充 length 触发步骤后继续定位；现场网络负责人/后续诊断核查 UNSDG DNS 与链路，不能据网络名称推断具体拦截机制。真实 macOS Safari 下载文件的验收、GitHub 提交/PR与生产发布未完成，不代签。
