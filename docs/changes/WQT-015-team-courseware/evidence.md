# WQT-015 验证证据

状态：技术验证通过，待用户体验验收；未部署。日期 2026-11-13，分支 codex/team-courseware-integration，基线 2c922ba。缺少 Emma 原始课件与正式域名，本轮使用独立示例。

## 验证记录

| 验收 | 实际检查 | 结果 |
|---|---|---|
| AC1 | 两个 loopback origin，Chromium 使用真实 SDK→平台授权页→账号选择→回跳→PKCE 兑换；回跳后清理 URL | 通过，平台 identity token 仅留平台 origin |
| AC2 | tests/runtime/team-courseware.test.mjs：真实 PG/Redis 的开局、跨阶段选卡、调整、结算、读取；后端提交后丢响应，刷新再用同请求重试；DB 验证单条事件 | 通过，0 跳过 |
| AC3 | 未登记回跳、来源、成员拒绝；错误 PKCE 不消耗码；并发兑换仅一次成功；过期码拒绝；SDK 错误 state/回跳/重复参数拒绝 | 通过 |
| AC4 | 即使身份账号是 boss，app token 仍拒绝管理/身份/旧接口；跨组织拒绝；应用停用、账号解绑、原会话撤销后拒绝；签名篡改/过期/错误 audience 单测 | 通过 |
| AC5 | 真实示例 UI 开局→调整→刷新→结束；另合成浏览器验证 390px 无横向溢出、结果刷新、0 pageerror | 通过；实际 Emma 课件待提供 |

本地测试使用专门启动的 PostgreSQL 18.4 与 Redis 独立端口；每个集成用例通过 owned helper 创建随机独占库，结束清理。Docker 本机返回 500，改用现成 PostgreSQL embedded 二进制和 WSL Redis，没有修改生产或借用业务数据库。

- `npm run test:runtime`：70/70 通过，0 跳过，包含恢复/迁移/账号及新接入用例。
- `npm run test:frontend`：106 项，104 通过、2 既有跳过、0 失败。
- `node --test tests/team-apps.test.mjs tests/player-state.test.mjs`：9/9 通过（授权/协议与跨阶段状态规则）。
- `npm run lint`：通过；制品测试 4/4、结构检查（121 文档/15 变更）、diff 空白检查通过。手动演示入口实际启动，两个站点返回 200，正常停止后 owned 测试库集合恢复原状。
- 新授权单测与跨阶段状态测试已接 Runtime CI；SDK/示例浏览器检查已接 Browser CI；新 PG 集成按 runtime glob 自动执行。
- 截图：本地 `tmp/wqt015-evidence/courseware-result.png`，主控已查看，未将本地产物提交。

失败与修复：全量后端首次 69 通过、1 失败。根因为精确路由顺序测试未包含新增的 teamTokenBoundary 和 /connect 响应头中间件；更新明确预期，未放宽整体断言，最终 70/70。

基线差异处理：迁入已批准 2ad6a56 的跨阶段选牌规则及测试，保留其他当前行为；未整批覆盖生产分支。短复盘与当前闭环无依赖，继续作为单独候选，不将此分支称为所有修复的集合。

## 验收与交付

代码与演示用于技术评审；真实 Emma 课件、正式域名、最终业务验收和生产部署仍待后续。授权实现参考 RFC 7636 / RFC 9700 的 S256 PKCE 和精确回跳原则，不声称完整 OAuth/OIDC 平台。见[快速开始](../../development/team-courseware-quickstart.md)。

## 工程复盘

假设得到验证：独立 HTML 站点可直接复用既有玩家业务，平台无需新建服务。新增约束：应用精确登记、允许身份列表、player-only token、短期凭证及原会话实时撤销检查。新增运行依赖为既有 Redis 中的 60 秒授权码，无新数据库表。

复杂度保留在单个团队接入模块与轻量浏览器文件。首次未登录需打开现有登录页后返回继续；15 分钟凭证到期后重新连接，无 refresh token。SDK 退出只清除本地凭证，副本由过期/平台会话撤销/登记移除限制。AI、语音、媒体与管理功能尚未授予应用。应用身份列表暂由配置维护。

理解重点：应用凭证与平台身份凭证分离；一次性码+PKCE 绑定发起登录的浏览器；请求幂等与 revision 分别解决重试与并发。
