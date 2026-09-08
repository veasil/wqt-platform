import { useCallback, useEffect, useRef, useState } from 'react';
import { gameService } from '../services/gameService';
import { getCardAudioElement, speakLocally, stopLocalSpeech } from '../services/cardAudioPlayer';

const labels = {
  preparing: '生成语音中…',
  loading: '加载语音中…',
  playing: 'Ⅱ 正在播放',
  paused: '▶ 继续播放',
  ready: '▶ 听情境语音',
  error: '↻ 重试语音',
};

export default function CardAudioButton({ card, sessionId, gamePaused }) {
  const audioRef = useRef(null);
  const requestRef = useRef(0);
  const pausedRef = useRef(gamePaused);
  const localSpeechRef = useRef(null);
  const [status, setStatus] = useState('preparing');

  useEffect(() => { pausedRef.current = gamePaused; if (gamePaused && audioRef.current) audioRef.current.pause(); if (gamePaused && localSpeechRef.current) stopLocalSpeech(); }, [gamePaused]);

  const stopAudio = useCallback(() => {
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
    audio.removeAttribute('src');
    audio.load();
  }, []);

  const prepare = useCallback(async (autoPlay) => {
    const requestId = ++requestRef.current;
    stopAudio();
    setStatus('preparing');
    try {
      const result = await gameService.prepareCardAudio(sessionId, card.grantId);
      if (requestId !== requestRef.current) return;
      setStatus('loading');
      const audio = getCardAudioElement();
      audio.muted = false;
      audio.src = result.audioUrl;
      audio.preload = 'auto';
      audio.oncanplay = async () => {
        if (requestId !== requestRef.current) return;
        setStatus('ready');
        if (autoPlay && !pausedRef.current) {
          try { await audio.play(); } catch { setStatus('ready'); }
        }
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
      if (autoPlay && !pausedRef.current) {
        localSpeechRef.current = speakLocally(`${card.title}。${card.text}`, { onStart: () => setStatus('playing'), onEnd: () => { localSpeechRef.current = null; setStatus('ready'); }, onError: () => setStatus('error') });
        if (!localSpeechRef.current) setStatus('error');
      } else setStatus('ready');
    }
  }, [card.grantId, card.text, card.title, sessionId, stopAudio]);

  useEffect(() => {
    prepare(true);
    return () => { requestRef.current += 1; stopAudio(); };
  }, [prepare, stopAudio]);

  async function toggle() {
    const audio = audioRef.current;
    if (status === 'error') { await prepare(true); return; }
    if (!audio && status === 'ready') {
      localSpeechRef.current = speakLocally(`${card.title}。${card.text}`, { onStart: () => setStatus('playing'), onEnd: () => { localSpeechRef.current = null; setStatus('ready'); }, onError: () => setStatus('error') });
      if (!localSpeechRef.current) setStatus('error');
      return;
    }
    if (!audio && status === 'playing' && localSpeechRef.current) { stopLocalSpeech(); localSpeechRef.current = null; setStatus('ready'); return; }
    if (!audio || status === 'preparing' || status === 'loading') return;
    if (!audio.paused) { audio.pause(); return; }
    try { await audio.play(); } catch { setStatus('error'); }
  }

  return <button className={`card-audio ${status}`} type="button" disabled={status === 'preparing' || status === 'loading'} onClick={toggle} aria-live="polite"><i />{labels[status] || labels.ready}</button>;
}
