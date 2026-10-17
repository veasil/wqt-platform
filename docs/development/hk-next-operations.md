# 新版香港运维入口

仅适用于WQT-009：主机8.217.44.101，namespace environment-6ad2657554d74b84a5bd1e57，应用service-6ad26b6b38f4286bd6df6332。旧脚本8.210.121.92不是新版主机，不能用于新版排查。

在有Python及paramiko的受控工作机运行：

```powershell
python scripts/ops/hk_next.py status
python scripts/ops/hk_next.py https
```

凭据只从本机~/.codex/secrets/wqt-hk-server-access.json读取；固定主机公钥文件为同目录wqt-hk-known-hosts，不提交这些文件。公钥来自既有受信部署会话；新工作机应经独立可信渠道核对或转移固定公钥，不能为了连通而使用自动信任新主机策略。未知/变更公钥、认证失败即停止。

本机Clash使用127.0.0.1:7897且存在fake-IP DNS；198.18.x.x不是公网主机地址。工具先尝试固定IP直连，连接/会话通道失败时在提交命令前尝试HTTPS_PROXY指定的HTTP CONNECT代理（无配置时使用上述本机端口）；保留服务器主机密钥校验。生产命令提交后不重放，超时先查实际状态。HTTPS检查在香港主机发起，按正式域名验证证书，绕开本机fake-IP；没有关闭TLS校验、修改全局代理或修改hosts。

status只列新版Pod；https仅检查两端公开配置及倒计时静态资源，不发送短信、不登录、不读取个人记录。连通不代表真实人机挑战或短信送达成功。脚本中的run_remote可供受控运维调用，但不会自动授予任何写权限；修改配置时优先单键更新，并核对其余配置原值保持。不要输出环境变量值、数据库连接或登录token。

重现网络失败时，记录直连/代理分支、失败阶段和耗时；不要把某次本机TLS失败写成线上服务宕机。浏览器探测用实际DOM/API结果，不以第三方字体请求的networkidle判定系统可用。

命令确认及输出读取共用总超时：底层SSH库的exec确认等待不一定受socket读超时控制，工具到期会关闭连接并报告结果未知，不会重发。无网络回归：`python tests/ops/test_hk_next.py`，覆盖确认丢失的超时和成功路径各只提交一次。
