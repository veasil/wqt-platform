# 卡牌选择器：跨引擎滚动与全部卡牌筛选

来源：2026-10-28 用户确认“修改和发布修复”，默认显示45张卡牌，在风险分类旁增加启蒙期/成长期/青春期筛选；随后确认允许跨阶段选牌计分。范围为当前场次已发布卡组，不扩大到其他卡组或草稿卡牌。

状态：技术验证通过，已按用户明确授权于2026-10-28发布，用户真实iPhone体验待验收。生产代码2ad6a56e555b869b9852eae0a9506687ee4c0f89；基线为生产 c466f02481ee7e8dc0afbb2234859034f483ae7f，独立分支 codex/card-picker-20261028，[PR #17](https://github.com/veasil/wqt-platform/pull/17)。PR保持draft未合并，后续纯证据提交不改变运行代码。

## 根因与方案

WebKit 下弹窗 height:fit-content、纵向 flex、列表 flex:1/min-height:0 组合使列表只剩6px内边距；外层 overflow:hidden 无法补偿。使用卡牌选择器专属类和明确动态视口高度，保留可滚动列表及短屏外层滚动退路。保留现有深浅主题、品牌玻璃边框与文字样式。相同 flow-card-picker 类的预习资料不受专属尺寸调整影响。

移除前端按当前游戏阶段隐式限制卡牌，默认风险/阶段均为全部；两个筛选并列，重置同时清空搜索与筛选。用户进一步确认跨阶段卡牌计入当前游戏阶段完成数量，卡牌阶段仅用于筛选。后端解除阶段相等限制，保留合法分类校验、当前阶段推进、卡组快照和全部写入保护；事件继续保留真实卡牌分类。

## 验收

- AC1：真实卡组45张时默认显示45张；阶段筛选各15张，支持风险+阶段+关键词组合与重置，无结果有提示。
- AC2：Chromium/WebKit 手机、桌面、横屏、短屏可显示卡牌并滚动至末张，选中后回到卡牌并能正常确认；风险与阶段框在手机上也并列。
- AC3：后端允许本场次快照内跨阶段卡牌计分，保持卡牌真实阶段记录、计分效果、并发revision、暂停/结束保护和经确认的阶段推进语义。跨卡组卡牌继续拒绝。
- AC4：预习资料、主题、关闭和键盘操作可用。自动检查与技术验证通过后执行本次已授权生产发布，验证线上源文件及健康状态。

## 验证与发布证据

本地 `node --test tests/player-state.test.mjs` 5/5；lint通过；制品4/4与结构检查通过。使用自建临时PG16/Redis和owned随机数据库运行 player-integration/card-permissions 两项均通过，0跳过；包括真实HTTP跨阶段计分、当前阶段数量、真实分类和重复请求幂等记录，测试数据库删除、临时容器已停止。

候选全部CI通过：Runtime [40624771992](https://github.com/veasil/wqt-platform/actions/runs/40624771992) PG16/18各63/63、0跳过；Browser [40624771794](https://github.com/veasil/wqt-platform/actions/runs/40624771794) 含两引擎卡牌用例及其余登录/管理回归；Artifact [40624771803](https://github.com/veasil/wqt-platform/actions/runs/40624771803)。浏览器用例已纳入仓库与CI，全部HTTP使用合成数据，无生产用户会话或业务写入。

两引擎各6个视口×2主题，共24组布局/末张选中检查；包含393×740、393×852、390×600、740×360、1365×1000、393×300。393×740列表Chromium318px、WebKit314px，原WebKit6px塌缩已解除。阶段各15张、阶段+风险3张、关键词1张、无结果0张、重置45张；跨阶段卡牌请求、键盘关闭、实际预习资料弹窗均通过。最短屏保留150px列表，允许外层滚动到列表。截图已检查深浅主题：`C:/ArdenDev/tmp/wqt-card-picker-dark-20261028/picker-chromium.png` 与 `C:/ArdenDev/tmp/wqt-card-picker-fixed-20261028/picker-chromium.png`。Windows WebKit初次在控件稳定性等待超时，关闭动效后与Linux CI均通过；DOM检查有效，空截图不作为视觉证据。

发布前只读核对：正式默认卡组5快照45张，启蒙期/成长期/青春期各15张。42条平台变量记录备份为私有文件，后续按唯一键保留配置，仅更新两个release字段；没有验证码供应商、权限、卡组快照或数据库schema变更。源代码在本地独立工作树修改，没有覆盖主工作区无关改动。

精确Git archive：25,899,361字节，SHA256 b4692a931321655834897094985d9a3f55a441e73b8746f30675761cc6369395。官方上传ID dda250eb37a855cd743a4c5b，对应唯一部署6ae167bdea16512cf74179c4；prepare返回等待超时后根据uploadID确认已BUILDING，没有重复提交。发布前配置、运行Pod和deployment记录保留服务器私有目录 `/var/lib/wqt-next-backup/card-picker-20261028/`；回退代码镜像为c466f02对应d-6ae035cb3ba10e638d7c91c4，并恢复两个版本字段。没有schema迁移，无需重写已存在场次，回退不回滚用户在新版本已提交的业务记录。

实际生产镜像d-6ae167bdea16512cf74179c4，digest sha256:fef3e3adba25d6114ea57f7f0e8873b8dc46770087f9cc9c290b6b0302406ceb。平台变量只更新WQT_RELEASE_SHA/SOURCE_GIT_COMMIT_SHA，另外38个唯一键值保持，阿里云校验继续开启；显式重启一次后核对进程全部40个配置键一致。最终Pod service-6ad26b6b38f4286bd6df6332-74f84bc6fd-vrxnz Ready、重启0；两端正式HTTPS health均200并报告完整2ad6a56，verification-options均200且aliyun/enabled。

运行文件及公开资源hash与候选原始字节一致：player.js 0e3f39f89d9066754f397d95cbdc18a1ee763022ca073e616216bafdddbc3bf1；player.css 54087515a6eca057cb74889de5e69086eb4bc5fc4655b5780bfb71140c90c0b0；后端state.js 16f7c28789cfa6e176923e82cc0ba3b6b9f58c1df95209e0706d99ec893d342e。服务器verification.json保留正式核验。

正式域名浏览器检查使用实际部署HTML/JS/CSS，仅注入合成游戏状态与45张合成卡牌，业务API全部拦截。Chromium 393×740显示45张、阶段各15张、重置恢复45张、末张可选中，列表318px，pageerror和业务写入均0。已查看线上资源深浅主题截图：`C:/ArdenDev/tmp/wqt-card-picker-production-20261028/picker-dark.png`、picker-light.png。线上Windows WebKit直连及本机代理导航均超时，不能将其报告为页面回归失败或真实设备通过；发布前两引擎的本地与Linux CI回归、生产源文件核对均已通过。真实iPhone触摸仍由用户验收，不把Windows WebKit等同实体Safari。

## 工程复盘

改变的假设：卡牌阶段作为分类，不再限制当前阶段选牌；游戏阶段仍定义完成数量与推进。约束：本场次发布快照仍是选牌边界，事件保留卡牌阶段，choices.phase保留游戏阶段，不能混用。新增保证：WebKit与Chromium的最小可见列表高度、末张可选和组合筛选进入CI；状态机和真实HTTP均验证跨阶段计分。无schema/基础设施新债；真实设备软键盘和触摸体验待用户验收。理解重点：确定高度与最大高度不同；卡牌分类和游戏流程进度是两个独立维度。
