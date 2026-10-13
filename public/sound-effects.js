// 高级音效系统
class SoundEffects {
    constructor() {
        this.audioContext = null;
        this.initAudioContext();
    }

    initAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) {
            console.warn('Web Audio API not supported');
        }
    }

    // 鸿蒙 ArkWeb / Chromium 的自动播放策略：AudioContext 初始为 'suspended'，
    // 必须在用户手势中 resume() 才会出声。需在首次点击/触摸时调用。
    unlock() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
        }
    }

    // 创建复合音色
    createChord(frequencies, type = 'triangle', duration = 0.3, delay = 0) {
        if (!this.audioContext) return;
        
        setTimeout(() => {
            frequencies.forEach((freq, index) => {
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                const filter = this.audioContext.createBiquadFilter();
                
                oscillator.connect(filter);
                filter.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                
                oscillator.frequency.value = freq;
                oscillator.type = type;
                
                // 滤波器设置
                filter.type = 'lowpass';
                filter.frequency.value = freq * 2;
                filter.Q.value = 1;
                
                // ADSR包络
                const now = this.audioContext.currentTime;
                const attack = 0.02;
                const decay = 0.1;
                const sustain = 0.6;
                const release = duration - attack - decay;
                
                gainNode.gain.setValueAtTime(0, now);
                gainNode.gain.linearRampToValueAtTime(0.2 / frequencies.length, now + attack);
                gainNode.gain.linearRampToValueAtTime(sustain * 0.2 / frequencies.length, now + attack + decay);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);
                
                oscillator.start(now);
                oscillator.stop(now + duration);
            });
        }, delay);
    }

    // 创建真实鼓掌音效
    createClap(delay = 0) {
        if (!this.audioContext) return;
        
        setTimeout(() => {
            // 多层噪声模拟真实鼓掌
            const layers = [
                { freq: 1000, q: 2, gain: 0.4, decay: 0.02 },  // 主要冲击
                { freq: 2500, q: 3, gain: 0.3, decay: 0.015 }, // 高频脆响
                { freq: 500, q: 1.5, gain: 0.2, decay: 0.03 }  // 低频厚度
            ];
            
            layers.forEach(layer => {
                const bufferSize = this.audioContext.sampleRate * 0.08;
                const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
                const data = buffer.getChannelData(0);
                
                // 生成更复杂的噪声模式
                for (let i = 0; i < bufferSize; i++) {
                    const t = i / bufferSize;
                    const envelope = Math.exp(-t / layer.decay);
                    const noise = (Math.random() * 2 - 1);
                    // 添加一些周期性变化模拟手掌拍击
                    const modulation = 1 + 0.3 * Math.sin(t * Math.PI * 40);
                    data[i] = noise * envelope * modulation;
                }
                
                const source = this.audioContext.createBufferSource();
                const gainNode = this.audioContext.createGain();
                const filter = this.audioContext.createBiquadFilter();
                const compressor = this.audioContext.createDynamicsCompressor();
                
                source.buffer = buffer;
                source.connect(filter);
                filter.connect(compressor);
                compressor.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                
                filter.type = 'bandpass';
                filter.frequency.value = layer.freq;
                filter.Q.value = layer.q;
                
                // 压缩器设置
                compressor.threshold.value = -20;
                compressor.knee.value = 5;
                compressor.ratio.value = 8;
                compressor.attack.value = 0.001;
                compressor.release.value = 0.01;
                
                gainNode.gain.setValueAtTime(layer.gain, this.audioContext.currentTime);
                
                source.start();
            });
        }, delay);
    }

    // 创建Bling效果 - 亮晶晶泛音
    createBling(frequency, duration = 0.3, delay = 0) {
        if (!this.audioContext) return;
        
        setTimeout(() => {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();
            
            oscillator.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';
            
            // 高通滤波器增强亮度
            filter.type = 'highpass';
            filter.frequency.value = frequency * 0.8;
            filter.Q.value = 3;
            
            const now = this.audioContext.currentTime;
            // 快速攻击，慢衰减的包络
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(0.4, now + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);
            
            oscillator.start(now);
            oscillator.stop(now + duration);
        }, delay);
    }

    // 创建带颤音和bit-crush的音符
    createVibratoTone(frequency, duration = 0.2, delay = 0, vibratoRate = 5) {
        if (!this.audioContext) return;
        
        setTimeout(() => {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            const vibrato = this.audioContext.createOscillator();
            const vibratoGain = this.audioContext.createGain();
            const waveshaper = this.audioContext.createWaveShaper();
            
            // Bit-crush效果
            const samples = 256;
            const curve = new Float32Array(samples);
            for (let i = 0; i < samples; i++) {
                const x = (i * 2) / samples - 1;
                curve[i] = Math.sign(x) * Math.pow(Math.abs(x), 0.8) * 0.9;
            }
            waveshaper.curve = curve;
            waveshaper.oversample = '2x';
            
            // 主音符
            oscillator.type = 'triangle';
            oscillator.frequency.value = frequency;
            
            // 颤音LFO
            vibrato.type = 'sine';
            vibrato.frequency.value = vibratoRate;
            vibrato.connect(vibratoGain);
            vibratoGain.gain.value = 8;
            vibratoGain.connect(oscillator.frequency);
            
            oscillator.connect(waveshaper);
            waveshaper.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            const now = this.audioContext.currentTime;
            gainNode.gain.setValueAtTime(0.25, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);
            
            oscillator.start(now);
            vibrato.start(now);
            oscillator.stop(now + duration);
            vibrato.stop(now + duration);
        }, delay);
    }

    // 升级音效 - 阳光灿烂的和弦
    playUpgrade() {
        // 四个上升音符，每个都是和弦
        this.createChord([261.63, 329.63, 392.00], 'triangle', 0.15, 0);     // C大调和弦
        this.createChord([329.63, 415.30, 493.88], 'triangle', 0.15, 120);   // E大调和弦
        this.createChord([392.00, 493.88, 587.33], 'triangle', 0.15, 240);   // G大调和弦
        this.createChord([523.25, 659.25, 783.99], 'triangle', 0.25, 360);   // C高八度和弦
    }

    // 成功音效 - 庆祝感强烈
    playSuccess() {
        // 主旋律
        this.createChord([523.25, 659.25, 783.99], 'triangle', 0.2, 0);
        this.createChord([659.25, 830.61, 987.77], 'triangle', 0.2, 150);
        this.createChord([783.99, 987.77, 1174.66], 'triangle', 0.2, 300);
        this.createChord([1046.5, 1318.51, 1567.98], 'triangle', 0.4, 450);
        
        // 管乐和弦叠加
        this.createChord([523.25, 784.88, 1046.5], 'sawtooth', 0.3, 100);
        this.createChord([659.25, 988.88, 1318.51], 'sawtooth', 0.3, 250);
        
        // 鼓掌效果 - 连续三次拍手
        this.createClap(500);
        this.createClap(580);
        this.createClap(660);
        
        // Bling效果 - 亮晶晶的高音C泛音
        this.createBling(2093, 0.3, 700); // High C
    }

    // 警告音效 - 圆滚滚带振动和轻微故障感
    playWarning() {
        // 第一组：三次A4 (带bit-crush)
        this.createVibratoTone(440, 0.15, 0, 8);
        this.createVibratoTone(440, 0.15, 200, 8);
        this.createVibratoTone(440, 0.15, 400, 8);
        
        // 停顿后再来一次
        this.createVibratoTone(440, 0.15, 800, 8);
        this.createVibratoTone(440, 0.15, 1000, 8);
        this.createVibratoTone(440, 0.15, 1200, 8);
    }

    // 失败音效 - 下降且减速
    playFailure() {
        const frequencies = [293.66, 261.63, 220.00, 174.61]; // D4-C4-A3-F3
        const durations = [0.2, 0.25, 0.35, 0.5]; // 逐渐变慢
        const delays = [0, 200, 450, 750]; // 间隔逐渐增大
        
        frequencies.forEach((freq, index) => {
            setTimeout(() => {
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                
                oscillator.frequency.value = freq;
                oscillator.type = 'triangle';
                
                const now = this.audioContext.currentTime;
                gainNode.gain.setValueAtTime(0.25, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + durations[index]);
                
                oscillator.start(now);
                oscillator.stop(now + durations[index]);
            }, delays[index]);
        });
    }
}

// 全局音效实例
window.soundEffects = new SoundEffects();

// 首次用户手势时解锁音频（覆盖欢迎页点击穿越、登录、开始游戏等所有入口）。
// once:true 保证只解锁一次；capture 阶段尽早触发。
['click', 'touchstart', 'keydown'].forEach(evt => {
    window.addEventListener(evt, () => window.soundEffects && window.soundEffects.unlock(), { once: true, capture: true });
});

// 兼容原有接口
function playSound(type) {
    switch(type) {
        case 'upgrade':
            window.soundEffects.playUpgrade();
            break;
        case 'success':
            window.soundEffects.playSuccess();
            break;
        case 'failure':
            window.soundEffects.playFailure();
            break;
        case 'warning':
            window.soundEffects.playWarning();
            break;
    }
}