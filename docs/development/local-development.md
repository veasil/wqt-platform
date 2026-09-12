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

部署环境已注入变量时，可直接 `npm start`。玩家端访问 [localhost:8080](http://localhost:8080/)。自助注册默认关闭；测试账号通过已有管理员或邀请码流程建立，完整登录还依赖短信配置。

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

## 自动验证

`npm run lint` 检查模块入口与新提取代码的未定义变量；`npm run test:runtime` 覆盖导入副作用、路由顺序、运行生命周期与租户边界。PG 用例必须显式提供 `WQT_TEST_PG_ADMIN_URL`，它指向专用测试 PostgreSQL 实例中的管理员库，并具有创建/删除临时库权限。

测试控制器每次创建随机独占数据库，主库与卡牌库都指向该库；业务子进程使用环境白名单，退出后仅删除自己登记创建的库。不能把生产连接填入这个变量。未提供变量时 PG 用例标记 skipped，不能据此声称集成通过。PR 的 Runtime isolation 使用一次性 PostgreSQL 16 完整运行，外部 OSS/短信使用替身。

`node scripts/audit-session-ownership.mjs` 是独立只读盘点入口，仅接受显式 `WQT_MIGRATION_DATABASE_URL`，不加载 .env、不回退业务默认连接；输出聚合计数，不能自动修复或回填未知归属。

## 验证限制

制品工具可独立运行 `npm run test:artifacts` 和 `npm run check:artifacts`，不安装业务依赖、不启动数据库；这两项也是 PR 的 Artifact checks。新变更使用 `npm run change:new -- WQT-003 short-topic` 创建草案。

`npm run build` 构建两个 Vue 应用，不验证后端权限或数据正确性。

旧 `test/bench/run.mjs` 未纳入 Git；已跟踪的 `tests/auth.bench.mjs` 也仍依赖临时 SQLite 路径并继承环境变量。主库现在使用 PostgreSQL，这两套脚本都不能保证测试隔离。新 PG 测试入口不改变旧脚本的风险，不直接运行它们。

启动服务会修改连接的数据库。测试必须显式指定独立 PG 库与外部服务替身，再验证登录、开局、事件、结算、复盘和组织统计。容量与恢复验收遵循 [vNext 基线](../vnext-requirements-and-acceptance.md)。

## 部署与历史资料

仓库原部署说明记录为 Zeabur Node 服务与 PostgreSQL；本轮未核实线上版本。构建入口为 `npm run build`，环境变量已注入时运行 `npm start`。

`src/runtime.js` 调用主库初始化与增量迁移，不等于生产迁移已经获得批准。发布记录需包含提交、迁移、备份、验证结果和回退版本。SQLite 导入脚本 `scripts/migrate_sqlite_to_pg.mjs` 是历史数据迁移工具，不是日常启动步骤。

[旧部署指南](../DEPLOY.md)描述 Screen 双环境，[旧后台迁移手册](../MIGRATION_PLAYBOOK.md)描述 Streamlit 迁移；二者仅作历史参考，不能直接用于当前生产操作。
