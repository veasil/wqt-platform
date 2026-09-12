# 云端 gate：生产触发器与预发布资源

## G-TRIGGER（已批准并执行）

只读证据：scoring-system（service 6a22926fe957fb053c550c2f），production环境6a2289b495b39806d284a7c3，GitHub repoID 1117361465，branch feat/cards-2026-workbench。PR3/4合并均触发生产构建并FAILED；两次buildLogs均显示npm install / EALLOWREMOTE，失败发生在构建镜像的依赖安装步骤。本次没有执行容器命令或数据库查询，不能推断整个生产库当前状态。

建议操作：仅将该服务该环境的Git trigger设为null，停止后续push自动触发。Zeabur GraphQL updateGitTrigger的schema说明明确null意味着不再由git push触发。保留现有服务、运行镜像、数据库和域名，不触发重启或主动部署；变更后只读复查gitTrigger=null、服务RUNNING和原镜像tag。后续生产发布改为明确候选版本与人工gate。

回退：恢复provider GITHUB、repoID 1117361465、branchName feat/cards-2026-workbench的trigger配置；恢复前再次确认不会把未验收提交自动上线。该回退方案尚未执行；正式关闭的执行证据见下文。

该操作改变生产交付触发方式，按AGENTS/CONTRIBUTING属于重要gate，已由需求方明确确认。

## G-RESOURCE（首月采购完成，自动续费已关闭）

需求方预算：每月新增几十元人民币。Zeabur dedicatedServerPlans(provider:ALIYUN,region:cn-hongkong)实查：同现有生产规格swas.s.c2m4s50b1.linux，2CPU/4GB/50GB，available=true，price=9；随后核对 Zeabur 官方 CLI 的 server/rent 源码，价格格式为 $%d/mo，因此该方案为 $9/月，不是9元。税费/人民币支付汇率以结算为准。来源：https://github.com/zeabur/cli/blob/main/internal/cmd/server/rent/rent.go 。

建议独立同规格机器部署wqt-staging与PG18；按官方说明服务器按月计费且默认自动续费。成本还包含可选订阅、OSS、短信、AI；不为本轮新增Team/Pro订阅。采购建议：只购首月$9，购入后关闭自动续费，待实际账单复核后再续；额外短信/AI消费不在这次采购授权中。该具体方案已批准并购入，见下方执行记录。

若最终报价不在预算内，重新比较按需运行或同机隔离；不得为了省费默认把预发布数据库指向生产。后续还需独立OSS/Bmob/AI配置及团队测试账号，Zeabur部署key不能替代这些服务凭据。

## 构建修复

两次旧失败日志均含EALLOWREMOTE，拒绝registry.npmmirror.com tarball。此次仅把root lock中85条resolved改为registry.npmjs.org，版本与integrity逐项保持，交CI完整重装验证。该修复不会通过推送本codex分支触发生产；是否解决实际Zeabur构建仍需在独立预发布验证，不重部署生产来试错。

## 2026-09-12 gate 执行记录

来源：需求方明确回复“关闭自动触发，后续按发布 gate 放行”以及“批准首月 $9，关闭自动续费”。两项授权可跨会话复用。

- 生产：updateGitTrigger 返回 true；复查 scoring-system 的 gitTrigger=null，status=RUNNING，镜像仍为 d-6a56112af9e67eefe065c705。未主动部署或重启，其他服务触发器未修改。
- 采购：按上述 ALIYUN / cn-hongkong / swas.s.c2m4s50b1.linux 调用一次 rentServer，operationID=wqt-staging-20260912-first-month。返回资源记录 6aa531a7aa8a37958d9588a0，随后 provisioningStatus=FAILED、isManaged=false、expiresAt=null。
- 原因：CreateStripeInvoice 阶段失败，账号没有 default_payment_method。未查询账单扣款明细，不以创建记录推断已付款或已开通。
- 关闭自动续费请求失败：Server is not managed by Zeabur；isAutoRenewDisabled=null，不能报告已关闭续费。
- 下一步：需求方在 Zeabur 账单设置指定默认支付方式后，先核对失败订单及现有资源，避免重复购买，再按已批准预算继续。开通后必须关闭并读回 isAutoRenewDisabled=true，才算采购 gate 完成。当前不自动重试扣费。
- 应用项目、PG18、合成数据部署和真实外部服务联调尚未开始；不回退到生产同库，也不复制生产凭据。

## 余额支付恢复后的执行记录

需求方回复“可以用余额支付了”后，先复查服务器列表：旧资源6aa531a7aa8a37958d9588a0仍FAILED、无到期时间，没有已开通的预发布机器；重新核对同规格报价仍为9且available=true。

随后仅提交一次采购请求，沿用operationID=wqt-staging-20260912-first-month。平台返回新资源6aa54068aa8a37958d958950，而非旧资源，说明不能假定该字段提供请求去重保证。此次状态由CREATING、PROVISIONING、INITIALIZING到READY，isManaged=true、status.isOnline=true。

