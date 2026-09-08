import { useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import LiquidGlass from 'liquid-glass-react';
import logo from '../../assets/logo.png';

const tabs = [['game', '桌游模式', 'PLAY'], ['supervisor', '监督模式', 'WATCH'], ['profile', '我的', 'ME']];

export default function BrandHeader({ activeTab, onTabChange, user, timer, paused, ended }) {
  const reduceMotion = useReducedMotion();
  const navigationRef = useRef(null);

  return (
    <header className="brand-header">
      <button className="brand-lockup" type="button" onClick={() => onTabChange('game')} aria-label="返回桌游模式">
        <img src={logo} alt="伍力全开" />
        <span><b>AI@5000days</b><small>《伍力全开》桌游计分系统</small></span>
      </button>
      <div className="primary-tabs-stage" ref={navigationRef}>
        <LiquidGlass
          className="primary-tabs-glass"
          displacementScale={reduceMotion ? 0 : 34}
          blurAmount={0.18}
          saturation={152}
          aberrationIntensity={reduceMotion ? 0 : 0.85}
          elasticity={reduceMotion ? 0 : 0.035}
          cornerRadius={18}
          padding="0"
          mode="standard"
          mouseContainer={navigationRef}
          style={{ position: 'absolute', top: '50%', left: '50%', width: '100%' }}
        >
          <nav className="primary-tabs" aria-label="主导航">
            {tabs.map(([key, label, code]) => {
              const active = activeTab === key;
              return (
                <button key={key} className={active ? 'active' : ''} type="button" aria-current={active ? 'page' : undefined} onClick={() => onTabChange(key)}>
                  {active ? <motion.i className="primary-tab-indicator" layoutId="primary-tab-indicator" transition={reduceMotion ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.36 }} /> : null}
                  <small>{code}</small><span>{label}</span>
                </button>
              );
            })}
          </nav>
        </LiquidGlass>
      </div>
      <div className="header-status">
        <div className={`timer ${ended ? 'ended' : paused ? 'paused' : ''}`}><i /><span>{ended ? '本局已结束' : paused ? '计时已冻结' : '本局剩余'}</span><strong>{timer}</strong></div>
        <button className="user-chip" type="button" onClick={() => onTabChange('profile')}><span>{user.name.slice(0, 1)}</span><b>{user.name}<small>{user.role}</small></b></button>
      </div>
    </header>
  );
}
