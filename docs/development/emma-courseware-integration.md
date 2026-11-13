# Emma / Codex：HTML 课件接入交接

日期：2026-11-13。仓库：https://github.com/veasil/wqt-platform 。协作基线分支：`codex/emma-courseware-baseline`。

这是当前本地多迭代代码的协作快照，不等于 main、生产版本或生产发布批准。SDK 尚未开发，本轮不实现课件接入，不承诺稳定的外部 API。验证状态见 [WQT-014](../changes/WQT-014-emma-handoff/change.md)。

## 1. 获取代码与提交 PR

首次获取：

```sh
git clone --branch codex/emma-courseware-baseline https://github.com/veasil/wqt-platform.git
cd wqt-platform
git switch -c codex/emma-html-courseware
git rev-parse HEAD
```

已有克隆：先保存自己的改动，再执行 `git fetch origin`，然后执行 `git switch -c codex/emma-html-courseware origin/codex/emma-courseware-baseline`。若该开发分支已存在，切回该分支，先比较差异，不重置、不强推。把起点 SHA 记入自己的变更制品。

仓库为公开仓库，读取无需写权限。具有协作者权限时 push 自己的分支；否则 fork 后从 fork 提 PR。PR 的 base 使用 `codex/emma-courseware-baseline`，由维护者另行决定何时向 main 集成。不要直接改共享基线或生产分支。PR 说明目标、课件样例、接口变更、验证证据与剩余问题；不要附 token、真实学生信息、生产配置或数据库导出。

## 2. 先读什么

- [AGENTS](../../AGENTS.md)、[协作流程](../../CONTRIBUTING.md)、[领域规则](../architecture/domain-rules.md)。
- [本地开发](local-development.md)、[账号方案](../changes/WQT-006-account-permissions/spec.md)。
- 新版调用参考：[player.js](../../public/player/player.js)、[请求处理](../../public/player/api.js)。它们是现有应用实现，不是可以直接跨站使用的 SDK。
- 后端：[玩家路由](../../src/game/player/routes.js)、[状态规则](../../src/game/player/state.js)、[计分结算](../../src/game/player/settlement.js)、[写入去重](../../src/game/sessions/operation.js)。

## 3. 本地环境

使用 Node.js 22、锁文件安装 `npm ci`。两个管理端需要 `npm run build`；HTML 玩家端位于 `public/player/`。浏览器测试需要 Playwright Chromium。

`.env.example` 只是变量示意，仍有旧 SQLite 说明，不是一键可用配置。按照本地开发文档配置专用 PostgreSQL、独立随机 JWT_SECRET 和 SETTINGS_ENCRYPTION_KEY；新版账号链路必须显式设 `WQT_ACCOUNT_MODEL=accounts`，并配置独立 Redis 的 `REDIS_URL` 和自己的 `WQT_REDIS_NAMESPACE`。默认账号模式仍是 legacy，不能仅凭文件存在就认为新版认证已启用。

启动 `node --env-file=.env server.js` 会初始化和修改数据库，只能使用专用开发库。不要复制维护者的 `.env` 或连接生产。短信、人机验证、OSS、AI、语音需要各自的配置或测试替身；不要为了跑通课件放宽生产权限校验。测试账号必须在隔离库中建立，不使用共享生产管理员账号。

## 4. 当前接口地图

以下为源码导航，不是完整外部接口契约；参数、响应和错误以当前路由及测试为准。

| 用途 | 新版入口 | 约束 |
|---|---|---|
| 登录 | POST `/api/auth/login` | accounts 模式走身份验证；可能返回 requiresAccountSelection |
| 恢复身份 | GET `/api/auth/session` | 检查有效会话与可用账号 |
| 选择账号 | POST `/api/auth/select-account` | 使用当前身份实际拥有的账号并使用返回的新 token |
| 创建新版场次 | POST `/api/player/start` | requestId、地点、有效卡牌组、设置等；不能用任意课件 ID 代替卡牌组 |
| 读取场次 | GET `/api/player/session/:id` | 返回 session、state、scoreOverview、events；校验访问范围 |
| 读取场次卡牌 | GET `/api/player/cards/:id` | 使用创建场次时保存的发布快照 |
| 操作与结束 | POST `/api/player/action` | 由 state.js 验证动作；结束也是 finish 动作 |

旧 `/api/game/start`、`/api/game/event`、`/api/game/finish` 仍在代码里；不要与新版玩家状态链路混搭。现有系统按桌游场次、卡牌和伍力状态建模，并非“任意课程积分账本”。如果课件要新增独立积分类型、学生账户或不同记分规则，先列出业务差异交维护者确认。

## 5. 跨网站接入尚需决定的边界

HTML 可以自定义界面，但真实身份、组织权限、场次归属和持久数据仍由后端检查。Organization 就是 Tenant；不能由课件随意传组织 ID 来获得访问权。

现有请求使用 `Authorization: Bearer <token>`。课件网站与伍仟天是不同 origin，无法直接读取伍仟天的 localStorage 登录状态。不要将 token 放 URL、写进 HTML、共享管理员密钥，或复制管理员专用 session bridge。当前 CORS 配置不代表已有第三方登录授权方案；默认 frame-ancestors / X-Frame-Options 也禁止任意外站嵌入。

拿到课件后，先明确实际域名、谁登录、谁有记分权、是否必须沿用伍仟天登录。跨站登录、嵌入白名单和 token 交付方式需要维护者确认，不能由课件 Codex 自行放宽。当前可以先做隔离的同源原型或 API 替身来确认交互，但原型成功不等于跨站接入成功。

## 6. 请求重试与状态恢复

新版 accounts 模式关键写入要求 8–120 位 requestId。一次用户操作只生成一次 ID；网络超时后重试同一操作，保留相同 ID 和相同 payload。下一次不同操作生成新 ID。相同 ID 配不同内容会冲突。

原因是浏览器超时不代表服务端没有记分；如果每次重试都换 ID，就可能重复计分。现有后端把去重结果和业务写入放在同一事务中。课件应从服务端恢复场次状态，避免刷新后只使用浏览器里的旧分数。不要假定旧账号链路也具备同等去重保障。

401 需要恢复登录，403 需要处理失权，404 可能表示不可访问，409 需要读取当前状态或处理请求冲突，429 应展示稍后重试。网络错误及部分 5xx 的写入结果可能未知，不能直接显示“未计分”并新建操作。参考 api.js 的 outcomeUnknown 处理。

## 7. 后续第一份课件的建议验收（尚待确认）

老师登录并选择正确账号 → 创建场次 → 课件操作记分 → 刷新恢复 → 结束并查看结果。另验证重复点击/超时重试不重复计分、撤权后不能继续写、不能读取其他组织场次。课件里不含后端密钥和真实学员数据。

建议下一轮只完成一份课件的闭环；不预建通用 SDK、课程平台、多租户代理或新积分模型。本说明不授权生产部署、数据迁移、修改登录边界。

可给 Codex 的任务：

> 先读 AGENTS.md 和本接入说明。检查我提供的 HTML 课件，列出交互到现有玩家接口的映射、无法复用的规则和跨站登录待决项。先形成小范围变更记录与验收草案；不要做通用 SDK，不改生产，不绕过组织权限。经需求确认后，在 codex/emma-html-courseware 分支实现隔离原型并附 PR 验证证据。
