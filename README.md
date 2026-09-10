# WQT Platform

[GitHub 仓库](https://github.com/veasil/wqt-platform) · [变更制品](docs/changes/README.md)

伍仟天团队维护的应用平台，为《AI在5000天·伍力全开》提供账号、组织、桌游计分、内容管理和复盘能力。

## 项目状态

| 项目 | 状态 |
|---|---|
| 桌游、组织管理、平台管理 | 已有实现 |
| Organization 作为 Tenant | 已确认的领域边界 |
| 场次固定归创建时的组织 | 已批准，待代码与数据迁移 |
| Learning MVP | 纳入 vNext，尚待实现与验收 |
| 创客营接入 | 后续架构方向 |

## 技术架构

当前采用 Express 单体、PostgreSQL 和三个前端。Express 同时提供 API 与静态托管；卡牌默认与主库共用 PG 数据库。组织是租户隔离单位。

| 应用 | 技术 | 访问路径 |
|---|---|---|
| 后端 API | Node.js / Express / ESM | `/api/*` |
| 桌游玩家端 | HTML / CSS / JavaScript | `/` |
| 组织管理端 | Vue 3 / Vite | `/enterprise/` |
| 平台管理端 | Vue 3 / Vite | `/admin/` |

## 仓库结构

以下为当前主要目录；目标模块结构及迁移顺序见[目录规范](docs/architecture/repository-layout.md)。

```text
wqt-platform/                # 仓库名称；已有本地目录可保留旧名
├── server.js             # 服务启动、应用装配及尚未拆分的业务路由
├── src/                  # 后端：认证、权限、数据访问及服务
├── public/               # 桌游玩家端
├── enterprise-panel/     # 组织管理前端
├── admin-web/            # 平台管理前端
├── tests/                # 已跟踪的测试；PG 隔离适配待完成
├── scripts/              # 数据维护、迁移与运维脚本
├── docs/                 # 需求、架构、开发与验收制品
├── .github/              # Issue / PR 模板与制品检查 CI
├── AGENTS.md             # 团队及编码代理的工程约束
└── CONTRIBUTING.md       # 制品驱动的开发与交付流程
```

`admin-panel/` 是旧 Streamlit 后台，仅作历史参考。仓库尚有遗留脚本和本地产物，目录整理按独立变更逐步实施。

## 快速开始

准备 Node.js / npm 和独立开发 PostgreSQL 库，按[本地开发指南](docs/development/local-development.md)配置 `.env`。启动会初始化并写入数据库，先确认开发库连接。

```sh
npm ci
node --env-file=.env server.js
```

玩家端访问 [localhost:8080](http://localhost:8080/)。管理端开发、外部服务配置及验证限制见开发指南。

## 团队协作

采用 **artifact-driven development**：需求与验收标准确认后，以版本化制品驱动实现、验证、修复和交付。GitHub 管理 Issue、分支、PR 与版本追踪；开发循环在已确认范围内持续推进，业务验收由指定验收人完成。

- [贡献流程](CONTRIBUTING.md)：角色、制品、自动循环、GitHub 与完成标准。
- [工程约束](AGENTS.md)：所有贡献者和编码代理必须遵守的项目规则。
- [文档索引](docs/README.md)：需求基线、架构、领域知识与历史资料。
- [变更制品](docs/changes/README.md)：使用 `npm run change:new -- WQT-002 short-topic` 创建下一项变更；`npm run check:artifacts` 执行与 PR 相同的结构检查。
