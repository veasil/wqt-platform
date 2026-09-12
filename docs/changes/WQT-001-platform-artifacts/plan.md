# WQT-001 · 实施计划

## 步骤

1. 核查远端名称、权限、Pages、webhooks、工作流、分支及部署路径。
2. 建独立分支，保存团队文档，统一 package 名称与制品目录。
3. 实现制品生成器、检查命令和无数据库依赖的 CI，测试重复 ID 与覆盖保护。
4. 更名现有 GitHub 仓库，更新 origin，核验仓库 ID、refs 与旧 URL 跳转。
5. 建 Issue，提交选定文件，推送分支并建草稿 PR；记录 CI 与验收状态。

## 引用盘点与兼容处理

| 项目 | 发现 | 处理 |
|---|---|---|
| GitHub | veasil/scoring_system；公开；默认 main；管理员权限 | 更名 wqt-platform，保持 ID 与设置 |
| 当前基线 | feat/cards-2026-workbench，4ab1c76，与远端一致 | PR base 使用此分支，避免夹带 main 之外的既有功能 |
| Pages / Actions / 仓库 webhooks | Pages 关闭；无工作流；无仓库 webhook | 新增制品 CI；不据此推断第三方 GitHub App 集成不存在 |
| 本地路径 | C:/ArdenDev/wqt-auth-backend，有多个 worktree | 保持物理路径，更新 origin 即可；不移动活动工作区 |
| 根包 | wqt-game-auth-backend | package 与 lock 名称同步变更，不升级依赖 |
| 旧部署脚本 | /home/admin/app/scoring_system、/opt/wqt-auth-backend/staging | 原样保留；目录名称不随 GitHub 仓库名称自动变化 |
| 生产服务 / Zeabur | 本轮未读取生产控制台 | 不发布、不触发代码合并；更名后第三方集成待部署负责人核验 |

参考：[GitHub 官方更名说明](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)。
Git 操作和仓库网页支持旧地址重定向；Pages URL 和作为 Action 被引用的仓库另有例外。不重用旧仓库名称，以保留重定向。

## 回退

代码可回退本变更提交。远端名称如需回退且旧名称仍可用，由管理员将同一仓库更回 scoring_system，再恢复 origin。回退不涉及数据库。Issue/PR 作为历史记录保留；不通过删除仓库回退。

## 风险与后续

第三方 GitHub App 的仓库关联和生产自动部署是否识别更名尚未核验，后续发布前核查。当前 CI 仅验证制品与生成器，不是产品发布验收；不修改分支保护，不配置自动合并。
