document.addEventListener('DOMContentLoaded', () => {
    // Determine type from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const scrapeType = urlParams.get('type') || 'profile'; // default to profile

    // Setup UI text based on type
    const navProfile = document.getElementById('navProfile');
    const navRange = document.getElementById('navRange');
    const navMix = document.getElementById('navMix');
    const pageTitle = document.getElementById('pageTitle');
    const pageDesc = document.getElementById('pageDesc');
    const urlLabel = document.getElementById('urlLabel');
    const profileUrlInput = document.getElementById('profileUrl');
    const submitBtnSpan = document.querySelector('#submitBtn span');
    const rangeInputContainer = document.getElementById('rangeInputContainer');
    const startIdxInput = document.getElementById('startIdx');
    const endIdxInput = document.getElementById('endIdx');

    if (scrapeType === 'mix') {
        navProfile.className = 'text-sm font-medium transition-colors border-b-2 px-1 py-1 text-gray-400 border-transparent hover:text-white';
        navRange.className = 'text-sm font-medium transition-colors border-b-2 px-1 py-1 text-gray-400 border-transparent hover:text-white';
        navMix.className = 'text-sm font-medium transition-colors border-b-2 px-1 py-1 text-white border-blue-400';
        
        pageTitle.innerHTML = '合集视频<span class="gradient-text">全量采集</span>';
        pageDesc.textContent = '输入抖音合集链接，我们将全自动提取该合集内的所有视频、AI 语音听写，并实时导入飞书多维表格。';
        urlLabel.textContent = '抖音合集 URL';
        profileUrlInput.placeholder = 'https://www.douyin.com/user/...?showSubTab=compilation&modal_id=...';
        
        const svgHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`;
        submitBtnSpan.innerHTML = svgHTML + ' 开始合集采集';
    } else if (scrapeType === 'range') {
        navProfile.className = 'text-sm font-medium transition-colors border-b-2 px-1 py-1 text-gray-400 border-transparent hover:text-white';
        navMix.className = 'text-sm font-medium transition-colors border-b-2 px-1 py-1 text-gray-400 border-transparent hover:text-white';
        navRange.className = 'text-sm font-medium transition-colors border-b-2 px-1 py-1 text-white border-blue-400';
        
        pageTitle.innerHTML = '博主主页<span class="gradient-text">范围采集</span>';
        pageDesc.textContent = '输入抖音主页链接并指定抓取范围（如第1到第10条视频），我们将为您精准提取指定区间的视频并导入飞书。';
        urlLabel.textContent = '抖音博主主页 URL';
        
        rangeInputContainer.classList.remove('hidden');
        startIdxInput.required = true;
        endIdxInput.required = true;

        const svgHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`;
        submitBtnSpan.innerHTML = svgHTML + ' 开始范围采集';
    } else {
        navMix.className = 'text-sm font-medium transition-colors border-b-2 px-1 py-1 text-gray-400 border-transparent hover:text-white';
        navRange.className = 'text-sm font-medium transition-colors border-b-2 px-1 py-1 text-gray-400 border-transparent hover:text-white';
        navProfile.className = 'text-sm font-medium transition-colors border-b-2 px-1 py-1 text-white border-blue-400';
    }

    // DOM Elements
    const form = document.getElementById('batchForm');
    const appIdInput = document.getElementById('appId');
    const appSecretInput = document.getElementById('appSecret');
    const appTokenInput = document.getElementById('appToken');
    const submitBtn = document.getElementById('submitBtn');
    const continueBtn = document.getElementById('continueBtn');
    const stopBtn = document.getElementById('stopBtn');
    const checkpointInfo = document.getElementById('checkpointInfo');
    const checkpointText = document.getElementById('checkpointText');
    const statusContainer = document.getElementById('statusContainer');
    
    let hasCheckpoint = false;
    let checkTimeout;

    profileUrlInput.addEventListener('input', () => {
        clearTimeout(checkTimeout);
        let url = profileUrlInput.value.trim();
        
        // Auto-sanitize the URL right in the input field if it's a profile scrape
        if ((scrapeType === 'profile' || scrapeType === 'range') && url.includes('showSubTab=')) {
            url = url.replace(/([&?])showSubTab=[^&]+&?/, '$1').replace(/&$/, '').replace(/\?$/, '');
            profileUrlInput.value = url;
        }

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
                } else if (cpData.success && cpData.exists && cpData.data && cpData.data.processed) {
                    hasCheckpoint = true;
                    checkpointText.textContent = `上次中断前已处理了 ${cpData.data.processed.length} 个视频，您可以点击「继续执行」恢复进度。`;
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
        let history = JSON.parse(localStorage.getItem('douyin_batch_history') || '[]');
        history.unshift({
            url: url.substring(0, 50) + '...',
            tableUrl,
            count,
            date: new Date().toLocaleString()
        });
        if (history.length > 6) history.pop();
        localStorage.setItem('douyin_batch_history', JSON.stringify(history));
        renderHistory();
    };

    const renderHistory = () => {
        const history = JSON.parse(localStorage.getItem('douyin_batch_history') || '[]');
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

    // UI State Management
    const setUIState = (state, message = '', extra = null) => {
        statusContainer.classList.remove('hidden');
        // Trigger reflow for animation
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
                
                // Hide checkpoint since it completed
                checkpointInfo.classList.add('hidden');
                continueBtn.classList.add('hidden');
                hasCheckpoint = false;
                
                if (extra) {
                    resultCount.textContent = extra.count;
                    bitableLink.href = extra.url;
                    copyLinkBtn.dataset.url = extra.url;
                    addHistory(profileUrlInput.value, extra.url, extra.count);
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
            case 'extracting': percent = 30; break;
            case 'processing': percent = 60; break;
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
            const confirmRestart = confirm("发现未完成的进度，开始全新采集将清空之前的数据。确定要重新开始吗？");
            if (!confirmRestart) return;
        }

        let url = profileUrlInput.value.trim();
        
        // Extra safeguard before sending to backend
        if ((scrapeType === 'profile' || scrapeType === 'range') && url.includes('showSubTab=')) {
            url = url.replace(/([&?])showSubTab=[^&]+&?/, '$1').replace(/&$/, '').replace(/\?$/, '');
            profileUrlInput.value = url;
        }

        const appId = appIdInput.value.trim();
        const appSecret = appSecretInput.value.trim();
        const appToken = appTokenInput.value.trim();

        if (scrapeType === 'profile' && !url.includes('douyin.com/user/')) {
            alert('请输入有效的抖音主页链接 (包含 douyin.com/user/)');
            return;
        } else if (scrapeType === 'range' && !url.includes('douyin.com/user/')) {
            alert('请输入有效的抖音主页链接 (包含 douyin.com/user/)');
            return;
        } else if (scrapeType === 'mix' && !url.includes('douyin.com/user/')) {
            alert('请输入有效的抖音合集链接 (包含 douyin.com/user/ 以及合集参数)');
            return;
        }

        let startIdx = '';
        let endIdx = '';
        if (scrapeType === 'range') {
            startIdx = startIdxInput.value.trim();
            endIdx = endIdxInput.value.trim();
            if (parseInt(startIdx) > parseInt(endIdx)) {
                alert('起始位置不能大于结束位置');
                return;
            }
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
        if (scrapeType === 'range') {
            query.append('startIdx', startIdx);
            query.append('endIdx', endIdx);
        }

        const endpoint = scrapeType === 'mix' ? '/api/mix/stream' : '/api/batch/stream';
        eventSource = new EventSource(`${endpoint}?${query.toString()}`);

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
                const count = data.stats ? data.stats.success : (data.count || 0);
                setUIState('success', data.message, { count: count, url: data.url });
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
            // Only show generic disconnect error if we didn't intentionally close it via success/custom error event
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
            
            // Tell backend to abort the background job
            try {
                await fetch('/api/batch/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: profileUrlInput.value.trim() })
                });
            } catch (e) {}

            setUIState('error', '解析任务已由用户主动中止。');
            
            // Provide a visual cue that it can be resumed
            if (hasCheckpoint) {
                checkpointInfo.classList.remove('hidden');
                continueBtn.classList.remove('hidden');
            }
        }
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        startScraping(false); // New parse
    });

    continueBtn.addEventListener('click', () => {
        startScraping(true); // Resume parse
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

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.metaKey) {
            startScraping();
        }
    });

    // Init
    loadState();
    profileUrlInput.focus();
});
