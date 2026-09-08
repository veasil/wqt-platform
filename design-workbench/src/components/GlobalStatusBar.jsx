import { useEffect, useState } from 'react';

const tabLabels = { game: '桌游模式', supervisor: '监督模式', profile: '我的' };

export default function GlobalStatusBar({ activeTab, game }) {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const sessionState = game.ended
    ? '本局已结束'
    : game.paused
      ? '全局暂停 · 计时与写入已冻结'
      : game.started
        ? '本局同步中'
        : '尚未开始游戏';

  return (
    <div className={`global-status-bar ${!online ? 'offline' : ''} ${game.ended ? 'ended' : game.paused ? 'paused' : ''}`} role="status" aria-live="polite">
      <div className="status-route"><span>当前位置</span><b>{tabLabels[activeTab]}</b></div>
      <div className="status-session"><i />{sessionState}</div>
      <div className="status-detail">
        {game.recording && <span className="recording-pill">● 现场录音中</span>}
        <span className={online ? 'online' : 'offline'}>{online ? '网络已连接 · 自动保存' : '当前离线 · 恢复后自动重试'}</span>
      </div>
    </div>
  );
}
