# WQT 真实预发布环境研究方案

研究日期：2026-09-12。状态：建议稿，未采购、未创建云资源、未部署。需求方已确认生产部署在 Zeabur，项目标识为 project-6a2289b3f1be9943f1f9153d；本轮已通过 Zeabur API 只读核查服务与部署元数据，结果见下文。

## 建议

生产已确认使用 Zeabur，建议用同一平台建立独立 wqt-staging 项目，配独立小型服务器、PostgreSQL 和私有 OSS bucket。代码继续使用同一 GitHub 仓库，部署绑定通过 CI 的准确 SHA。三个前端仍由同一个 Express 服务托管，不新增微服务或 Kubernetes。

若实际生产已经使用自管服务器，则优先复用同样的部署方式在另一台测试服务器运行，避免为了预发布额外维护一套平台。最低成本可同机独立容器/网络/数据库账号/卷，但资源故障仍会相互影响，不作为首选。

Zeabur 官方建议不同环境用不同项目；其 2026 年公告已停止共享集群新项目，采购应按专用服务器评估。项目复制会复制变量和磁盘数据，不建议直接克隆生产项目后立刻运行。[最佳实践](https://zeabur.com/docs/en-US/get-started/best-practices)、[平台变更](https://zeabur.com/changelogs/phasing-out-shared-cluster)、[项目复制](https://zeabur.com/docs/en-US/deploy/manage/copy-project)。

## 最小资源

| 资源 | 建议配置与目的 |
|---|---|
| 计算 | 单实例 Node22，暂估 2 vCPU / 2–4GB RAM 起步，按构建与运行峰值测量调整；这是工程起点不是容量保证 |
| 数据库 | 独立 PostgreSQL，版本先核对生产；现 CI 是 PG16。数据库仅内网访问，专用账号，绝不引用生产连接 |
| 卡牌库 | DATABASE_URL 和 CARDS_DATABASE_URL 都显式配置；生产若分两库，预发布复制这一拓扑，不擅自合并 |
| 域名 | 建议 staging 子域，HTTPS 和团队访问限制；同源的 /staging 路径会与生产共享 localStorage，现有绝对 /api 路径也需额外适配 |
| 文件 | 独立私有 OSS bucket，独立 RAM 凭据仅允许测试桶必要操作，包括失败上传清理所需删除权限 |
| 短信 | 单独 Bmob 测试应用（需核实账号能力）或测试凭据，真实发送仅团队同意的号码；接收人白名单需后端实现，当前固定码白名单不是发送保护 |
| AI | 独立项目/key，低额度告警；供应商若无硬限额，需服务端配额，不能把预算告警当熔断 |
| 备份 | 私有备份存储、校验摘要、明确保留期和恢复记录；禁止存入公开 GitHub artifacts |

OSS 的 RAM 策略可以把凭据限制到指定桶/对象，私有 ACL 和身份授权应一起检查。[阿里云权限说明](https://www.alibabacloud.com/help/en/oss/how-to-control-access-permissions-on-oss)、[RAM 策略](https://www.alibabacloud.com/help/en/oss/user-guide/ram-policy/)。

## 项目当前必须补的启动保护

以下来自当前本地代码，不是已经实现的配置能力：

1. src/config.js 先读环境，再用数据库非空 system_settings 覆盖。生产副本必须在应用启动前清理外部连接、密钥与通知配置，只按白名单保留业务设置。
2. src/runtime.js 的 OSS_BUCKET_NAME 缺失会回退现有桶名。staging 应要求显式 bucket 并在有效配置不匹配预期时拒绝启动，不能只靠变量命名。
3. src/services/sms.js 缺少 Bmob 凭据时会返回 mockCode，并未限制只能 NODE_ENV=test；TEST_LOGIN_CODE 也可重复通过验证。对外预发布必须禁止这些模式，以真实短信验证手机控制权。先前完整登录测试验证的是隔离替身链路，不能推断部署配置安全。
4. JWT_SECRET 仍有开发默认值回退。预发布需要独立强密钥、独立 SETTINGS_ENCRYPTION_KEY、SERVER_ENV=staging，缺失时应失败；NODE_ENV 使用 production，不要用 development 打开捷径。
5. 应用启动会迁移、初始化和清理场次。第一次连接数据副本前先完成脱敏和备份；真实预发布应补只读预检/迁移执行步骤，避免“试着启动看看”改变原始演练基线。
6. 增加可核对版本的健康检查和醒目的预发布标识；测试配置值只记录校验结果，不输出密钥。后端单实例符合当前内存验证码/限流实现，多副本延期。

## 数据如何准备

第一阶段用完整应用 schema 和合成业务数据跑通真实服务：组织 A/B、个人账号、未知历史场次、管理员、公开/组织活动及测试文件。无需等待生产数据即可搭建可用环境。

第二阶段才引入脱敏生产副本：在受控中间环境恢复备份、替换手机号/姓名/密码，撤销会话，清除验证码、日志中的个人信息和所有生产密钥；复盘文本、录音、报告及 payload 不能只改姓名就算脱敏。保留组织/用户/场次主外键与分布，旧文件引用重写到测试对象。人工核对后才允许应用连接副本。

备份格式需要辨认：我们 CI 使用 pg_dump custom archive / pg_restore；Zeabur 官方说明其 PostgreSQL 在线备份使用 pg_dumpall，输出 SQL，需对应 SQL 恢复流程，不能直接套用 CI 的 pg_restore。官方当前保留期为 7 天；长期备份需另存受控位置。[Zeabur 备份文档](https://zeabur.com/docs/en-US/operations/data/backup-restore)、[PostgreSQL pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)。

## 发布流程

同一仓库的 PR → CI → 审核通过的 SHA → 预发布部署 → 浏览器业务链路与数据核对 → 需求方重要 gate → 正式发布。

Zeabur 默认关联分支 push 会触发部署，首次接入必须核对自动部署设置。建议只部署明确候选版本，不把所有 codex 分支写入自动映射成运行授权。初期可手动部署选定候选提交；后续再把受控触发写入 GitHub 工作流。[部署触发说明](https://zeabur.com/docs/en-US/deploy)。

预发布验收至少覆盖：三端入口、完整管理登录、开局选牌结算复盘、真实文件上传/匿名拒绝/认证下载、转组织后撤权、A/B 报表、AI 正常/失败、备份恢复与重启。记录版本、数据规模、结果和耗时。正式发布仍沿用现有 release gate。

## 成本与取舍

总成本 = 测试服务器 + 平台订阅（按所需功能）+ 磁盘/备份 + OSS 存储与流量 + 短信 + AI。Zeabur 当前 Dev 为 US$5/月、Pro 为 US$19/月，是平台订阅，不是整套机器和服务总价。独立服务器具体费用依区域与供应商报价，未选型前不报精确月费。先控制规模与调用额度，再看一周实际账单。[官方价格](https://zeabur.com/pricing)。

本轮建议只决定三个重要边界：是否沿用 Zeabur及独立服务器、月度预算上限、是否首期仅合成数据。实际实施前核实生产平台/区域/PG版本、团队访问人、域名控制权与测试服务账户。资源创建、数据副本读取和收费调用由后续明确授权执行。

## 生产项目确认后的落地清单

来源：2026-09-12 需求方提供项目标识 project-6a2289b3f1be9943f1f9153d。当前会话没有可调用的 Zeabur 连接器，也未发现本机已安装 zeabur CLI；不能据项目标识读取私有控制台配置。

下一步只读核实：生产区域、专用服务器或旧共享集群、应用服务数量及部署分支、PostgreSQL 版本、主库/卡牌库是否分开。只需要服务概况，不需要密钥或数据库连接串。

预发布方案保持独立项目、独立数据库/存储凭据，先合成数据。资源选择和预算确认后才创建；不通过复制生产项目携带生产配置。启动保护补丁和预发布部署属于下一批实现，当前研究没有更改生产。

## Zeabur API 实查（2026-09-12）

用户提供部署机器人凭据后，仅执行 GraphQL query，未查询变量值、未运行容器命令、未执行 mutation。凭据未写入文件或 Git。

- 项目名 postgresql；环境 production；区域/服务器名 Aliyun Hong Kong 2C 4GB，region id 为 server 类型。
- scoring-system、postgresql、camp-app、wqt-scoring-workbench 运行中；ai5000-tutor 已暂停。
- PostgreSQL 镜像 docker.io/library/postgres:18；这是部署镜像标签，尚未 SQL 查询实际补丁版本。现 CI 仅 PG16，需要补 PG18 兼容及对应备份客户端后才能认为对齐生产。
- scoring-system Git trigger 绑定 veasil/wqt-platform 的 feat/cards-2026-workbench。
- 合并版本 4bd7de9 和 f7c9956 已于 2026-09-12 自动生成生产部署，两者状态 FAILED；当前服务仍 RUNNING，镜像 tag 指向更早部署。尚未核查失败阶段或数据库变化，不能据 FAILED 断言没有启动或写库。
- wqt-scoring-workbench 没有 Git trigger，运行部署没有 commitSHA；不能认定它与当前源码一致。变量名出现 WQT_TEST_DB，但未读取值，不能认定数据库独立。
- PostgreSQL 的 Zeabur autoBackup.enabled=false；不能据此推断其他渠道完全没有备份。

修正此前假设：开发集成分支实际连接生产自动部署；此前“未部署”的声明应理解并更正为“未主动调用部署，但合并触发平台部署且失败”。今后变更分支前必须核对平台触发器。

建议优先顺序：先核实失败部署阶段及影响；经明确授权解除生产服务与日常集成分支的自动部署绑定；补 PG18 CI；再搭建独立预发布项目。生产触发器变更影响交付方式，需要明确授权，当前未改动。
