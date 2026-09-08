import { useEffect, useState } from 'react';

const LEGAL_DOCUMENTS = {
  privacy: {
    eyebrow: 'PRIVACY NOTICE · V1.0',
    title: '隐私说明',
    updatedAt: '更新日期：2026年9月2日',
    summary: '本说明解释上海伍仟天数字科技有限公司在“《AI在5000天·伍力全开》守望者计分系统”中如何处理个人信息。',
    points: ['只收集完成登录、计分与复盘所需的信息', '儿童信息须由监护人知情并同意', '可通过工单申请查阅、更正或删除'],
    sections: [
      {
        title: '一、适用范围与责任主体',
        paragraphs: [
          '本说明适用于守望者计分系统的账号登录、活动配置、桌游计分、现场监督、录音、成长复盘与工单服务。个人信息处理者为上海伍仟天数字科技有限公司（下称“我们”）。',
          '个人信息保护联系渠道：登录后进入“我的—文件与反馈—工单中心”提交请求。我们会在核验身份后处理并反馈。',
        ],
      },
      {
        title: '二、我们处理的信息',
        paragraphs: [
          '账号与认证：手机号、密码的不可逆摘要、短信验证结果、守望师名称、所属组织、账号角色，以及登录时间、IP 地址、设备与会话标识。用于身份核验、单设备会话、安全审计和账号服务。',
          '游戏与活动：活动码、桌号、参与人数、卡牌选择、技能使用、伍力分值、操作时间和本局配置。用于实时计分、恢复对局、生成复盘和活动统计。',
          '你主动提供的信息：在再次授权后采集的录音，以及工单内容、附件和反馈。拒绝录音不影响计分等基本功能。请勿在录音、工单或自由输入中填写无关的身份、健康、住址等敏感信息。',
          '安全验证：启用腾讯云天御验证码时，会处理验证票据、IP 地址及完成风险判断所需的设备或浏览器环境信息；系统界面不要求录入人脸、指纹等生物识别信息。具体处理以验证服务当时展示的规则为准。',
        ],
      },
      {
        title: '三、处理目的与法律基础',
        paragraphs: [
          '我们基于你的同意以及履行账号与计分服务所必需的范围处理信息；为保障网络与账号安全、履行法定义务或应对紧急情况时，也可能依法处理必要信息。与基本功能无关的信息会另行征求同意，你可以拒绝或撤回。',
        ],
      },
      {
        title: '四、第三方服务与委托处理',
        paragraphs: [
          '为提供必要能力，我们可能委托：腾讯云天御完成安全验证；Bmob 完成短信验证码发送与核验；阿里云 OSS 存储你主动上传的录音、报告或附件；按管理员配置启用的 DeepSeek、阿里云百炼、OpenAI 或 Google Gemini 等模型服务生成复盘或辅助内容。',
          '调用模型服务时仅应发送完成该次生成所需的会话内容，不应包含手机号等直接身份标识。我们不出售个人信息，也不会允许受托方将信息用于与本服务无关的目的。服务商、处理目的或信息种类发生实质变化时，我们会另行告知并依法征得同意。',
        ],
      },
      {
        title: '五、存储、跨境与安全',
        paragraphs: [
          '账号和游戏数据保存于本系统部署所使用的数据库；录音、报告或附件在启用上传时可能保存于阿里云 OSS 中国香港区域。涉及向境外提供个人信息时，我们会依法履行告知、单独同意及适用的安全合规程序；在完成相关程序前，请勿上传包含敏感个人信息的内容。',
          '除法律另有要求外，我们仅在实现处理目的所必要的最短期限内保存信息，并采取访问控制、传输保护、密码摘要、敏感配置加密和安全审计等措施。期限届满后将删除或匿名化处理。',
        ],
      },
      {
        title: '六、未成年人特别保护',
        paragraphs: [
          '本产品用于未成年人安全教育。未满十四周岁儿童的个人信息属于敏感个人信息，应由监护人阅读本说明并作出明确同意；学校、教师或活动组织者代为录入前，应确认已取得合法、有效的监护人授权。我们坚持最有利于未成年人、目的明确和最小必要原则。',
        ],
      },
      {
        title: '七、你的权利',
        paragraphs: [
          '你或未成年人的监护人可以通过工单中心申请查阅、复制、更正、补充或删除个人信息，撤回可选授权、解释处理规则，或注销账号。撤回不影响此前基于同意已经完成的处理；若删除请求涉及法定保存义务，我们会说明理由与预计处理时间。',
        ],
      },
      {
        title: '八、更新与联系我们',
        paragraphs: [
          '我们会在处理目的、方式、信息种类或第三方服务发生实质变化时更新本说明，并通过页面提示等显著方式通知。若变化依法需要再次同意，我们会在继续处理前重新征得同意。投诉、建议和个人信息权利请求均可通过工单中心提交。',
        ],
      },
    ],
  },
  terms: {
    eyebrow: 'TERMS OF USE · V1.0',
    title: '使用条款',
    updatedAt: '更新日期：2026年9月2日',
    summary: '本条款约定你与上海伍仟天数字科技有限公司之间关于使用守望者计分系统的权利与责任。',
    points: ['仅供获授权的桌游活动与教育场景使用', '账号、活动码和内容不得转售或滥用', '计分与复盘不构成医疗或心理诊断'],
    sections: [
      {
        title: '一、接受与适用',
        paragraphs: [
          '当你勾选同意并登录，即表示你已阅读、理解并同意本条款与隐私说明。若你代表学校、机构或未成年人使用，应确认你有权作出相应授权；未成年人应在监护人或教师指导下使用。',
        ],
      },
      {
        title: '二、账号与访问',
        paragraphs: [
          '系统仅向获授权的守望者、组织成员和运营人员开放。你应提供真实、必要的信息，妥善保管密码、验证码和活动码，不得出租、出借、转售账号或绕过单设备会话、安全验证、权限隔离等措施。发现异常使用时，请立即通过工单中心联系我们。',
        ],
      },
      {
        title: '三、服务内容与使用边界',
        paragraphs: [
          '系统提供活动配置、卡牌选择记录、伍力计分、监督记录、录音与成长复盘等功能。功能可因账号权限、活动配置、网络状态或运营安排不同而变化。',
          '计分、提示和 AI 生成的复盘用于教育讨论与活动辅助，不构成医疗、心理、法律、网络安全处置或其他专业意见；涉及现实人身、财产或网络风险时，应及时寻求监护人、学校或专业机构帮助。',
        ],
      },
      {
        title: '四、录音、工单与提交内容',
        paragraphs: [
          '启用录音前，你应确认已取得现场参与者尤其是未成年人监护人的必要授权。你对主动提交的内容及其合法性负责，并授予我们仅为存储、展示、处理工单和生成本局复盘所必需的有限使用权。请勿上传违法、侵权、泄露隐私或与活动无关的内容。',
        ],
      },
      {
        title: '五、禁止行为',
        paragraphs: [
          '不得攻击、扫描、反向破解或干扰系统；不得冒用身份、越权访问、批量注册、刷取短信、篡改成绩或伪造活动记录；不得传播恶意代码、违法信息或侵害他人权益的内容；不得未经许可复制、改编、公开传播或商业化利用卡牌、品牌、角色和软件内容。',
        ],
      },
      {
        title: '六、知识产权',
        paragraphs: [
          '系统软件、页面设计、品牌标识、卡牌内容、小伍角色及相关素材的知识产权归我们或相应权利人所有。本条款仅授予你在授权期限和场景内使用系统的有限、可撤销、不可转让许可，不转移任何知识产权。',
        ],
      },
      {
        title: '七、服务变更、中断与责任',
        paragraphs: [
          '我们会尽合理努力保障服务安全与连续性，并可能为维护、升级、安全事件或不可抗力暂停部分功能。因用户设备、网络、第三方服务或超出合理控制范围的原因造成中断时，我们会在可行范围内协助恢复。任何责任限制均不排除法律规定不得限制或免除的责任。',
        ],
      },
      {
        title: '八、违规处置与终止',
        paragraphs: [
          '如发现违反本条款、危害系统安全或侵害他人权益的行为，我们可以根据风险采取警告、限制功能、下线会话、暂停或终止账号等必要措施，并保存依法需要的审计记录。账号到期或注销后，数据按隐私说明和法律要求处理。',
        ],
      },
      {
        title: '九、适用法律与联系',
        paragraphs: [
          '本条款适用中华人民共和国法律。争议发生后，双方应先通过工单中心协商；协商不成的，依照有管辖权的人民法院和适用法律处理。产品问题、投诉与条款建议均可通过“我的—文件与反馈—工单中心”提交。',
        ],
      },
    ],
  },
};

