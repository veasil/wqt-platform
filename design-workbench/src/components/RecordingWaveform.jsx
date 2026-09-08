import { useEffect, useRef } from 'react';
import { recordingService } from '../services/recordingService';

function drawIdle(context, width, height, color) {
  context.clearRect(0, 0, width, height);
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.setLineDash([3, 5]);
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  context.setLineDash([]);
}

export default function RecordingWaveform({ active, compact = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let frame = 0;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const context = canvas.getContext('2d');
      if (!active) {
        drawIdle(context, width, height, 'rgba(128, 151, 190, .48)');
      } else {
        const samples = recordingService.sampleWaveform(compact ? 48 : 96);
        if (!samples) drawIdle(context, width, height, 'rgba(255, 86, 155, .55)');
        else {
          context.clearRect(0, 0, width, height);
          const gradient = context.createLinearGradient(0, 0, width, 0);
          gradient.addColorStop(0, '#6b7dff');
          gradient.addColorStop(.5, '#2bd9ff');
          gradient.addColorStop(1, '#ff569b');
          context.strokeStyle = gradient;
          context.shadowColor = 'rgba(43, 217, 255, .5)';
          context.shadowBlur = 6 * dpr;
          context.lineWidth = (compact ? 1.25 : 1.7) * dpr;
          context.beginPath();
          samples.forEach((sample, index) => {
            const x = (index / Math.max(1, samples.length - 1)) * width;
            const y = height / 2 + sample * height * .43;
            if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
          });
          context.stroke();
        }
      }
      frame = window.requestAnimationFrame(render);
    };
    render();
    return () => window.cancelAnimationFrame(frame);
  }, [active, compact]);

  return <canvas className={`recording-waveform ${active ? 'is-live' : ''} ${compact ? 'is-compact' : ''}`} ref={canvasRef} aria-label={active ? '实时麦克风波形' : '录音未开始'} />;
}
