# WQT-015 计划

主控：当前会话模型，负责协议、审查、集成、基线修复和实际 PG/Redis验证。团队指定 gpt-5.6-luna 不可用，已告知用户；子代理继承当前模型。

## 步骤

- Backend：src/platform/team-apps/**、src/platform/accounts/auth.js、src/services/identity-sessions.js、src/app.js、tests/team-apps*.test.mjs。实现固定协议与权限边界，不改其他业务。
- Client：shared/browser/team-client.js、public/connect/**、examples/courseware/emma/**、tests/frontend/team-client*.test.mjs。实现 SDK/独立样例/授权页，协议依 spec。
- 主控：tests/runtime/team-courseware.test.mjs 及 scenarios/team-courseware.mjs、基线跨阶段选牌修复、配置/CI/docs。主控运行集成测试前等子代理提交代码；不并行改同一文件。

子代理不切分支、不提交、不继续委派。发现权限范围扩大、依赖变化或无法解释失败时提交证据给主控。

顺序：形成契约 → 两独立任务 → 复核 → 专用 PG/Redis + 双 origin 浏览器 → 修复 → 文档/交付。状态：两子任务完成并经主控复核；真实 PG/Redis 双 origin 浏览器验证通过，收尾文档与提交。

## 回退

代码通过独立分支交付，未执行生产部署。移除 WQT_TEAM_APPS 登记并重启可关闭应用授权及后续访问；代码可回退至 2c922ba，无 schema 迁移，无需重写场次数据。
