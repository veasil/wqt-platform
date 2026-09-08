import { POWER_META } from '../data/gameData';
import RecordingWaveform from './RecordingWaveform';
import { calculatePowerScore } from '../utils/scoring';

function polygon(radius) {
  return POWER_META.map((_, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index / POWER_META.length);
    return `${50 + Math.cos(angle) * radius},${50 + Math.sin(angle) * radius}`;
  }).join(' ');
}

function Radar({ values, maxScores }) {
  const valuePoints = POWER_META.map((power, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index / POWER_META.length);
    const max = Number(maxScores?.[power.name]) || 1;
    const radius = 36 * Math.max(0, Math.min(values[power.key] / max, 1));
    return `${50 + Math.cos(angle) * radius},${50 + Math.sin(angle) * radius}`;
  }).join(' ');

  return (
    <svg className="radar-chart" viewBox="0 0 100 100" role="img" aria-label="五力雷达图">
      {[16, 24, 32, 40].map((radius) => <polygon key={radius} points={polygon(radius)} />)}
      {POWER_META.map((_, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index / POWER_META.length);
        return <line key={index} x1="50" y1="50" x2={50 + Math.cos(angle) * 40} y2={50 + Math.sin(angle) * 40} />;
      })}
      <polygon className="radar-value" points={valuePoints} />
      {POWER_META.map((power, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index / POWER_META.length);
        return <text key={power.key} x={50 + Math.cos(angle) * 47} y={52 + Math.sin(angle) * 47}>{power.code}</text>;
      })}
    </svg>
  );
}

export default function SupervisorMode({ game, actions }) {
  const configuredTotal = game.activity.phaseTargets.reduce((sum, value) => sum + value, 0);
  const total = configuredTotal || game.totalCardCount || 0;
  const completed = Object.values(game.phaseProgress).reduce((sum, value) => sum + value, 0);
  const score = calculatePowerScore(game.powers, game.maxScores);
  const scoreByPower = new Map(score.details.map((item) => [item.key, item]));
  const sessionStatus = game.ended ? '已结束' : game.paused ? '已暂停' : '进行中';
  const phaseName = ['启蒙期', '成长期', '青春期'][game.currentPhase] || '—';

  return (
    <main className={`supervisor-page ${game.ended ? 'is-ended' : game.paused ? 'is-paused' : 'is-live'}`}>
      <div className="monitor-strip" role="status" aria-live="polite">
        <span className={game.ended ? 'archived' : ''}><i />{game.ended ? '会话已封存' : '会话在线'}<b>#{game.sessionId || '—'}</b></span>
        <span className={game.ended ? 'archived' : ''}><i />事件写入<b>{game.ended ? '已封存' : '正常'}</b></span>
        <span className={game.recording ? 'recording' : ''}><i />现场录音<b>{game.recording ? '记录中' : game.lastRecording ? '已归档' : '未开启'}</b></span>
        <span className={game.ended ? 'ended' : game.paused ? 'warning' : ''}><i />本局状态<b>{sessionStatus}</b></span>
      </div>

      <section className="supervisor-grid">
        <article className="radar-panel panel-shell">
          <header><span>伍力综合观察</span><b>{completed}/{total || '—'} 张已完成</b></header>
          <div className="radar-panel-body">
            <div className="radar-insights">
              <div className="score-summary">
                <span>伍力综合得分率</span>
                <b>{score.percent}<small>%</small></b>
                <div role="progressbar" aria-label="伍力综合得分率" aria-valuemin="0" aria-valuemax="100" aria-valuenow={score.percent}>
                  <i style={{ width: `${score.percent}%` }} />
                </div>
              </div>
              <div className="radar-legend">
                {POWER_META.map((power) => {
                  const detail = scoreByPower.get(power.key);
                  const rate = Math.round((detail?.rate || 0) * 100);
                  return (
                    <span key={power.key} style={{ '--power': power.color }}>
                      <i />{power.name}
                      <b>{game.powers[power.key]}<small> / {detail?.max || '—'}</small></b>
                      <em><i style={{ width: `${rate}%` }} /></em>
                    </span>
                  );
                })}
              </div>
            </div>
            <Radar values={game.powers} maxScores={game.maxScores} />
          </div>
        </article>

        <article className="control-panel panel-shell">
          <header>
            <div className="control-title">
              <span>伍力控制</span>
              <details className="control-help">
                <summary aria-label="查看伍力控制说明" title="查看伍力控制说明">!</summary>
                <p>{game.ended ? '本局结束后数据只读，避免复盘分数被再次改写。' : '每次调整都会记录督导身份、前后数值与时间，可在操作与审计历史中追溯。'}</p>
              </details>
            </div>
            {game.ended ? <b>本局已锁定</b> : null}
          </header>
          <div className="power-control-list">
            {POWER_META.map((power) => (
              <div key={power.key} style={{ '--power': power.color }}>
                <span><i>{power.code}</i><b>{power.name}</b></span>
                <button aria-label={`${power.name}减一分`} disabled={game.paused || game.ended} type="button" onClick={() => actions.adjustPower(power.key, -1)}>−</button>
                <strong>{String(game.powers[power.key]).padStart(2, '0')}</strong>
                <button aria-label={`${power.name}加一分`} disabled={game.paused || game.ended} type="button" onClick={() => actions.adjustPower(power.key, 1)}>＋</button>
              </div>
            ))}
          </div>
        </article>

        <article className="history-panel panel-shell">
          <header><span>操作与审计历史</span><b>{game.history.length} 条</b></header>
          <div className="history-list">
            {game.history.length ? game.history.map((entry, index) => (
              <div className={entry.reason ? 'has-reason' : ''} key={`${entry.time}-${index}`}>
                <time>{entry.time}</time>
                <div className="history-copy">
                  <b>{entry.title}</b>
                  <span>{entry.detail}</span>
                  {entry.reason && (
                    <details>
                      <summary>查看伍力理由</summary>
                      <p>{entry.reason}</p>
                      {entry.consequence && <small><b>结果反馈</b>{entry.consequence}</small>}
                    </details>
                  )}
                </div>
                <em>{entry.value}</em>
              </div>
            )) : (
              <div className="history-empty"><span>暂无操作记录</span></div>
            )}
          </div>
        </article>

        <article className="live-status panel-shell">
          <header><span>游戏状态</span><b className={game.ended ? 'ended' : game.paused ? 'paused' : ''}>{sessionStatus}</b></header>
          <div className="status-metrics">
            <div><span>活动码</span><b>{game.activity.code}</b></div>
            <div><span>当前时期</span><b>{phaseName}</b></div>
            <div><span>卡牌版本</span><b>{game.activity.deckVersion}</b></div>
            <div><span>现场录音</span><b>{game.recording ? '记录中' : game.lastRecording ? '已归档' : '未开启'}</b></div>
          </div>
          <RecordingWaveform active={game.recording && !game.ended} compact />
          <button type="button" disabled={game.ended} onClick={actions.togglePause}>{game.ended ? '本局已结束' : game.paused ? '继续游戏' : '暂停游戏'}</button>
        </article>
      </section>
    </main>
  );
}
