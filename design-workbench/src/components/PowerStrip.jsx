import { POWER_META } from '../data/gameData';

export default function PowerStrip({ values, pulseKey }) {
  return (
    <div className="power-strip" aria-label="五力状态">
      {POWER_META.map((power) => <div key={power.key} className={pulseKey === power.key ? 'pulse' : ''} style={{ '--power': power.color }}><span>{power.code}</span><b>{power.name}</b><strong>{String(values[power.key]).padStart(2, '0')}</strong></div>)}
    </div>
  );
}
