import { useEffect, useMemo, useRef, useState } from 'react';
import { POWER_META } from '../data/gameData';
import { calculatePowerScore } from '../utils/scoring';
import { activityRecommendationLabel, recommendActivity } from '../utils/activityRecommendation';
import { LegalNotice } from './LegalNotice';
import futureCity from '../../assets/future-city-welcome.webp';
import ai5000daysLogo from '../../assets/ai5000days-logo.jpg';

const watcherVoices = [
  { teacher: '林老师', level: '导师级守望者', tables: 42, message: '孩子开始主动解释为什么这样选，这比答对更重要。' },
  { teacher: '周老师', level: '进阶守望者', tables: 28, message: '一局结束后，五种力量让复盘有了清晰的抓手。' },
  { teacher: '陈老师', level: '进阶守望者', tables: 19, message: '情境卡让数字安全不再只是大人的提醒。' },
  { teacher: '吴老师', level: '初始守望者', tables: 8, message: '看见选择如何影响伍力，孩子会更愿意讨论。' },
];

export function Welcome({ onEnter }) {
  return <section className="welcome-screen" style={{ '--expedition-art': `url(${futureCity})` }}>
    <div className="welcome-vignette" /><div className="welcome-contours" />
    <div className="welcome-cosmos" aria-hidden="true"><i /><i /><i /></div>
    <div className="welcome-copy">
      <span className="eyebrow">AI@5000days · 数智免疫力桌游 · 守望者计分系统</span>
      <h1>把每一次选择，<br />变成面对数字世界的<br /><b>真实力量</b></h1>
      <p>欢迎来到 AI 5000天伍力全开的世界。和小伍一起，从一张情境卡出发，完成属于你的数智安全成长任务。</p>
      <div className="welcome-mission-row"><span><i>01</i>迎接数智挑战</span><span><i>02</i>共同做出选择</span><span><i>03</i>解锁伍力免疫</span></div>
      <button type="button" onClick={onEnter}><span><small>START MISSION</small>启动本次任务</span><i>↗</i></button>
    </div>
    <aside className="welcome-world-label" aria-label="守望者老师留言">
      <div className="welcome-voices-window">
        <div className="welcome-voices-track">
          {[false, true].map((duplicate) => <div className="welcome-voices-group" aria-hidden={duplicate || undefined} key={String(duplicate)}>{watcherVoices.map((voice) => <blockquote key={`${duplicate}-${voice.teacher}`}><div><strong>{voice.teacher}</strong><span>{voice.level} · 带场 {voice.tables} 桌</span><p>{voice.message}</p></div></blockquote>)}</div>)}
        </div>
      </div>
    </aside>
    <footer className="welcome-product">
      <img src={ai5000daysLogo} alt="伍仟天科技 · 5000天" />
      <span><b>上海伍仟天数字科技有限公司</b><small>《AI在5000天·伍力全开》数智免疫力桌游 · 守望者计分系统</small></span>
    </footer>
  </section>;
}

