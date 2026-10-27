# WQT-009 阿里云验证码切换

状态：c466f02 已按本聊天授权发布，阿里云切换及技术核验完成；真实用户登录待本人验收。完整版本、CI、备份、镜像、配置和线上证据见[生产切换记录](aliyun-captcha-release-20261027.md)。

来源：2026-10-27 本聊天。腾讯验证码因无有效套餐/欠费阻断登录，需求方比较方案后选择阿里云，并明确中国内地。采用验证码 2.0 按量付费、Web/H5 V3；本次不改变身份、组织、账号权限和短信供应商。

本聊天随后提供：region=`cn`、prefix=`ot95rd`、场景名称“计分系统登录”、sceneId=`jgcvql0u`，随后提供调用凭据。凭据仅保存到本机受控文件，未进入仓库或生产环境；公共值记录于制品。接口可用性与弹窗证据见后文，未代签真实用户验证成功。

## 范围与验收

- AC-01：显式 `CAPTCHA_PROVIDER=aliyun` 选择阿里云；未指定仍兼容原腾讯配置，以支持审阅和回退。未知供应商不得静默放行或回退。
- AC-02：公共选项仅含启用状态、供应商、region、prefix、sceneId 等公开字段；专用 AccessKey 留在部署环境，不复用 OSS 密钥，不允许后台设置接口写入。
- AC-03：前端动态加载官方 V3 SDK；重新验证必须使用新实例/新票据，取消、加载失败、初始化失败和超时均可重试，并恢复按钮状态。覆盖玩家、平台、组织以及共用助手的注册/重置流程。
- AC-04：后端使用官方 SDK VerifyIntelligentCaptcha，原样发送 captchaVerifyParam，SceneId 固定取服务器配置；仅真实通过且 VerifyCode=T001 接受。配置不足、错误结果、测试/容灾结果、超时不得放行，不自动回退腾讯。短信前置验证和密码验证顺序保持。
- AC-05：生产启动前校验供应商对应参数；CSP 只增加验证码所需域名，不增加 unsafe-eval 或任意通配外联。缺省腾讯原行为通过回归。
- AC-06：隔离测试不连接业务库、不发送短信；覆盖真实路由请求字段、公共配置泄漏及 CSP、SDK结果分类和前端生命周期。真实挑战、短信和登录验收需配置后另行执行。

## 方案与边界

中国内地实例使用 `cn` 和 `captcha.cn-shanghai.aliyuncs.com`，不因应用服务器位于香港而选错地域。保留现有 proof 边界，新增 captchaVerifyParam；不引入通用供应商注册框架、自动多供应商容灾或新数据库表。两个实际供应商选择分支解决当前切换与回退需求。

部署项为 CAPTCHA_PROVIDER、ALIYUN_CAPTCHA_REGION、ALIYUN_CAPTCHA_PREFIX、ALIYUN_CAPTCHA_SCENE_ID、ALIYUN_CAPTCHA_ACCESS_KEY_ID、ALIYUN_CAPTCHA_ACCESS_KEY_SECRET，继续使用 CAPTCHA_ENABLED。region 需显式提供 cn 或 sgp，当前用户选择 cn；不自动创建收费实例或扩大 RAM 权限。

阿里云文档中的异常放行建议不采纳：本项目人机验证保护公开短信发码及密码校验，故障放行将改变已确认安全边界。服务端同时检查 Success、VerifyResult 和 T001，拒绝测试通过 T005 及限流容灾 T002。真实场景必须关闭测试模式。

