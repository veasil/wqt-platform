import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandHeader from './components/BrandHeader';
import GameMode from './components/GameMode';
import SupervisorMode from './components/SupervisorMode';
import ProfileMode from './components/ProfileMode';
import GlobalStatusBar from './components/GlobalStatusBar';
import { LoginDialog, PhaseCompleteDialog, ReviewDialog, SetupDialog, SupportDialog, Welcome } from './components/Overlays';
import { DEFAULT_ACTIVITY, PHASES, POWER_META } from './data/gameData';
import { unlockCardAudio } from './services/cardAudioPlayer';
import { gameService } from './services/gameService';
import { recordingService } from './services/recordingService';
import { calculatePowerScore } from './utils/scoring';

const initialPowers = { safety: 3, reason: 3, sense: 3, creative: 3, empathy: 3 };
const powerKeys = { 安全力: 'safety', 脑波力: 'reason', 实感力: 'sense', 创心力: 'creative', 沟通力: 'empathy' };
const clock = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const now = () => new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function App() {
  const [welcome, setWelcome] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [phaseComplete, setPhaseComplete] = useState(null);
  const [activeTab, setActiveTab] = useState('game');
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const [game, setGame] = useState({ sessionId: null, started: false, ended: false, paused: false, recording: false, recordingStatus: 'idle', recordingError: '', lastRecording: null, cardLoading: false, answering: false, time: DEFAULT_ACTIVITY.duration, activity: DEFAULT_ACTIVITY, cardGroups: [], maxScores: {}, totalCardCount: 0, currentCard: null, currentPhase: 0, phaseProgress: { 启蒙期: 0, 成长期: 0, 青春期: 0 }, powers: initialPowers, pulseKey: null, usedSkills: [], creativeCardCode: null, feedback: null, history: [] });
  const [user, setUser] = useState({ name: '守望师', role: '未登录', organization: 'AI 5000天' });

  useEffect(() => {
    if (!game.started || game.paused || game.time <= 0) return undefined;
    const timer = window.setInterval(() => setGame((current) => ({ ...current, time: Math.max(0, current.time - 1) })), 1000);
    return () => window.clearInterval(timer);
  }, [game.started, game.paused, game.time <= 0]);

  useEffect(() => () => { window.clearTimeout(toastTimer.current); }, []);
  const notify = useCallback((message) => { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 2400); }, []);
  const suggestCards = useCallback(async (query) => {
    if (!game.started || !game.sessionId || !query.trim()) return [];
    try { return await gameService.suggestCards(game.sessionId, query); }
    catch { return []; }
  }, [game.started, game.sessionId]);
  const listCardOptions = useCallback(async (phase, safetyType = '') => {
    if (!game.started || !game.sessionId) return { safetyTypes: [], cards: [], remaining: 0 };
    return gameService.listCardOptions(game.sessionId, phase, safetyType);
  }, [game.started, game.sessionId]);

  const actions = useMemo(() => ({
    suggestCards,
    listCardOptions,
    async openCard(cardReference) {
      if (!game.started) { notify('请先开始一局游戏'); setSetupOpen(true); return; }
      if (game.ended) { notify('本局已结束，不能再调取卡牌'); return; }
      if (game.paused) { notify('游戏暂停中'); return; }
      if (game.answering || game.cardLoading) return;
      setGame((current) => ({ ...current, cardLoading: true, feedback: null }));
      try {
        const card = await gameService.resolveCard(game.sessionId, cardReference);
        setGame((current) => ({ ...current, cardLoading: false, currentCard: card, feedback: null }));
      } catch (error) {
        setGame((current) => ({ ...current, cardLoading: false }));
        notify(error.message || '卡牌调取失败');
      }
    },
    async chooseCard(choice, customText = '') {
      if (!game.currentCard || game.paused || game.ended || game.feedback || game.answering) return;
      if (choice !== 'D' && !game.currentCard.options[choice]) return;
      setGame((current) => ({ ...current, answering: true }));
      try {
        const result = await gameService.answerCard(game.sessionId, game.currentCard.grantId, choice, customText);
        const effects = result.attributeEffects || {};
        const nextPowers = { ...game.powers };
        const deltaLabels = [];
        Object.entries(effects).forEach(([name, rawValue]) => {
          const key = powerKeys[name];
          const value = Number(rawValue) || 0;
          if (!key || value === 0) return;
          nextPowers[key] = Math.max(0, nextPowers[key] + value);
          deltaLabels.push(`${name} ${value > 0 ? '+' : ''}${value}`);
        });
        const phaseIndex = PHASES.indexOf(result.phase);
        if (phaseIndex < 0) throw new Error(`卡牌 ${game.currentCard.shortCode} 缺少有效时期`);
        const copy = result.consequence;
        const title = `卡牌 ${game.currentCard.shortCode} · 选择 ${choice}`;
        const creativeSkillApplied = game.creativeCardCode === game.currentCard.code;
        const deltaText = [deltaLabels.join('　'), creativeSkillApplied ? '创心力技能 +1（已计入）' : ''].filter(Boolean).join('　') || '伍力值不变';
        setGame((current) => ({
          ...current,
          answering: false,
          feedback: { choice, title, copy, reason: result.reason || '', delta: deltaText, feedbackGrantId: result.feedbackGrantId, provider: result.feedbackProvider || null },
          phaseProgress: { ...current.phaseProgress, ...result.phaseProgress },
          currentPhase: phaseIndex,
          powers: nextPowers,
          pulseKey: null,
          history: [{ time: now(), title: `卡牌 ${current.currentCard.shortCode}`, detail: `选择 ${choice} · ${current.currentCard.title}`, value: deltaLabels.join(' / ') || '伍力值不变', reason: result.reason || '本选项暂无伍力理由。', consequence: copy }, ...current.history],
        }));
        if (result.phaseCompleted) setPhaseComplete({ phase: result.phase, powers: nextPowers });
      } catch (error) {
        setGame((current) => ({ ...current, answering: false }));
        notify(error.message || '作答提交失败');
      }
    },
    useSkill(power) {
      if (!game.started) { notify('请先开始一局游戏'); return false; }
      if (game.ended) { notify('本局已结束，不能再发动技能'); return false; }
      if (game.paused) { notify('游戏暂停中'); return false; }
      if (power.key === 'safety') return false;
      if (power.key === 'creative' && (!game.currentCard || game.feedback || game.answering)) { notify(!game.currentCard ? '请先调取一张卡牌' : '当前卡牌已经完成选择，不能再创建选项 D'); return false; }
      setGame((current) => ({ ...current, usedSkills: [...current.usedSkills, power.key], creativeCardCode: power.key === 'creative' ? current.currentCard?.code || null : current.creativeCardCode, powers: { ...current.powers, [power.key]: current.powers[power.key] + 1 }, pulseKey: power.key, history: [{ time: now(), title: `发动 ${power.skill}`, detail: current.currentCard ? `用于卡牌 ${current.currentCard.shortCode}` : '本局技能已记录', value: `${power.name} +1` }, ...current.history] }));
      void gameService.recordEvent(game.sessionId, 'skill_used', { skill: power.key, power: power.name, cardCode: game.currentCard?.code || null }).catch(() => notify('技能记录回传失败，已保留本地状态'));
      notify(`${power.skill}已发动 · ${power.name} +1`);
      return true;
    },
    analyzeSafetySkill(power) {
      if (!game.started) { notify('请先开始一局游戏'); return null; }
      if (game.ended) { notify('本局已结束，不能再发动技能'); return null; }
      if (game.paused) { notify('游戏暂停中'); return null; }
      if (game.usedSkills.includes(power.key)) return null;
      const before = { ...game.powers };
      const rescuedKeys = Object.keys(before).filter((key) => before[key] === 1);
      const after = Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value === 1 ? value + 1 : value]));
      const rescuedNames = rescuedKeys.map((key) => POWER_META.find((item) => item.key === key)?.name).filter(Boolean);
      return { before, after, rescuedKeys, rescuedNames, activated: false };
    },
    useSafetySkill(power) {
      if (!game.started) { notify('请先开始一局游戏'); return null; }
      if (game.ended) { notify('本局已结束，不能再发动技能'); return null; }
      if (game.paused) { notify('游戏暂停中'); return null; }
      if (game.usedSkills.includes(power.key)) return null;
      const before = { ...game.powers };
      const rescuedKeys = Object.keys(before).filter((key) => before[key] === 1);
      const after = Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value === 1 ? value + 1 : value]));
      const rescuedNames = rescuedKeys.map((key) => POWER_META.find((item) => item.key === key)?.name).filter(Boolean);
      setGame((current) => ({
        ...current,
        usedSkills: [...current.usedSkills, power.key],
        powers: after,
        pulseKey: rescuedKeys[0] || null,
        history: [{
          time: now(),
          title: '发动安全力技能',
          detail: rescuedNames.length ? `紧急救援：${rescuedNames.join('、')}` : '已查看当前伍力与扣分警告',
          value: rescuedNames.length ? rescuedNames.map((name) => `${name} +1`).join(' / ') : '无紧急救援',
        }, ...current.history],
      }));
      void gameService.recordEvent(game.sessionId, 'skill_used', {
        skill: power.key,
        power: power.name,
        effect: 'emergency_rescue',
        cardCode: game.currentCard?.code || null,
        before,
        after,
        rescuedPowers: rescuedNames,
      }).catch(() => notify('安全力技能记录回传失败，已保留本地状态'));
      notify(rescuedNames.length ? `紧急救援完成 · ${rescuedNames.join('、')} +1` : '安全力警告已生成 · 当前没有 1 分力值');
      return { before, after, rescuedKeys, rescuedNames, activated: true };
    },
    togglePause() {
      if (!game.started) { notify('当前没有进行中的游戏'); return; }
      if (game.ended) { notify('本局已结束，暂停状态不能再更改'); return; }
      const paused = !game.paused;
      setGame((current) => ({ ...current, paused, history: [{ time: now(), title: paused ? '游戏暂停' : '游戏继续', detail: paused ? '计时与现场操作已冻结' : '恢复计时与现场操作', value: paused ? '已暂停' : '进行中' }, ...current.history] }));
    },
    async toggleRecording() {
      if (!game.started || !game.sessionId) { notify('请先开始一局游戏'); return; }
      if (game.paused || game.ended) { notify(game.ended ? '本局已结束，不能再开启录音' : '全局暂停中，录音操作已冻结'); return; }
      if (['requesting', 'uploading'].includes(game.recordingStatus)) return;
      if (!game.recording) {
        setGame((current) => ({ ...current, recordingStatus: 'requesting', recordingError: '' }));
        try {
          await recordingService.start();
          setGame((current) => ({ ...current, recording: true, recordingStatus: 'recording', history: [{ time: now(), title: '开启现场录音', detail: '麦克风已连接，录音仅用于本局督导', value: '记录中' }, ...current.history] }));
        } catch (error) {
          setGame((current) => ({ ...current, recording: false, recordingStatus: 'error', recordingError: error.message }));
          notify(error.message || '无法开启麦克风');
        }
        return;
      }
      setGame((current) => ({ ...current, recordingStatus: 'uploading' }));
      try {
        const blob = await recordingService.stop();
        const result = await gameService.uploadRecording(game.sessionId, blob);
        setGame((current) => ({ ...current, recording: false, recordingStatus: 'saved', lastRecording: result.recording, history: [{ time: now(), title: '现场录音已保存', detail: result.recording.fileName, value: `${Math.ceil(result.recording.sizeBytes / 1024)} KB` }, ...current.history] }));
        notify('现场录音已安全保存到测试账户');
      } catch (error) {
        setGame((current) => ({ ...current, recording: false, recordingStatus: 'error', recordingError: error.message }));
        notify(error.message || '录音保存失败');
      }
    },
    finishGame() {
      if (!game.started) { notify('当前没有可复盘的游戏'); return; }
      if (['requesting', 'uploading'].includes(game.recordingStatus)) { notify('请等待当前录音操作完成后再结束游戏'); return; }
      setGame((current) => ({ ...current, paused: true }));
      setReviewOpen(true);
    },
    openSupervisor() { setActiveTab('supervisor'); },
    contactSupport() { setSupportOpen(true); },
    adjustPower(key, delta) {
      if (game.paused || game.ended) { notify(game.ended ? '本局已结束，不能再调整数值' : '全局暂停中，不能调整数值'); return; }
      const power = POWER_META.find((item) => item.key === key);
      setGame((current) => ({
        ...current,
        powers: { ...current.powers, [key]: Math.max(0, Math.min(99, current.powers[key] + delta)) },
        history: [{ time: now(), title: `督导调整${power?.name || '伍力'}`, detail: `由 ${current.powers[key]} 调整为 ${Math.max(0, Math.min(99, current.powers[key] + delta))} · 已记录操作者与时间`, value: delta > 0 ? '+1' : '−1' }, ...current.history],
      }));
    },
  }), [game, listCardOptions, notify, suggestCards]);

  async function startGame(activity) {
    const result = await gameService.startGame(activity);
    const resolvedActivity = { ...activity, cardGroupIds: result.cardGroups.map((group) => group.id) };
    if (result.sessionId) sessionStorage.setItem('wqt_session_id', String(result.sessionId));
    const groupNames = result.cardGroups.map((group) => group.name).join(' + ');
    setGame((current) => ({ ...current, sessionId: result.sessionId, started: true, ended: false, paused: false, recording: false, recordingStatus: 'idle', recordingError: '', lastRecording: null, cardLoading: false, answering: false, time: resolvedActivity.duration, activity: resolvedActivity, cardGroups: result.cardGroups, maxScores: result.maxScores || {}, totalCardCount: result.totalCardCount, currentCard: null, currentPhase: 0, phaseProgress: { 启蒙期: 0, 成长期: 0, 青春期: 0 }, powers: initialPowers, usedSkills: [], creativeCardCode: null, feedback: null, history: [{ time: now(), title: '游戏开始', detail: `${groupNames} · ${resolvedActivity.mode}`, value: '进行中' }] }));
    setSetupOpen(false);
    setActiveTab('game');
  }

  async function login(credentials) {
    const result = await gameService.login(credentials);
    setUser(result.user);
    setLoginOpen(false);
    setSetupOpen(true);
  }

  async function finishSession() {
    const totalScore = calculatePowerScore(game.powers, game.maxScores).percent;
    const attributes = { 安全力: game.powers.safety, 脑波力: game.powers.reason, 实感力: game.powers.sense, 创心力: game.powers.creative, 沟通力: game.powers.empathy };
    let recordingUpdate = {};
    let recordingArchiveFailed = false;
    if (game.recording) {
      setGame((current) => ({ ...current, recordingStatus: 'uploading' }));
      try {
        const blob = await recordingService.stop();
        const result = await gameService.uploadRecording(game.sessionId, blob);
        recordingUpdate = { recording: false, recordingStatus: 'saved', recordingError: '', lastRecording: result.recording };
      } catch (error) {
        recordingService.cancel();
        recordingArchiveFailed = true;
        recordingUpdate = { recording: false, recordingStatus: 'error', recordingError: error.message || '现场录音归档失败' };
      }
      setGame((current) => ({ ...current, ...recordingUpdate }));
    }
    await gameService.finishGame(game.sessionId, { finalScore: totalScore, attributes, payload: { activityCode: game.activity.code, phaseProgress: game.phaseProgress, scoreFormula: 'average-dimension-rate' } });
    setGame((current) => ({ ...current, ...recordingUpdate, ended: true, paused: true, history: [{ time: now(), title: '本局已结束', detail: recordingArchiveFailed ? '计分已封存；现场录音归档失败，请联系技术支持' : '计时、选择、技能与写入已冻结', value: recordingArchiveFailed ? '录音待处理' : '等待复盘' }, ...current.history] }));
    if (recordingArchiveFailed) notify('本局已结束，但现场录音未能归档');
  }

  async function generateReview(onProgress) {
    return gameService.generateReview(game.sessionId, onProgress);
  }

  if (welcome) return <Welcome onEnter={() => { unlockCardAudio(); setWelcome(false); setLoginOpen(true); }} />;
  return <div className={`app-shell ${game.paused ? 'is-paused' : ''} ${game.ended ? 'is-ended' : ''}`}><div className="app-atmosphere" /><BrandHeader activeTab={activeTab} onTabChange={setActiveTab} user={user} timer={clock(game.time)} paused={game.paused} ended={game.ended} /><GlobalStatusBar activeTab={activeTab} game={game} />{activeTab === 'game' && <GameMode game={game} actions={actions} />}{activeTab === 'supervisor' && <SupervisorMode game={game} actions={actions} />}{activeTab === 'profile' && <ProfileMode user={user} service={gameService} onOpenSupport={() => setSupportOpen(true)} onUserUpdate={(profile) => setUser((current) => ({ ...current, name: profile.name, phone: profile.phone }))} notify={notify} />}{!game.started && !loginOpen && !setupOpen && <button className="floating-new-game" type="button" onClick={() => user.role === '未登录' ? setLoginOpen(true) : setSetupOpen(true)}>＋ 新游戏</button>}{toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}<LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} onLogin={login} onStartHuman={gameService.startHumanCheck} onVerifyHuman={gameService.verifyHumanCheck} onSendCode={gameService.sendSmsCode} /><SetupDialog open={setupOpen} defaults={DEFAULT_ACTIVITY} onList={gameService.listActivities} onResolve={gameService.resolveActivity} onClose={() => setSetupOpen(false)} onStart={startGame} /><PhaseCompleteDialog data={phaseComplete} onClose={() => setPhaseComplete(null)} /><ReviewDialog open={reviewOpen} game={game} onFinish={finishSession} onGenerate={generateReview} onClose={(resumeGame = false) => { setReviewOpen(false); if (resumeGame && !game.ended) setGame((current) => ({ ...current, paused: false })); }} /><SupportDialog open={supportOpen} sessionId={game.sessionId} service={gameService} context={{ page: activeTab, activityCode: game.activity.code, recordingStatus: game.recordingStatus }} onClose={(submitted) => { setSupportOpen(false); if (submitted) notify('技术支持工单已提交'); }} /></div>;
}
