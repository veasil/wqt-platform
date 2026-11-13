# Emma 独立课件示例

这是一份替换 Emma 真实课件前的可运行教学样例：连接账号、开局、选卡/调整伍力、暂停、结束、刷新恢复。它不含测试账号、后端密钥或生产数据。

## 本地开始

1. 按平台开发文档准备专用 PostgreSQL、Redis 和已发布卡组，在 accounts 模式启动平台（默认 http://localhost:8080）。
2. 平台设置 WQT_TEAM_APPS，登记 clientId 为 emma-courseware，redirectUris 为 ["http://localhost:8090/"]，identityIds 为你自己的开发身份 ID；name 可写“Emma 示范课件”。
3. 仓库根目录运行：

    node examples/courseware/emma/serve.mjs

4. 打开 http://localhost:8090/，连接伍仟天。尚未登录时，授权页会提供平台登录入口；登录后自动继续连接。只有一个账号时直接回到课件；多个账号时选择后返回。
5. 填入开发库中已发布的卡组编号，开始课堂。localhost 和 127.0.0.1 是不同来源，所有配置保持一致。

serve.mjs 只公开示例文件和 /sdk/team-client.js，不公开仓库、配置环境文件或其他路径。它不启动业务服务、不创建账号、不写数据库。SDK 直接来自 shared/browser/team-client.js，没有第二份复制实现。

## 换成自己的课件

在 config.js 填公开的 platformOrigin、clientId、redirectUri，同时由平台维护者登记准确回跳地址。生产网站使用 HTTPS。将 app.js 的按钮交互换成课件交互即可；SDK 使用 sessionStorage 保存当前标签页的登录凭证、登录校验信息和未确认写入，请保留网站脚本的可信来源。

入口 createWqtClient(config) 提供 login、handleCallback、getConnection、startSession、getSession、getCards、performAction、retryPending、getPending 和 logout。先处理 handleCallback，再 getConnection。关键写操作自动生成 requestId；网络结果未知时保留整个请求，调用 retryPending，不新建一次操作。不同标签页不会共享未确认操作。已明确的版本冲突需要重新读取场次后发起新意图。

课件退出只清理本地访问凭证，未确认操作保留，原账号重新连接后可重试。它不等于撤销伍仟天账号会话；平台停用应用、身份会话撤销或账号解绑会在后端拒绝后续访问。

示例只覆盖玩家场次能力，未接语音、AI、上传、管理端。课件目录属于独立站点，不由平台 public/ 自动托管。
