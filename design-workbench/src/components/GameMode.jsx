import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PHASES, POWER_META } from '../data/gameData';
import CardAudioButton from './CardAudioButton';
import FeedbackAudioButton from './FeedbackAudioButton';
import PhaseRail from './PhaseRail';
import RecordingWaveform from './RecordingWaveform';

const initialSkillScore = 3;
const loadLiquidScenarioFrame = () => import('./LiquidScenarioFrame');
const LiquidScenarioFrame = lazy(loadLiquidScenarioFrame);

export default function GameMode({ game, actions }) {
  const [query, setQuery] = useState('');
  const [creativeText, setCreativeText] = useState('');
  const [creativeStep, setCreativeStep] = useState('input');
  const [showCreative, setShowCreative] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedCode, setSelectedCode] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPhase, setPickerPhase] = useState('');
  const [pickerSafety, setPickerSafety] = useState('');
  const [pickerData, setPickerData] = useState({ safetyTypes: [], cards: [], remaining: 0 });
  const [pickerLoading, setPickerLoading] = useState(false);
  const [speechStatus, setSpeechStatus] = useState('idle');
  const [speechDraft, setSpeechDraft] = useState('');
  const [safetyReport, setSafetyReport] = useState(null);
  const [submittingChoice, setSubmittingChoice] = useState('');
  const recognitionRef = useRef(null);
  const skillUseRef = useRef(new Set());

  useEffect(() => {
    const term = query.trim().toUpperCase();
    if (!term || !game.started || game.paused || game.ended || term === selectedCode) { setSuggestions([]); setSearching(false); return undefined; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const result = await actions.suggestCards(term);
      if (!cancelled) { setSuggestions(result); setSearching(false); }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, game.started, game.paused, game.ended, game.sessionId, selectedCode, actions.suggestCards]);
  useEffect(() => {
    if (!game.paused && !game.ended) return;
    setPickerOpen(false);
    setSuggestions([]);
    setSearching(false);
  }, [game.paused, game.ended]);
  useEffect(() => () => recognitionRef.current?.abort(), []);
  useEffect(() => {
    const preload = () => { void loadLiquidScenarioFrame(); };
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(preload, { timeout: 1600 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(preload, 600);
    return () => window.clearTimeout(handle);
  }, []);
  useEffect(() => { skillUseRef.current.clear(); setSafetyReport(null); }, [game.sessionId]);
  const currentCard = game.currentCard;

  async function submitChoice(choice, customText = '') {
    if (submittingChoice) return;
    setSubmittingChoice(choice);
    try { await actions.chooseCard(choice, customText); }
    finally { setSubmittingChoice(''); }
  }

  async function selectCard(card) {
    setSelectedCode(card.shortCode.toUpperCase());
    setQuery(card.shortCode);
    setSuggestions([]);
    setPickerOpen(false);
    await actions.openCard(card);
  }

  async function choosePhase(phase) {
    setPickerPhase(phase);
    setPickerSafety('');
    setPickerLoading(true);
    try { setPickerData(await actions.listCardOptions(phase)); }
    finally { setPickerLoading(false); }
  }

  async function chooseSafety(safetyType) {
    setPickerSafety(safetyType);
    setPickerLoading(true);
    try { setPickerData(await actions.listCardOptions(pickerPhase, safetyType)); }
    finally { setPickerLoading(false); }
  }

  function openPicker() {
    setPickerPhase('');
    setPickerSafety('');
    setPickerData({ safetyTypes: [], cards: [], remaining: 0 });
    setPickerOpen(true);
  }

  function useSkill(power) {
    const reopeningCreative = power.key === 'creative' && game.usedSkills.includes('creative') && game.creativeCardCode === currentCard?.code && !game.feedback;
    if (reopeningCreative) { setShowCreative(true); return; }
    if (game.usedSkills.includes(power.key) || skillUseRef.current.has(power.key)) return;
    if (power.key === 'safety') {
      const report = actions.analyzeSafetySkill(power);
      if (report) setSafetyReport(report);
      return;
    }
    skillUseRef.current.add(power.key);
    if (actions.useSkill(power) === false) { skillUseRef.current.delete(power.key); return; }
    if (power.key === 'creative') {
      setCreativeText('');
      setCreativeStep('input');
      setSpeechStatus('idle');
      setSpeechDraft('');
      setShowCreative(true);
    }
  }

  function confirmSafetySkill() {
    if (safetyReport?.activated || skillUseRef.current.has('safety')) { setSafetyReport(null); return; }
    const power = POWER_META.find((item) => item.key === 'safety');
    skillUseRef.current.add('safety');
    const result = actions.useSafetySkill(power);
    if (result) setSafetyReport(result);
    else skillUseRef.current.delete('safety');
  }

  function confirmCreative(choice) {
    recognitionRef.current?.stop();
    setShowCreative(false);
    void submitChoice(choice, creativeText);
  }

  function chooseNextCard() {
    setQuery('');
    setSelectedCode('');
    setSuggestions([]);
    openPicker();
  }

  function startSpeech() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setSpeechStatus('unsupported'); return; }
    recognitionRef.current?.abort();
    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => { setSpeechStatus('listening'); setSpeechDraft(''); };
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || '';
        if (event.results[index].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      setSpeechDraft(interimText);
      if (finalText.trim()) setCreativeText((current) => `${current}${current.trim() ? '，' : ''}${finalText.trim()}`);
    };
    recognition.onerror = () => { setSpeechStatus('error'); setSpeechDraft(''); };
    recognition.onend = () => setSpeechStatus((current) => current === 'listening' ? 'idle' : current);
    recognitionRef.current = recognition;
    recognition.start();
  }

  return (
    <main className="game-layout">
      {game.paused && <div className={`pause-ribbon ${game.ended ? 'ended' : ''}`} role="status"><span>{game.ended ? '✓' : 'Ⅱ'}</span><div><b>{game.ended ? '本局已结束' : '全局暂停中'}</b><small>{game.ended ? '本局数据已封存，可随时查看监督记录或重新打开复盘。' : '计时、卡牌选择、技能、录音操作与数值调整均已冻结'}</small></div><button type="button" onClick={game.ended ? actions.finishGame : actions.togglePause}>{game.ended ? '查看复盘' : '继续游戏'}</button></div>}
      <aside className="status-column panel-shell">
        <div className="section-label"><span>01</span> 本局游戏状态</div>
        <h1>{game.activity.name}</h1>
        <div className="status-led"><i />{game.ended ? '本局已结束' : game.paused ? '全局暂停' : game.started ? '游戏进行中 · 自动保存' : '等待开局'}</div>
        <dl className="mission-facts">
          <div><dt>当前卡片</dt><dd>{currentCard?.shortCode || '—'}</dd></div>
          <div><dt>活动码</dt><dd>{game.activity.code}</dd></div>
          <div><dt>卡牌版本</dt><dd>{game.activity.deckVersion}</dd></div>
          <div><dt>游戏模式</dt><dd>{game.activity.mode}</dd></div>
        </dl>
        <PhaseRail targets={game.activity.phaseTargets} progress={game.phaseProgress} currentPhase={game.currentPhase} />
        <div className="game-controls">
          <button className={game.paused ? 'resume' : ''} type="button" disabled={game.ended} onClick={actions.togglePause}><span>{game.paused ? '▶' : 'Ⅱ'}</span>{game.ended ? '本局已冻结' : game.paused ? '继续游戏' : '暂停游戏'}</button>
          <button className="stop" type="button" onClick={actions.finishGame}>{game.ended ? '查看复盘' : '停止并复盘'}</button>
        </div>
      </aside>

      <section className="decision-column">
        <div className="card-search-wrap">
          <div className="card-search-tools"><div className="card-search"><span>⌕</span><input value={query} disabled={game.paused || game.ended} onChange={(event) => { setSelectedCode(''); setQuery(event.target.value); }} onKeyDown={(event) => { if (event.key === 'Enter' && suggestions[0]) selectCard(suggestions[0]); }} placeholder={game.ended ? '本局已结束' : game.paused ? '游戏暂停中' : '输入卡牌编号'} aria-label="输入卡牌编号" /><button type="button" disabled={game.paused || game.ended || game.cardLoading || !suggestions[0]} onClick={() => suggestions[0] && selectCard(suggestions[0])}>{game.cardLoading ? '调取中…' : '调取卡牌'}</button></div><button className={`quick-picker-trigger ${pickerOpen ? 'active' : ''}`} type="button" disabled={!game.started || game.paused || game.ended} onClick={() => pickerOpen ? setPickerOpen(false) : openPicker()}><span>▦</span> 选择卡牌</button></div>
          {searching && <div className="search-status">正在匹配本局卡牌…</div>}
          {suggestions.length > 0 && <div className="suggestions">{suggestions.map((card) => <button key={card.cardRef || card.code} type="button" disabled={game.paused || game.ended} onClick={() => selectCard(card)}><span>{card.shortCode}</span><b>{card.title}<small>{card.phase} · {card.type}</small></b><em>打开</em></button>)}</div>}
          {pickerOpen && <div className="quick-picker"><header><div><small>按时期与安全类型筛选</small><b>选择本轮卡牌</b></div><button type="button" onClick={() => setPickerOpen(false)}>×</button></header><div className="picker-steps"><section><span><i>1</i>卡牌时期</span><div>{PHASES.map((phase) => <button className={pickerPhase === phase ? 'active' : ''} type="button" key={phase} onClick={() => choosePhase(phase)}>{phase}</button>)}</div></section><section className={!pickerPhase ? 'disabled' : ''}><span><i>2</i>所属安全</span><div>{pickerData.safetyTypes.map((item) => <button className={pickerSafety === item.name ? 'active' : ''} type="button" key={item.name} onClick={() => chooseSafety(item.name)}>{item.name}<small>{item.count}</small></button>)}</div></section></div>{pickerPhase && pickerSafety && <div className="picker-results"><div><b>{pickerSafety}</b><small>{pickerPhase}还差 {pickerData.remaining} 张</small></div>{pickerLoading ? <p>正在读取本局可用卡牌…</p> : <div className="picker-card-grid">{pickerData.cards.length ? pickerData.cards.map((card) => <button type="button" key={card.cardRef} onClick={() => selectCard(card)}><span>{card.shortCode}</span><b>{card.title}</b><small>点击打开</small></button>) : <p>这一分类没有待作答卡牌</p>}</div>}</div>}</div>}
        </div>

        <div className={`decision-stage ${currentCard ? 'has-card' : ''}`}>
          {currentCard ? (
            <Suspense fallback={<div className="liquid-material-loading" role="status">正在加载动态玻璃材质…</div>}>
            <LiquidScenarioFrame stateKey={`${currentCard.code}-${game.feedback ? 'feedback' : 'choice'}`}>
            <article className={`scenario-card ${game.feedback ? 'feedback-visible' : ''}`}>
              <header><div><span>{currentCard.shortCode}</span><b>{currentCard.type}</b></div><CardAudioButton card={currentCard} sessionId={game.sessionId} gamePaused={game.paused} /></header>
              <div className="card-scroll-area">
                <div className="card-body">{currentCard.guideText && <small>{currentCard.guideText}</small>}<h2>{currentCard.title}</h2><p>{currentCard.text}</p></div>
                <div className="choice-grid">{Object.entries(currentCard.options).map(([key, option]) => <button key={key} className={submittingChoice === key ? 'submitting' : ''} type="button" disabled={!!game.feedback || game.answering || game.ended} onClick={() => submitChoice(key)}><span>{key}</span><b>{submittingChoice === key ? '正在提交本次选择…' : option.text}</b>{submittingChoice === key && <i />}</button>)}</div>
                {game.feedback && <div className="feedback-reading"><div className="feedback-reading-head"><span>{game.feedback.choice}</span><div><small>{game.feedback.provider ? 'AI 结构化反馈' : '本张卡牌反馈'}</small><b>{game.feedback.title}</b></div><em>{game.feedback.delta}</em></div><p>{game.feedback.copy}</p>{game.feedback.reason && <details className="feedback-reason"><summary>查看伍力理由</summary><p>{game.feedback.reason}</p></details>}<div className="feedback-actions"><FeedbackAudioButton feedback={game.feedback} sessionId={game.sessionId} gamePaused={game.paused} /><button type="button" disabled={game.ended} onClick={chooseNextCard}>{game.ended ? '本局已结束' : '完成本张 · 选择下一张'} <i>{game.ended ? '✓' : '→'}</i></button></div></div>}
              </div>
            </article>
            </LiquidScenarioFrame>
            </Suspense>
          ) : (
            <div className="empty-decision"><div className="empty-map-art" /><span>DECISION DECK</span><h2>{game.ended ? '本局任务已完成' : <>下一张情境卡<br />正在等你开启</>}</h2>{game.ended && <p>卡牌、技能与分数已冻结，可前往监督模式查看完整记录。</p>}<button type="button" disabled={!game.started || game.paused || game.ended} onClick={openPicker}>{game.ended ? '本局已结束' : '浏览本局可选卡牌'} <i>{game.ended ? '✓' : '→'}</i></button></div>
          )}
        </div>
      </section>

      <aside className="action-column">
        <section className="skill-panel panel-shell">
          <div className="section-label"><span>03</span> 五力技能</div>
          <div className="skill-list">{POWER_META.map((power) => {
            const used = game.usedSkills.includes(power.key);
            const creativeUnavailable = power.key === 'creative' && (!currentCard || !!game.feedback);
            const canResumeCreative = power.key === 'creative' && used && game.creativeCardCode === currentCard?.code && !game.feedback;
            return <button key={power.key} className={`${used ? 'used' : ''} ${creativeUnavailable ? 'unavailable' : ''}`} disabled={game.paused || game.ended || creativeUnavailable || (used && !canResumeCreative)} title={game.ended ? '本局已结束' : game.paused ? '游戏暂停中' : creativeUnavailable ? (!currentCard ? '请先打开一张卡牌' : '当前卡牌已完成选择') : ''} style={{ '--power': power.color }} type="button" onClick={() => useSkill(power)}><i>{power.code}</i><b>{power.skill}</b><em>{game.ended ? '已锁定' : game.paused ? '已暂停' : canResumeCreative ? '继续创作' : used ? '已使用' : creativeUnavailable ? '待选牌' : '发动'}</em></button>;
          })}</div>
        </section>
        <section className={`supervisor-launch panel-shell ${game.recording ? 'recording' : ''}`}>
          <div className="section-label"><span>04</span> 开启督导模式</div>
          <RecordingWaveform active={game.recording} />
          <div className="recording-state"><span className={game.recordingStatus}>{game.recording ? '● 录音中' : game.recordingStatus === 'saved' ? '✓ 已保存' : game.recordingStatus === 'error' ? '! 需要处理' : '○ 未开始'}</span><small>{game.recording ? '仅记录本局现场声音' : game.recordingStatus === 'saved' ? '录音已归档至“我的文件”' : '开启前会请求麦克风权限'}</small></div>
          <div className="supervisor-actions"><button type="button" disabled={game.paused || game.ended || ['requesting', 'uploading'].includes(game.recordingStatus)} onClick={actions.toggleRecording}>{game.recordingStatus === 'requesting' ? '正在连接麦克风…' : game.recordingStatus === 'uploading' ? '正在保存录音…' : game.recording ? '停止并保存录音' : '开始现场录音'}</button><button type="button" onClick={actions.openSupervisor}>查看监督模式</button></div>
          {game.recordingError && <small className="recording-error">{game.recordingError}</small>}
          <button className="support-link" type="button" onClick={actions.contactSupport}>联系技术支持</button>
        </section>
      </aside>

      {showCreative && <div className="overlay" role="dialog" aria-modal="true" aria-label="创心力技能">
        <div className="creative-dialog">
          <button className="dialog-close" type="button" onClick={() => setShowCreative(false)}>×</button>
          <div className="creative-head"><span>P</span><div><small>创心力技能</small><h2>创造你的选项 D</h2></div></div>
          {creativeStep === 'input' ? <><div className="speech-permission-note"><i>麦</i><div><b>语音输入需要麦克风权限</b><small>仅把识别结果填入文本框；拒绝权限后仍可继续键盘输入。</small></div></div><div className="creative-input"><textarea value={creativeText} maxLength="280" onChange={(event) => setCreativeText(event.target.value)} autoFocus placeholder="写下一个不同于 A / B / C 的具体做法…" />{speechDraft && <p>{speechDraft}</p>}<div className="creative-input-tools"><span className={creativeText.length > 240 ? 'warning' : ''}>{creativeText.length}/280</span><button className={speechStatus === 'listening' ? 'listening' : ''} type="button" onClick={speechStatus === 'listening' ? () => recognitionRef.current?.stop() : startSpeech}><i />{speechStatus === 'listening' ? '停止听写' : '语音输入'}</button></div></div>{speechStatus === 'unsupported' && <div className="speech-note">当前浏览器不支持语音识别，已切换为键盘输入。</div>}{speechStatus === 'error' && <div className="speech-note">这次没有识别成功，你可以重试或直接编辑文字。</div>}<button className="primary-action" type="button" disabled={!creativeText.trim()} onClick={() => setCreativeStep('confirm')}>生成选项 D</button></> : <><div className="xiaowu-confirm"><span>伍</span><div><b>小伍正在等待你的最终确认</b><small>创心力技能已消耗。最终仍可选择 A、B、C 或你创造的 D。</small></div></div><div className="option-d"><span>D</span><b>{creativeText}</b></div><h3>请选择最终答案</h3><div className="xiaowu-choices">{['A', 'B', 'C', 'D'].map((choice) => <button key={choice} type="button" onClick={() => confirmCreative(choice)}><span>{choice}</span><small>{choice === 'D' ? '采用新办法' : '回到原选项'}</small></button>)}</div></>}
        </div>
      </div>}
      {safetyReport && <div className="overlay safety-alert-overlay" role="dialog" aria-modal="true" aria-label="安全力警告">
        <div className="safety-alert-dialog">
          <button className="dialog-close" type="button" onClick={() => setSafetyReport(null)}>×</button>
          <header className="safety-alert-head"><span>R</span><div><small>安全力警告</small><h2>当前伍力与扣分分析</h2></div><i className={safetyReport.rescuedKeys.length ? 'danger' : 'stable'}>{safetyReport.activated ? (safetyReport.rescuedKeys.length ? '已执行紧急救援' : '安全扫描已记录') : (safetyReport.rescuedKeys.length ? `发现 ${safetyReport.rescuedKeys.length} 项紧急风险` : '当前状态稳定')}</i></header>
          <div className="safety-score-board">{POWER_META.map((item) => {
            const before = safetyReport.before[item.key];
            const after = safetyReport.activated ? safetyReport.after[item.key] : before;
            const deduction = Math.max(0, initialSkillScore - before);
            const rescued = safetyReport.rescuedKeys.includes(item.key);
            return <article className={`${rescued && safetyReport.activated ? 'rescued' : ''} ${before <= 1 ? 'critical' : deduction ? 'warning' : ''}`} key={item.key} style={{ '--power': item.color }}><span>{item.code}</span><div><b>{item.name}</b><small>{deduction ? `较初始值扣 ${deduction} 分` : '本局未扣分'}</small></div><strong>{after}</strong>{rescued && <em>{safetyReport.activated ? <><del>1</del> +1</> : '待救援'}</em>}</article>;
          })}</div>
          <section className={`emergency-result ${safetyReport.activated && safetyReport.rescuedKeys.length ? 'activated' : ''}`}><i>!</i><div><b>{safetyReport.activated ? (safetyReport.rescuedKeys.length ? '紧急救援已生效' : '未触发紧急救援') : (safetyReport.rescuedKeys.length ? '紧急救援待确认' : '安全扫描待确认')}</b><p>{safetyReport.rescuedKeys.length ? (safetyReport.activated ? `${safetyReport.rescuedNames.join('、')}原为 1 分，现已分别恢复 1 分。` : `${safetyReport.rescuedNames.join('、')}当前为 1 分，确认发动后将分别恢复 1 分。`) : '当前没有恰好为 1 分的力值，发动后只记录本次安全扫描与扣分分析。'}</p></div></section>
          <button className="primary-action" type="button" onClick={confirmSafetySkill}>{safetyReport.activated ? '完成' : '确认发动安全力技能'}</button>
        </div>
      </div>}
    </main>
  );
}
