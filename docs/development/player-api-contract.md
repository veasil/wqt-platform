# 新版玩家 HTTP 契约：课件接入用源码快照

核对源码：`b469661`，日期 2026-11-13。适用于 `WQT_ACCOUNT_MODEL=accounts`；不是新建 API、正式版本化公共协议或 SDK。若更新集成 SHA，必须重新检查[基线差异](platform-baseline-map.md)。

## 公共约定与前提

JSON 请求用 `Content-Type: application/json`；受保护请求携带 `Authorization: Bearer <运行时登录所得 token>`。账号必须有实时有效身份绑定与相应权益；组织范围由后端决定。以下流程假设隔离开发库已有获授权测试账号和已发布卡组。没有公共 API key，也没有已完成的第三方网站登录授权。

当前接口返回一些数据库记录字段，尚未定义可长期承诺的外部响应 DTO。客户端只读取需要字段，不能把整个 session/events 对象公开或当作稳定存储格式。

## 登录与选择账号

`POST /api/auth/login`：手机号可用 phone（或 username 兼容字段）；身份验证具体字段参考 [auth.routes.js](../../src/platform/accounts/auth.routes.js) 与 [verification.js](../../src/platform/accounts/verification.js)。密码路径使用 password 和 verificationMethod，以及配置对应的人机验证字段。不要固定验证码或绕过验证。

成功返回 `{user, accounts, requiresAccountSelection, token, expiresAt}`。若需要选择账号，调用 `POST /api/auth/select-account`，body 为 `{accountId}`，携带已有身份 token；使用返回的新 `{user, token, expiresAt}`，不能只在浏览器里改 accountId。`GET /api/auth/session` 返回当前身份、可用账号及会话期限，适合恢复登录检查。账号选择不延长固定会话期限。

## 开局

`POST /api/player/start`。示例数字仅为形状示意，cardGroupId 必须来自自己的有效卡组：

```json
{
  "requestId": "a-new-uuid-for-this-start",
  "location": "隔离课件演示",
  "cardGroupId": 1,
  "players": [],
  "mode": "standard",
  "settings": {"duration": 1800, "counts": [1, 1, 1]}
}
```

- location 必须是非空字符串，原始长度不超过 200。
- duration 单位为秒，整数 1–10800；counts 为三个整数（启蒙/成长/青春），各 0–15，至少一个非零。
- players 可省略；提供时按最多 30 个、每个最长 40 字符的字符串数组使用。不要放真实学生身份资料。
- 可选 settings.ageRange 为完整 `{min,max}`，整数 0–120 且 min≤max；省略则为空。
- activityCode 可省略；省略时当前实现自动关联活动，活动码不是组织访问凭据。

成功返回 `{ok, sessionId, activity, initialState}`。后端保存创建时的组织归属和卡牌发布快照。**开局或重试后调用 GET 场次接口取得持久状态**：当前 start 路由会另行构造 initialState，不能把它当成重复开局请求后的最新持久状态。

## 读取与动作

`GET /api/player/session/:id` → `{session, state, scoreOverview, events}`。state 含 revision、values、phase、done、pending、paused、ended 等。`GET /api/player/cards/:id` → `{cards}`，由场次发布快照限制。不要从其他卡组或草稿拼接卡牌。

`POST /api/player/action`：公共字段为 requestId、sessionId、revision、action。revision 使用最近读取的 state.revision。例如结束：

```json
{"requestId":"a-new-uuid-for-this-finish","sessionId":1,"revision":3,"action":"finish"}
```

| action | 附加输入 | 当前主要约束 |
|---|---|---|
| choice | cardId、choice（A/B/C/D） | 卡牌在快照内；D 先由创心力建立；当前基线还限制卡牌阶段等于游戏阶段 |
| skill | skill，按技能附 cardId、text | 合法伍力且尚未使用；创心力方案 1–240 字；具体规则见 state.js |
| adjust | values，reason 可选 | 五个 0–10 整数的完整绝对值，非增量；理由最多 200 字 |
| pause | 无 | 暂停/恢复切换，不是“确保暂停”的设置命令 |
| advance | 无 | 必须有待处理阶段结果，不能任意跳关 |
| finish | 无 | 结束并冻结场次，后端计算最终分数 |

成功通常返回 `{state,type,payload}`；finish 另含 finalScore、scoreDetails。注意返回 type 可能是 card_choice、skill_use、game_finish，不一定等于请求 action。values 顺序为安全力、脑波力、实感力、创心力、沟通力；初始都是 3。finalScore 是后端基于卡组快照计算的归一化结果，不是这五项简单相加。

同一场次每次成功动作递增 revision；旧 revision 返回 409。结束后拒绝后续动作；暂停时只允许 pause/finish；时间耗尽只能 finish。以 [state.js](../../src/game/player/state.js) 和 [routes.js](../../src/game/player/routes.js) 为最终源码依据。

## 重试、并发和失败

requestId 为 8–120 位 `[a-zA-Z0-9_.:-]` 字符串，建议每次新意图生成 UUID。同一写入网络超时后重试，保留 ID、revision 和整个 payload。相同 ID 搭配不同操作/账号/内容会返回 409。成功操作的结果与业务状态在同一事务保存；重试仍检查身份绑定。不要把去重成功解释为跨所有接口、旧账号模式或外部 AI 调用的统一保证。

revision 解决两端同时修改的问题，requestId 解决同一请求重复提交的问题。超时可能已经写入：先恢复场次并保留原请求供重试。明确 revision 冲突后，刷新状态，让用户确认新的操作；新意图用新 ID，不要悄悄更改旧请求重发。重复 pause 使用新 ID 会再次切换状态。

常见错误 body 为 `{error: "说明"}`；当前没有统一稳定机器错误码，不要解析中文字符串写业务分支。400 输入无效；401 身份问题；403 权限/权益问题；404 不存在或不可访问；409 状态/版本/请求冲突；429 限流；503 依赖不可用或配置问题。其他 5xx 可能返回通用错误。写入超时、断线、某些 5xx 或无法解析成功响应时结果可能未知。参考 [api.js](../../public/player/api.js) 的 outcomeUnknown。

## 不包含的能力与后续验收

不包含跨站 SSO、任意课程积分模型、第三方通用授权、公开 SDK。旧 `/api/game/event` 和 `/api/game/finish` 不用于新版场次。

正式接入前最低验证：真实 HTTP 登录/选账号、开局/动作/结束/刷新恢复、同 ID 重试、两端旧 revision 冲突、撤权拒绝、跨组织拒绝。建议测试在专用 PG/Redis 上运行，并覆盖课件实际浏览器；当前基线完整回归尚未全部完成，详见 [WQT-014](../changes/WQT-014-emma-handoff/change.md)。

## WQT-015 增量

本分支已实现受限团队应用凭证，调用方式见[快速开始](team-courseware-quickstart.md)；旧正文继续描述 b469661 快照。本分支已迁入跨阶段选牌修复，卡牌阶段不再限制当前游戏阶段，卡组发布快照仍是边界。
