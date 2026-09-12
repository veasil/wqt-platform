# WQT-003 · 证据

## 验证记录

代码验证版本：7439e327edaec40cd93c173313cd29bd56ee45d3。2026-09-12 需求方明确“暂无预发布环境，先完成 CI 合成数据演练”，本轮按该范围完成技术验证，后续提交仅更新证据文档。

| 验收 ID | 环境与版本 | 命令/操作 | 结果 |
|---|---|---|---|
| AC-01 / AC-02 | GitHub CI 独占 PG16，合成最小 schema | npm run test:runtime，含真实 pg_dump / pg_restore | [Runtime CI](https://github.com/veasil/wqt-platform/actions/runs/34688227893) 12 passed / 0 failed / 0 skipped |
| AC-03 | CI Chromium / Node22 | 两个前端锁文件构建、verify-ui.py | [Browser CI](https://github.com/veasil/wqt-platform/actions/runs/34688227773) 通过 |
| AC-04（延期） | 无预发布环境 | 未执行 | 需求方明确延期；本轮限定 CI 合成数据 |
| AC-05 | 制品、演练手册、发布 gate | 记录输入、步骤、责任及未执行项 | [Artifact CI](https://github.com/veasil/wqt-platform/actions/runs/34688227782) 通过；生产发布仍待 gate |

本地制品测试 4/4、结构检查 28 份文档 / 3 项变更通过；新测试语法检查和 diff whitespace 检查通过。本机未提供 PG 配置，实际恢复结论来自 CI，不用本地 skip 冒充通过。

恢复测试创建三个独占数据库：旧 schema 备份→源库真实迁移→恢复旧备份→恢复库重复迁移→新增组织场次/文件 metadata→迁移后备份→第三库恢复。逐项比对用户、组织、场次及文件内容；反向验证不可变归属、组织外键、ownership check 和对象 key 唯一性。工具超时被终止；仅清理登记数据库及校验路径后的自身临时目录。

Luna 实现两个 recovery 文件，主控复核并修正部分创建失败清理、子进程超时、失败诊断和恢复后约束覆盖。主控配置 PG16 客户端、浏览器 CI 并核验实际日志。子代理本地 skip 未作为验收证据。

## 验收与交付

本轮 CI 合成演练技术完成，待需求方最终验收。[PR #5](https://github.com/veasil/wqt-platform/pull/5) 为草案，目标 feat/cards-2026-workbench，未合并、未发布。

边界：备份夹具是最小领域 schema，不是完整应用或生产副本；没有证明大数据容量、独立卡牌库恢复、真实 OSS 对象及生产恢复时间。浏览器 API 是替身，仅覆盖登录界面和认证下载，不宣称完整游戏交互或真实短信/AI 联调通过。

## 工程复盘

- 新保证：备份不仅生成文件，还能实际恢复所覆盖的数据、序列和数据库约束；浏览器专项不再仅依赖本机一次执行。
- 假设变化：需求方确认暂无预发布环境，真实服务联调从本轮执行项调整为明确的后续发布前工作。
- 保留债务：完整数据副本和实际服务仍未验证；CI 客户端与 PG16 版本配套，升级 PostgreSQL 时须一起复核。
- 关键概念：数据库备份恢复与对象存储恢复是两件事；合成演练能验证机制，不能替代真实数据规模和发布恢复时间。

下一步：需求方验收本轮 CI 结果；具备独立预发布资源后，按[演练手册](preproduction-runbook.md)准备副本和测试账号，再进入真实联调与发布 gate。
