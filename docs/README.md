# WQT 文档索引

文档按职责组织。README 是项目入口，AGENTS 是工程约束，CONTRIBUTING 是团队交付流程；本目录保存版本化项目知识与制品。

| 类别 | 入口 | 状态 |
|---|---|---|
| 团队协作 | [CONTRIBUTING](../CONTRIBUTING.md) | Artifact-driven、GitHub、开发循环与验收责任 |
| 开发变更 | [制品入口](changes/README.md) | WQT 编号、spec / plan / evidence、生成器与 CI |
| 当前需求 | [vNext 基线](vnext-requirements-and-acceptance.md) | 受控版本范围；原有制品路径继续有效 |
| 应用架构 | [架构方案](wqt-application-architecture.md) | 租户原则已确认；模块重构待实施 |
| 领域知识 | [领域规则](architecture/domain-rules.md) | 当前实现与已批准待实现规则 |
| 目录标准 | [目录规范](architecture/repository-layout.md) | 当前目录、目标模块与迁移步骤 |
| 本地开发 | [开发指南](development/local-development.md) | 当前配置、启动与测试限制 |
| 变更制品 | [变更模板](development/change-template.md) | 小变更复用一份记录，避免重复制品 |
| 本次整理 | [团队工程规范变更](development/team-engineering-change.md) | 工作区制品与验证状态 |
| 历史经验 | [修复记录](engineering-history.md) | 保留历史，不替代当前代码与测试 |

## 维护规则

- 文件必须区分当前实现、已批准待实现、提案和历史资料。
- 版本基线指定的路径和 ID 保持稳定；迁移文档时更新引用，必要时保留导航文件。
- 新文档按职责放置；短暂进度与调试输出不进入长期架构知识。
- 可在 GitHub Issue/PR 讨论，但被采用的结论必须回到关联制品并进入版本管理。

## 历史资料

[Screen 部署指南](DEPLOY.md)、[Streamlit 迁移手册](MIGRATION_PLAYBOOK.md)及根目录 `CLAUDE.md` 含过时运行说明。用于追溯时核对记录日期和代码，不作为当前开发与部署指令。
