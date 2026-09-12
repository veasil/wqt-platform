# 变更制品

每次开发先定位需求与验收标准，使用唯一 WQT 编号组织制品。版本基线已有编号时，在 spec 中引用原 ID，不替换原验收体系。

```sh
npm run change:new -- WQT-002 short-topic
npm run check:artifacts
npm run test:artifacts
```

生成器创建 `docs/changes/WQT-002-short-topic/` 下的 `spec.md`、`plan.md`、`evidence.md`，不会覆盖既有目录或复用编号。草案和未执行检查不等于确认或通过。

| 变更 | 内容 |
|---|---|
| [WQT-001](WQT-001-platform-artifacts/spec.md) | 仓库更名、团队文档、制品流程与 CI |
| [WQT-002](WQT-002-subagents-refactor/spec.md) | 模块化架构子代理执行计划与只读盘点 |

小改动仍可使用[单文件模板](../development/change-template.md)，以相同 `WQT-编号-主题` 目录内的 `change.md` 保存目标、验收、计划、证据。检查器支持三文件及单文件两种形式；完成状态由证据与验收人决定，结构检查不代替审批。
