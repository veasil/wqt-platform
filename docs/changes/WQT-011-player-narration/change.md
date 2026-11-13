# WQT-011 · 新版玩家端少年音朗读

- 状态：本地实现，真实语音联调阻塞，待产品验收
- 需求来源：2026-10-28 用户「落地啊 就是新版的朗读功能」；关联 TTS-001 / TTS-002。
- 负责人：当前执行代理；产品验收由需求方完成。
- GitHub：未创建 Issue / PR。版本：当前含其他开发工作的工作区，禁止覆盖无关修改。

## 目标与范围

新版正式场次的题面使用火山引擎统一音色，后端从场次发布快照提取标题和题面，不接受客户端任意合成文本。默认少年梓辛 `zh_male_shaonianzixin_moon_bigtts` / `seed-tts-1.0`，为本次实现默认值，未找到过去试听确认记录。语速默认 -5，可配置。只朗读标题和题面，保留原范围。

非目标：宣传片配音、重写旧端、批量覆盖旧音频、迁移卡牌、上线或代签音色质量验收。练习场景显式标示设备朗读；正式场次不静默降级成其他音色。

## 验收标准

| ID | 场景或检查 | 预期结果 | 验证方式 |
|---|---|---|---|
| AC-01 | 正式场次朗读 | 实时鉴权，只取可访问场次快照中的发布卡；拒绝越权与任意文本 | 路由测试 |
| AC-02 | 生成与复用 | 标题、题面、音色、资源版本、语速组成缓存键；私有 OSS 缓存，跨进程 PG 锁保护同一内容生成 | 服务测试；真实环境待验 |
| AC-03 | 播放 | 点击播放/暂停/继续；切题、切页面、退出时取消等待并停止；迟到响应不自动播放 | 前端控制器测试 |
| AC-04 | 异常 | 未配置、超时、限流、供应商错误、空/截断音频、OSS 失败均明确提示；不阻塞计分、不缓存失败 | 服务和前端测试 |

需求目标由上述用户指令确认，技术标准承接 TTS-002。具体音色听感由需求方最终验收。

## 步骤

1. 独立后端 TTS 服务，固定官方 HTTPS 端点，凭据仅在服务端；限制文本、响应大小和生成并发，不自动重试计费请求。
2. 受保护场次接口，复用既有实时授权和发布快照，私有缓存从同源认证接口读取；不修改卡牌音频字段。
3. 新版播放器控制器管理请求、对象 URL、暂停及清理；CSP 仅增加 blob 媒体。
4. 隔离供应商和 OSS 回归，记录真实凭据与上线阻塞。

不涉及 schema 迁移、组织归属或权益变化。回退：撤回本次接口/播放器变更，旧卡牌 `audio_url` 未覆盖；新缓存位于独立 `cards-narration/v1/` 前缀，可保留。

## 验证记录

| 验收 ID | 环境与版本 | 命令/操作与证据 | 结果 |
|---|---|---|---|
| AC-01/02/04 | 2026-10-28 本地工作区，合成凭据、OSS/供应商桩 | `node --test tests/runtime/card-narration.test.mjs tests/frontend/narration.test.mjs` | 首轮 11/11 通过；覆盖请求契约、鉴权处理器、快照拒绝、缓存内容版本、并发合并、持锁失败、空/损坏/截断/超时返回及存储失败；不是实际 PG 鉴权或真实语音证据 |
| AC-03 | Playwright Chromium，实际新版页面，HTTP/Audio 桩 | `$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\BibbTwigs\AppData\Local\ms-playwright'; node --test tests/frontend/narration-browser.test.mjs` | 1/1 通过；按钮调用认证接口、暂停/继续只请求一次、离页停止、游戏状态未变、页面无脚本异常；不能证明真实设备听感 |
| 工程检查 | 同一工作区 | `npm run lint`、`npm run test:artifacts`、`npm run check:artifacts`、`node --check public/player/player.js` | 初轮通过，制品测试 4/4；最终重验见下 |
| 扩展回归 | 同一工作区，指定已安装浏览器路径 | `npm run test:frontend` | 61 通过、4 失败、2 跳过；4 个失败均位于现有 `scoring-activity-review.test.mjs:93` 下载文件 `download.path: canceled`；未修改该用例或下载功能，不宣称全量通过。首次未指定浏览器路径失败，纠正路径后才取得此结果 |
| 真实供应商/PG/产品 | 尚无独立火山语音凭据；未提供本轮专用 PG/Redis 测试连接 | 本地仅按变量名检查凭据是否配置，未输出值；未启动会写库的业务服务 | 未执行真实语音/OSS端到端及跨实例 PG 锁验证，不能以桩测试代替。需要配置语音凭据后小量合成和目标设备播放 |

