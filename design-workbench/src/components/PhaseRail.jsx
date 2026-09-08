import { PHASES } from '../data/gameData';

export default function PhaseRail({ targets, progress, currentPhase }) {
  return (
    <div className="phase-rail" aria-label="时期进度">
      {PHASES.map((phase, index) => {
        const done = progress[phase] || 0;
        const target = targets[index];
        return (
          <div key={phase} className={`phase-step ${index === currentPhase ? 'active' : ''} ${done >= target ? 'complete' : ''}`}>
            <div className="phase-copy"><span>{phase}</span><b>{done >= target ? '已完成' : `还差 ${target - done} 张`}</b></div>
            <div className="phase-dots">{Array.from({ length: target }, (_, dot) => <i key={dot} className={dot < done ? 'filled' : ''} />)}</div>
          </div>
        );
      })}
    </div>
  );
}
