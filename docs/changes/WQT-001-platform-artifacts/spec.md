# WQT-001 · 仓库更名与制品流程

状态：实现与技术检查完成，待最终验收
需求来源：2026-09-10 项目讨论；需求提出方回复“你开始工作”，授权执行保留历史、更名 wqt-platform、落地版本化制品流程。
基线：4ab1c76309a116e90c9898436ea5477f0c07e7ac（feat/cards-2026-workbench）。
Issue：[GitHub #2](https://github.com/veasil/wqt-platform/issues/2)。PR：[草稿 #3](https://github.com/veasil/wqt-platform/pull/3)。

## 目标与范围

将现有 GitHub 仓库 veasil/scoring_system 更名为 veasil/wqt-platform，保留仓库身份、历史、权限及可见性。统一根包名称，纳入本轮团队文档，建立每次变更的 spec、plan、evidence 入口及自动检查。

## 非目标

不新建仓库；不合并或部署现有开发分支；不迁移数据库、前端目录或服务器目录；不修改 GitHub 分支保护、权限、密钥；不自动完成业务验收。

## 验收标准

| ID | 标准 | 验证方式 |
|---|---|---|
| AC-01 | GitHub 名称为 wqt-platform，仓库 ID 仍为 1117361465；历史与可见性保留 | 更名前后 API 与 Git refs 核对 |
| AC-02 | origin 使用新 URL；根 package.json 与锁文件名称一致；依赖不变 | Git、JSON 比对 |
| AC-03 | 每次变更可用命令创建 spec/plan/evidence，拒绝覆盖或重复 ID | 生成器自动测试 |
| AC-04 | 本地和 PR 有制品结构、链接与包名检查，不启动数据库 | 本地检查、GitHub Actions |
| AC-05 | Issue、分支、PR、制品和验证结果可相互追踪 | 链接及 PR 范围检查 |
| AC-06 | 本轮只涉及制品流程与更名，部署路径、数据和业务代码不变 | diff 与引用盘点 |

## 确认与验收

方向与执行范围由本次“你开始工作”确认。上述标准是对已同意方案的技术分解；本次验证不代替指定验收人的最终验收。远端更名已授权；合并和生产发布不在本轮范围。
