# WQT-001 · 验证与交付

## 验证记录

日期：2026-09-10。本地环境：Windows、Node 22.18.0；基线 4ab1c76，分支 codex/wqt-platform-artifacts。实现提交为 37f0354466d843e640794d9954914af4c3d61b69；本记录随后补充远端证据。CI 在 Ubuntu 上重复执行相同工具验证。

| 验收 ID | 操作与证据 | 结果 |
|---|---|---|
| AC-01 | gh api repos/veasil/wqt-platform；旧地址 API 查询；git ls-remote | 已更名；ID 1117361465 不变，public、main、Pages 关闭均不变；旧 URL 可解析新仓库 |
| AC-01 | 比对更名前后 main 和开发分支 SHA | main 352edf1e555fffefebc63b1f959d0e1ec254e629；开发分支 4ab1c76309a116e90c9898436ea5477f0c07e7ac，均未改变 |
| AC-02 | git remote get-url origin；package/lock JSON 核对 | origin 为 https://github.com/veasil/wqt-platform.git；根名称均为 wqt-platform |
| AC-02 | 将基线 lock 仅替换旧名称后逐字比较当前 lock | 一致，无依赖或版本升级 |
| AC-03 | npm run test:artifacts | 4/4 通过：草案生成、重复 ID/覆盖保护、非法路径、缺失制品/链接、包名一致性、单文件支持 |
| AC-04 | npm run check:artifacts；git diff --check | 17 份 Markdown、1 项变更结构和链接通过；diff 格式通过 |
| AC-04 | [GitHub Actions 34463685572](https://github.com/veasil/wqt-platform/actions/runs/34463685572)，head 为 37f0354 | success；工具测试和制品结构检查均通过 |
| AC-05 | Issue #2、草稿 PR #3、实现提交 37f0354、spec/plan/evidence | 相互关联；PR base 为原开发分支，23 个文件均属于本次范围 |
| AC-06 | 对 src、server.js、三个前端及旧部署脚本检查 diff | 无变更；未连生产或迁移数据库 |

仓库更名依据：[GitHub 官方文档](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)。已实际验证旧仓库 API 重定向；第三方部署平台的连接尚未验证。

## 验收与交付

- 仓库：[veasil/wqt-platform](https://github.com/veasil/wqt-platform)。
- Issue：[WQT-001 #2](https://github.com/veasil/wqt-platform/issues/2)。
- PR：[草稿 #3](https://github.com/veasil/wqt-platform/pull/3)，以 feat/cards-2026-workbench 为 base，仅评审本次变更。
- CI：实现提交的工作流已通过，后续提交状态以 PR Checks 为准。该检查只提供结构和工具行为保证，不验证需求真伪或业务验收。
- 用户最终验收：待完成；未合并、未部署。
- 保留原本地目录与服务器目录，避免更名破坏绝对路径。
- GitHub App / Zeabur 的关联状态需部署负责人在下次发布前核验。
- 分支保护与自动合并未修改；现有未提交的其他工作不包含在本变更。
- Issue 模板和流程成为默认分支的团队入口需要后续合并；当前命令可在本分支使用，PR 的 CI 已实际运行。

## 修复与工程回顾

2026-09-12 工作流补充：需求方明确指定 Astra 负责验收标准、复杂情况决策与规划，拉起 Luna 承接重复性代码工作。已同步 AGENTS 与 CONTRIBUTING，规定任务契约、升级条件、文件归属及主控复核；保留需求方确认与人工最终验收。该补充仅记录模型调度规则，没有切换当前任务模型、启动常驻调度或扩大业务权限。

提交前检查发现历史文档混合 CRLF/LF 和多余末尾空行；统一新增文档的换行后，git diff --cached --check 通过。早期未暂存检查不能覆盖未跟踪文件，因此最终交付采用暂存区范围核查。

本轮新增保证是制品草案可生成、不覆盖已有编号、结构缺失能被 CI 检出。保留原 Git 历史与包依赖；代码模块重构和租户迁移继续作为独立后续变更。自动开发循环仍需依据已确认需求推进，CI 不会替团队签署验收结论。