export function LoginDialog({ open, onLogin, onStartHuman, onVerifyHuman, onSendCode, onClose }) {
  const [method, setMethod] = useState('password');
  const [verified, setVerified] = useState(false);
  const [humanProof, setHumanProof] = useState('');
  const [phone, setPhone] = useState('');
  const [secret, setSecret] = useState('123456');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [legalDocument, setLegalDocument] = useState(null);
  const legalReturnFocusRef = useRef(null);
  useEffect(() => {
    if (!countdown) return undefined;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);
  if (!open) return null;
  const startHumanVerification = async () => {
    if (verified || busy) return;
    setBusy(true);
    setError('');
    try {
      const challenge = await onStartHuman();
      // Workbench currently returns a minimum verification window. The production
      // adapter will hand this step to the configured third-party challenge UI.
      await new Promise((resolve) => window.setTimeout(resolve, Number(challenge.holdForMs || 900)));
      const result = await onVerifyHuman(challenge.challengeId);
      setHumanProof(result.proof);
      setVerified(true);
    } catch (startError) { setError(startError.message || '安全验证启动失败'); }
    finally { setBusy(false); }
  };
  async function sendCode() {
    if (!verified) return setError('请先完成人机验证');
    if (!/^1\d{10}$/.test(phone)) return setError('请输入正确的手机号');
    setSending(true); setError('');
    try {
      const result = await onSendCode(phone, humanProof);
      setCountdown(60);
      if (result.mockCode) setSecret(result.mockCode);
    } catch (sendError) { setError(sendError.message || '验证码发送失败'); }
    finally { setSending(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (!verified || busy || !privacyAccepted) return;
    setBusy(true); setError('');
    try { await onLogin({ phone, humanProof, ...(method === 'password' ? { password: secret } : { code: secret }), loginMethod: method }); }
    catch (loginError) { setError(loginError.message || '登录失败'); }
    finally { setBusy(false); }
  }
  function openLegalDocument(kind, trigger) {
    legalReturnFocusRef.current = trigger;
    setLegalDocument(kind);
  }
  function closeLegalDocument() {
    setLegalDocument(null);
    window.requestAnimationFrame(() => legalReturnFocusRef.current?.focus());
  }
  const phoneValid = /^1\d{10}$/.test(phone);
  return <><div className="overlay login-overlay" role="dialog" aria-modal={!legalDocument} aria-label="守望师登录" aria-hidden={legalDocument ? 'true' : undefined} inert={legalDocument ? true : undefined}>
    <div className="login-dialog">
      <aside className="login-story" style={{ '--mission-map': `url(${futureCity})` }}><div><small>WATCHER ACCESS</small><h2>回到你的<br />守望师席位</h2><p>登录后可继续桌游计分、现场监督与成长复盘。</p></div><ul><li>会话按设备安全保存</li><li>卡牌内容仅在本局按需读取</li><li>录音需再次获得你的授权</li></ul></aside>
      <form className="login-form" onSubmit={submit}>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭登录">×</button>
        <div className="login-brand"><small>《伍力全开》桌游计分系统</small><h2>守望师登录</h2><p>使用已授权的手机号进入</p></div>
        <div className="login-tabs"><button className={method === 'password' ? 'active' : ''} type="button" onClick={() => { setMethod('password'); setSecret('123456'); }}>密码登录</button><button className={method === 'code' ? 'active' : ''} type="button" onClick={() => { setMethod('code'); setSecret(''); }}>验证码登录</button></div>
        <label className={phone && !phoneValid ? 'field-invalid' : phoneValid ? 'field-valid' : ''}><span>手机号</span><input value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, '').slice(0, 11)); setVerified(false); setHumanProof(''); }} inputMode="tel" autoComplete="tel" placeholder="请输入 11 位手机号" aria-invalid={phone ? !phoneValid : undefined} /><small>{phone && !phoneValid ? '还需要输入完整的 11 位手机号' : phoneValid ? '手机号格式正确' : '仅用于登录与账号安全验证'}</small></label>
        {method === 'password' ? <label><span>登录密码</span><input value={secret} onChange={(event) => setSecret(event.target.value)} type="password" autoComplete="current-password" /><small>至少 6 位字符</small></label> : <label className="code-input"><span>短信验证码</span><input value={secret} onChange={(event) => setSecret(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 位验证码" inputMode="numeric" autoComplete="one-time-code" /><button type="button" disabled={sending || countdown > 0 || !phoneValid} onClick={sendCode}>{sending ? '发送中…' : countdown > 0 ? `${countdown} 秒后重试` : '获取验证码'}</button></label>}
        <button className={`human-check ${verified ? 'verified' : ''}`} type="button" disabled={!phoneValid || busy} onClick={startHumanVerification}><i>{verified ? '✓' : '◇'}</i><span><b>{verified ? '安全验证已通过' : busy ? '正在验证…' : '安全验证'}</b></span><em>{verified ? '已验证' : '验证'}</em></button>
        <div className="privacy-consent"><label className="privacy-check"><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span>我已阅读并同意</span></label><button type="button" onClick={(event) => openLegalDocument('privacy', event.currentTarget)}>隐私说明</button><span>与</span><button type="button" onClick={(event) => openLegalDocument('terms', event.currentTarget)}>使用条款</button></div>
        {error && <div className="form-error" role="alert"><b>暂时无法登录</b><span>{error}</span></div>}
        <button className="primary-action" type="submit" disabled={!verified || !privacyAccepted || busy}>{busy ? '正在安全登录…' : '进入计分系统'}<i>→</i></button>
      </form>
    </div>
  </div>{legalDocument && <LegalNotice kind={legalDocument} onChange={setLegalDocument} onClose={closeLegalDocument} />}</>;
}

export function SetupDialog({ open, defaults, onList, onResolve, onStart, onClose }) {
  const [config, setConfig] = useState(defaults);
  const [activities, setActivities] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [position, setPosition] = useState(null);
  const [locating, setLocating] = useState(false);
  const manualSelectionRef = useRef(false);
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    manualSelectionRef.current = false;
    setConfig(defaults); setLoaded(false); setError(''); setActivities([]); setListLoading(true);
    void onList().then((items) => { if (!cancelled) setActivities(items); }).catch((listError) => { if (!cancelled) setError(listError.message || '活动列表读取失败'); }).finally(() => { if (!cancelled) setListLoading(false); });
    return () => { cancelled = true; };
  }, [open, defaults, onList]);
  const recommendation = useMemo(() => recommendActivity(activities, position), [activities, position]);
  useEffect(() => {
    if (!open || !recommendation || manualSelectionRef.current) return;
    setConfig(recommendation.activity);
    setLoaded(true);
  }, [open, recommendation]);
  if (!open) return null;
  const update = (key, value) => setConfig((current) => ({ ...current, [key]: value }));
  const updateTarget = (index, value) => setConfig((current) => ({ ...current, phaseTargets: current.phaseTargets.map((item, targetIndex) => targetIndex === index ? Number(value) : item) }));
  async function resolve() {
    setBusy(true); setError('');
    try { const result = await onResolve(config.code); setConfig(result); setLoaded(true); }
    catch (resolveError) { setError(resolveError.message || '活动码读取失败'); }
    finally { setBusy(false); }
  }
  function selectActivity(activity) {
    manualSelectionRef.current = true;
    setConfig(activity);
    setLoaded(true);
    setError('');
  }
  function requestLocation() {
    if (!navigator.geolocation || locating) {
      if (!navigator.geolocation) setError('当前浏览器不支持定位，可继续使用时间与活动状态推荐');
      return;
    }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { manualSelectionRef.current = false; setPosition({ latitude: coords.latitude, longitude: coords.longitude }); setLocating(false); },
      () => { setError('未获得定位权限，已继续按时间和活动状态推荐'); setLocating(false); },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
    );
  }
  async function submit(event) {
    event.preventDefault();
    if (!loaded) { setError('请先选择推荐活动或输入有效的活动码'); return; }
    setBusy(true); setError('');
    try { await onStart(config); }
    catch (startError) { setError(startError.message || '开局失败'); setBusy(false); }
  }
  const totalCards = config.phaseTargets.reduce((sum, value) => sum + Number(value || 0), 0);
  return <div className="overlay setup-overlay" role="dialog" aria-modal="true" aria-label="新游戏配置"><form className="setup-dialog" onSubmit={submit}>
    <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭配置">×</button>
    <div className="setup-head"><h2>新游戏配置</h2><p>选择你新建任务的活动场次，确认活动场地和当前模式。你可以在下方调整每个阶段的卡牌数量以及游戏总时长。</p></div>
    <section className="activity-entry">
      <header><b>推荐活动场次</b><button className={position ? 'location-active' : ''} type="button" onClick={requestLocation} disabled={locating}>{locating ? '正在定位…' : position ? '已结合定位' : '结合定位推荐'}</button></header>
      {listLoading ? <div className="activity-skeleton" aria-label="正在读取活动"><i /><i /></div> : activities.length > 0 ? <div className="activity-cards">{activities.map((activity) => {
        const isRecommended = recommendation?.activity.code === activity.code;
        const selected = config.code === activity.code && loaded;
        const metadata = [activity.location || activity.organizer, activity.mode].filter(Boolean).join(' · ');
        return <button className={`${selected ? 'active' : ''} ${isRecommended ? 'recommended' : ''}`.trim()} key={activity.id || activity.code} type="button" onClick={() => selectActivity(activity)}><span>{activity.code}</span><b>{activity.name}</b><span className="activity-meta">{metadata}</span><em>{selected ? '已选择' : isRecommended ? activityRecommendationLabel(recommendation) : '选择'}</em></button>;
      })}</div> : <div className="activity-empty"><span>暂无可推荐的活动，请输入唯一活动码</span></div>}
    </section>
    <section className="activity-entry code-entry"><header><b>唯一活动码</b></header><div className="activity-query"><input value={config.code} onChange={(event) => { manualSelectionRef.current = true; update('code', event.target.value.toUpperCase()); setLoaded(false); }} placeholder="例如 WQT-0820" aria-label="唯一活动码" /><button type="button" disabled={busy || !config.code.trim()} onClick={resolve}>{busy ? '正在读取…' : '读取活动配置'}</button></div></section>
    {loaded && <div className="config-loaded"><span>✓</span><b>{config.name}已载入</b><em>本局可调整</em></div>}
    {error && <div className="form-error" role="alert"><b>请检查活动配置</b><span>{error}</span></div>}
    <section className={`mission-config ${loaded ? '' : 'disabled'}`} aria-disabled={!loaded}>
      <header><span>本局任务配置</span><em>可调整</em></header>
      <div className="config-form"><label><span>活动名称</span><input disabled={!loaded} value={config.name} onChange={(event) => update('name', event.target.value)} /></label><label><span>卡牌版本</span><select disabled={!loaded} value={config.deckVersion} onChange={(event) => update('deckVersion', event.target.value)}><option>2025 版</option><option>2026 版</option></select></label><label><span>游戏模式</span><select disabled={!loaded} value={config.mode} onChange={(event) => update('mode', event.target.value)}><option>标准成长模式</option><option>快速体验模式</option><option>自定义模式</option></select></label><label><span>倒计时（秒）</span><input disabled={!loaded} type="number" min="60" value={config.duration} onChange={(event) => update('duration', Number(event.target.value))} /></label></div>
      <div className="phase-config"><span>阶段卡牌数量 <b>共 {totalCards} 张</b></span><div>{['启蒙期', '成长期', '青春期'].map((phase, index) => <label key={phase}><span>{phase}</span><input disabled={!loaded} type="number" min="0" value={config.phaseTargets[index]} onChange={(event) => updateTarget(index, event.target.value)} /></label>)}</div></div>
    </section>
    <footer className="setup-actions"><button className="primary-action" type="submit" disabled={busy}>{busy ? '正在创建本局…' : '确认配置，开始游戏'}<i>→</i></button></footer>
  </form></div>;
}

