# WQT-004 真实预发布交接清单

本文是已批准 gate 的执行交接材料，目标是把独立预发布从“构建验证中、应用未就绪”推进到可验证的真实联调。它不重新请求已批准的采购或生产触发器决定，也不包含任何凭据值。

## 当前状态与已知资源

| 状态 | 证据/标识 | 含义 |
|---|---|---|
| CI | PG18/PG16 与浏览器检查按 CI 结果判断 | CI 通过后才允许使用候选版本部署；构建通过不代表外部服务可用 |
| 资源就绪 | 服务器 `wqt-staging-hk`（`6aa54068aa8a37958d958950`）、项目 `wqt-staging`（`6aa541025dbe69df73c8b41f`）、PG18 `wqt-staging-pg`（`6aa5412af9b152e74791f0a3`，RUNNING）、候选应用 `wqt-candidate`（`6aa54496a97995bc0221efcb`） | 独立服务器、项目和数据库已准备；服务器自动续费已关闭 |
| PG18 只读验证 | PostgreSQL 18.6，数据目录 `/var/lib/postgresql/18/docker`，业务表计数为 0；非交互 `sh -c 'psql -X -w </dev/null'` 成功 | 空库条件已取得只读证据；旧 API 客户端超时根因仍未确定 |
| 构建验证中 | 候选部署 `6aa544977a2a029fbe0d2ac3`，实际 SHA `d358bbf4b0d3b3ee8ec02840374a42cc625e5ac3`，状态 `FAILED（前端构建缺Vite，修复复验中）`；候选 git trigger 已关闭 | 这是无凭据的构建/失败保护验证，不是业务上线 |
| 应用 | 旧 `wqt-api` 两次 gitRef 被平台忽略并选 `main`，部署已取消且无 DB 连接；当前以 `wqt-candidate` 为配置目标 | 应用尚未就绪，不能报告启动保护、合成数据或真实联调通过 |
| 生产交付 | `scoring-system` 的生产 Git trigger 已为 `null`，生产服务仍 RUNNING | 不因本次预发布工作触发生产部署；正式发布仍需候选版本与发布 gate |

## 配置清单

所有变量通过 `wqt-candidate` 的 staging 环境私有变量/secret 配置界面写入，再由只读配置检查复核变量名和非敏感状态。平台环境标签仍为 `production`（ID `6aa541025070596c8e668c0c`），但该标签属于独立 `wqt-staging` 项目；应用模式必须由变量显式设置，不能从标签推断。不要把值写入 Git、聊天、构建日志或交接文档。

### 应用与数据库

| 变量 | 配置方式 |
|---|---|
| `NODE_ENV` | staging 应用私有变量，固定为 `production` |
| `SERVER_ENV` | staging 应用私有变量，固定为 `staging`；不能从平台环境标签推断 |
| `DATABASE_URL` | 指向独立 PG18 主库的私有 secret；由数据库服务提供连接信息 |
| `CARDS_DATABASE_URL` | 指向独立 PG18 卡牌库的私有 secret；按实际部署的数据库连接配置 |
| `CARDS_SOURCE` | staging 应用私有变量，固定为 `postgres` |
| `JWT_SECRET` | 用安全随机生成器生成至少 32 字符的私有 secret，不使用默认或开发值 |
| `SETTINGS_ENCRYPTION_KEY` | 用安全随机生成器生成 64 位十六进制私有 secret |
| `WQT_EXPECTED_MAIN_HOST` / `WQT_EXPECTED_MAIN_DATABASE` | staging 应用私有变量，填写实际主库 host/database 的预期标识 |
| `WQT_EXPECTED_CARDS_HOST` / `WQT_EXPECTED_CARDS_DATABASE` | staging 应用私有变量，填写实际卡牌库 host/database 的预期标识 |
| `WQT_EXPECTED_OSS_BUCKET` | staging 应用私有变量，填写独立 OSS bucket 名称 |
| `TEST_LOGIN_*` | staging 必须留空，不得填写 `false` 字符串 |
| `ENABLE_DEV_LOGIN` | staging 私有变量固定为 `false` |
| `DEV_LOGIN_KEY` | staging 必须留空 |

主库与卡牌库必须对应独立 PG18 资源和授权边界；若实际部署共用同一 PG 服务，仍须按应用要求提供两条正确连接配置，并由资源权限和启动检查阻止生产目标。预发布数据库中的 BMOB、OSS、AI 等敏感或外部配置必须为空，不能依赖数据库非空值覆盖身份、连接或运行模式。

### Bmob 短信

建立独立的 Bmob app（不得复用生产 app），在 staging 应用私有 secret 中配置：

| 变量 | 配置方式 |
|---|---|
| `BMOB_APP_ID` | 填入独立 Bmob app 的 app id |
| `BMOB_REST_KEY` | 填入同一独立 Bmob app 的 REST key，作为私有 secret |

准备已明确同意的团队测试号码，并在 staging 的正式认证流程中绑定到对应合成数据账号。预置账号的空手机号不是可用登录凭据；不写入固定验证码，不依赖 `mockCode`。真实短信验证前先确认预发布凭据不能访问生产 Bmob app。

### OSS 文件存储

