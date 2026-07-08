document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const form = document.getElementById('multiParseForm');
    const urlListContainer = document.getElementById('urlListContainer');
    const addUrlBtn = document.getElementById('addUrlBtn');
    const urlCountTracker = document.getElementById('urlCountTracker');
    
    const appIdInput = document.getElementById('appId');
    const appSecretInput = document.getElementById('appSecret');
    const appTokenInput = document.getElementById('appToken');
    
    const submitBtn = document.getElementById('submitBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusContainer = document.getElementById('statusContainer');
    
    const spinner = document.getElementById('spinner');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const progressWrapper = document.getElementById('progressWrapper');
    const progressBar = document.getElementById('progressBar');
    
    const resultBox = document.getElementById('resultBox');
    const resultCount = document.getElementById('resultCount');
    const bitableLink = document.getElementById('bitableLink');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    
    const failuresContainer = document.getElementById('failuresContainer');
    const failuresList = document.getElementById('failuresList');
    const failCount = document.getElementById('failCount');
    
    const errorBox = document.getElementById('errorBox');
    const errorMsg = document.getElementById('errorMsg');
    
    let eventSource = null;

    // Load saved credentials
    const loadState = () => {
        appIdInput.value = localStorage.getItem('douyin_app_id') || 'cli_a963a8c6d0785bd4';
        appSecretInput.value = localStorage.getItem('douyin_app_secret') || '';
        appTokenInput.value = localStorage.getItem('douyin_app_token') || 'FDqZF0JFeE7nhwlQ1SoJChuVEN1HLcbs';
    };

    const saveState = () => {
        localStorage.setItem('douyin_app_id', appIdInput.value);
        localStorage.setItem('douyin_app_secret', appSecretInput.value);
        localStorage.setItem('douyin_app_token', appTokenInput.value);
    };

    // Dynamic URL Inputs Logic
    const updateUrlCount = () => {
        const count = urlListContainer.querySelectorAll('.url-input-row').length;
        urlCountTracker.textContent = `已添加 ${count} 个链接`;
    };

    const createInputRow = (val = '') => {
        const row = document.createElement('div');
        row.className = 'url-input-row flex items-center gap-2 transition-all duration-300';
        row.innerHTML = `
            <div class="relative flex-grow">
                <input type="url" placeholder="https://www.douyin.com/video/..." 
                    class="url-input w-full bg-slate-800/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono text-sm" value="${val}">
            </div>
            <button type="button" class="remove-btn p-3 text-gray-500 hover:text-red-400 transition-colors bg-slate-800/50 border border-slate-600 rounded-xl hover:border-red-400/50" title="移除该链接">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
        `;
        
        row.querySelector('.remove-btn').addEventListener('click', () => {
            if (urlListContainer.querySelectorAll('.url-input-row').length > 1) {
                row.style.opacity = '0';
                row.style.transform = 'translateY(-10px)';
                setTimeout(() => {
                    row.remove();
                    updateUrlCount();
                }, 300);
            } else {
                row.querySelector('.url-input').value = '';
            }
        });
        
        urlListContainer.appendChild(row);
        updateUrlCount();
    };

    addUrlBtn.addEventListener('click', () => {
        createInputRow();
        const inputs = urlListContainer.querySelectorAll('.url-input');
        inputs[inputs.length - 1].focus();
    });

    // Initialize with 3 rows
    createInputRow();
    createInputRow();
    createInputRow();

    const getValidUrls = () => {
        const inputs = urlListContainer.querySelectorAll('.url-input');
        const urls = [];
        inputs.forEach(input => {
            const val = input.value.trim();
            if (val && (val.includes('douyin.com') || val.includes('v.douyin.com'))) {
                urls.push(val);
            }
        });
        return [...new Set(urls)]; // Deduplicate
    };

    // UI State Management
    const setUIState = (state, message = '', extra = null) => {
        statusContainer.classList.remove('hidden');
        void statusContainer.offsetWidth; // force reflow
        statusContainer.classList.remove('opacity-0', 'translate-y-4');
        
        switch(state) {
            case 'loading':
                submitBtn.disabled = true;
                stopBtn.disabled = false;
                spinner.classList.remove('hidden');
                statusIcon.classList.add('hidden');
                resultBox.classList.add('hidden');
                errorBox.classList.add('hidden');
                failuresContainer.classList.add('hidden');
                progressWrapper.classList.remove('hidden');
                statusText.className = 'text-lg font-medium text-blue-400 glow-text';
                statusText.textContent = message;
                break;
            case 'success':
                submitBtn.disabled = false;
                stopBtn.disabled = true;
                spinner.classList.add('hidden');
                statusIcon.classList.remove('hidden');
                statusIcon.innerHTML = `<svg class="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
                progressWrapper.classList.add('hidden');
                resultBox.classList.remove('hidden');
                errorBox.classList.add('hidden');
                statusText.className = 'text-lg font-medium text-green-400 glow-text';
                statusText.textContent = message;
                
                if (extra) {
                    resultCount.textContent = extra.stats.success;
                    bitableLink.href = extra.url;
                    copyLinkBtn.dataset.url = extra.url;

                    if (extra.stats.failed > 0) {
                        failuresContainer.classList.remove('hidden');
                        failCount.textContent = extra.stats.failed;
                        failuresList.innerHTML = extra.stats.failures.map(f => `
                            <li class="flex flex-col border-b border-red-500/10 pb-2 last:border-0 last:pb-0">
                                <span class="text-slate-400 truncate w-full" title="${f.url}">${f.url}</span>
                                <span class="text-red-400 font-medium">失败原因: ${f.reason}</span>
                            </li>
                        `).join('');
                    } else {
                        failuresContainer.classList.add('hidden');
                    }
                }
                break;
            case 'error':
                submitBtn.disabled = false;
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
            case 'connecting': percent = 15; break;
            case 'extracting': percent = 30; break;
            case 'processing': 
                // Extract "x/y" from message if possible to animate nicely
                const match = message.match(/\((\d+)\/(\d+)\)/);
                if (match) {
                    const current = parseInt(match[1]);
                    const total = parseInt(match[2]);
                    percent = 30 + (current / total) * 50; // maps to 30-80%
                } else {
                    percent = 50;
                }
                break;
            case 'uploading': percent = 90; break;
        }
        progressBar.style.width = `${percent}%`;
    };

    // Main Submit Logic
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const urls = getValidUrls();
        if (urls.length === 0) {
            alert('请至少输入一个有效的抖音视频链接');
            return;
        }

        const appId = appIdInput.value.trim();
        const appSecret = appSecretInput.value.trim();
        const appToken = appTokenInput.value.trim();

        saveState();
        setUIState('loading', '正在初始化批量解析任务...');
        progressBar.style.width = '5%';

        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }

        try {
            // POST urls to backend to get a jobId
            const initRes = await fetch('/api/multi/init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls })
            });
            const initData = await initRes.json();
            
            if (!initRes.ok || !initData.success) {
                throw new Error(initData.error || '任务初始化失败');
            }

            const jobId = initData.jobId;
            const query = new URLSearchParams({ jobId, appId, appSecret, appToken });
            
            eventSource = new EventSource(`/api/multi/stream?${query.toString()}`);
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
                        url: data.url,
                        stats: data.stats
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

        } catch (error) {
            console.error('[INIT ERROR]', error);
            setUIState('error', error.message);
        }
    });

    stopBtn.addEventListener('click', () => {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
            setUIState('error', '解析任务已由用户主动中止。');
        }
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

    loadState();
});