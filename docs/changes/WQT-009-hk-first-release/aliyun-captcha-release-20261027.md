# WQT-009 阿里云验证码生产切换记录

状态：2026-10-27 已发布并完成技术核验；真实用户通过挑战、收到短信及完整登录待本人验收。

## 授权与版本

需求方在本聊天明确批准“现在发布并切换阿里云”。范围为已审阅的 c466f02481ee7e8dc0afbb2234859034f483ae7f，在新版香港服务切换至阿里云验证码2.0、中国内地；不改短信供应商、账号权限或组织归属。

代码与检查关联 [PR #16](https://github.com/veasil/wqt-platform/pull/16)，保持 draft、未合并。代码候选 CI：Runtime [40450520684](https://github.com/veasil/wqt-platform/actions/runs/40450520684)，PG16/18 各63/63通过、0跳过；Browser [40450520663](https://github.com/veasil/wqt-platform/actions/runs/40450520663)、Artifact [40450520758](https://github.com/veasil/wqt-platform/actions/runs/40450520758) 通过。后续纯证据提交不改变运行版本。

固定 Git archive ZIP 25,893,453 字节，SHA256 `cf99352a6315099bde057216e609199870f0553b3d82a3768cf28550aaf3e8ca`；全包扫描无所提供的凭据及 .env，不含主工作区其他变更。未使用可能忽略 gitRef 的默认 Git deploy，自动 Git 部署保持关闭。

## 备份、发布与运行核验

- 发布前完整云变量快照保留于本机受控目录 `~/.codex/secrets/wqt-aliyun-release-before-20261027.json`；服务器 `/var/lib/wqt-next-backup/aliyun-20261027/` 保留原 deployment、运行环境和镜像记录，目录0700、敏感文件0600，不提交值。
- 数据库备份 `database-v3.dump`，625,063字节，SHA256 `5a71092f64c7a57c76bd6bddd4d4e3709029841734a74f1d13eb508ae5bbdba0`；临时复制至PG容器后 pg_restore --list 203行通过，临时容器副本已删除。未执行生产恢复。前两次备份文件已生成，但通过 kubectl stdin 流式列目录超时，不能当成成功核验；改为文件路径核验后通过，没有反复重试生产发布。
- 上传 ID `9895daae649375657b51357f`；香港服务器接收代码包并核对完整SHA256后，官方预签名上传 HTTP200。prepare 请求响应未成功返回，随后根据 uploadID 核实唯一部署 `6ae035cb3ba10e638d7c91c4` 已在 BUILDING；没有重复 prepare。等待构建切换，旧实例在此期间继续服务。
- 最终镜像标签 `d-6ae035cb3ba10e638d7c91c4`，digest `sha256:2f82150c7ddba0a1ec0d39393242635f13229b98080a8741125d4f2a24db2fb7`。最终 Pod `service-6ad26b6b38f4286bd6df6332-5dd97d984b-5fldd`，ready、重启0。
- 14个关键源文件摘要与 c466f02 完全一致，包含 app/runtime/startup-guards、前后端验证码、认证路由、设置保护和 package.json。package-lock 原始字节摘要不同；独立比较证实仅构建阶段 CRLF→LF，完整JSON语义相同、依赖版本无变化。运行安装的官方阿里云 SDK 为1.1.4。
- 保留已有配置值，增加阿里云五项和 provider，更新两个发布版本字段，保持 CAPTCHA_ENABLED=true；没有关闭校验。原平台36条变量记录合并为34个唯一键，31个未参与本轮更新的原键值保持。最终持久化40个唯一变量，全部为不对外暴露；逐项回读与预期一致。
- 配置写入后明确调用一次 restartService，并核实新进程全部40项变量与持久化预期相同。两端正式 HTTPS `/api/health` 均200并报告完整 c466f02；verification-options 均为 enabled、aliyun、cn、prefix=ot95rd、sceneId=jgcvql0u、smsMode=live，不返回 AccessKey。

## 线上验证与边界

从香港按正式 TLS 域名访问 scoring/admin：密码登录与发码接口提交专用无效阿里云票据均400。另在正式运行容器调用真实供应商，返回 F003，RequestId `01A17BDA-1415-5495-B15D-EEEC171042F9`，证明实际新进程接入正常且拒绝无效验证参数。

使用两个正式域名的真实 HTML/JS/CSS 与真实阿里云 SDK：平台密码登录、玩家短信发送入口均正常显示验证弹窗；场景初始化、动态JS/CSS成功，CSP违规与pageerror为空。浏览器拦截本站写请求，确认未完成人机前没有业务POST，没有自动解答挑战或发送短信。截图已查看。证据：受控工作机 `C:/ArdenDev/tmp/wqt-aliyun-production-20261027/` 的 evidence.json、admin-challenge.png、player-challenge.png；服务器 production-verification.json 保留公开接口及镜像核验。

只读事务复核负责人及两名新开通成员：identity 11/13/14 各有本组织唯一有效 boss 绑定，身份/账号 active，owner_account_id仍11、账号期限不变，组织已分配账号仍50。没有测试会话、业务写入、密码修改、历史迁移或 schema 变更。

验证弹窗与负向验签通过不证明本人真实挑战、短信送达和最终登录成功；这部分由需求方实际登录验收。玩家深色全局样式使第三方弹窗标题对比度偏低，确认控件和关闭按钮可见；记录为后续视觉细节，不将其写成短信或验证失败。

## 回退与复盘

原镜像标签 `d-6ad8ca09940c1abca2f42e79`，digest `sha256:ce1f15dbc87215d9a7e9b4f339b00959ef0784ce70171c21ef5fee99f1bb1833`，运行代码c8ad1fc；完整原云配置、deployment和环境快照已保存。需要回退时恢复精确镜像与原配置，不恢复数据库、删除账号或关闭校验。原腾讯套餐故障并未被续费解决，恢复原镜像/配置不等于登录恢复可用。

改变的假设：源码相同不能靠版本环境变量推断，锁文件字节差异也不必然表示依赖变化；持久化配置与进程读取必须分别核验。新增保证为阿里云真实接入、明确的错误拒绝和多入口回归，无新增领域规则或 schema。遗留为本人登录验收、第三方弹窗深色样式、供应商额度/可用性持续告警。最值得理解：发布响应未知后的状态核对、镜像/源码/版本三者核验、技术验证与业务验收的区别。
