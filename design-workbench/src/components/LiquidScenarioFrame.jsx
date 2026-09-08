import { useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import LiquidGlass from 'liquid-glass-react';

export default function LiquidScenarioFrame({ children, stateKey }) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef(null);

  return (
    <motion.div
      ref={containerRef}
      className="liquid-scenario-motion"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.975 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion
        ? { duration: 0.16 }
        : { type: 'spring', bounce: 0, duration: 0.42 }}
    >
      <LiquidGlass
        key={stateKey}
        className="liquid-scenario-shell"
        displacementScale={reduceMotion ? 0 : 42}
        blurAmount={0.16}
        saturation={148}
        aberrationIntensity={reduceMotion ? 0 : 1.15}
        elasticity={reduceMotion ? 0 : 0.045}
        cornerRadius={18}
        padding="0"
        mode="standard"
        mouseContainer={containerRef}
        style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%' }}
      ><span aria-hidden="true" /></LiquidGlass>
      {children}
    </motion.div>
  );
}
