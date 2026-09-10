# WQT-001 · 验证与交付

## 验证记录

日期：2026-09-10。本地环境：Windows、Node 22.18.0；基线 4ab1c76，分支 codex/wqt-platform-artifacts。下列本地验证针对提交前工作区；提交与 CI 版本在后续交付记录关联。

| 验收 ID | 操作与证据 | 结果 |
|---|---|---|
| AC-01 | gh api repos/veasil/wqt-platform；旧地址 API 查询；git ls-remote | 已更名；ID 1117361465 不变，public、main、Pages 关闭均不变；旧 URL 可解析新仓库 |
| AC-01 | 比对更名前后 main 和开发分支 SHA | main 352edf1e555fffefebc63b1f959d0e1ec254e629；开发分支 4ab1c76309a116e90c9898436ea5477f0c07e7ac，均未改变 |
| AC-02 | git remote get-url origin；package/lock JSON 核对 | origin 为 https://github.com/veasil/wqt-platform.git；根名称均为 wqt-platform |
| AC-02 | 将基线 lock 仅替换旧名称后逐字比较当前 lock | 一致，无依赖或版本升级 |
| AC-03 | npm run test:artifacts | 4/4 通过：草案生成、重复 ID/覆盖保护、非法路径、缺失制品/链接、包名一致性、单文件支持 |
| AC-04 | npm run check:artifacts；git diff --check | 17 份 Markdown、1 项变更结构和链接通过；diff 格式通过 |
| AC-05 | Issue #2；独立分支；PR 与 CI 待创建后补录 | 本地制品已建立；关联远端跟进 |
| AC-06 | 对 src、server.js、三个前端及旧部署脚本检查 diff | 无变更；未连生产或迁移数据库 |

仓库更名依据：[GitHub 官方文档](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)。已实际验证旧仓库 API 重定向；第三方部署平台的连接尚未验证。

## 验收与交付

- 仓库：[veasil/wqt-platform](https://github.com/veasil/wqt-platform)。
- Issue：[WQT-001 #2](https://github.com/veasil/wqt-platform/issues/2)。
- PR：待创建，以 feat/cards-2026-workbench 为 base，仅评审本次变更。
- CI：工作流已编写，远端执行结果待补录。
- 用户最终验收：待完成；未合并、未部署。
- 保留原本地目录与服务器目录，避免更名破坏绝对路径。
- GitHub App / Zeabur 的关联状态需部署负责人在下次发布前核验。
- 分支保护与自动合并未修改；现有未提交的其他工作不包含在本变更。
