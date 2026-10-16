# WQT-007 · 下载中心

- 状态：已部署生产；需求方实际资料发布/体验验收待确认
- 需求来源：2026-10-12 用户聊天：云端桌游资料更新、登录且权益有效才能查看下载、两个玩家入口、平台上传、下载审计。
- 负责人：本次执行代理；业务验收人：需求提出方
- GitHub：[PR #8](https://github.com/veasil/wqt-platform/pull/8)、[构建修复 #9](https://github.com/veasil/wqt-platform/pull/9)、[版本保护 #10](https://github.com/veasil/wqt-platform/pull/10) 已合并；PR7因生产基线校正已关闭。
- 版本：实际生产发布 aa40cb26641b419ad99672a9515b4187982ec290，基于原运行5bc69a1保留生产功能；工作区C:/ArdenDev/worktrees/wqt-download-center-live。

## 目标与范围
平台 boss 上传桌游资料版本；玩家查看最新版本并下载；记录下载请求及结果。非目标：自动发布、跨产品权益、新存储服务、浏览器保存证明。

## 验收标准
| ID | 场景或检查 | 预期结果 | 验证方式 |
|---|---|---|---|
| AC-01 | 未登录、无付费权益或过期 | 不返回目录及文件；沿用生产用户/组织会员有效期，平台角色的有效期豁免不自动授予资料下载权益 | HTTP 自动测试 |
| AC-02 | 上传与更新 | 仅 boss 可上传，私有 OSS 对象，保留版本与摘要 | 自动测试与真实 OSS 待验证 |
| AC-03 | 下载 | 后端鉴权后传输，不暴露对象链接；写审计失败拒绝传输 | HTTP 自动测试 |
| AC-04 | 审计 | 请求、拒绝、服务器传输结束/失败可追踪；仅 boss 查询 | 自动测试与管理端验收 |
| AC-05 | 玩家入口 | 登录区个人中心旁、个人中心顶部提供下载箭头入口；目录有错误/空状态 | 浏览器检查 |

需求及标准确认：用户已确认上述功能请求；技术细化依现有权益规则，不自行标记业务验收通过。

## 步骤
新增资料版本及事件表，不修改历史业务数据。采用既有 OSS 的 private ACL，经服务器传输。最新版本按创建时间及 UUID 排序；旧版本留档，不提供普通玩家下载。上传与审计同事务，OSS 写入失败不发布，数据库失败尝试清理新对象。审计保存生产 users.id / organizations.id、版本、时间、结果、请求 UUID；不存 token、IP 或电话。不自动清除审计。进程终止可能留下 requested 事件，不能视为成功。
回退：回退代码后保留新表及 OSS 对象，不自动删除审计。上线前独立库验证新增 schema，生产迁移由发布负责人执行。

## 验证记录

| 验收 ID | 环境与版本 | 命令/操作与证据位置 | 结果 |
|---|---|---|---|
| AC-01–04 | 原生产 main 独立工作区，HTTP / OSS / DB 替身 | npm run test:downloads | 5 通过，覆盖权限、到期边界、私有 ACL、审计失败拒绝传输、版本失效、存储失败及事务失败清理 |
| AC-05 | 本机 Edge / Playwright，原版静态文件与合成 HTTP | WQT_BROWSER_CHANNEL=msedge npm run test:downloads:browser | 1 通过，验证拒绝/空列表/安全文本/390px布局/浏览器实际下载 |
| AC-02、04 | 原版平台管理前端 | npm --prefix admin-web run build | 通过；已有大 chunk 警告 |
| 全部 | 独立 main 工作区 | git diff --check，node --check 新增 JS | 通过 |

新增专用 Download center contracts CI；尚未提交，不声称 GitHub CI 已执行。源码测试不导入 server.js，不连接业务库。真实 PostgreSQL schema、既有登录与下载端到端、OSS 私有访问及中文文件名须在发布前以隔离库/专用对象联调；本会话未提供独立测试库配置。没有启动生产或本机默认后端。

## 原版适配与工程回顾

用户追加确认：目标是原版生产，生产跟随 main。已从账号改造工作区迁移到独立 main 分支，并仅撤掉该工作区本会话下载改动；不将 WQT-006 或模块化场次迁移带入本分支。

- 生产主入口仍为 server.js，只注册独立下载模块。原版登录、用户、组织与权益语义保持不变。
- 新增 withTransaction 仅供下载发布，将版本 metadata 与发布审计放在同一 PG 连接提交。否则审计失败可能导致已发布版本没有对应记录。
- OSS 与数据库无法一起提交：先上传私有对象，事务失败尝试清理；清理失败记服务器日志。此类失败或进程中断可能产生孤立私有对象，后续由运维核对，不自动批量删除。
- 下载请求审计写入失败不读 OSS。发送后审计失败保留 requested 并记日志，不把审计故障谎报为文件传输失败。
- 未通过原版鉴权的请求不从未验证 token 提取用户，审计用户 ID 可为空；成功下载与发布绑定已认证用户。
- 当前页面只展示最近 200 条审计和最近 100 个版本，数据库保留全部；分页/筛选和审计保留期限后续另行决定。
- 上传与浏览器下载沿用内存方式且上限 50 MB；大文件和并发上传容量未验证。没有新增队列或存储框架。
- 值得理解的三个边界：私有对象与前端按钮的区别；文件传输结束与本机保存的区别；跨 OSS/数据库操作的失败补偿。


## 验收与交付
已提交实现 a17995e，草稿 PR #7；未业务验收、未合并、未发布。

## 2026-10-12 上线就绪复核

结论：暂不技术放行生产；可进入隔离环境联调。用户问“能上线吗”不视为部署或生产数据库写入授权。
复核范围：本次下载中心增量，参考 mvp-security-check 的认证/授权/文件存储/应急条目；不代表原系统整体安全体检。

- 已验证：HTTP 替身专项复跑 5/5，代码 diff 检查通过；此前浏览器实际下载 1/1、平台构建通过。后端付费权益和 boss 权限、私有对象上传参数、审计失败拒绝开始下载均有测试。
- 未验证阻断项：真实 PG 新表及索引创建、重复执行与事务回退；生产原版 JWT/会话及实时组织到期/停用端到端；真实 OSS 上传/下载与匿名直链被拒绝，中文压缩包内容一致性。
- 发布准备缺口：仍未提交/PR/运行 GitHub CI，未记录生产备份、部署负责人及具体回退版本；现有回退设计保留审计表与私有对象。
- 环境证据：未配置专用 WQT_TEST_PG_ADMIN_URL，docker ps 未列出运行容器。未使用生产或默认数据库替代隔离验证，未尝试读取生产凭据。
- 范围内风险：上传/下载采用内存方式，50 MB 单文件上限；没有并发限额及容量证据。首次小规模发布前应按实际服务内存验证目标并发，不能从单次浏览器下载推断容量。
- 需人工核对的外部状态：对象桶策略是否允许匿名读取此 private 对象；生产服务备份与回退可执行性。本地 ACL 参数检查不能证明桶策略。

## 后续验证与用户决策（2026-10-12）

用户确认：暂不更改生产登录；无测试 OSS，完成其他验证并保留 OSS 待验项。

已建立仅绑定 127.0.0.1 的一次性 PostgreSQL 16 容器。每次 PG 测试创建随机独占数据库，子进程用环境白名单且在空临时目录运行，不加载业务 .env。测试结束删除其独占库，并核对没有残留测试数据库；从未连接生产。

最终专项：npm run test:downloads 7通过/0失败/0跳过，其中1项真实PG并包含真实原版登录和浏览器端到端。静态浏览器契约另1通过。真实PG覆盖schema重复执行、原版三要素登录、会话轮换、个人到期、组织到期/停用、实时boss降权、中文版上传与下载、SHA-256一致性、审计不可用拒绝传输、事务回退及发布审计失败时metadata回退和OSS替身清理。新增短文件流用例，传输字节数不足不能写server_sent。

平台与组织两个前端构建均通过，保留已有大chunk警告。新增CI使用一次性PG服务，构建平台后跑真实PG/浏览器及静态契约。具体发布检查及回退见[release.md](release.md)。旧的“缺测试PG”说明是当时历史状态，本节更新了验证进展；真实OSS和生产运维验证仍未完成。

原版 /api/auth/admin-login 只凭手机号签发管理员令牌，是本次审查发现且按用户决定未修的认证缺陷。已有前端使用密码及验证码不消除该旁路。此缺陷与真实OSS待验仍阻止本次安全放行；用户决定暂不修改不等于已接受生产发布风险。

## 云端验证收尾

[Download center contracts](https://github.com/veasil/wqt-platform/actions/runs/38224457997) 已成功，验证提交 438e8cf，Ubuntu/Node22/专用PG16/Chromium。7项专项全部通过、0跳过；另1项静态浏览器契约通过；平台构建通过。草稿[PR #7](https://github.com/veasil/wqt-platform/pull/7) 未合并、未部署。

云端曾发现中文文件被浏览器命名为download。本机Windows/Edge及Chromium可正常下载，数据库及返回metadata的中文filename正确；保留下载锚点后Linux仍失败（运行38224376653）。根因为隔离子进程环境白名单删除了语言环境，Linux Chromium处理保存文件名时落到ASCII环境。只增加LANG/LC_ALL=C.UTF-8后云端通过（438e8cf），中文文件名及内容断言保持不变。测试凭据隔离应保留必要的非敏感运行环境。网络阻断只匹配HTTP，避免拦截浏览器管理的blob下载；下载锚点和blob延后清理。

本机随机测试数据库全部清理；本次创建的专用容器已停止并自动移除。无生产数据库或真实OSS读写。最终技术状态：下载功能与可执行非OSS验证完成；真实OSS和原版认证缺陷未关闭，不能把CI通过写为生产安全放行。

## 补充发布演练（2026-10-12）

需求方要求继续执行；此前“不更改登录”“无测试OSS”的决定保持有效。

- 完整原版server.js在白名单环境、空临时cwd、随机独占PG16主库/卡牌库启动；桌游、平台、组织静态页面均200，下载入口鉴权及无OSS失败行为与模块测试一致。原版顶层导入sqlite3，即使使用PG仍需其原生绑定；本机通过npm rebuild sqlite3安装，CI增加同一步骤，不修改生产卡牌来源。
- 真正pg_dump自定义格式备份，再pg_restore到另一随机独占库，资料中文文件名、全部审计ID/事件、用户数量与卡牌发布记录核对通过。不是生产备份或生产恢复时间承诺。
- 新增4个并发8MiB下载，内容逐字节一致，每请求的requested/server_sent关联独立；客户端中断只记录failed，不记录server_sent。该测试使用内存OSS与DB替身，证明传输/审计隔离，不证明生产服务50MB并发容量。
- 本机验证：test:downloads 9通过0跳过，test:downloads:release 1通过0跳过，test:downloads:browser 1通过。专用测试库均清理，未连接生产。
- 完整启动/备份恢复的可重复入口为npm run test:downloads:release，必须显式WQT_TEST_PG_ADMIN_URL和WQT_TEST_DOCKER_CONTAINER；检查容器所有权标签，dump/restore只针对本轮随机创建的库。CI使用其服务容器ID，标记wqt.test=download-center-release。

[发布门槛](release.md)中的真实OSS和原版认证缺陷仍未关闭，本轮不改变生产发布结论。

## 经授权的真实 OSS 验证（2026-10-12）

用户提示已有OSS key，核查现有.env与.env.staging均完整且使用同一组凭据和同一桶，不能将文件名当作独立测试存储。仅输出凭据完整性，不输出值。只读确认凭据有效，桶ACL为public-read。

用户明确授权：“允许执行这个临时对象验证”，范围为现有桶download-center/verification/随机路径的约64字节私有合成对象，验证后只删除该对象，不改桶设置/现有文件/数据库。

执行scripts/verify-download-oss.mjs，对象0646f739-6dcd-4756-a662-b199bb720af5：private ACL核对通过，签名凭据读取内容逐字节一致，去除签名后的匿名GET为403。删除精确对象（若返回版本ID则删除指定版本），随后凭据HEAD返回404。未枚举或改动其他对象，未连接生产数据库。

真实OSS基础权限与读写门槛已有证据；公开读桶不意味着显式private对象公开，本次实测证明该对象匿名读取被拒绝。未测生产完整HTTP/数据库/OSS链路、50MB容量或外部对象备份恢复，不能扩大本次证据含义。原版管理员手机号认证旁路仍未关闭，继续不安全放行生产。历史“无OSS待验”的记录保留，本节是最新状态。

## 管理员认证旁路关闭（2026-10-12追加授权）

需求方在确认风险后明确要求“哦哦 关闭吧”，覆盖此前暂不修改此接口的决定。候选代码将/api/auth/admin-login所有方法改为410/ADMIN_LOGIN_CLOSED，no-store，既不查询手机号也不签发/轮换会话。原/api/auth/login密码+短信验证码流程保留。

新增无数据库HTTP回归覆盖GET/POST/PUT/PATCH/DELETE/OPTIONS，均拒绝且无令牌；真实PG回归覆盖已有boss、watcher、未知手机号均拒绝，已有session逐项一致；完整server.js也验证该接口关闭。现用Vue管理端已用三要素登录；旧admin-panel/app.py的两个调用将失败，该旧Streamlit入口不属于当前Vue登录流程，本轮不延续不安全登录。

本机10项专项、1项完整启动/备份恢复、1项静态浏览器全部通过，0跳过；三要素登录与上传下载链路通过。此关闭尚未部署，不能报告线上接口已经关闭。关闭接口不自动撤销已签发的JWT；发布负责人应在部署时评估并沿用现有强制下线/重新登录流程重建管理员会话，本轮未修改任何生产会话。

回退不得恢复手机号认证旁路；如果下载中心需回退，应保留本安全补丁，不能直接回退到未修的原352edf1。产品验收、生产发布操作与现网容量仍须记录。真实OSS基础权限此前已通过，候选中本次具体认证缺陷已修；这不代表全站安全审计或生产全链路已验收。

## 2026-10-13 正式部署授权与基线校正

需求方两次明确要求“部署”，授权当前下载中心与手机号旁路关闭版本的正式合并/部署。发布前只读核查发现生产镜像实际为部署6a56112af9e67eefe065c705、提交5bc69a17c9554ecb8d2e26befc095368be168293、旧feat/cards-2026-workbench引用，不是用户先前理解的main/352edf1。main相对实际生产缺失卡牌素材、复盘、忘记密码和个人中心等77个文件变化，故不部署PR7的旧main候选。

已以实际生产5bc69a1创建codex/download-center-live-release，只移入本功能、认证关闭、测试与文档。生产原有代码/素材保持；保留reset-password和既有会话实现。当前diff相对真实生产除新文件外，server只有注册2行、两个玩家入口各1行、平台导航各1行、db只增加下载初始化和事务、auth只关闭旁路。根build改为ci --include=dev，避免生产模式缺Vite；保持现有allowScripts配置。

本机以专用一次性PG18完整重验：10专项、1完整服务/备份恢复、1静态浏览器通过（0跳过）；生产模式npm run build通过。CI扩展PG16/PG18矩阵。

生产读取：PG18.6、应用与卡牌同库zeabur；应用角色可创建public表；用户41、会话28。平台内置createBackup拒绝Upgrade needed，不升级或采购。改用现有PG18工具备份zeabur到持久卷，pg_restore目录读取成功，权限600、大小1257345字节、SHA256=8cdbbe168a6cba2f5bc9ab47b66771a60dc2b1c764f163beddcb94a26ca71f5e。路径/var/lib/postgresql/wqt-release-backups/wqt007-20261013-224e1763-88d6-4032-addb-072276233d01.dump。未导出客户记录到本机、Git或聊天。备份不代表生产全库恢复演练已执行。

安全回退已准备：codex/download-center-safe-rollback，157c6c6；基于实际生产5bc69a1仅关闭手机号旁路并修正production构建。保留新表、审计和OSS对象；不以旧未修镜像回退。正式部署继续保持gitTrigger=null，使用明确候选提交，不能重新开启日常推送自动上线。

## 首次生产构建失败与范围内修复

PR8已合并，候选main179172d，实际代码树与PG16/18双CI通过候选一致。deployFromSpecification拒绝Invalid input，读回无部署/配置变化；使用既有deploy mutation明确gitRef main后得到部署6acdd6f948c5c4b0780733f0，commitSHA准确。平台仍保留gitTrigger=null。

构建阶段失败，生产仍运行旧镜像，未进入新代码启动。日志EALLOWREMOTE拒绝playwright-core在registry.npmmirror.com的URL。此前npm install --package-lock-only受到本机registry配置影响，将新增测试依赖的锁文件URL又写回镜像站。修复只规范残余resolved为registry.npmjs.org，每包version和integrity逐项断言一致；不扩大allowScripts、不启用allowRemote、不绕过平台安全机制。进一步CI和部署结果以下文及平台记录为准。

## 最终生产发布证据（2026-10-13）

- 发布授权：需求方明确“部署”；平台服务scoring-system（6a22926fe957fb053c550c2f），环境production（6a2289b495b39806d284a7c3），原服务和变量保留。
- PR8/9/10依次合并。CI在PG16和PG18均通过：原功能12项，版本删除保护增加1项，最终每个PG矩阵13项、0跳过；[最终CI](https://github.com/veasil/wqt-platform/actions/runs/38380181463)。生产模式前端构建通过。
- 第一次main179172d部署6acdd6f948c5c4b0780733f0在依赖安装阶段EALLOWREMOTE失败，原运行镜像保留，无新代码数据库初始化。锁文件两条Playwright URL改官方registry后，main eb404a6的部署6acdff88da7cf920c263c935成功。
- 范围内集成检查发现旧通用OSS删除接口能够删download-center版本对象。PR10仅禁止该命名空间（包含规范化别名）经旧接口删除，保留更新发布、历史版本和其他对象管理行为；完整服务测试覆盖boss/玩家均拒绝，不执行真实对象删除。
- 最终提交aa40cb26641b419ad99672a9515b4187982ec290、部署6ace01b0da7cf920c263c9b2，平台状态RUNNING，镜像tag=d-6ace01b0da7cf920c263c9b2；gitTrigger仍null。准确核对实际commitSHA，不以deploy mutation返回true代替上线证据。
- 域名https://www.ai5000days.com：首页/my.html均200并包含/downloads.html；/reset-password.html、/downloads.html、/admin/、/enterprise/、/cards-pdf/2026B01.webp均200。/api/downloads、/api/downloads/verification/file、/api/admin/downloads、/api/admin/downloads/events匿名401。POST /api/auth/admin-login为410/ADMIN_LOGIN_CLOSED；正常POST /api/auth/login缺三要素返回400，不发短信。
- 实际运行容器只读核对旧删除接口已有新版本保护，普通/规范化对象键均判定保护。未伪造生产用户JWT、未冒用账号、未创建生产测试用户。
- 生产库zeabur：用户仍41，新download_releases/download_events及索引就绪；资料版本0，平台首次实际文件待负责人上传。线上未执行真实会员上传/下载/短信业务UAT；该链路已在隔离PG16/18与浏览器验证，真实OSS基础权限已按单对象授权验证。
- 安全收尾：撤销boss/operator旧会话5个，防止旧手机号旁路已签发token继续有效；普通玩家会话保留。之后正常三要素重新登录即可，未改密码或JWT_SECRET。
- 生产备份沿用上述PG18原生dump（600权限/TOC可读/摘要），没有下载客户数据到本机或上传Git。安全回退更新至683594c74734e75e96151cb63d3e132b3dcc8751，保留认证关闭和版本对象保护，移除新功能时不删download_*表/审计/私有对象。
- 本机专用PG容器和独占库已清理。用户的账号改造工作区未合并/部署。未开启自动合并、自动部署或付费备份。

本轮改变的假设：Git默认main与实际运行提交并不等同；平台RUNNING、具体镜像与commitSHA才是部署事实。新增不变量：回退不能恢复认证旁路，下载版本不能由通用OSS删除接口绕过留档。遗留事项：需求方上传真实桌游资料并体验验收；真实生产容量/全量恢复仍不由本次冒烟证明。重要概念：部署与Git合并的区别、私有对象与桶公开读的区别、修复签发入口与撤销旧会话的区别。
