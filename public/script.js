document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const form = document.getElementById('parseForm');
    const urlInput = document.getElementById('url');
    const appIdInput = document.getElementById('appId');
    const appSecretInput = document.getElementById('appSecret');
    const appTokenInput = document.getElementById('appToken');
    const submitBtn = document.getElementById('submitBtn');
    const continueBtn = document.getElementById('continueBtn');
    const stopBtn = document.getElementById('stopBtn');
    const checkpointInfo = document.getElementById('checkpointInfo');
    const checkpointText = document.getElementById('checkpointText');
    const statusContainer = document.getElementById('statusContainer');
    
    // Result Details
    const coverImg = document.getElementById('coverImg');
    const likesCount = document.getElementById('likesCount');
    const commentsCount = document.getElementById('commentsCount');
    const favoritesCount = document.getElementById('favoritesCount');
    const sharesCount = document.getElementById('sharesCount');
    const videoTitle = document.getElementById('videoTitle');
    const videoTranscript = document.getElementById('videoTranscript');
    const copyBtn = document.getElementById('copyBtn');

    let hasCheckpoint = false;
    let checkTimeout;

    urlInput.addEventListener('input', () => {
        clearTimeout(checkTimeout);
        let url = urlInput.value.trim();

        checkpointInfo.classList.add('hidden');
        continueBtn.classList.add('hidden');
        hasCheckpoint = false;
        
        if (!url || (!url.includes('douyin.com') && !url.includes('v.douyin.com'))) return;

        checkTimeout = setTimeout(async () => {
            try {
                // Check if a background job is already running for this URL
                const cpRes = await fetch(`/api/checkpoint?url=${encodeURIComponent(url)}`);
                const cpData = await cpRes.json();
                
                if (cpData.success && cpData.isRunning) {
                    hasCheckpoint = true;
                    checkpointText.textContent = `该链接的后台解析任务正在执行中...您可以点击「继续执行」重新连接以查看实时进度。`;
                    checkpointInfo.classList.remove('hidden');
                    continueBtn.classList.remove('hidden');
                } else if (cpData.success && cpData.exists && cpData.data && cpData.data.completed) {
                    hasCheckpoint = true;
                    checkpointText.textContent = `该视频之前已成功解析，您可以点击「继续执行」直接恢复结果。`;
                    checkpointInfo.classList.remove('hidden');
                    continueBtn.classList.remove('hidden');
                }
            } catch (e) {}
        }, 500);
    });

    const spinner = document.getElementById('spinner');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const progressWrapper = document.getElementById('progressWrapper');
    const progressBar = document.getElementById('progressBar');
    const resultBox = document.getElementById('resultBox');
    const errorBox = document.getElementById('errorBox');
    const errorMsg = document.getElementById('errorMsg');
    const retryBtn = document.getElementById('retryBtn');
    const resultCount = document.getElementById('resultCount');
    const bitableLink = document.getElementById('bitableLink');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const historyList = document.getElementById('historyList');
    const emptyHistory = document.getElementById('emptyHistory');

    let eventSource = null;

    // Load saved credentials & history
    const loadState = () => {
        appIdInput.value = localStorage.getItem('douyin_app_id') || 'cli_a963a8c6d0785bd4';
        appSecretInput.value = localStorage.getItem('douyin_app_secret') || '';
        appTokenInput.value = localStorage.getItem('douyin_app_token') || 'FDqZF0JFeE7nhwlQ1SoJChuVEN1HLcbs';
        renderHistory();
    };

    const saveState = () => {
        localStorage.setItem('douyin_app_id', appIdInput.value);
        localStorage.setItem('douyin_app_secret', appSecretInput.value);
        localStorage.setItem('douyin_app_token', appTokenInput.value);
    };

    const addHistory = (url, tableUrl, count) => {
        let history = JSON.parse(localStorage.getItem('douyin_single_history') || '[]');
        history.unshift({
            url: url.substring(0, 50) + '...',
            tableUrl,
            count,
            date: new Date().toLocaleString()
        });
        if (history.length > 6) history.pop();
        localStorage.setItem('douyin_single_history', JSON.stringify(history));
        renderHistory();
    };

    const renderHistory = () => {
        const history = JSON.parse(localStorage.getItem('douyin_single_history') || '[]');
        historyList.innerHTML = '';
        if (history.length === 0) {
            emptyHistory.style.display = 'block';
        } else {
            emptyHistory.style.display = 'none';
            history.forEach(item => {
                const card = document.createElement('a');
                card.href = item.tableUrl;
                card.target = '_blank';
                card.className = 'glass-panel p-4 rounded-xl hover:bg-slate-800/50 transition-colors border border-slate-700/50 group block relative overflow-hidden';
                card.innerHTML = `
                    <div class="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-blue-500 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <p class="text-slate-300 text-xs truncate mb-2">${item.url}</p>
                    <div class="flex items-center justify-between">
                        <span class="text-white font-bold text-sm flex items-center gap-1">
                            <svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            ${item.count} 条数据
                        </span>
                        <span class="text-slate-500 text-[10px]">${item.date}</span>
                    </div>
                `;
                historyList.appendChild(card);
            });
        }
    };

    const formatNumber = (num) => {
        if (!num) return '0';
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + 'w';
        }
        return num.toString();
    };

    // UI State Management
    const setUIState = (state, message = '', extra = null) => {
        statusContainer.classList.remove('hidden');
        void statusContainer.offsetWidth;
        statusContainer.classList.remove('opacity-0', 'translate-y-4');
        
        switch(state) {
            case 'loading':
                submitBtn.disabled = true;
                continueBtn.disabled = true;
                stopBtn.disabled = false;
                spinner.classList.remove('hidden');
                statusIcon.classList.add('hidden');
                resultBox.classList.add('hidden');
                errorBox.classList.add('hidden');
                progressWrapper.classList.remove('hidden');
                statusText.className = 'text-lg font-medium text-blue-400 glow-text';
                statusText.textContent = message;
                break;
            case 'success':
                submitBtn.disabled = false;
                continueBtn.disabled = false;
                stopBtn.disabled = true;
                spinner.classList.add('hidden');
                statusIcon.classList.remove('hidden');
                statusIcon.innerHTML = `<svg class="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
                progressWrapper.classList.add('hidden');
                resultBox.classList.remove('hidden');
                errorBox.classList.add('hidden');
                statusText.className = 'text-lg font-medium text-green-400 glow-text';
                statusText.textContent = message;
                
                checkpointInfo.classList.add('hidden');
                continueBtn.classList.add('hidden');
                hasCheckpoint = false;
                
                if (extra) {
                    resultCount.textContent = extra.count;
                    bitableLink.href = extra.url;
                    copyLinkBtn.dataset.url = extra.url;
                    addHistory(urlInput.value, extra.url, extra.count);

                    if (extra.videoData) {
                        const data = extra.videoData;
                        coverImg.src = data.coverUrl || 'https://via.placeholder.com/300x500?text=暂无封面';
                        likesCount.textContent = formatNumber(data.likes);
                        commentsCount.textContent = formatNumber(data.comments);
                        favoritesCount.textContent = formatNumber(data.favorites);
                        sharesCount.textContent = formatNumber(data.shares);
                        videoTitle.textContent = data.title || '暂无标题';
                        videoTranscript.textContent = data.transcript || '暂无文案';
                    }
                }
                break;
            case 'error':
                submitBtn.disabled = false;
                continueBtn.disabled = false;
                stopBtn.disabled = true;
                spinner.classList.add('hidden');
                statusIcon.classList.remove('hidden');
                statusIcon.innerHTML = `<svg class="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
                progressWrapper.classList.add('hidden');
                resultBox.classList.add('hidden');
                errorBox.classList.remove('hidden');
                errorMsg.textContent = message;
                statusText.className = 'text-lg font-medium text-red-400 glow-text';
                statusText.textContent = message.includes('中止') ? '任务已取消' : '解析中断';
                break;
        }
    };

    const updateProgress = (stage, message) => {
        statusText.textContent = message;
        let percent = 10;
        switch(stage) {
            case 'connecting': percent = 10; break;
            case 'extracting': percent = 40; break;
            case 'processing': percent = 70; break;
            case 'uploading': percent = 90; break;
        }
        progressBar.style.width = `${percent}%`;
    };

    // Form Submission (Start SSE)
    const startScraping = (resume = true) => {
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        if (!resume && hasCheckpoint) {
            const confirmRestart = confirm("发现已有的解析记录，开始全新解析将覆盖数据。确定要重新开始吗？");
            if (!confirmRestart) return;
        }

        let url = urlInput.value.trim();
        const appId = appIdInput.value.trim();
        const appSecret = appSecretInput.value.trim();
        const appToken = appTokenInput.value.trim();

        if (!url || (!url.includes('douyin.com') && !url.includes('v.douyin.com'))) {
            alert('请输入有效的抖音视频链接');
            return;
        }

        saveState();
        setUIState('loading', '正在建立安全连接...');
        progressBar.style.width = '5%';
        checkpointInfo.classList.add('hidden');
        continueBtn.classList.add('hidden');

        if (eventSource) {
            eventSource.close();
        }

        const query = new URLSearchParams({ url, appId, appSecret, appToken, resume: resume.toString() });
        eventSource = new EventSource(`/api/parse/stream?${query.toString()}`);

        let isIntentionalClose = false;

        eventSource.addEventListener('progress', (e) => {
            try {
                const data = JSON.parse(e.data);
                updateProgress(data.stage, data.message);
                console.log(`[SSE PROGRESS] ${data.stage}: ${data.message}`);
            } catch(err) {
                console.error('[SSE PARSE ERROR]', err);
            }
        });

        eventSource.addEventListener('success', (e) => {
            try {
                const data = JSON.parse(e.data);
                setUIState('success', data.message, { 
                    count: 1, 
                    url: data.url,
                    videoData: data.videoData
                });
                console.log(`[SSE SUCCESS] ${data.message}`);
            } catch(err) {
                console.error('[SSE PARSE ERROR]', err);
            }
            isIntentionalClose = true;
            eventSource.close();
        });

        eventSource.addEventListener('error', (e) => {
            let msg = '服务器连接中断或发生未知错误。';
            try {
                const data = JSON.parse(e.data);
                if (data.message) msg = data.message;
                console.error(`[SSE BACKEND ERROR] ${msg}`, data.stack || '');
            } catch(err) {
                console.error('[SSE PARSE ERROR]', err, e.data);
            }
            setUIState('error', msg);
            isIntentionalClose = true;
            eventSource.close();
        });

        eventSource.onerror = (e) => {
            if (eventSource.readyState === EventSource.CLOSED && !isIntentionalClose) {
                console.error('[SSE NETWORK ERROR] Connection dropped or timed out.', e);
                setUIState('error', '服务器连接已断开，可能是任务超时或被强制终止。');
            }
        };
    };

    stopBtn.addEventListener('click', async () => {
        if (eventSource) {
            isIntentionalClose = true;
            eventSource.close();
            eventSource = null;
            
            try {
                await fetch('/api/batch/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: urlInput.value.trim() })
                });
            } catch (e) {}

            setUIState('error', '解析任务已由用户主动中止。');
            
            if (hasCheckpoint) {
                checkpointInfo.classList.remove('hidden');
                continueBtn.classList.remove('hidden');
            }
        }
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        startScraping(false);
    });

    continueBtn.addEventListener('click', () => {
        startScraping(true);
    });

    retryBtn.addEventListener('click', () => {
        startScraping(true);
    });

    copyLinkBtn.addEventListener('click', () => {
        const url = copyLinkBtn.dataset.url;
        if (!url) return;
        navigator.clipboard.writeText(url).then(() => {
            const origText = copyLinkBtn.textContent;
            copyLinkBtn.textContent = '已复制';
            copyLinkBtn.classList.replace('bg-slate-700', 'bg-blue-600');
            setTimeout(() => {
                copyLinkBtn.textContent = origText;
                copyLinkBtn.classList.replace('bg-blue-600', 'bg-slate-700');
            }, 2000);
        });
    });

    copyBtn.addEventListener('click', () => {
        const text = videoTranscript.textContent;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '已复制！';
            copyBtn.classList.add('text-blue-300');
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.classList.remove('text-blue-300');
            }, 2000);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.metaKey) {
            startScraping();
        }
    });

    loadState();
    urlInput.focus();
});
