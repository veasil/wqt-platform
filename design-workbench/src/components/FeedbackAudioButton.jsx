import { useCallback, useEffect, useRef, useState } from 'react';
import { gameService } from '../services/gameService';
import { getCardAudioElement, speakLocally, stopLocalSpeech } from '../services/cardAudioPlayer';

const labels = {
  idle: '▶ 听反馈',
  preparing: '生成中…',
  loading: '加载中…',
  playing: 'Ⅱ 暂停',
  paused: '▶ 继续',
  ready: '↻ 重播',
  error: '↻ 重试',
};

export default function FeedbackAudioButton({ feedback, sessionId, gamePaused }) {
  const audioRef = useRef(null);
  const requestRef = useRef(0);
  const localSpeechRef = useRef(null);
  const [status, setStatus] = useState('idle');

  const stop = useCallback(() => {
    if (localSpeechRef.current) { stopLocalSpeech(); localSpeechRef.current = null; }
    if (!audioRef.current) return;
    const audio = audioRef.current;
    audioRef.current = null;
    audio.oncanplay = null;
    audio.onplay = null;
    audio.onpause = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
  }, []);

  useEffect(() => {
    setStatus('idle');
    return () => { requestRef.current += 1; stop(); };
  }, [feedback.feedbackGrantId, stop]);

  useEffect(() => { if (gamePaused && audioRef.current) audioRef.current.pause(); }, [gamePaused]);

  async function prepare() {
    const requestId = ++requestRef.current;
    stop();
    setStatus('preparing');
    try {
      const result = await gameService.prepareFeedbackAudio(sessionId, feedback.feedbackGrantId);
      if (requestId !== requestRef.current) return;
      setStatus('loading');
      const audio = getCardAudioElement();
      audio.muted = false;
      audio.src = result.audioUrl;
      audio.preload = 'auto';
      audio.oncanplay = async () => {
        if (requestId !== requestRef.current) return;
        setStatus('ready');
        try { await audio.play(); } catch { setStatus('ready'); }
        audio.oncanplay = null;
      };
      audio.onplay = () => setStatus('playing');
      audio.onpause = () => setStatus((current) => current === 'playing' ? 'paused' : current);
      audio.onended = () => setStatus('ready');
      audio.onerror = () => setStatus('error');
      audioRef.current = audio;
      audio.load();
    } catch {
      if (requestId !== requestRef.current) return;
      localSpeechRef.current = speakLocally(feedback.copy, { onStart: () => setStatus('playing'), onEnd: () => { localSpeechRef.current = null; setStatus('ready'); }, onError: () => setStatus('error') });
      if (!localSpeechRef.current) setStatus('error');
    }
  }

  async function toggle() {
    if (gamePaused || ['preparing', 'loading'].includes(status)) return;
    if (status === 'idle' || status === 'error') { await prepare(); return; }
    if (!audioRef.current && status === 'ready') {
      localSpeechRef.current = speakLocally(feedback.copy, { onStart: () => setStatus('playing'), onEnd: () => { localSpeechRef.current = null; setStatus('ready'); }, onError: () => setStatus('error') });
      if (!localSpeechRef.current) setStatus('error');
      return;
    }
    if (!audioRef.current && status === 'playing' && localSpeechRef.current) { stopLocalSpeech(); localSpeechRef.current = null; setStatus('ready'); return; }
    if (!audioRef.current) return;
    if (!audioRef.current.paused) { audioRef.current.pause(); return; }
    try { audioRef.current.currentTime = status === 'ready' ? 0 : audioRef.current.currentTime; await audioRef.current.play(); }
    catch { setStatus('error'); }
  }

  return <button className={`feedback-audio ${status}`} type="button" disabled={gamePaused || ['preparing', 'loading'].includes(status)} onClick={toggle} aria-live="polite"><i />{labels[status]}</button>;
}