建立独立 OSS bucket（不得复用生产 bucket），并配置只允许该 bucket、该 staging 项目所需路径的访问凭据：

| 变量 | 配置方式 |
|---|---|
| `ALIBABA_CLOUD_ACCESS_KEY_ID` | 使用为 staging 创建的独立 RAM 身份，在应用私有 secret 中配置 |
| `ALIBABA_CLOUD_ACCESS_KEY_SECRET` | 配置同一 staging RAM 身份的私有 secret |
| `OSS_BUCKET_NAME` | 填入独立 bucket 名称 |
| `OSS_REGION` | 填入独立 bucket 所在 region |

权限验证必须包含“可执行预期 staging 操作”和“不能访问生产 bucket”两部分。`WQT_EXPECTED_OSS_BUCKET` 只用于误配置检查，不能代替 bucket 隔离和限桶授权。

### AI（仅在本轮使用时）

若 staging 联调包含 AI，单独申请与配置 staging 的 AI 项目、凭据、模型/区域和配额；不要复制生产 AI secret，也不要把 AI 配置写入数据库。变量名以当前应用实际支持的 AI 配置为准，采用平台私有 secret 注入，并在交接记录中只登记变量名、项目/配额配置方式和验证结果。若本轮不使用 AI，则保持 AI 变量未配置，并明确跳过 AI 联调项。

## 验证顺序

1. **确认 CI gate。** 核对候选提交的 PG18、PG16、浏览器 CI 均通过，并记录构建版本。CI 失败时停在代码/构建阶段，不推进业务部署。
2. **确认资源 gate。** 只读复核服务器、`wqt-staging` 项目、PG18 服务和 `wqt-candidate` 对应上表 ID；确认服务器在线、PG18 RUNNING、自动续费关闭。资源 READY 不等于应用已部署。
3. **配置 staging 私有变量。** 按本清单注入应用与数据库配置；由运维在 Bmob 建立独立 app、在 OSS 建立独立 bucket 与限桶 RAM 凭据，并准备团队测试号码。若使用 AI，先建立独立 AI 配置。只读检查变量存在性、模式和预期标识，不输出值。
4. **执行部署前检查。** 在应用绑定候选版本前，按 `configuration.md` 进行两个数据库和主库 `system_settings` 的只读预检；确认目标 host/database/bucket 一致，拒绝副本中的敏感配置，并确认检查发生在 `initDb`/迁移之前。不要为检查临时开放 PG 公网端口。
5. **推进候选构建验证。** 继续观察 `wqt-candidate` 的候选部署，确认平台使用指定实际 SHA 且 git trigger 保持关闭。当前无数据库凭据的受控构建/失败保护验证可以继续；不把它当作业务启动或上线。待配置齐备后，`loadConfig` 再次复核变量存在性、值的非敏感模式和预期标识；目标不符或弱/默认密钥时保持应用未就绪并记录失败证据。
6. **初始化完整 schema。** 仅对已核实的独立空库执行初始化；确认受检领域表为空后，再按既定 helper 在同一事务中准备合成数据。非空拒绝或任一步失败时应全部回滚，不使用生产数据、生产凭据或伪造文件。
7. **验证正式认证。** 使用已同意的团队测试号码走真实短信流程，确认 staging 缺真实短信配置时返回失败且不返回模拟码；确认 staging 凭据无法访问生产 Bmob。
8. **验证 OSS 与可选 AI。** 使用限桶凭据执行 staging 所需上传/读取/删除或等价业务操作，并验证生产 bucket 拒绝。若启用 AI，验证独立项目、模型/区域和配额；若未启用，记录该项为明确跳过。
9. **执行浏览器全链路与隔离复核。** 覆盖登录、组织/场次核心流程及文件/AI 集成（按启用项），同时复核预发布连接、凭据和数据不会触达生产目标。将 CI、资源、部署、合成数据和外部联调分别记录为独立证据。
10. **提交验收材料。** 需求方验收前，交付候选版本、配置变量清单（不含值）、资源 ID、启动/迁移/联调日志摘要和失败回滚证据。需求方验收及正式发布是后续 gate，不由本交接文档代替。

## 状态判定与阻塞处理

- **构建验证中 / 资源就绪 / 应用未就绪**：这是当前已知状态，允许继续做配置准备与受控失败保护验证；不能称为预发布可用。
- **资源就绪但配置未完成**：可以进行无凭据的受控构建验证；业务启动、数据库初始化和外部联调须等待配置完成。
- **配置完成但预检失败**：保留应用未就绪，修复目标标识、权限或空库条件后重跑预检；不绕过启动保护。
- **应用启动但真实服务未验证**：只能报告应用已部署，不能报告短信、OSS、AI 或全链路通过。
- **任一 staging 凭据可访问生产目标**：立即停止联调并撤销/重发 staging 凭据，修复权限边界后再继续；不通过修改预期变量掩盖问题。

本交接依赖 `spec.md`、`configuration.md` 与 `cloud-gates.md` 中已批准的 G-TRIGGER/G-RESOURCE 记录；不要求重新批准这些既有 gate。若实际报价、资源 ID、权限边界或应用支持的变量发生变化，记录差异并升级给相应负责人后再继续。