export function ReviewDialog({ open, game, onFinish, onGenerate, onClose }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState(false);
  const [finished, setFinished] = useState(false);
  const [queued, setQueued] = useState(false);
  const [progress, setProgress] = useState({ message: '正在准备复盘数据…', percent: 0 });
  async function finish() {
    setEnding(true); setError('');
    try { await onFinish(); setFinished(true); }
    catch (finishError) { setError(finishError.message || '本局结束失败，请重试'); }
    finally { setEnding(false); }
  }
  async function generate() {
    setLoading(true); setError(''); setProgress({ message: '正在准备复盘数据…', percent: 0 });
    try { setResult(await onGenerate((message, percent) => setProgress((current) => ({ message: message || current.message, percent: typeof percent === 'number' ? percent : current.percent })))); }
    catch (reviewError) { setError(reviewError.message || '复盘报告生成失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (!open) { setResult(null); setError(''); setFinished(false); setQueued(false); setProgress({ message: '正在准备复盘数据…', percent: 0 }); }
  }, [open]);
  useEffect(() => () => {
    if (result?.reportUrl?.startsWith('blob:')) URL.revokeObjectURL(result.reportUrl);
  }, [result?.reportUrl]);
  if (!open) return null;
  const report = result?.report;
  const score = calculatePowerScore(game.powers, game.maxScores);
  return <div className="overlay" role="dialog" aria-modal="true" aria-label="结束游戏与生成复盘"><div className="review-dialog"><button className="dialog-close" type="button" onClick={() => onClose(!game.ended && !finished)}>×</button>
    {!finished && !game.ended ? <div className="review-stop-step"><small>END SESSION · 结束本局</small><h2>先结束计分，再决定是否生成复盘</h2><p>结束后，本局计时、卡牌选择、技能与数值写入会立即冻结，已经产生的记录不会丢失。</p><div className="freeze-list"><span>✓ 保存本局进度</span><span>✓ 冻结后续计分</span><span>✓ 录音与事件继续归档</span></div>{error && <div className="form-error">{error}</div>}<div className="danger-actions"><button type="button" onClick={() => onClose(true)}>继续游戏</button><button type="button" disabled={ending} onClick={finish}>{ending ? '正在安全结束…' : '确认结束本局'}</button></div></div> : loading ? <div className="report-loading"><div className="xiaowu-orbit"><span>伍</span></div><small>ORIGINAL REVIEW ENGINE</small><h2>小伍正在生成原版成长复盘</h2><p>正在调用原版提示词、伍力与风险雷达、故事插画及海报排版流程。</p><div className="report-progress" aria-live="polite"><i style={{ width: `${progress.percent}%` }} /><span>{progress.message}</span><em>{Math.round(progress.percent)}%</em></div><button type="button" onClick={() => { setQueued(true); onClose(); }}>转入后台生成</button></div> : error ? <div className="report-error"><span>!</span><h2>复盘暂未生成</h2><p>{error}</p><small>本局已经安全结束，不会重复结算分数。</small><button className="primary-action" type="button" onClick={generate}>重新生成复盘</button></div> : report ? <div className="report-ready"><small>本局复盘报告 · {result.provider}</small><h2>{report.headline || game.activity.name}</h2><div className="report-score"><span>综合伍力得分率</span><b>{report.score}%</b><em>复盘 {report.cardsReviewed} 张卡牌</em></div><p>{report.summary}</p><p>{report.insight}</p><div className="report-columns"><section><h3>成长小贴士</h3><ul>{report.strengths?.map((item) => <li key={item}>{item}</li>)}</ul></section><section><h3>数智行动公约</h3><ul>{report.actions?.map((item) => <li key={item}>{item}</li>)}</ul></section></div><div className="report-actions"><button type="button" onClick={() => window.open(result.reportUrl, '_blank', 'noopener,noreferrer')}>查看 / 导出海报报告</button><button type="button" onClick={onClose}>返回系统</button></div>{!result.stored && <small className="report-storage-note">云端保存失败，当前报告仅保存在本浏览器标签页，请先导出。</small>}</div> : <div className="review-generate-step"><small>SESSION SAVED · 本局已结束</small><span className="session-seal">已冻结</span><h2>现在生成你的成长复盘</h2><p>将调用原版复盘引擎，综合本局决策、伍力变化与现场记录，生成故事插画与完整海报。</p><div className="review-summary"><span><b>{game.history.filter((item) => item.title?.startsWith('卡牌')).length}</b>张已作答卡牌</span><span><b>{score.percent}%</b>综合伍力得分率</span></div><div className="report-actions"><button type="button" onClick={onClose}>稍后在“我的”生成</button><button className="primary-action" type="button" onClick={generate}>生成原版复盘报告</button></div></div>}
    {queued && <span className="sr-only">报告已转入后台生成</span>}
  </div></div>;
}

const ticketStatus = { open: '待响应', in_progress: '处理中', resolved: '已解决', closed: '已关闭' };
const ticketCategory = { technical: '系统与网络', audio: '录音与语音', game: '游戏流程', account: '账号问题' };
const ticketTime = (value) => value ? new Date(Number(value)).toLocaleString('zh-CN') : '刚刚';

export function SupportDialog({ open, sessionId, service, context, onClose }) {
  const [category, setCategory] = useState('technical');
  const [priority, setPriority] = useState('normal');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [reply, setReply] = useState('');
  const [tickets, setTickets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('list');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError(''); setSelected(null); setView('list');
    service.supportTickets().then((items) => { if (!cancelled) setTickets(items); }).catch((loadError) => { if (!cancelled) setError(loadError.message || '工单读取失败'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, service]);
  if (!open) return null;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await service.submitSupportTicket({ category, priority, subject, content, sessionId, context });
      setContent(''); setSubject('');
      setTickets((current) => [result.ticket, ...current.filter((item) => item.id !== result.ticket.id)]);
      setSelected(await service.supportTicket(result.ticket.id)); setView('detail');
    }
    catch (submitError) { setError(submitError.message || '工单提交失败'); }
    finally { setBusy(false); }
  }
  async function openTicket(id) {
    setLoading(true); setError('');
    try { setSelected(await service.supportTicket(id)); setView('detail'); }
    catch (loadError) { setError(loadError.message || '工单读取失败'); }
    finally { setLoading(false); }
  }
  async function submitReply(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await service.replySupportTicket(selected.id, reply); setReply(''); setSelected(await service.supportTicket(selected.id)); setTickets(await service.supportTickets()); }
    catch (replyError) { setError(replyError.message || '追问提交失败'); }
    finally { setBusy(false); }
  }
  return <div className="overlay" role="dialog" aria-modal="true" aria-label="技术支持工单"><div className="support-dialog ticket-dialog"><button className="dialog-close" type="button" onClick={() => onClose(false)}>×</button><header className="ticket-head"><div><small>SUPPORT DESK · 支持中心</small><h2>技术支持工单</h2></div><nav><button className={view === 'list' ? 'active' : ''} type="button" onClick={() => setView('list')}>我的工单 <b>{tickets.length}</b></button><button className={view === 'new' ? 'active' : ''} type="button" onClick={() => setView('new')}>+新建工单</button></nav></header>
    {error && <div className="form-error">{error}</div>}
    {view === 'list' && <section className="ticket-list">{loading ? <div className="ticket-empty">正在同步工单…</div> : tickets.length ? tickets.map((ticket) => <button type="button" key={ticket.id} onClick={() => openTicket(ticket.id)}><span className={`ticket-status ${ticket.status}`}>{ticketStatus[ticket.status] || ticket.status}</span><div><b>#{ticket.id} · {ticket.subject}</b><small>{ticketCategory[ticket.category] || ticket.category} · {ticket.messageCount} 条消息 · {ticketTime(ticket.updatedAt)}</small><p>{ticket.lastMessage}</p></div><em>›</em></button>) : <div className="ticket-empty"><span>暂无工单</span><p>录音、账号或游戏流程遇到问题时，可以在这里提交并持续追踪。</p><button type="button" onClick={() => setView('new')}>创建第一张工单</button></div>}</section>}
    {view === 'new' && <form className="ticket-form" onSubmit={submit}><div className="ticket-form-grid"><label><span>问题类型</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{Object.entries(ticketCategory).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>紧急程度</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="normal">一般</option><option value="high">紧急，影响当前游戏</option><option value="low">不紧急</option></select></label></div><label><span>工单标题</span><input maxLength="60" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="一句话说明问题" /></label><label><span>问题描述</span><textarea maxLength="2000" value={content} onChange={(event) => setContent(event.target.value)} rows="6" placeholder="请描述发生了什么，以及当时正在进行的操作" /><small>{content.length}/2000 · 会自动附带当前会话与设备摘要</small></label><button className="primary-action" disabled={busy || !subject.trim() || !content.trim()} type="submit">{busy ? '正在建立工单…' : '提交并开始跟踪'}</button></form>}
    {view === 'detail' && selected && <section className="ticket-detail"><button className="ticket-back" type="button" onClick={() => setView('list')}>← 返回工单列表</button><div className="ticket-detail-title"><div><small>#{selected.id} · {ticketCategory[selected.category] || selected.category}</small><h3>{selected.subject}</h3></div><span className={`ticket-status ${selected.status}`}>{ticketStatus[selected.status] || selected.status}</span></div><div className="ticket-meta"><span>创建于 {ticketTime(selected.createdAt)}</span>{selected.sessionId && <span>关联游戏 #{selected.sessionId}</span>}<span>{selected.priority === 'high' ? '紧急' : selected.priority === 'low' ? '低优先级' : '一般优先级'}</span></div><div className="ticket-thread">{selected.messages?.map((message) => <article className={message.authorType === 'user' ? 'from-user' : 'from-support'} key={message.id}><header><b>{message.authorType === 'user' ? '我' : '小伍支持'}</b><time>{ticketTime(message.createdAt)}</time></header><p>{message.content}</p></article>)}</div><form className="ticket-reply" onSubmit={submitReply}><label><span>补充说明或追问</span><textarea rows="3" maxLength="2000" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="继续补充现象、复现步骤或处理结果…" /></label><button type="submit" disabled={busy || !reply.trim()}>{busy ? '发送中…' : '发送追问'}</button></form></section>}
  </div></div>;
}

export function PhaseCompleteDialog({ data, onClose }) {
  if (!data) return null;
  const total = Object.values(data.powers).reduce((sum, value) => sum + value, 0);
  const nextPhase = data.phase === '启蒙期' ? '成长期' : data.phase === '成长期' ? '青春期' : '本局复盘';
  return <div className="overlay" role="dialog" aria-modal="true" aria-label={`${data.phase}完成`}>
    <div className="phase-complete-dialog">
      <div className="phase-seal"><span>✓</span><small>PHASE CLEARED</small></div>
      <small>时期任务完成</small>
      <h2>{data.phase}，已抵达</h2>
      <p>这一时期的任务已全部完成。你的每次判断，都已经记录进本局成长轨迹。</p>
      <div className="phase-total"><span>当前伍力总分</span><b>{total}</b><em>下一站 · {nextPhase}</em></div>
      <div className="phase-score-grid">{POWER_META.map((power) => <div key={power.key} style={{ '--power': power.color }}><span>{power.code}</span><small>{power.name}</small><b>{String(data.powers[power.key]).padStart(2, '0')}</b></div>)}</div>
      <button className="primary-action" type="button" onClick={onClose}>{nextPhase === '本局复盘' ? '返回桌游，准备复盘' : `继续前往${nextPhase}`}<i>→</i></button>
    </div>
  </div>;
}
