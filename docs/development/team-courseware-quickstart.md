# 独立课件：最短接入路径

实现分支：`codex/team-courseware-integration`。这是 WQT-015 新增的团队应用接入，不是 WQT-014 的静态交接快照。Emma 的真实课件和域名尚未提供，先用[示范课件](../../examples/courseware/emma/README.md)验证；未部署生产。

## 先体验

准备专用本地 PostgreSQL 和 Redis、Node 22、`npm ci`，浏览器集成测试需 Playwright Chromium。指定 **测试** 管理连接后运行：

```powershell
$env:WQT_TEST_PG_ADMIN_URL='postgres://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PG_PORT/postgres'
$env:WQT_TEST_REDIS_URL='redis://127.0.0.1:TEST_REDIS_PORT'
node tests/manual/team-courseware-demo.mjs
```

控制台最后输出 `WQT015_READY`，其中有两个不同 origin 的地址、合成账号和卡组编号。打开 courseware 地址 → 连接伍仟天 → 若未登录，在同一标签页登录 → 单账号自动返回课件，多账号选择后返回 → 开局。

该入口创建随机独占测试库及 Redis 命名空间，用合成身份/组织/卡牌，未读取 `.env`。Ctrl+C 正常退出后清理该测试库；强杀进程可能留下独占测试库，应按其确切名称处理，不删除其他数据库。演示数据随测试库清理消失；正常接入开发/生产环境才使用其持久数据。本入口不是生产启动脚本。

## 接上自己的课件

1. 平台在 accounts 模式运行，配置 PostgreSQL/Redis。服务端 `WQT_TEAM_APPS` 登记应用及获准身份，例如开发环境：

```json
[{"clientId":"emma-courseware","name":"Emma 课件","redirectUris":["http://localhost:8090/"],"identityIds":[1]}]
```

这里的 `1` 必须换成该环境中 Emma 的实际身份 ID。回跳地址精确匹配，正式环境使用 HTTPS；开发/test 才允许 loopback HTTP。移除应用/成员后，后端拒绝其凭证；环境配置变更按现有运行方式重启生效。

2. 将 `shared/browser/team-client.js` 作为 ES module 随课件站点托管（示例服务器映射到 `/sdk/team-client.js`）。设置平台地址、应用 ID、回跳地址：

```js
import { createWqtClient } from '/sdk/team-client.js';
const wqt = createWqtClient({
  platformOrigin: 'https://YOUR_PLATFORM_HOST',
  clientId: 'emma-courseware',
  redirectUri: 'https://YOUR_COURSEWARE_HOST/'
});
await wqt.handleCallback();
// 连接按钮调用 wqt.login()；成功回跳后读取账号。
const connection = await wqt.getConnection();
// 开局参数来自真实的已发布卡组；操作参数沿用玩家接口契约。
const result = await wqt.startSession(settings);
const current = await wqt.getSession(result.sessionId);
```

`performAction` 输入 sessionId/revision/action 及动作参数。SDK 生成 requestId，未知结果用 `retryPending()` 重试原请求；新的操作不能覆盖未确认写入。课件保存场次 ID，刷新后从后端读状态。完整工作代码直接看[示例 app.js](../../examples/courseware/emma/app.js)。

3. 接入第一份课件时，替换教学内容和按钮，复用样例的连接、状态恢复和错误交互。独立域名通过应用登记接入；无需课件自己的后端或应用密钥。

## 当前能力边界

已开放：连接账号、创建场次、读取场次/卡牌、选卡、调整伍力、技能、暂停、推进、结束。仅允许固定玩家接口，管理、旧接口、AI、语音和上传不在当前应用凭证范围。后续按需求逐项扩展。

授权码 60 秒有效且只能正确兑换一次；S256 PKCE，凭证最多 15 分钟且不超过原平台登录期限。课件提示重新连接时复用平台登录并恢复场次，当前没有刷新 token。首次连接在同一标签页完成登录并继续授权；只有一个账号时自动返回课件，多账号时选择后返回。

课件只保存短期受限凭证，不取得平台 identity token。浏览器 sessionStorage 按站点和标签页隔离；关闭标签页后需要重新连接。退出课件清理本地凭证，**不代表撤销所有已复制凭证**；撤销平台会话、账号绑定或应用成员资格后由后端拒绝访问。

## 给下一位 Codex

> 从 codex/team-courseware-integration 分支开始，先读本页及 WQT-015。将我的 HTML 课件映射到 examples/courseware/emma 的登录和场次流程；保持独立部署。使用现有 team-client.js 和账号权限，先用隔离开发配置跑通一份课件。记录使用的 SHA、回跳地址和验收证据，提 PR 供维护者评审。

[实现与验收](../changes/WQT-015-team-courseware/spec.md) · [验证结果](../changes/WQT-015-team-courseware/evidence.md) · [玩家业务契约](player-api-contract.md)
