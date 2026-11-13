# 本地开发与配置

> 当前 Express / PostgreSQL 实现的操作指引。项目入口见 [README](../../README.md)。

## 本地启动

准备 Node.js / npm 和一个独立的开发 PostgreSQL 数据库。依赖以各目录的 `package.json` 和锁文件为准。

**启动会初始化表、写入默认配置，并执行场次清理。先确认连接的是开发库。** 主库不再使用 `DB_PATH`；只设置 SQLite 路径不能隔离当前数据库。

### 1. 安装依赖并配置

在仓库根目录执行：

```sh
npm ci
```

在本地 `.env` 中配置以下项目，替换占位值；已有文件只补充所需项：

```dotenv
NODE_ENV=development
DATABASE_URL=postgres://<user>:<password>@localhost:5432/<development_database>
JWT_SECRET=<独立的随机签名密钥>
SETTINGS_ENCRYPTION_KEY=<32字节密钥的64位十六进制字符串>
PORT=8080
```

数据库连接在模块初始化时读取。为保证配置在 ESM 模块加载前生效，下面使用支持 `--env-file` 的 Node 启动。

### 2. 启动后端

```sh
node --env-file=.env server.js
```

部署环境按[启动保护配置](../changes/WQT-004-staging-startup-guards/configuration.md)补齐必填项后可 `npm start`；缺少 NODE_ENV / SERVER_ENV / 密钥或数据库配置会在初始化前拒绝启动。玩家端访问 [localhost:8080](http://localhost:8080/)。自助注册默认关闭；测试账号通过已有管理员或邀请码流程建立，完整登录还依赖短信配置。

### 3. 启动管理端

分别在两个终端、仓库根目录执行：

```sh
npm --prefix enterprise-panel install
npm --prefix enterprise-panel run dev
```

```sh
npm --prefix admin-web install
npm --prefix admin-web run dev
```

组织端访问 [localhost:5173/enterprise/](http://localhost:5173/enterprise/)，平台端访问 [localhost:5174/admin/](http://localhost:5174/admin/)。两者的 `/api` 请求代理到后端 8080；更改后端端口时同步调整 Vite 配置。

要验证 Express 托管三个前端的形态，在根目录执行 `npm run build`，再访问 8080 下的 `/enterprise/` 和 `/admin/`。该命令会安装并构建两个 Vue 应用。

## 配置放在哪里

| 配置 | 用途与读取方式 |
|---|---|
| `DATABASE_URL` | 主库连接；卡牌默认复用它 |
| `CARDS_DATABASE_URL` | 可选，单独指定卡牌 PG 连接 |
| `CARDS_SOURCE` | 默认 `postgres`；`sqlite` 只切换卡牌库，主库仍为 PG |
| `JWT_SECRET` | 登录 token 签名；更换后原 token 失效 |
| `SETTINGS_ENCRYPTION_KEY` | 解密数据库敏感设置；读取已有数据时必须匹配原密钥 |
| `BMOB_APP_ID`、`BMOB_REST_KEY` | Bmob 短信，按需配置到运行期设置 |
| OSS 相关设置 | 上传与文件存储；通过 `config` 读取环境变量及数据库设置 |
| AI 相关设置 | 按功能配置；卡牌生成读取环境中的 DeepSeek 配置，复盘支持按设置选择提供商 |
| `DATABASE_SSL` | 当前连接池在值为 `true` 时启用 SSL；按实际数据库连接要求设置 |

`src/config.js` 的 `loadConfig()` 先读取环境变量，再由数据库 `system_settings` 中的非空值覆盖。部分代码直接读取 `process.env`，不能假定所有设置采用同一优先级。排查时先找对应功能的读取入口。

`.env`、密钥、生产数据和 `_migration/` 导出不提交。外部功能尚未配置时，服务启动成功不等于短信、上传和 AI 已可用。

阿里云验证码2.0接入使用独立 `ALIYUN_CAPTCHA_*` 部署配置，不能复用 OSS 密钥；`CAPTCHA_PROVIDER` 未设置时保留腾讯。中国内地配置、场景形态、受控凭据交接及上线验证顺序见[阿里云验证码配置](aliyun-captcha-setup.md)。新版生产已运行c466f02，实际镜像、配置及验证证据见[生产切换记录](../changes/WQT-009-hk-first-release/aliyun-captcha-release-20261027.md)；后续工作稿不自动代表线上状态。

本机受控玩家UAT默认使用隔离环境，不继承`.env`全部变量。需要真实短信时，为 `tests/manual/player-uat.mjs` 或保留已有数据的 `tests/manual/resume-player-uat.mjs` 显式增加 `--live-sms`，仅白名单载入Bmob两项配置；腾讯人机验证使用独立 `--live-captcha`。恢复已有库必须指定owned数据库并使用resume入口，不能用会在退出时清理资源的新建入口。`/api/auth/verification-options` 的 `smsMode` 表示live/mock/unavailable，仅说明服务配置，不代表手机收件或供应商额度已验证。参见[登录与视觉修订](../changes/WQT-006-account-permissions/login-visual-followup-20261016.md)。

## 新版题面朗读（WQT-011）

正式场次 `POST /api/player/narration/:sessionId/:cardId` 使用服务端场次发布快照，实时校验访问范围，不接受客户端文本。配置 `VOLC_TTS_API_KEY`（火山语音新版控制台），或旧版语音控制台的 `VOLC_TTS_APP_ID` + `VOLC_TTS_ACCESS_KEY`；Ark 凭据不用于此接口。默认 `VOLC_TTS_SPEAKER=zh_male_shaonianzixin_moon_bigtts`、`VOLC_TTS_RESOURCE_ID=seed-tts-1.0`、`VOLC_TTS_SPEECH_RATE=-5`，配置见 `.env.example`。凭据仅从服务端环境读取，尚无管理端编辑入口；不提交真实密钥。

要求已配置 OSS。音频以文本、音色、模型资源、语速等的 SHA-256 放入独立私有 `cards-narration/v1/` 前缀；不同题面或音色不会复用旧版本。通过同源认证接口返回 MP3，前端使用 blob 播放；正式场次不自动降级成设备声音。并发生成使用主库事务级 PG advisory lock 防止同内容跨实例重复调用；每实例最多 4 个处理中内容。其他实例持锁时返回 429，不排队。供应商不自动重试，允许手动重试。若供应商成功但 OSS 写入失败，重试可能再次计费；不声称跨外部服务 exactly-once。

隔离回归：`node --test tests/runtime/card-narration.test.mjs tests/frontend/narration.test.mjs`；浏览器 UI 回归：`node --test tests/frontend/narration-browser.test.mjs`（需本机 Playwright 浏览器）。已配置语音凭据且能访问外网时，用 `node --env-file=.env scripts/verify-card-narration.mjs --live` 做一次固定短文本的计费合成探测；默认不接受缺少 `--live` 的调用，不输出密钥、不写业务库。真实音色还需手机播放试听，桩测试不代替该验收。实施证据见 [WQT-011](../changes/WQT-011-player-narration/change.md)。

## 自动验证

Windows 受限执行环境中，若 Playwright 浏览器已安装但下载测试报 `download.path: canceled`，先把**当前测试进程**的 TEMP/TMP 指向仓库内可写的临时目录，再保留原下载断言重跑。示例：创建 `./tmp/narration-test-temp`，将 `$env:TEMP=(Resolve-Path ./tmp/narration-test-temp).Path; $env:TMP=$env:TEMP`，并将 PLAYWRIGHT_BROWSERS_PATH 指向实际已安装的浏览器目录。无需更改系统全局临时目录或业务下载功能。复现结果见 [WQT-011](../changes/WQT-011-player-narration/change.md)。

`npm run lint` 检查模块入口与新提取代码的未定义变量；`npm run test:runtime` 覆盖导入副作用、路由顺序、运行生命周期与租户边界。PG 用例必须显式提供 `WQT_TEST_PG_ADMIN_URL`，它指向专用测试 PostgreSQL 实例中的管理员库，并具有创建/删除临时库权限。

测试控制器每次创建随机独占数据库，主库与卡牌库都指向该库；业务子进程使用环境白名单，退出后仅删除自己登记创建的库。不能把生产连接填入这个变量。未提供变量时 PG 用例标记 skipped，不能据此声称集成通过。PR 的 Runtime isolation 使用一次性 PostgreSQL 16 完整运行，外部 OSS/短信使用替身。

`node scripts/audit-session-ownership.mjs` 是独立只读盘点入口，仅接受显式 `WQT_MIGRATION_DATABASE_URL`，不加载 .env、不回退业务默认连接；输出聚合计数，不能自动修复或回填未知归属。

## 验证限制

制品工具可独立运行 `npm run test:artifacts` 和 `npm run check:artifacts`，不安装业务依赖、不启动数据库；这两项也是 PR 的 Artifact checks。新变更使用 `npm run change:new -- WQT-005 short-topic` 创建草案。

`npm run build` 构建两个 Vue 应用，不验证后端权限或数据正确性。

旧 `test/bench/run.mjs` 未纳入 Git；已跟踪的 `tests/auth.bench.mjs` 也仍依赖临时 SQLite 路径并继承环境变量。主库现在使用 PostgreSQL，这两套脚本都不能保证测试隔离。新 PG 测试入口不改变旧脚本的风险，不直接运行它们。

启动服务会修改连接的数据库。测试必须显式指定独立 PG 库与外部服务替身，再验证登录、开局、事件、结算、复盘和组织统计。容量与恢复验收遵循 [vNext 基线](../vnext-requirements-and-acceptance.md)。

## 部署与历史资料

仓库原部署说明记录为 Zeabur Node 服务与 PostgreSQL；本轮未核实线上版本。构建入口为 `npm run build`，环境变量已注入时运行 `npm start`。

`src/runtime.js` 调用主库初始化与增量迁移，不等于生产迁移已经获得批准。发布记录需包含提交、迁移、备份、验证结果和回退版本。SQLite 导入脚本 `scripts/migrate_sqlite_to_pg.mjs` 是历史数据迁移工具，不是日常启动步骤。

[旧部署指南](../DEPLOY.md)描述 Screen 双环境，[旧后台迁移手册](../MIGRATION_PLAYBOOK.md)描述 Streamlit 迁移；二者仅作历史参考，不能直接用于当前生产操作。

## CI 合成数据恢复演练

WQT-003 的 tests/runtime/recovery.test.mjs 使用 pg_dump / pg_restore 和真实场次归属迁移函数，分别验证迁移前、迁移后的备份恢复。显式配置 WQT_TEST_PG_ADMIN_URL 后，测试会创建三个随机独占数据库；本机还需安装与 PG16 服务匹配的客户端并加入 PATH。缺 PG 配置时跳过，已配置但缺工具时失败。

夹具覆盖组织、用户、场次和文件 metadata 的最小 schema，并非完整生产副本；恢复测试不证明全库容量、卡牌独立库、外部对象或生产恢复时间。不要把此测试当作生产备份脚本。

Browser contracts CI 用锁文件构建两个前端，再运行固定 Playwright 版本的 Chromium 专项。所有 HTTP API 使用替身且外网请求被拒绝，不发送短信、不调用 AI、不连接数据库。