- 服务器名称：wqt-staging-hk，ID 6aa54068aa8a37958d958950。
- updateServerAutoRenew(autoRenew:false)返回true，随后读回isAutoRenewDisabled=true。
- 到期：2026-10-12T16:00:00Z，即新加坡时间2026-10-13 00:00。后续续费由需求方决定，不自动续费。
- 项目：wqt-staging，ID 6aa541025dbe69df73c8b41f，region=server-6aa54068aa8a37958d958950，确认使用新服务器。
- 平台默认环境标签仍为production，ID 6aa541025070596c8e668c0c；它位于独立wqt-staging项目，不是旧生产项目。应用必须配置SERVER_ENV=staging，不从平台默认标签推断应用模式。
- 数据库服务：wqt-staging-pg，ID 6aa5412af9b152e74791f0a3，镜像postgres:18，状态RUNNING，portForwardingMode=DISABLED。独立安全随机密码仅写入该服务私有变量，未写入Git或输出；卷挂载/var/lib/postgresql，符合PG18官方镜像布局。
- 此次没有查询生产数据库、复制生产环境变量或操作旧生产服务器续费。未取得账单明细，不能报告余额实际扣款拆分；服务器开通和续费关闭已有平台证据。
- 应用、合成数据导入及真实短信/OSS联调仍未完成，待独立服务配置。数据库RUNNING不等于完整业务验收。

参考：[Zeabur服务器购买](https://zeabur.com/docs/en-US/server/purchase)、[PostgreSQL官方镜像](https://hub.docker.com/_/postgres)。

- 已创建空应用服务wqt-api（6aa541a95dbe69df73c8b49d），尚未绑定代码或启动，可供后续配置独立凭据。项目入口：https://zeabur.com/projects/6aa541025dbe69df73c8b41f 。

- SQL只读验证限制：对新PG服务执行psql查询current_database/server_version/data_directory/空表计数，两次API客户端分别在25秒、55秒超时，未获得exitCode/output。没有执行写入SQL，不推断查询成功；后续需通过平台终端或修复执行通道继续验证，不为检查临时开放数据库公网。

## 继续部署的排查与验证

- 新PG executeCommand简单命令成功；随后sh -c下运行非交互psql（-X -w，PGCONNECT_TIMEOUT=5，stdin=/dev/null），exitCode=0。查询确认wqt_staging、PostgreSQL18.6、data_directory=/var/lib/postgresql/18/docker、public业务表数0。旧API超时根因未证实，不能直接归因数据库故障。
- 旧空wqt-api的deploy(gitRef.ref=SHA)与完整refs/heads分支均被平台解析为main/352edf1；部署6aa5440cbda3ae6d4ec89389和6aa5445b7a2a029fbe0d2abc均已取消。未配置DB连接、未运行迁移。deployFromSpecification尝试在创建部署前报Invalid input/Failed to get Dockerfile；没有报告成功。
- 改用createService(template:GIT,gitProvider:GITHUB,repoID,branchName)创建wqt-candidate（6aa54496a97995bc0221efcb），部署6aa544977a2a029fbe0d2ac7记录实际d358bbf4b0d3b3ee8ec02840374a42cc625e5ac3、refs/heads/codex/staging-startup-guards；随后关闭该候选服务Git trigger。
- 构建器警告没有SOURCE_GIT_COMMIT_SHA，会按分支拉取；本轮构建期间不推送分支。部署元数据不是严格不可变源证明，后续发布仍须解决固定源制品。
- 正确分支构建已通过root npm install，没有重现EALLOWREMOTE；随后npm run build因vite:not found退出127。原因：NODE_ENV=production使前端npm install默认跳过devDependencies，而Vite属于构建依赖。
- 修复：根build改为两前端npm ci --include=dev，使用锁文件并显式包含构建依赖。Browser CI改用NODE_ENV=production执行根build，覆盖实际触发条件。此变更不降低应用运行模式，不填假外部凭据。

- b412469 CI：Runtime 34693760154（PG16/18），Browser 34693760020，Artifact 34693759966全部通过；Browser实际执行NODE_ENV=production的根build。
- 平台redeployService在gitTrigger=null时拒绝（CANNOT_REDEPLOY_INPLACE）。本轮仅对预发布candidate短暂设置TriggerInput={repoID:1117361465,branchName:codex/staging-startup-guards}，手动重建后立即置null；TriggerInput不接受provider字段。新部署6aa545da7a2a029fbe0d2af9，实际SHA=b4124699f7c3acc979a35105595ec28bda017db0。生产trigger未变。

- 最终云端复验：b412469镜像构建及上传完成，容器成功拉取并启动该镜像；服务日志明确Error: Startup guard rejected JWT_SECRET，栈为validateStartupEnvironment→preflightStartup→startRuntimeInternal。候选故意未配置JWT/DB/外部凭据，证据仅证明第一道缺配置保护生效，不能扩展为全部真实集成通过。
- runtimeLogs按deploymentID过滤没有返回应用日志，去掉该过滤、限定新service/environment后取得日志；查询差异需记录，不能以空日志推断无错误。
- 已调用suspendService=true停止重启循环；候选仍无公开业务入口、没有合成数据导入。后续按staging-handoff.md配置真实依赖后恢复，并验证正常启动。
