# 部署前配置与合成数据操作约束

## 部署模式

本地开发显式 NODE_ENV=development；隔离测试为 test；真实预发布及生产使用 NODE_ENV=production，并分别设置 SERVER_ENV=staging / prod。不以 development 模式运行公开预发布。

必须有 DATABASE_URL、CARDS_DATABASE_URL、CARDS_SOURCE=postgres、至少32字符非默认 JWT_SECRET、64位十六进制 SETTINGS_ENCRYPTION_KEY。开发捷径与 TEST_LOGIN_* 留空/关闭。强度检查只排除明显弱值，密钥仍须用安全随机生成器产生。

真实服务有效配置必须包含 BMOB_APP_ID/BMOB_REST_KEY、ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET、OSS_BUCKET_NAME/OSS_REGION。生产允许已解密数据库服务配置；身份、连接、运行模式不允许由数据库非空值覆盖。缺真实短信配置在部署模式下返回失败，不启用模拟码。

staging 必须另有 WQT_EXPECTED_MAIN_HOST、WQT_EXPECTED_MAIN_DATABASE、WQT_EXPECTED_CARDS_HOST、WQT_EXPECTED_CARDS_DATABASE、WQT_EXPECTED_OSS_BUCKET，与实际连接和桶对应。数据库中 BMOB/OSS/AI等敏感或外部配置非空即拒绝，先在受控副本清理后再启动。预期名称是误配置检查，不能替代独立账号权限/私网隔离；两个配置都误填同一生产目标仍须由资源权限阻止。

预检只读查询两个数据库及主库system_settings，禁止连接参数自定义options；随后启动初始化并在loadConfig时再次复核。配置检查不证明云凭据权限正确，真实服务验证仍需执行。

## 合成数据

src/development/synthetic-data.js 的 seedSyntheticData(tx,{password}) 由操作方在已核实的独立空库上通过 withTransaction 调用；不自动随服务器启动，不提供默认密码，不自行连接数据库。先初始化完整主库/卡牌schema。CI示例见 tests/runtime/scenarios/synthetic-data.mjs，仅作用于测试helper创建的数据库。

seed包括组织A/B、5个角色账号、组织与个人及legacy_unknown场次、活动关联与事件。预置账号phone为空，不可当作真实短信登录账号；上线测试前将明确同意的团队测试号码绑定到相应账号，保持正式认证流程。没有预置登录会话，没有伪造session_files。卡牌表完整初始化，卡牌样本内容由现有初始化流程负责。

任一受检领域表非空就拒绝；检查和写入在表锁/同一事务内完成，失败全部回滚。数据库标识和授权由调用方负责，禁止在生产使用seed。

## 云端顺序

1. 核实两次失败部署所在阶段与影响；在获准调整前保留生产触发器现状，不合并到生产绑定分支。
2. 用户预算确定后列出实际报价、独立项目/服务器/数据库/存储配置，完成采购gate。
3. 部署通过PG18 CI的指定版本到独立预发布，准备合成数据及团队测试账号。
4. 真实短信、OSS、AI联调与浏览器全链路；验证生产目标无法被预发布凭据访问。
5. 需求方验收和发布gate后再考虑生产。
