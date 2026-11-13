"""Apply the newly retrieved, versioned Feishu evidence to story copy."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
p = HERE / 'story-chapters.json'
chapters = json.loads(p.read_text(encoding='utf-8'))
updates = {
 '03-literacy': dict(body='孩子在安全、支持性的场景中看见风险、理解机制、练习选择、感受后果、建立边界。通过风险再现、安全预演、真实决策、结果反馈与修复行动，将一次体验转化为主动判断的练习。五力承载不同能力，不与五类风险机械对应。', source='S5 计划全文 rev142；S7 志愿者话术 rev78'),
 '04-family': dict(body='家庭版桌游把教育体验延伸到日常。家长与孩子通过角色代入、情境讨论和轻松互动理解彼此，共同建立家庭数字使用规则。成长支持关注日常练习、AI创作与陪伴，让孩子的真实想法进入家庭选择。', source='S5 计划全文；S7 家庭桌游与成长支持说明', status='家庭支持方向；二级产品仍在开发测试'),
 '05-cocreation': dict(body='儿童不仅是AI的使用者，也是AI发展的参与者。家庭提供真实体验，学校和社区提供持续支持，专业人士理解发展需求，科技企业将儿童的安全、权益与参与前置到产品设计。孩子自己的声音，是协作的组成部分。', source='S6 新版媒体通稿 rev406；S8 倡导说明 rev2'),
 '06-research': dict(body='自2022年以来，项目坚持研究驱动。计划全文记载《中国儿童数字媒介素养报告》、2025年《儿童青少年数智素养测评报告》及2026年《儿童青少年数字风险白皮书》，以一手数据、问题识别工具和行动框架连接教育实践与技术治理。', source='S5 计划全文 rev142，第五节；S7 研究说明', status='按项目官方材料记载；报告全文尚未逐篇复核'),
 '07-activities': dict(body='计划已在上海、宁夏等地把桌游与负责任开发者项目带入社区、学校和家庭。2026年WAIC行动设置风险预演、价值访谈、家庭志愿、倡导之声和产品展示五个板块，让儿童体验、家庭意见与行业交流在同一现场发生。', source='S5 计划全文第六节；S6 新版媒体通稿', status='资料记载的实践；插画为场景表达，不冒充现场照片'),
 '08-products': dict(body='三级产品形成递进关系：教育支持让孩子看见风险，成长支持让练习进入日常，技术治理推动环境更加友好。桌游、开发者营与守望者培训已进入市场化；家庭桌游、AI Tutor、RASPE和测评系统仍在开发测试。', source='S5 计划全文三级产品；S7 商务落地与产品状态', status='一级市场化；二、三级开发测试，不推定已全面集成'),
 '10-cultivation': dict(body='负责任开发者营将儿童友好、安全意识和用户责任融入问题识别、方案设计与原型实践。守望者培训面向家长、教师、社区工作者、志愿者及企业人员，支持本地力量运用工具开展教育与陪伴。', source='S5 计划全文第六节；S7 开发者营与守望者说明', status='计划材料记载上海已培育近50位守望者；口径截至该材料版本'),
 '11-communication': dict(body='儿童代表、家长、守望者、教师、专家与科技企业共同发声。倡导短视频、儿童绘画、海报、公众号及现场交流，把家庭体验和儿童需求带入公共讨论，让儿童友好进入产品设计、开发、运营与迭代。', source='S8 倡导ID说明 rev2；S6 新版媒体通稿', status='倡导机制与资料记载的行动，不把合作意向写成已签约成果'),
}
for c in chapters:
    c.update(updates.get(c['id'], {}))
p.write_text(json.dumps(chapters, ensure_ascii=False, indent=2), encoding='utf-8')
print('Updated 9 chapters with retrieved Feishu evidence')
