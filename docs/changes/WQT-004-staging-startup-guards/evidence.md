# WQT-004 · 验证证据

## 验证记录

本地启动配置与生产短信拒绝用例10/10通过；lint通过。真实PG16/18和合成数据结果待CI，不把无数据库环境的skip当通过。

只读云端事实：生产镜像postgres:18；scoring-system的Git trigger绑定feat/cards-2026-workbench，先前两次合并触发部署且FAILED。当前分支不向该生产分支推送。详见[环境研究](../../architecture/staging-environment-proposal.md)。

## 验收与交付

执行中、未最终验收，未主动调用部署/修改生产配置。云端实际影响必须以平台记录为准，Git合并不等于与部署隔离。
