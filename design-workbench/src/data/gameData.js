export const POWER_META = [
  { key: 'safety', code: 'R', name: '安全力', skill: '安全力技能', color: '#39e6a7' },
  { key: 'reason', code: 'A', name: '脑波力', skill: '脑波力技能', color: '#67a7ff' },
  { key: 'sense', code: 'S', name: '实感力', skill: '实感力技能', color: '#ffc75a' },
  { key: 'creative', code: 'P', name: '创心力', skill: '创心力技能', color: '#c78cff' },
  { key: 'empathy', code: 'E', name: '沟通力', skill: '沟通力技能', color: '#ff7898' },
];

export const PHASES = ['启蒙期', '成长期', '青春期'];

export const CARD_CATALOG = [
  { code: 'B01', phase: '启蒙期', type: '数字权益', title: '陌生头像发来的好友申请', text: '一个头像很酷的陌生人申请加你为好友，还说知道学校里很多人的秘密。你会怎么做？', options: { A: '先不通过，问可信的大人或同学确认对方身份', B: '通过好友，先看看对方想说什么', C: '把申请截图发到班级群，让大家一起猜' } },
  { code: 'B03', phase: '启蒙期', type: '经济安全', title: '陌生链接里的“限时皮肤”', text: '群聊里有人发来“免费领取限定皮肤”的链接，并催你在一分钟内填写手机号和验证码。你会怎么做？', options: { A: '不点链接，通过游戏官方渠道核实活动', B: '先填手机号，验证码暂时不填', C: '转发给朋友，请他帮忙试一下' } },
  { code: 'B05', phase: '启蒙期', type: '经济安全', title: '游戏里的低价代充', text: '有人承诺用很低的价格替你充值，但需要你提供账号密码。你会怎么做？', options: { A: '拒绝并保留证据，只使用官方充值渠道', B: '先给一个不常用的小号试试', C: '问对方能不能只提供验证码' } },
  { code: 'D02', phase: '成长期', type: '社交安全', title: '群聊里的恶意玩笑', text: '同学把别人的尴尬照片发进群里，大家都在转发和评论。你会怎么处理？', options: { A: '停止转发，提醒删除并私下关心被拍的人', B: '不参与评论，但保留照片以后再说', C: '跟着发一个表情，避免显得不合群' } },
  { code: 'D08', phase: '成长期', type: '数字权益', title: 'AI 换脸来电中的紧急求助', text: '视频中的“家人”声音急促，要求你立刻转账。画面和声音都很真实，你会怎样确认？', options: { A: '挂断后用熟悉号码回拨，并询问只有家人才知道的信息', B: '先转一小笔，确认对方能否收到', C: '继续视频，让对方靠近镜头证明身份' } },
  { code: 'P04', phase: '青春期', type: '心理安全', title: '被算法困住的一整晚', text: '短视频不断推荐你喜欢的内容，回过神已经到了深夜。你准备怎样重新掌握时间？', options: { A: '设置停止时间，把设备放到卧室外充电', B: '再刷十分钟，用意志力控制自己', C: '把喜欢的视频先全部收藏，周末一次看完' } },
];

export const DEFAULT_ACTIVITY = {
  code: 'WQT-0820',
  name: '未来守望者 · 城市站',
  deckVersion: '2026 版',
  mode: '标准成长模式',
  cardGroupIds: [],
  duration: 5000,
  phaseTargets: [5, 3, 4],
};
