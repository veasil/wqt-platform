# WQT-015 · 团队独立课件接入

状态：已确认实施范围，进行中。来源：2026-11-13 用户确认最小方案并要求多智能体完成；用户回复暂没有 Emma 课件或域名。基线 2c922ba，分支 codex/team-courseware-integration。

## 目标与范围

目标：独立 origin 的示范课件，通过伍仟天登录取得有限凭证，完成开局、操作、刷新恢复和结果展示，供 Emma 替换课件。沿用现有组织/账号/伍力模型；代码交付，不部署生产。

已确认边界：团队应用手工登记、PKCE S256 一次性授权码、短期凭证、仅玩家场次权限，无客户端密钥。沿用现有账号实时检查；只有登记的身份可使用登记应用（配置 identityIds，防止公开应用变成任意账号授权入口）。不新增 DB schema、微服务、通用开发者平台或刷新 token。

## 验收标准

- AC1：两个独立 origin，登录后兑换短期 token；平台 identity token 不交给课件。
- AC2：真实 PG/Redis HTTP 完成 start/action/get/finish，刷新恢复、相同 requestId 重试不重复计分。
- AC3：PKCE/redirect/state 校验，授权码一次性并发消费；过期/错误来源/未登记成员拒绝。
- AC4：课件 token 不能访问管理、登录或旧 API；停用应用、撤销账号绑定/身份会话后拒绝，跨组织场次拒绝。
- AC5：提供 SDK、独立示例、启动说明、Codex 交接；用户未提供课件，不能声称 Emma 实际课件验收。

## 固定接口契约

登记环境变量 WQT_TEAM_APPS 为 JSON 数组：[{clientId,name,redirectUris,identityIds}]，精确 HTTPS 回跳地址，开发/test 仅额外允许 loopback HTTP。只启用 accounts 模式；缺配置默认关闭。

GET /connect/authorize.html?client_id=...&redirect_uri=...&state=...&code_challenge=...&code_challenge_method=S256 为平台授权页面。用已有 WQT_AUTH_TOKEN 调 GET /api/auth/session，展示可用账号并选择；未登录时让用户到 /player/ 登录后返回（保留本页请求）；无需新写密码登录实现。
POST /api/connect/authorize 使用原 identity Bearer，JSON {client_id,redirect_uri,state,code_challenge,code_challenge_method,accountId}，验证后返回 {redirectUrl}（包含 code/state，不含 token）。
POST /api/connect/token 无 identity Bearer，JSON {grant_type:'authorization_code',client_id,redirect_uri,code,code_verifier}，要求 Origin 为登记 redirect 的 origin，成功 {access_token,token_type:'Bearer',expires_in}。code 60 秒，token 最多 15 分钟且不超过原 identity session 到期。

课件 token type=team_app，有 audience、clientId、固定 scope player:session，绑定 identity/account/session/credentialVersion；每次检查应用、origin、登记身份及原账号/身份会话状态。只允许 POST /api/player/start、POST /api/player/action、GET /api/player/session/:id、GET /api/player/cards/:id、GET /api/connect/session。connect/session 返回最小 {account:{id,name,organizationId},expiresAt}。其他 API 默认拒绝。现有内部 identity token 行为不变。

SDK 路径 shared/browser/team-client.js，导出 createWqtClient({platformOrigin,clientId,redirectUri})：login(), handleCallback(), getConnection(), startSession(settings), getSession(id), getCards(id), performAction(input), retryPending(), logout()。sessionStorage 保存 PKCE/state/短期 token/未决写请求；state 绑定精确平台与回跳，callback 后清除 URL code/state。不自动重试写入；未知结果保留 requestId 与完整 payload 供 retryPending，刷新仍可恢复；禁止新的写入覆盖未决操作。getSession 后可供用户确认已恢复状态。

参考 RFC 7636 https://www.rfc-editor.org/rfc/rfc7636 与 RFC 9700 https://www.rfc-editor.org/rfc/rfc9700 ，使用其 PKCE / 精确回跳原则，不声称完整 OAuth/OIDC 提供者。

## 确认与验收

需求方于 2026-11-13 同意前述最小实现方案，并授权多智能体执行；本轮暂缺实际课件/正式域名，使用独立站点示例。不代表生产部署或真实 Emma 课件的业务验收。