官方协议依据：[HTTP Chunked V3](https://docs.volcengine.com/docs/doubao-voice/http-chunked-sse-unidirectional-streaming-v3?lang=zh)、[音色列表](https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh)。使用完整结束码 20000000 才接受生成成功，服务端不传身份、账号、场次或手机号给供应商，只传已发布题面和固定服务标识。

模型按当前会话设置运行；未冒充 Astra 或 Luna，未委派指定但当前不可用的 `gpt-5.6-luna`。工作区原有大量无关改动及未跟踪文件，新增模块与测试按明确路径隔离，未整理、覆盖或提交他人工作。前端防止异步迟到播放、取消旧请求、切账号/跨标签登录变化停止，并对移动端自动播放拒绝保留再次点击播放入口。

剩余风险：每实例最多 4 个处理内容，尚无供应商全局并发配额协调；同内容用 PG 锁保护。若供应商生成成功而 OSS 保存失败，手动重试可能再次计费。存储失败显式提示，不伪造缓存成功。未发现新的权限或历史归属决定，不涉及 schema 迁移。

## 验收与交付

最终重验（2026-10-28）：`node --test tests/runtime/card-narration.test.mjs tests/frontend/narration.test.mjs tests/frontend/narration-browser.test.mjs` 12/12 通过，0 跳过；`npm run lint`、`npm run check:artifacts` 通过。浏览器使用上表已安装路径。真实火山/OSS/PG端到端与手机试听仍未完成，前端全量的4个下载用例失败保留为未闭合证据。

未产品验收、未提交、未合并、未发布。本地仅发现 Ark 生图/视频类凭据变量，未发现本功能独立语音凭据，不能以 Ark 密钥冒充语音授权。需部署负责人配置语音服务凭据并做真实合成与目标设备试听。

### 后续凭据配置与真实调用尝试（2026-10-28）

用户在本会话提供凭据并授权继续配置验证。已将其写入 Git 忽略的本地 `.env` 中 `VOLC_TTS_API_KEY`，未写入源码、样例环境文件或证据；该记录取代上文“尚未提供凭据”的阻塞描述。未修改生产配置、未部署。

实际调用 `synthesizeNarration`，仅发送固定合成示例文本：原生 Node fetch 直连报 `ENOTFOUND`；显式使用当前 HTTPS 代理后报 `EACCES`。当前执行环境未取得供应商 HTTP 响应，因此不能判断密钥是否有效、是否具备少年梓辛/seed-tts-1.0权限，也不能宣称真实合成成功。未缓存任何失败音频，未继续重复请求；没有供应商成功响应或用量证据。

新增可复用的小量真实验证命令：`node --env-file=.env scripts/verify-card-narration.mjs --live`。该命令只调用固定官方语音接口，不启动业务服务或写库；记录 HTTP 状态、请求日志 ID、合成字节数或网络错误码，不输出密钥及原始供应商错误消息。下一步是在具备外网访问的受控环境运行该命令，再验证私有 OSS 缓存、PG锁及目标设备播放，产品听感仍由需求方确认。

### 继续排查与全量回归闭合（2026-10-28）

用户要求继续推进后读取已有香港运维指南，尝试 `python scripts/ops/hk_next.py status`：固定主机的 SSH 直连与 HTTP CONNECT 代理均在连接阶段报 PermissionError，未提交任何服务器命令。Python requests 访问火山公开站点亦因本机代理 socket WinError 10013 失败。没有取得可用的远程执行入口，未更改代理、TLS校验、主机公钥信任、生产配置或网络权限策略。真实供应商 HTTP 结果仍未知，凭据已配置但未验证有效性。

前端下载失败继续定位：指定已安装 Playwright 浏览器后，把本次测试进程 TEMP/TMP 指向仓库内 `tmp/narration-test-temp`，4项原失败全部通过；随后完整 `npm run test:frontend` 为 **68项，66通过、0失败、2跳过**。2项因缺少专用PG/Redis连接跳过，不能作为数据库集成证据。此结果取代上文“4个下载用例未闭合”的当前状态，原失败保留为排查历史。没有修改下载业务或放松断言。尝试 C:/workspace 临时目录被运行环境拒绝后，改用实际可写的仓库目录。

复现命令（PowerShell，仅影响当前测试进程环境）：

```powershell
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path ./tmp/narration-test-temp | Out-Null
$env:TEMP=(Resolve-Path ./tmp/narration-test-temp).Path
$env:TMP=$env:TEMP
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\BibbTwigs\AppData\Local\ms-playwright'
npm run test:frontend
```

实际阻塞：当前执行环境不允许所需 socket 连接，真实合成/缓存/上线需要具备该网络访问权限的执行环境；本地代码与回归可接续，尚无真实音频、供应商验签、OSS/PG联调或生产部署成功证据。
