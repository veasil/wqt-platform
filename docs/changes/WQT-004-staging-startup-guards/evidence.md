# WQT-004 · 验证证据

## 验证记录

本地启动配置与生产短信拒绝用例10/10通过；lint通过。真实PG16/18和合成数据已通过CI，见最终代码复验。

只读云端事实：生产镜像postgres:18；scoring-system的Git trigger绑定feat/cards-2026-workbench，先前两次合并触发部署且FAILED。当前分支不向该生产分支推送。详见[环境研究](../../architecture/staging-environment-proposal.md)。

## 验收与交付

未最终业务验收；获批关闭生产自动触发器，未主动部署或重启。云端实际影响必须以平台记录为准，Git合并不等于与部署隔离。

## 第一轮 CI

版本 de6872f 的 [Runtime CI](https://github.com/veasil/wqt-platform/actions/runs/34689589302) 在 PG16 和 PG18 各24 passed / 0 skipped；[Browser CI](https://github.com/veasil/wqt-platform/actions/runs/34689589306) 与制品检查通过。

后续139dc9a只规范85条npm resolved地址（版本/integrity不变），d1ddf51补充严格staging模式启动成功的正向测试；其新增正向测试暴露手工fixture缺少description列，436d3d3修正为实际schema后复验通过。两次生产失败的只读buildLogs均指向npm install / EALLOWREMOTE，未查询生产库。

预算与云端 gate：需求方明确每月新增几十元。已准备同现有机器规格的 $9/月独立测试机、首月购买后关闭自动续费方案，以及生产Git trigger置空方案。两项已获明确批准并执行；生产触发器关闭成功，采购被默认支付方式缺失阻塞。详见cloud-gates.md。

## 最终代码复验

代码版本436d3d3：[Runtime CI](https://github.com/veasil/wqt-platform/actions/runs/34690061545) PG16/PG18各24 passed、0 failed、0 skipped；[Browser CI](https://github.com/veasil/wqt-platform/actions/runs/34690061539)及[制品检查](https://github.com/veasil/wqt-platform/actions/runs/34690061592)通过。覆盖严格staging成功启动、启动前拒绝复制配置且不写业务表、事务合成数据与回滚、真实pg_dump/restore。

## 工程复盘与后续

- 新增约束：严格环境在任何初始化写库前验证目标和配置；生产短信缺配置拒绝服务，不能降级为模拟验证码。合成数据只允许空业务库、同一事务，拒绝覆盖数据。
- 改变的假设：合并生产绑定分支确实会触发部署；已获批关闭触发器。PG实际主版本为18，CI补齐18而非只依赖16。
- 测试教训：拒绝路径的最小fixture不足以证明成功启动，正向启动用例识别并修正schema缺列。
- 限制与后续责任：配置目标白名单只减少误配，真实隔离仍依赖独立账号、数据库和网络权限。平台采购缺默认支付方式；资源就绪后再配置独立OSS/Bmob和团队测试账号。真实短信、文件、云端恢复及产品验收尚未完成。
- 当前未引入新架构层；真实云端联调与运行证据是未完成项，不能以CI通过替代。

## 余额支付后云资源进展

首月服务器已READY且isOnline=true，自动续费关闭读回确认。独立项目和PG18服务已创建，PG公网端口转发为DISABLED。详情和资源ID见cloud-gates.md。之前的支付阻塞已解除；真实应用、合成数据导入与外部服务联调仍未完成。

最新文档提交7695845的Runtime、Browser、Artifact CI均通过，Runtime run 34690167773、Browser run 34690167782；本轮仅追加云资源证据。

云端SQL只读验证的executeCommand两次超时，尚无查询成功证据；未进行云端合成数据写入。应用空服务已创建但未绑定代码，独立外部配置已向需求方询问。

## 云端继续验证与构建修复

PG只读验证已成功：18.6、wqt_staging、/var/lib/postgresql/18/docker、公有业务表0；旧API超时不能当数据库故障证据。正确分支候选构建已通过root依赖安装，前端阶段因生产环境跳过Vite失败。b412469把前端安装改为ci --include=dev，并把Browser CI切到根build的NODE_ENV=production条件；本地相同条件两个前端构建通过（存在既有bundle大小/依赖注释及Windows清理警告，退出码0）。b412469的PG16/18、Browser、Artifact CI全部通过；Zeabur复验已完成前端构建并进入DEPLOYING，云端日志确认Startup guard rejected JWT_SECRET，随后暂停候选。此证据只覆盖首个缺配置拒绝，正常启动及外部联调未完成。
