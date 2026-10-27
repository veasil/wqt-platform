# 阿里云验证码 2.0 配置

适用 WQT-009 的阿里云接入工作稿；未发布不代表生产已切换。[本次变更与证据](../changes/WQT-009-hk-first-release/aliyun-captcha-20261027.md)。

## 控制台准备

1. 依[官方接入指引](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/quick-start)开通验证码 2.0，选择按量付费。需求方已选中国内地，不因香港应用主机而改选新加坡。
2. 在实例概览获取身份标 prefix；创建一个 Web/H5、V3 的交互式验证场景（如拼图或一点即过），获取场景 ID。当前程序通过实例 show 弹出验证，不选首次不支持 show 的无痕形态。
3. 场景保持正常验证模式，关闭测试通过模式。将 scoring.ai5000days.com、admin.ai5000days.com 配置为允许的业务域名（若控制台提供域名限制）；当前组织端仍不发布，不为其另开收费场景。
4. 创建仅供验证码使用的 RAM 凭据，按[官方后端接入说明](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/server-access)配置对应验证码权限；如使用文档列出的 AliyunYundunAFSFullAccess，仅授予该专用 RAM 用户。不要复用 OSS 写入凭据、主账号密钥，或授予其他资源权限。

prefix、场景 ID、地域是公开配置，可在聊天中提供。AccessKey 不发到聊天、不放入仓库；当前受控工作机可写入 `C:/Users/BibbTwigs/.codex/secrets/wqt-aliyun-captcha.json`，由运维读取后仅通过受控通道注入部署环境。文件格式如下，值由所有者在本机填写：

```json
{
  "ALIYUN_CAPTCHA_REGION": "cn",
  "ALIYUN_CAPTCHA_PREFIX": "ot95rd",
  "ALIYUN_CAPTCHA_SCENE_ID": "jgcvql0u",
  "ALIYUN_CAPTCHA_ACCESS_KEY_ID": "",
  "ALIYUN_CAPTCHA_ACCESS_KEY_SECRET": ""
}
```

## 部署配置

保留完整原环境映射，新增上述五项并设置 `CAPTCHA_ENABLED=true`、`CAPTCHA_PROVIDER=aliyun`。应用内统一将 cn 映射至上海接口；后端固定配置 SceneId，不能接受前端自选场景。不得仅修改环境变量便把尚未发布的代码视为已生效；先准备精确候选版本，通过既有发布门槛后执行发布和配置切换。

所有验证码设置均由部署环境管理；后台通用设置接口不允许修改。公共 verification-options 不返回 AccessKey。SDK 采用官方 @alicloud/captcha20230305 1.1.4，锁文件新增包来自 npm 官方 registry；不修改全局 npm 源。

## 验证顺序

1. 启动前检查 cn/prefix/sceneId/专用密钥齐全；运行后核实公共选项为 aliyun/cn，正式 HTTPS 页面加载官方 JS，无 CSP 拦截。
2. 专用无效票据必须拒绝；确认到达正常验证判断，未报密钥、权限、欠费或场景错误。只证明拒绝路径，不能替代成功挑战。
3. 真实用户完成人机验证，分别测试密码登录、短信发送和验证码登录。短信仍由 Bmob 提供。检查同一票据不能重复使用，验证失败和取消能重试。
4. 保留测试结果、发布 SHA、镜像及运行源码摘要。不得为了验收通过打开测试通过模式或关闭人机验证。

后端只接受 Success=true、VerifyResult=true、VerifyCode=T001；T002 自动容灾和 T005 测试通过均拒绝。外部异常最多等待 8 秒且不重试单次票据。错误日志仅保留错误码与 RequestId，不打印供应商异常对象、票据、手机号或凭据。

## 费用与后续

依[官方计费说明](https://help.aliyun.com/zh/captcha/captcha2-0/billing)，中国内地按量验证 0.005 元/次，前三个场景不收场景扩展费；自定义策略另收费。当前共用一个实际存在的认证验证场景，不开启收费自定义策略。实际费用由阿里云账单及控制台为准，攻击流量也可能形成计费请求。

套餐/余额和供应商故障的持续告警尚未实现；密码防猜与短信配额沿用现有机制，本次不新增跨供应商容灾或调整限额。计费异常需要账户所有者处理，程序不会自动购买资源或放宽认证规则。