function plainText(document) {
  return [document.title, document.updatedAt, document.summary, ...document.sections.flatMap((section) => [section.title, ...section.paragraphs])].join('\n\n');
}

export function LegalNotice({ kind, onChange, onClose }) {
  const [copied, setCopied] = useState(false);
  const document = LEGAL_DOCUMENTS[kind] || LEGAL_DOCUMENTS.privacy;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function copyDocument() {
    try {
      await navigator.clipboard.writeText(plainText(document));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return <div className="legal-overlay" role="dialog" aria-modal="true" aria-labelledby="legal-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <article className="legal-dialog">
      <header className="legal-head">
        <div><small>{document.eyebrow}</small><h2 id="legal-title">{document.title}</h2><p>{document.updatedAt}</p></div>
        <button type="button" onClick={onClose} aria-label={`关闭${document.title}`} autoFocus>×</button>
      </header>
      <div className="legal-tabs" role="tablist" aria-label="法律文档">
        <button type="button" role="tab" aria-selected={kind === 'privacy'} className={kind === 'privacy' ? 'active' : ''} onClick={() => onChange('privacy')}>隐私说明</button>
        <button type="button" role="tab" aria-selected={kind === 'terms'} className={kind === 'terms' ? 'active' : ''} onClick={() => onChange('terms')}>使用条款</button>
      </div>
      <div className="legal-scroll">
        <section className="legal-summary">
          <span>{kind === 'privacy' ? '信息透明承诺' : '使用前请确认'}</span>
          <p>{document.summary}</p>
          <ul>{document.points.map((point) => <li key={point}>{point}</li>)}</ul>
        </section>
        <div className="legal-sections" tabIndex="0">{document.sections.map((section) => <section key={section.title}><h3>{section.title}</h3>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}</div>
      </div>
      <footer className="legal-actions">
        <span>如不同意，请关闭并停止登录。</span>
        <div><button type="button" onClick={copyDocument}>{copied ? '已复制全文' : '复制全文'}</button><button type="button" onClick={onClose}>返回登录</button></div>
      </footer>
    </article>
  </div>;
}
