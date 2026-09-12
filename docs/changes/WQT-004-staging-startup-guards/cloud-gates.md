# 云端 gate：生产触发器与预发布资源

## G-TRIGGER（已批准并执行）

只读证据：scoring-system（service 6a22926fe957fb053c550c2f），production环境6a2289b495b39806d284a7c3，GitHub repoID 1117361465，branch feat/cards-2026-workbench。PR3/4合并均触发生产构建并FAILED；两次buildLogs均显示npm install / EALLOWREMOTE，失败发生在构建镜像的依赖安装步骤。本次没有执行容器命令或数据库查询，不能推断整个生产库当前状态。

建议操作：仅将该服务该环境的Git trigger设为null，停止后续push自动触发。Zeabur GraphQL updateGitTrigger的schema说明明确null意味着不再由git push触发。保留现有服务、运行镜像、数据库和域名，不触发重启或主动部署；变更后只读复查gitTrigger=null、服务RUNNING和原镜像tag。后续生产发布改为明确候选版本与人工gate。

回退：恢复provider GITHUB、repoID 1117361465、branchName feat/cards-2026-workbench的trigger配置；恢复前再次确认不会把未验收提交自动上线。当前仅准备方案，未调用mutation。

该操作改变生产交付触发方式，按AGENTS/CONTRIBUTING属于重要gate，需要需求方明确确认。

## G-RESOURCE（已批准，采购受支付配置阻塞）

需求方预算：每月新增几十元人民币。Zeabur dedicatedServerPlans(provider:ALIYUN,region:cn-hongkong)实查：同现有生产规格swas.s.c2m4s50b1.linux，2CPU/4GB/50GB，available=true，price=9；随后核对 Zeabur 官方 CLI 的 server/rent 源码，价格格式为 $%d/mo，因此该方案为 $9/月，不是9元。税费/人民币支付汇率以结算为准。来源：https://github.com/zeabur/cli/blob/main/internal/cmd/server/rent/rent.go 。

建议独立同规格机器部署wqt-staging与PG18；按官方说明服务器按月计费且默认自动续费。成本还包含可选订阅、OSS、短信、AI；不为本轮新增Team/Pro订阅。采购建议：只购首月$9，购入后关闭自动续费，待实际账单复核后再续；额外短信/AI消费不在这次采购授权中。资源创建前确认该具体方案，未采购。

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