官方参考：[V3前端接入](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/new-architecture-for-web-and-h5-client-access)、[后端接入](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/server-access)、[按量计费](https://help.aliyun.com/zh/captcha/captcha2-0/billing)。

## 发布与回退

先完成代码、构建与隔离测试，取得真实配置并验证目标环境，再按既有发布门槛发布；不得将整个未提交工作区直接打包。当前线上腾讯故障仍未恢复，不因本地支持阿里云就标记上线成功。回退选择原供应商需其套餐可用；退回原代码前移除阿里云专属选择或恢复原完整配置，不能关闭验证代替恢复。

## 证据

- `node --test tests/frontend/captcha-loading.test.mjs tests/runtime/startup-guards.test.mjs tests/runtime/aliyun-captcha.test.mjs tests/sms-provider.test.mjs tests/frontend/sms-cooldown.test.mjs`：53/53 通过，无跳过。覆盖两个地域映射、缺失配置、公共选项不泄密、真实路由拒绝错误票据、官方 SDK 字段转换、固定服务端场景、无自动重发、8 秒超时、错误日志不含票据/凭据，以及原腾讯回归。
- `npm --prefix admin-web run build`、`npm --prefix enterprise-panel run build` 通过；保留已有大 bundle 和第三方 PURE 注释警告，未为本轮切换扩大拆包范围。
- `python tests/browser/verify-aliyun-captcha.py`：7 个场景通过（平台密码/短信、组织密码、玩家密码/短信、注册短信、重置密码短信）；每个场景覆盖 SDK 错误后恢复、挑战回调前不发业务请求、再次操作使用新票据、SDK 仅加载一次、无 pageerror。全部 HTTP/SDK 为受控替身，无外网/短信/数据库。
- `python tests/browser/verify-login-retry.py`：既有玩家、平台、注册、重置四入口动态 429、成功等待和到期恢复全部通过，pageerror 为空。
- `npm run lint`、`npm run check:artifacts` 通过；制品检查 104 文档/10 变更，仅证明结构。运行时专项位于既有 Runtime 通配测试目录，新增浏览器与前端加载回归已加入 Browser CI；本次未提交或触发远端 CI。
- 浏览器测试夹具初次因合成 SDK 文本开头多了 `+` 产生语法错误，修正夹具后完整七场景通过，没有修改产品实现来适应夹具错误。
- 仅下载官方公开 SDK 查看装载形式，没有使用真实 prefix 或发起真实付费验证。其 `new Function` 字符串位于 globalThis 不存在时的兼容分支，不能据字符串出现就认定现代浏览器必须放宽 unsafe-eval；本轮没有增加 unsafe-eval。

以上为首轮工作区证据；后续独立候选的真实供应商验证及数据库集成见下文。生产状态未改；真实挑战完成、短信收件和成功登录仍待本人验收。参考[控制台与受控凭据准备](../../development/aliyun-captcha-setup.md)。

## 凭据到位后的隔离候选与真实验证

- 实际线上仍为 c8ad1fcf1338edb87fe27933a4a22bc2f3a8f921、腾讯供应商，Pod ready。以该提交新建独立 worktree/分支 codex/aliyun-captcha-20261027，只移入本次变更；保留正式入口、组织端关闭、正式 OSS 白名单和 boss 活动权限。远端交接分支 codex/scoring-release-20261021 的后续 8ca539a 仅新增发布文档与浏览器脚本，候选业务基线仍对应实际运行代码。
- 使用受控凭据直接调用阿里云 VerifyIntelligentCaptcha，专用无效票据返回 HTTP200、Success=true、Code=Success、VerifyCode=F003；RequestId 01A17B97-82C2-503F-BFAA-3B9B4F45A1C3。说明接口认证通过并正确拒绝非法验证参数，不证明真实用户挑战通过。首次应用包装探针遇到 SDK_ERROR；后续同端点直接探针成功，记录为一次未进一步归因的本机调用失败，不据此重置密钥或宣称链路永久稳定。
- 使用候选正式管理端构建资源，在独立浏览器上下文拦截全部本站 API，仅提供公开配置；真实加载官方阿里云 SDK 和本场景。首次实测发现 CSP 阻止设备指纹双栈接口、内嵌字体、外部样式以及本地 data URI 读取。已按官方域名和实际阻断逐项补齐，仅在 aliyun 启用时添加；未增加 unsafe-eval、任意 https 或通配云域名。增加相应 CSP 回归。
- 一次真实初始化超过原 10 秒上限；将阿里云初始化及 SDK 请求超时调整为 20 秒，公共配置/JS 下载仍为 10 秒，单次人工挑战仍为 120 秒、后端验签为 8 秒。超时失败后恢复重试，不自动重放验证票据。
- 修订后真实 SDK、场景初始化、指纹接口、动态 JS/CSS 均取得200；已查看 screenshot，管理页弹出“请完成安全验证 / 确认您不是机器人”窗口，CSP 违规与 pageerror 均为空。一个遥测请求 ERR_ABORTED，不影响弹窗，未宣称所有请求均成功。没有解答挑战、提交真实登录或发送短信。证据受控本机 C:/ArdenDev/tmp/wqt-aliyun-live/evidence.json、challenge.png；新增 tests/manual/verify-aliyun-challenge.py 需显式 --live，拦截本站业务请求，供复查 SDK/CSP，不纳入自动 CI。
- 独立候选最初 npm ci --ignore-scripts 未生成 SQLite 原生绑定，5项导入相关测试失败；执行现有 sqlite3 的正常 rebuild 后消除环境缺件，未改业务代码或测试断言。重新生成锁文件保留线上既有依赖版本，新增官方 SDK 所需依赖；12个已有代理依赖仅由 optional 变为必需，没有升级其版本，未带入主工作区的 Redis/Playwright 版本差异。
- 使用本机新建、无持久卷的 postgres:16 / redis:8 容器、随机回环端口运行 65 项认证/会话/启动/前端加载/短信专项：65/65通过、无跳过。随后新增阿里云票据正向链路：独占 PG 临时库和 Redis 命名空间内，验证普通/平台密码登录、无效票据不进行密码比较、有效票据后密码成功/失败、发码前置验证，以及短信登录不复用发送票据；4项阿里云测试再次通过。全部使用合成人员与短信/供应商替身，不连接生产库。
- 独立候选两端重新按各自锁文件安装并构建通过，7场景阿里云浏览器与4场景倒计时回归通过，lint、制品结构通过。PG备份工具本机未安装，未把所跑专项写成完整 runtime/recovery 通过；完整 PG16/18 和浏览器 CI 尚待候选推送后记录。

## 工程复盘

改变的假设：替换供应商不只是换密钥，前端票据格式、后端 SDK、公共配置、启动校验和浏览器 CSP 必须配套；供应商 success 回调也可能为容灾票据，仍需服务端判断真实结果。

新增约束：专用部署凭据、固定服务器场景、只接受 T001、超时拒绝且不自动重放单次票据；供应商错误码/RequestId 可以诊断但异常对象不可直接输出。无 schema 或账号权限变化。

新增依赖为官方 SDK 1.1.4 及锁文件依赖，来自官方 npm registry，未修改全局源；保留腾讯分支仅用于本次切换兼容与审阅回退，不建立自动容灾框架。现有三份前端助手继续同步修改，并以同一测试矩阵约束，未在本次夹带模块重构。真实资源白名单仍需实际场景验证；余额和供应商可用性告警为待安排债务。

需求方负责提供真实 prefix/场景与受控 RAM 凭据、服务开通及业务验收；实施方在配置到位后继续精确版本发布准备和真实路径验证。当前不自动购买服务、部署整个脏工作区或关闭验证。最值得理解：前后端配置契约、外部依赖失败策略、隔离测试与真实服务验收的区别。
