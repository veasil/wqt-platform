// 录音功能模块
class AudioRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.animationId = null;
        this.selectedDeviceId = null;
        this.sessionId = null;
        this.uploading = false;
    }

    async checkPermission() {
        try {
            const permission = await navigator.permissions.query({ name: 'microphone' });
            return permission.state;
        } catch (error) {
            return 'prompt';
        }
    }

    async getAudioDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(device => device.kind === 'audioinput');
        } catch (error) {
            console.error('获取设备列表失败:', error);
            return [];
        }
    }

    showDeviceSelector(devices) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';

            const content = document.createElement('div');
            content.style.cssText = 'background:white;padding:20px;border-radius:10px;max-width:400px;width:90%';

            content.innerHTML = `
                <h3>选择麦克风设备</h3>
                <select id="device-select" style="width:100%;padding:8px;margin:10px 0">
                    ${devices.map(device =>
                `<option value="${device.deviceId}">${device.label || '麦克风 ' + (devices.indexOf(device) + 1)}</option>`
            ).join('')}
                </select>
                <div style="text-align:right;margin-top:15px">
                    <button id="cancel-btn" style="margin-right:10px;padding:8px 16px">取消</button>
                    <button id="confirm-btn" style="padding:8px 16px;background:#007bff;color:white;border:none;border-radius:4px">确认</button>
                </div>
            `;

            modal.appendChild(content);
            document.body.appendChild(modal);

            content.querySelector('#cancel-btn').onclick = () => {
                document.body.removeChild(modal);
                resolve(null);
            };

            content.querySelector('#confirm-btn').onclick = () => {
                const deviceId = content.querySelector('#device-select').value;
                document.body.removeChild(modal);
                resolve(deviceId);
            };
        });
    }

    showPermissionTip() {
        alert('请点击浏览器地址栏右侧的麦克风图标 → 允许录音\n\n如果没有看到麦克风图标，请刷新页面后重试。');
    }

    async startRecording() {
        if (this.isRecording || this.uploading) return false;
        try {
            this.sessionId = window.GameReview?.getSessionId?.() || Number(sessionStorage.getItem('WQT_SESSION_ID')) || null;
            if (!this.sessionId) {
                alert('请先开局后再录音');
                return false;
            }
            const recordingSessionId = this.sessionId;
            // 检查权限
            const permission = await this.checkPermission();
            if (permission === 'denied') {
                this.showPermissionTip();
                return false;
            }

            // 获取设备列表
            const devices = await this.getAudioDevices();
            if (devices.length > 1 && !this.selectedDeviceId) {
                this.selectedDeviceId = await this.showDeviceSelector(devices);
                if (!this.selectedDeviceId) return false;
            }

            const constraints = {
                audio: this.selectedDeviceId ? { deviceId: this.selectedDeviceId } : true
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = event => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = () => {
                this.uploading = true;
                this.uploadRecording(recordingSessionId);
                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            };

            // 设置音频分析
            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            source.connect(this.analyser);

            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            this.mediaRecorder.start();
            this.isRecording = true;

            return true;
        } catch (error) {
            console.error('录音失败:', error);
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                this.showPermissionTip();
            }
            return false;
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.uploading = true;
            this.mediaRecorder.stop();
            this.isRecording = false;
            cancelAnimationFrame(this.animationId);
        }
    }

    async uploadRecording(sessionId = this.sessionId) {
        if (!this.audioChunks.length) { this.uploading = false; return; }

        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });

        // 创建 FormData
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");
        formData.append("sessionId", String(sessionId));

        try {
            // 获取 token
            const token = localStorage.getItem("WQT_AUTH_TOKEN");
            if (!token) {
                alert("请先登录，录音无法上传");
                this.saveRecordingLocally(audioBlob);
                return;
            }

            const res = await fetch("api/upload/audio", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`
                },
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                console.log("✅ 录音上传成功:", data.url);
                // 在进度展示区显示下载按钮；会话文件必须通过带认证的 fetch 获取
                const progressBox = document.getElementById('progress-display');
                if (progressBox) {
                    progressBox.innerHTML = `
                        <p style="color: #28a745; margin-bottom: 5px;">🎤 录音已上传成功！</p>
                        <button id="audio-download-file" type="button" style="color:#007bff;background:none;border:0;padding:0;cursor:pointer;font-size:12px;">下载录音（需登录）</button>
                    `;
                    const button = progressBox.querySelector('#audio-download-file');
                    button.onclick = async () => {
                        const { downloadSessionFile } = await import('/session-files.js');
                        await downloadSessionFile(data.url, { filename: '游戏录音.webm' });
                    };
                }
            } else {
                const err = await res.json();
                console.error("❌ 上传失败:", err);
                alert("录音上传至服务器失败，已尝试保存到本地，请检查网络或登录状态");
                this.saveRecordingLocally(audioBlob);
            }
        } catch (error) {
            console.error("❌ 上传出错:", error);
            alert("上传过程中发生错误，录音已保存到本地");
            this.saveRecordingLocally(audioBlob);
        } finally {
            this.uploading = false;
            this.isRecording = false; // 确保状态最终重置
        }
    }

    saveRecordingLocally(audioBlob) {
        const url = URL.createObjectURL(audioBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `游戏录音_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
        a.click();
        URL.revokeObjectURL(url);
    }

    drawWaveform(canvas) {
        if (!this.isRecording || !this.analyser) return;

        const ctx = canvas.getContext('2d');
        this.analyser.getByteFrequencyData(this.dataArray);

        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = canvas.width / this.dataArray.length * 2;
        let x = 0;

        for (let i = 0; i < this.dataArray.length; i++) {
            const barHeight = (this.dataArray[i] / 255) * canvas.height;
            ctx.fillStyle = `hsl(${i * 3}, 100%, 60%)`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }

        this.animationId = requestAnimationFrame(() => this.drawWaveform(canvas));
    }
}
