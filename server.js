const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const whisper = require('whisper-node');
const ffmpeg = require('ffmpeg-static');
const lark = require('@larksuiteoapi/node-sdk');
require('dotenv').config();
const axios = require('axios');
const OpenCC = require('opencc-js');

// Initialize traditional to simplified Chinese converter
// Using 't' (Traditional) to 'cn' (Simplified Chinese - Mainland)
const t2sConverter = OpenCC.Converter({ from: 't', to: 'cn' });

const app = express();
const PORT = process.env.PORT || 3000;

// LLM Post-Processing Error Correction Function
async function correctTranscriptWithLLM(transcript) {
    const apiKey = process.env.LLM_API_KEY;
    const baseUrl = process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.LLM_MODEL || 'gpt-4o-mini';

    if (!apiKey) {
        console.log(`[WARN] LLM_API_KEY not configured. Skipping transcript correction.`);
        return transcript;
    }

    if (!transcript || transcript.length < 5) return transcript;

    console.log(`[INFO] Sending transcript to LLM (${model}) for error correction...`);
    
    try {
        const response = await axios.post(`${baseUrl}/chat/completions`, {
            model: model,
            messages: [
                {
                    role: 'system',
                    content: '你是一个专业的视频文案编辑。以下是一段由语音识别生成的视频文案，其中可能包含中英文混编识别错误（如把英文单词识别成了发音相似的中文错别字，例如"sgail"->"skill"，"普龙特"->"prompt"）。请结合上下文语境修正这些同音字错误和错别字。保持原意不变，不增减语气词，直接输出修正后的完整文案，不要包含任何解释语或额外的格式。'
                },
                {
                    role: 'user',
                    content: transcript
                }
            ],
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000 // 15 seconds max wait
        });

        if (response.data && response.data.choices && response.data.choices.length > 0) {
            const corrected = response.data.choices[0].message.content.trim();
            console.log(`[INFO] LLM Correction Success. (Original length: ${transcript.length}, Corrected length: ${corrected.length})`);
            return corrected;
        }
    } catch (error) {
        console.error(`[ERROR] LLM Correction Failed:`, error.message);
    }
    
    // Fallback to original transcript if LLM fails
    return transcript;
}

const LOG_BUFFER_MAX = 500;
const logBuffer = [];

function logEvent(level, reqId, stage, message, extra) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        reqId,
        stage,
        message,
        ...(extra && typeof extra === 'object' ? extra : {})
    };
    console.log(JSON.stringify(entry));
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_MAX) {
        logBuffer.shift();
    }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Checkpoint Storage
const CHECKPOINT_DIR = path.join(__dirname, 'checkpoints');
if (!fs.existsSync(CHECKPOINT_DIR)) {
    fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

function getCheckpointFile(url) {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    return path.join(CHECKPOINT_DIR, `${hash}.json`);
}

function loadCheckpoint(url) {
    const file = getCheckpointFile(url);
    if (fs.existsSync(file)) {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch(e) {
            return null;
        }
    }
    return null;
}

function saveCheckpoint(url, data) {
    const file = getCheckpointFile(url);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function clearCheckpoint(url) {
    const file = getCheckpointFile(url);
    if (fs.existsSync(file)) {
        fs.unlinkSync(file);
    }
}

app.get('/api/checkpoint', (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: '缺少 url 参数' });
    
    // Also check if there's an active background job
    const jobId = Buffer.from(url).toString('base64');
    const activeJobs = app.locals.activeJobs;
    const isRunning = activeJobs && activeJobs.has(jobId);

    const cp = loadCheckpoint(url);
    if (cp) {
        res.json({ success: true, exists: true, data: cp, isRunning });
    } else {
        res.json({ success: true, exists: false, isRunning });
    }
});

app.get('/api/debug/logs', (req, res) => {
    const { reqId, limit } = req.query;
    const n = Math.max(1, Math.min(500, Number(limit) || 200));
    const filtered = reqId ? logBuffer.filter((x) => x.reqId === reqId) : logBuffer;
    res.json({
        success: true,
        data: {
            count: filtered.length,
            logs: filtered.slice(-n)
        }
    });
});

async function fetchVideoData(url, reqId) {
    let stage = 'init';
    let targetUrl = url;
    let videoId = null;
    const modalMatch = url.match(/modal_id=(\d+)/);
    const videoMatch = url.match(/video\/(\d+)/);
    const noteMatch = url.match(/note\/(\d+)/);
    
    if (modalMatch) {
        videoId = modalMatch[1];
    } else if (videoMatch) {
        videoId = videoMatch[1];
    } else if (noteMatch) {
        videoId = noteMatch[1];
    }

    if (videoId) {
        targetUrl = `https://www.douyin.com/video/${videoId}`;
    }

    let browser;
    try {
        const userAgents = [
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        ];
        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

        const attemptMax = 2;
        let videoData = null;
        for (let attempt = 1; attempt <= attemptMax; attempt++) {
            const launchArgs = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list'
            ];
            
            if (process.env.PROXY_SERVER) {
                launchArgs.push(`--proxy-server=${process.env.PROXY_SERVER}`);
            }

            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                ignoreHTTPSErrors: true,
                args: launchArgs
            });

            const page = await browser.newPage();
            
            // Randomize viewport slightly to avoid fingerprinting
            const randomWidth = 375 + Math.floor(Math.random() * 50);
            const randomHeight = 812 + Math.floor(Math.random() * 100);
            await page.setViewport({ width: randomWidth, height: randomHeight, isMobile: true, hasTouch: true });
            await page.setUserAgent(randomUA);
            
            // Mask webdriver
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
                window.chrome = { runtime: {} };
            });

            let interceptedOnce = false;
            page.on('response', async (response) => {
                const resUrl = response.url();
                if (resUrl.includes('/aweme/v1/web/aweme/detail/') || resUrl.includes('/aweme/detail/')) {
                    try {
                        const json = await response.json();
                        if (json && json.aweme_detail) {
                            videoData = json.aweme_detail;
                        }
                    } catch (e) {}
                }
            });

            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            for (let i = 0; i < 50; i++) {
                if (videoData) break;
                await new Promise(r => setTimeout(r, 100));
            }

            if (!videoData && targetUrl.includes('v.douyin.com')) {
                await new Promise(r => setTimeout(r, 2000));
                const redirectedUrl = page.url();
                const newVideoMatch = redirectedUrl.match(/video\/(\d+)/) || redirectedUrl.match(/note\/(\d+)/);
                if (newVideoMatch) {
                    targetUrl = `https://www.douyin.com/video/${newVideoMatch[1]}`;
                    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    for (let i = 0; i < 50; i++) {
                        if (videoData) break;
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
            }

            if (!videoData && targetUrl.includes('so.douyin.com')) {
                 throw new Error('这是一个搜索页面，请点击进入具体的视频后再复制链接！');
            }

            if (!videoData) {
                try {
                    await new Promise(r => setTimeout(r, 1000));
                    const html = await page.content();
                    const routerDataMatch = html.match(/window\._ROUTER_DATA\s*=\s*(.*?);?<\/script>/s);

                    if (routerDataMatch) {
                        const json_str = routerDataMatch[1].trim().replace(/;$/, '');
                        const data = JSON.parse(json_str);
                        function findAweme(obj) {
                            if (Array.isArray(obj)) {
                                for (const item of obj) {
                                    const res = findAweme(item);
                                    if (res) return res;
                                }
                            } else if (typeof obj === 'object' && obj !== null) {
                                if (obj.aweme_id && obj.desc !== undefined) {
                                    return obj;
                                }
                                for (const key in obj) {
                                    const res = findAweme(obj[key]);
                                    if (res) return res;
                                }
                            }
                            return null;
                        }
                        videoData = findAweme(data);
                    }
                } catch (e) {}
            }

            await browser.close();
            browser = null;

            if (videoData) break;
        }

        if (!videoData) {
            throw new Error('未能在页面中捕获到视频数据，可能需要登录或由于反爬机制限制。');
        }

        let title = videoData.desc || videoData.item_title || '';
        if (!title && videoData.chapter_abstract) {
            title = videoData.chapter_abstract;
        }
        if (!title) title = '无标题';

        let transcript = '';
        if (videoData.seo_info && videoData.seo_info.ocr_text) {
            transcript = videoData.seo_info.ocr_text;
        } else if (videoData.caption && typeof videoData.caption === 'string' && videoData.caption.length > 0) {
            transcript = videoData.caption;
        } else if (videoData.video && videoData.video.caption && typeof videoData.video.caption === 'string' && videoData.video.caption.length > 0) {
            transcript = videoData.video.caption;
        }

        if (!transcript) {
            let playAddr = null;
            if (videoData.video && videoData.video.play_addr && videoData.video.play_addr.url_list) {
                playAddr = videoData.video.play_addr.url_list[0];
            }
            
            if (playAddr) {
                const fetchRes = await fetch(playAddr, {
                    headers: {
                        'User-Agent': randomUA,
                        'Referer': 'https://www.douyin.com/'
                    }
                });
                
                const buffer = await fetchRes.arrayBuffer();
                const ts = Date.now() + Math.floor(Math.random() * 1000);
                const vidFile = path.join(__dirname, `tmp_video_${ts}.mp4`);
                const audFile = path.join(__dirname, `tmp_audio_${ts}.wav`);
                
                fs.writeFileSync(vidFile, Buffer.from(buffer));
                
                try {
                    execSync(`"${ffmpeg}" -i "${vidFile}" -ar 16000 -ac 1 -c:a pcm_s16le "${audFile}" -y`, { stdio: 'ignore' });
                    const options = { modelName: "small", whisperOptions: { language: "zh" } };
                    const whisperRes = await whisper.whisper(audFile, options);
                    transcript = whisperRes.map(t => t.speech).join(' ');
                    
                    // Apply LLM Correction for Mixed-Language/Homophone issues
                    transcript = await correctTranscriptWithLLM(transcript);
                } catch(e) {
                    transcript = videoData.chapter_abstract || '暂无文案（原声提取失败）';
                } finally {
                    if (fs.existsSync(vidFile)) fs.unlinkSync(vidFile);
                    if (fs.existsSync(audFile)) fs.unlinkSync(audFile);
                }
            } else {
                transcript = videoData.chapter_abstract || '暂无文案';
            }
        }

        const stats = videoData.statistics || {};
        const likes = stats.digg_count || 0;
        const comments = stats.comment_count || 0;
        const favorites = stats.collect_count || 0;
        const shares = stats.share_count || 0;

        let coverUrl = null;
        if (videoData.video && videoData.video.cover && videoData.video.cover.url_list) {
            coverUrl = videoData.video.cover.url_list[0];
        } else if (videoData.images && videoData.images.length > 0) {
            coverUrl = videoData.images[0].url_list[0];
        }

        // Convert Traditional Chinese to Simplified Chinese for output fields
        const simplifiedTitle = title ? t2sConverter(title) : title;
        const simplifiedTranscript = transcript ? t2sConverter(transcript) : transcript;

        return {
            title: simplifiedTitle,
            transcript: simplifiedTranscript,
            likes,
            comments,
            favorites,
            shares,
            coverUrl
        };

    } finally {
        if (browser) await browser.close();
    }
}

app.get('/api/parse/stream', async (req, res) => {
    req.setTimeout(0);
    res.setTimeout(0);
    
    const { url, appId, appSecret, appToken, resume = 'true' } = req.query;

    if (resume === 'false') {
        clearCheckpoint(url);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let isConnectionClosed = false;

    const sendEvent = (type, data) => {
        if (!isConnectionClosed) {
            res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        }
    };
    
    const keepAliveInterval = setInterval(() => {
        if (!isConnectionClosed) {
            res.write(':\n\n');
        }
    }, 15000);

    req.on('close', () => {
        isConnectionClosed = true;
        clearInterval(keepAliveInterval);
        console.log(`[WARN] Client disconnected prematurely for single parse stream ${url}`);
    });

    if (!url || !appId || !appSecret || !appToken) {
        sendEvent('error', { message: '参数缺失，请提供视频链接以及完整的飞书凭证信息。' });
        return res.end();
    }

    const reqId = crypto.randomUUID();

    try {
        sendEvent('progress', { stage: 'connecting', message: '正在初始化飞书多维表格...' });
        const feishuClient = new lark.Client({ appId, appSecret });
        const tableUrl = `https://feishu.cn/base/${appToken}`;
        
        // Ensure table is ready
        let viewId;
        try {
            const tableRes = await feishuClient.bitable.appTable.list({ path: { app_token: appToken } });
            if (!tableRes || !tableRes.data || !tableRes.data.items || tableRes.data.items.length === 0) {
                throw new Error("找不到多维表格的数据表");
            }
            const tableId = tableRes.data.items[0].table_id;
            
            // Check if fields exist
            const fieldsRes = await feishuClient.bitable.appTableField.list({ path: { app_token: appToken, table_id: tableId } });
            const existingFields = fieldsRes.data.items.map(f => f.field_name);
            const requiredFields = [
                { field_name: '标题', type: 1 },
                { field_name: '文案', type: 1 },
                { field_name: '点赞量', type: 2 },
                { field_name: '收藏量', type: 2 },
                { field_name: '评论量', type: 2 },
                { field_name: '视频URL', type: 1 }
            ];
            
            for (const field of requiredFields) {
                if (!existingFields.includes(field.field_name)) {
                    await feishuClient.bitable.appTableField.create({
                        path: { app_token: appToken, table_id: tableId },
                        data: { field_name: field.field_name, type: field.type }
                    });
                }
            }
            viewId = tableId;
        } catch (e) {
            console.error('[ERROR] Feishu Table Init Failed:', e);
            throw new Error('飞书多维表格初始化失败，请检查凭证及权限');
        }

        sendEvent('progress', { stage: 'extracting', message: '正在解析视频内容与提取文案...' });
        logEvent('info', reqId, 'start', 'Starting extraction via fetchVideoData', { url });
        
        const videoData = await fetchVideoData(url, reqId);
        
        if (isConnectionClosed) return;

        sendEvent('progress', { stage: 'processing', message: '解析成功，正在整理数据格式...' });
        
        const record = {
            "标题": videoData.title,
            "文案": videoData.transcript,
            "点赞量": Number(videoData.likes),
            "收藏量": Number(videoData.favorites),
            "评论量": Number(videoData.comments),
            "视频URL": url
        };

        sendEvent('progress', { stage: 'uploading', message: '正在将数据写入飞书多维表格...' });
        
        try {
            await feishuClient.bitable.appTableRecord.batchCreate({
                path: { app_token: appToken, table_id: viewId },
                data: { records: [{ fields: record }] }
            });
        } catch (e) {
            console.error('[ERROR] Feishu Write Failed:', e);
            let detail = e.message;
            if (e.code === 91403) detail = "飞书应用权限不足。请确保您已将该机器人（应用）添加为飞书表格的协作者，并且具备'可编辑'权限。";
            throw new Error(`写入飞书失败: ${detail}`);
        }

        saveCheckpoint(url, { completed: true, data: videoData });
        
        sendEvent('success', { 
            message: '视频解析完成，数据已同步至飞书！', 
            url: tableUrl,
            videoData: videoData
        });

    } catch (error) {
        logEvent('error', reqId, 'error', 'Parsing failed', { url, error: String(error && error.message ? error.message : error) });
        sendEvent('error', { message: (error && error.message) ? error.message : '解析失败，请检查链接或稍后重试' });
    } finally {
        clearInterval(keepAliveInterval);
    }
});

// SSE Endpoint for Mix / Compilation Scraping
app.get('/api/mix/stream', async (req, res) => {
    req.setTimeout(0);
    res.setTimeout(0);
    
    const { url, appId, appSecret, appToken, resume = 'true' } = req.query;

    if (resume === 'false') {
        clearCheckpoint(url);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let isConnectionClosed = false;

    const sendEvent = (type, data) => {
        if (!isConnectionClosed) {
            res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        }
    };
    
    const keepAliveInterval = setInterval(() => {
        if (!isConnectionClosed) {
            res.write(':\n\n');
        }
    }, 15000);

    req.on('close', () => {
        isConnectionClosed = true;
        clearInterval(keepAliveInterval);
        console.log(`[WARN] Client disconnected prematurely for mix stream ${url}`);
    });

    if (!url || !appId || !appSecret || !appToken) {
        sendEvent('error', { message: '参数缺失，请提供合集链接以及完整的飞书凭证信息。' });
        return res.end();
    }

    let browser;
    try {
        const client = new lark.Client({ appId, appSecret });
        sendEvent('progress', { stage: 'connecting', message: '正在启动无头浏览器...' });

        const launchArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list'
            ];
            
            if (process.env.PROXY_SERVER) {
                launchArgs.push(`--proxy-server=${process.env.PROXY_SERVER}`);
            }

            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                ignoreHTTPSErrors: true,
                args: launchArgs
            });

        const page = await browser.newPage();
        
        // Randomize viewport slightly
        const randomWidth = 1900 + Math.floor(Math.random() * 40);
        const randomHeight = 1000 + Math.floor(Math.random() * 80);
        await page.setViewport({ width: randomWidth, height: randomHeight });

        // Mask webdriver
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
            window.chrome = { runtime: {} };
        });

        // Force PC User Agent because Douyin mix/compilation APIs often redirect or behave more predictably on PC
        const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';
        await page.setUserAgent(ua);
        
        let allVideos = [];
        let hasMore = true;
        let currentCursor = 0;
        let mixId = null;

        page.on('response', async (response) => {
            const resUrl = response.url();
            // Listen for mix API specifically
            if (resUrl.includes('/mix/aweme/') || resUrl.includes('/mix/list/')) {
                try {
                    const text = await response.text();
                    const json = JSON.parse(text);
                    if (json && json.aweme_list) {
                        allVideos = allVideos.concat(json.aweme_list);
                        sendEvent('progress', { stage: 'extracting', message: `已从合集中截获到 ${allVideos.length} 个视频数据...` });
                        if (json.has_more === 0 || json.has_more === false) {
                            hasMore = false;
                        } else {
                            hasMore = true;
                        }
                        if (json.cursor !== undefined) {
                            currentCursor = json.cursor;
                        }
                        if (!mixId && json.aweme_list.length > 0 && json.aweme_list[0].mix_info) {
                            mixId = json.aweme_list[0].mix_info.mix_id;
                        }
                    }
                } catch (e) {}
            }
        });

        sendEvent('progress', { stage: 'extracting', message: '正在访问合集页面并等待API数据...' });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Wait dynamically for up to 15 seconds for the mix API to return
        for (let i = 0; i < 30; i++) {
            if (allVideos.length > 0) break;
            await new Promise(r => setTimeout(r, 500));
        }

        if (mixId) {
            sendEvent('progress', { stage: 'extracting', message: `解析到合集ID: ${mixId}，开始拉取全量列表...` });
            let fetchCount = 0;
            
            while (hasMore && fetchCount < 20) { // Limit to 20 pages (~400 videos)
                if (isConnectionClosed) break;
                fetchCount++;
                
                const fetchUrl = `https://www.douyin.com/aweme/v1/web/mix/aweme/?mix_id=${mixId}&cursor=${currentCursor}&count=20&device_platform=webapp&aid=6383`;
                
                try {
                    const res = await page.evaluate(async (fUrl) => {
                        const r = await fetch(fUrl);
                        return await r.json();
                    }, fetchUrl);
                    
                    if (res && res.aweme_list && res.aweme_list.length > 0) {
                        allVideos = allVideos.concat(res.aweme_list);
                        sendEvent('progress', { stage: 'extracting', message: `已从合集中提取到 ${allVideos.length} 个视频数据...` });
                        if (res.has_more) {
                            currentCursor = res.cursor;
                        } else {
                            hasMore = false;
                        }
                    } else {
                        hasMore = false;
                    }
                } catch(e) {
                    console.error(`[WARN] Manual fetch failed:`, e.message);
                    break;
                }
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
            }
        }

        await browser.close();
        browser = null;

        // Deduplicate
        let uniqueVideos = [];
        const ids = new Set();
        for (const v of allVideos) {
            if (!ids.has(v.aweme_id)) {
                ids.add(v.aweme_id);
                uniqueVideos.push(v);
            }
        }

        // Sort by episode order (Douyin compilations are usually ordered by episode ascending)
        // We will just use the order they were provided, or create_time ascending
        uniqueVideos.sort((a, b) => a.create_time - b.create_time);

        if (uniqueVideos.length === 0) {
            sendEvent('error', { message: '未能在该链接中提取到任何合集视频，请检查是否为有效的合集链接。' });
            return res.end();
        }

        // Load Checkpoint if exists
        let checkpoint = loadCheckpoint(url);
        let processed = [];
        let startIndex = 0;

        if (checkpoint && checkpoint.totalVideos === uniqueVideos.length) {
            sendEvent('progress', { stage: 'processing', message: `检测到未完成的任务进度！已恢复之前处理的 ${checkpoint.processed.length} 个视频。继续处理剩余视频...` });
            processed = checkpoint.processed;
            startIndex = processed.length;
        } else {
            sendEvent('progress', { stage: 'processing', message: `合集抓取完成，共提取到 ${uniqueVideos.length} 个视频。开始逐个分析详情...` });
            // Save initial checkpoint
            saveCheckpoint(url, { totalVideos: uniqueVideos.length, processed: [] });
        }
        
        for (let i = startIndex; i < uniqueVideos.length; i++) {
            if (isConnectionClosed) {
                console.log(`[INFO] Client disconnected. Halting mix processing at index ${i}`);
                break;
            }
            
            const v = uniqueVideos[i];
            const videoUrl = `https://www.douyin.com/video/${v.aweme_id}`;
            sendEvent('progress', { stage: 'processing', message: `正在处理合集视频 (${i + 1}/${uniqueVideos.length}): 获取完整数据...` });
            
            try {
                const videoData = await fetchVideoData(videoUrl, `mix-${v.aweme_id}`);
                processed.push({
                    "标题": videoData.title,
                    "文案": videoData.transcript,
                    "点赞量": Number(videoData.likes),
                    "收藏量": Number(videoData.favorites),
                    "评论量": Number(videoData.comments),
                    "视频URL": videoUrl
                });
            } catch (e) {
                const title = v.desc || v.item_title || v.chapter_abstract || '无标题';
                const likes = v.statistics ? v.statistics.digg_count : 0;
                const comments = v.statistics ? v.statistics.comment_count : 0;
                const favorites = v.statistics ? v.statistics.collect_count : 0;
                
                processed.push({
                    "标题": title ? t2sConverter(title) : title,
                    "文案": '暂无文案（获取失败）',
                    "点赞量": Number(likes),
                    "收藏量": Number(favorites),
                    "评论量": Number(comments),
                    "视频URL": videoUrl
                });
            }

            // Save progress to checkpoint
            saveCheckpoint(url, { totalVideos: uniqueVideos.length, processed });

            if (i < uniqueVideos.length - 1) {
                const delayMs = 2000 + Math.floor(Math.random() * 2000);
                await new Promise(r => setTimeout(r, delayMs));
            }
        }

        if (isConnectionClosed) {
            console.log(`[INFO] Process terminated due to client disconnect. Progress saved to checkpoint. Skipping Feishu upload.`);
            return res.end();
        }

        // Upload to Feishu
        let tablesRes;
        try {
            tablesRes = await client.bitable.appTable.list({
                path: { app_token: appToken }
            });
        } catch (feishuErr) {
            sendEvent('error', { message: `无法连接到飞书API。详细信息: ${feishuErr.message}` });
            return res.end();
        }
        
        if (tablesRes.code !== 0 || !tablesRes.data || tablesRes.data.items.length === 0) {
            sendEvent('error', { message: `无法访问飞书表格，请检查凭证是否有效。` });
            return res.end();
        }
        
        const tableId = tablesRes.data.items[0].table_id;

        const logFeishuApi = (action, reqPayload, resPayload, err) => {
            const logData = { timestamp: new Date().toISOString(), action, request: reqPayload, response: resPayload, error: err };
            if (err) console.error(`[FEISHU_API_ERROR]\n${JSON.stringify(logData, null, 2)}`);
            else console.log(`[FEISHU_API_SUCCESS]\n${JSON.stringify(logData, null, 2)}`);
        };

        try {
            sendEvent('progress', { stage: 'uploading', message: '正在检查并配置多维表格字段...' });
            const fieldsRes = await client.bitable.appTableField.list({
                path: { app_token: appToken, table_id: tableId }
            });
            const existingFields = fieldsRes.data?.items?.map(f => f.field_name) || [];
            
            const requiredFields = [
                { field_name: '标题', type: 1 },
                { field_name: '文案', type: 1 },
                { field_name: '点赞量', type: 2 },
                { field_name: '收藏量', type: 2 },
                { field_name: '评论量', type: 2 },
                { field_name: '视频URL', type: 1 }
            ];

            for (const rf of requiredFields) {
                if (!existingFields.includes(rf.field_name)) {
                    const reqPayload = { field_name: rf.field_name, type: rf.type };
                    try {
                        const createFieldRes = await client.bitable.appTableField.create({
                            path: { app_token: appToken, table_id: tableId },
                            data: reqPayload
                        });
                        logFeishuApi('create_field', reqPayload, createFieldRes, null);
                    } catch (e) {
                        logFeishuApi('create_field', reqPayload, null, e);
                        throw e;
                    }
                }
            }
        } catch (fieldErr) {}

        const feishuRecords = processed.map(r => ({ fields: r }));
        const chunkSize = 100;
        
        sendEvent('progress', { stage: 'uploading', message: '正在批量写入数据到飞书多维表格...' });
        for (let i = 0; i < feishuRecords.length; i += chunkSize) {
            const chunk = feishuRecords.slice(i, i + chunkSize);
            const reqPayload = { records: chunk };
            try {
                const createRes = await client.bitable.appTableRecord.batchCreate({
                    path: { app_token: appToken, table_id: tableId },
                    data: reqPayload
                });
                logFeishuApi('batch_create_records', reqPayload, createRes, null);
                if (createRes.code !== 0) {
                    throw new Error(`飞书批量写入失败: ${createRes.msg}`);
                }
            } catch (batchErr) {
                logFeishuApi('batch_create_records', reqPayload, null, batchErr);
                sendEvent('error', { message: `飞书批量写入失败: ${batchErr.message}` });
                return res.end();
            }
        }

        const feishuUrl = `https://feishu.cn/base/${appToken}?table=${tableId}`;
        sendEvent('success', { 
            message: '合集全量采集并入库成功！',
            url: feishuUrl,
            stats: {
                total: uniqueVideos.length,
                success: processed.length
            }
        });

        // Clear checkpoint on success
        clearCheckpoint(url);

    } catch (error) {
        sendEvent('error', { message: `执行过程中发生错误: ${error.message}` });
    } finally {
        if (browser) await browser.close();
        clearInterval(keepAliveInterval);
        res.end();
    }
});

// SSE Endpoint for Batch Profile Scraping
app.get('/api/batch/stream', async (req, res) => {
    // Override Node.js default timeout (usually 2 mins) for long-running batch processes
    req.setTimeout(0);
    // Remove the implicit timeout for the response object itself
    res.setTimeout(0);
    
    const { url, appId, appSecret, appToken, resume = 'true' } = req.query;

    if (resume === 'false') {
        clearCheckpoint(url);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Ensure proxies don't buffer the SSE stream
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let isConnectionClosed = false;

    // Track active background jobs
    const activeJobs = app.locals.activeJobs || new Map();
    app.locals.activeJobs = activeJobs;
    const jobId = Buffer.from(url).toString('base64');
    
    // If a job is already running in the background, we just reattach to it
    if (activeJobs.has(jobId)) {
        console.log(`[INFO] Reattaching to existing background job for ${url}`);
        const job = activeJobs.get(jobId);
        job.clients.push(res);
        
        // Catch them up with the last known message
        if (job.lastStage && job.lastMessage) {
            res.write(`event: progress\ndata: ${JSON.stringify({ stage: job.lastStage, message: job.lastMessage })}\n\n`);
        }
        
        req.on('close', () => {
            const idx = job.clients.indexOf(res);
            if (idx !== -1) job.clients.splice(idx, 1);
        });
        return;
    }

    const job = {
        clients: [res],
        lastStage: 'init',
        lastMessage: '初始化中...',
        isFinished: false,
        isError: false
    };
    activeJobs.set(jobId, job);

    const sendEvent = (type, data) => {
        if (type === 'progress') {
            job.lastStage = data.stage;
            job.lastMessage = data.message;
        } else if (type === 'success' || type === 'error') {
            job.isFinished = true;
            if (type === 'error') job.isError = true;
        }
        
        // Broadcast to all currently connected clients
        for (let i = job.clients.length - 1; i >= 0; i--) {
            const clientRes = job.clients[i];
            try {
                clientRes.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
                if (type === 'success' || type === 'error') {
                    clientRes.end();
                    job.clients.splice(i, 1);
                }
            } catch(e) {
                job.clients.splice(i, 1);
            }
        }
        
        if (type === 'success' || type === 'error') {
            activeJobs.delete(jobId);
        }
    };
    
    // Heartbeat mechanism
    const keepAliveInterval = setInterval(() => {
        for (let i = job.clients.length - 1; i >= 0; i--) {
            try {
                job.clients[i].write(':\n\n');
            } catch(e) {
                job.clients.splice(i, 1);
            }
        }
    }, 15000);

    req.on('close', () => {
        isConnectionClosed = true;
        const idx = job.clients.indexOf(res);
        if (idx !== -1) job.clients.splice(idx, 1);
        console.log(`[WARN] Client disconnected. Background job will continue processing: ${url}`);
    });

    if (!url || !appId || !appSecret || !appToken) {
        sendEvent('error', { message: '参数缺失，请提供主页链接以及完整的飞书凭证信息。' });
        return res.end();
    }

    let browser;
    try {
        const client = new lark.Client({ appId, appSecret });
        sendEvent('progress', { stage: 'connecting', message: '正在启动无头浏览器...' });

        const launchArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list'
            ];
            
            if (process.env.PROXY_SERVER) {
                launchArgs.push(`--proxy-server=${process.env.PROXY_SERVER}`);
            }

            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                ignoreHTTPSErrors: true,
                args: launchArgs
            });

        const page = await browser.newPage();
        
        await page.setViewport({ width: 1920, height: 1080 });

        // Mask webdriver
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
            window.chrome = { runtime: {} };
            
            // Override fetch to bypass standard signature issues if fallback is needed
            window.fetchData = async (url) => {
                const headers = new Headers();
                headers.append('accept', 'application/json, text/plain, */*');
                headers.append('sec-ch-ua', '"Google Chrome";v="114", "Chromium";v="114", "Not=A?Brand";v="24"');
                headers.append('sec-ch-ua-mobile', '?0');
                headers.append('sec-ch-ua-platform', '"macOS"');
                headers.append('sec-fetch-dest', 'empty');
                headers.append('sec-fetch-mode', 'cors');
                headers.append('sec-fetch-site', 'same-origin');
                const r = await fetch(url, { headers });
                return await r.json();
            };
        });

        const userAgents = [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
        await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);
        
        let allVideos = [];
        let hasMore = true;
        let maxCursor = 0;
        let targetTotalCount = -1;

        // Ensure we handle both mobile and PC API formats
        page.on('response', async (response) => {
            const resUrl = response.url();
            if (resUrl.includes('aweme/v1/web/aweme/post') || resUrl.includes('aweme/post')) {
                try {
                    const json = await response.json();
                    if (json && json.aweme_list) {
                        allVideos = allVideos.concat(json.aweme_list);
                        console.log(`[API INTERCEPT] Detected POST API. Received ${json.aweme_list.length} videos. Total so far: ${allVideos.length}`);
                        sendEvent('progress', { stage: 'extracting', message: `正在提取数据，已捕获 ${allVideos.length} 个视频...` });
                        if (json.has_more === 0 || json.has_more === false) {
                            hasMore = false;
                        }
                        if (json.max_cursor !== undefined) maxCursor = json.max_cursor;
                        else if (json.cursor !== undefined) maxCursor = json.cursor;
                    }
                } catch (e) {}
            } else if (resUrl.includes('aweme') && resUrl.includes('list')) {
                // Alternative list API sometimes used on mobile
                try {
                    const json = await response.json();
                    if (json && json.aweme_list) {
                        allVideos = allVideos.concat(json.aweme_list);
                        console.log(`[API INTERCEPT] Detected LIST API. Received ${json.aweme_list.length} videos. Total so far: ${allVideos.length}`);
                        sendEvent('progress', { stage: 'extracting', message: `正在提取数据，已捕获 ${allVideos.length} 个视频...` });
                        if (json.has_more === 0 || json.has_more === false) {
                            hasMore = false;
                        }
                        if (json.max_cursor !== undefined) maxCursor = json.max_cursor;
                        else if (json.cursor !== undefined) maxCursor = json.cursor;
                    }
                } catch (e) {}
            }
        });

        let cleanUrl = url;
        if (cleanUrl.includes('showSubTab=')) {
            cleanUrl = cleanUrl.replace(/([&?])showSubTab=[^&]+&?/, '$1').replace(/&$/, '');
        }

        console.log(`[START] Initiating profile scrape for: ${cleanUrl}`);
        sendEvent('progress', { stage: 'extracting', message: '正在访问博主主页并绕过安全校验...' });

        // Set PC specific cookies to bypass some captchas
        // Removed ttwid cookie to let it generate naturally on the page load

        await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Wait dynamically for the initial API to populate `allVideos`
        let waited = 0;
        while (allVideos.length === 0 && waited < 10000) {
            await new Promise(r => setTimeout(r, 1000));
            waited += 1000;
        }

        // Extract total video count from _ROUTER_DATA
        try {
            console.log(`[DOM] Parsing initial DOM for total aweme count...`);
            const html = await page.content();
            const routerDataMatch = html.match(/window\._ROUTER_DATA\s*=\s*(.*?);?<\/script>/s);
            if (routerDataMatch) {
                const data = JSON.parse(routerDataMatch[1].trim().replace(/;$/, ''));
                if (data.app && data.app.user && data.app.user.user && data.app.user.user.awemeCount !== undefined) {
                    targetTotalCount = data.app.user.user.awemeCount;
                    console.log(`[DOM] Target count identified: ${targetTotalCount} videos`);
                    sendEvent('progress', { stage: 'extracting', message: `解析主页信息成功，博主共有 ${targetTotalCount} 个视频。准备全量抓取...` });
                }
            }
            
            // Check if there is a captcha/slider
            if (html.includes('验证码') || html.includes('captcha') || html.includes('secsdk-captcha')) {
                console.log(`[WARNING] Captcha or Slider verification detected in DOM!`);
                sendEvent('progress', { stage: 'extracting', message: `[注意] 页面触发了风控验证码，系统正在尝试自动绕过，这可能需要一些时间...` });
            }
        } catch(e) {
            console.log(`[DOM ERROR] Failed to parse initial _ROUTER_DATA:`, e.message);
        }
        
        // Fallback: extract videos from window._ROUTER_DATA embedded in HTML
        try {
            const html = await page.content();
            const routerDataMatch = html.match(/window\._ROUTER_DATA\s*=\s*(.*?);?<\/script>/s);
            if (routerDataMatch) {
                const data = JSON.parse(routerDataMatch[1].trim().replace(/;$/, ''));
                let foundAwemes = 0;
                function findAwemeList(obj) {
                    if (Array.isArray(obj)) {
                        for (const item of obj) findAwemeList(item);
                    } else if (typeof obj === 'object' && obj !== null) {
                        if (Array.isArray(obj.aweme_list) && obj.aweme_list.length > 0 && obj.aweme_list[0].aweme_id) {
                            foundAwemes += obj.aweme_list.length;
                            allVideos = allVideos.concat(obj.aweme_list);
                            if (obj.has_more === 0 || obj.has_more === false) hasMore = false;
                            if (obj.max_cursor !== undefined) maxCursor = obj.max_cursor;
                            else if (obj.cursor !== undefined) maxCursor = obj.cursor;
                        } else if (Array.isArray(obj.itemList) && obj.itemList.length > 0 && obj.itemList[0].aweme_id) {
                            foundAwemes += obj.itemList.length;
                            allVideos = allVideos.concat(obj.itemList);
                            if (obj.hasMore === 0 || obj.hasMore === false) hasMore = false;
                            if (obj.cursor !== undefined) maxCursor = obj.cursor;
                        }
                        for (const key in obj) findAwemeList(obj[key]);
                    }
                }
                findAwemeList(data);
                if (foundAwemes > 0) {
                    sendEvent('progress', { stage: 'extracting', message: `从页面缓存中提取到 ${foundAwemes} 个视频...` });
                }
            }
        } catch (e) {}

        let noNewCount = 0;
        let previousLength = 0;
        const maxRetries = 25; // Increased wait rounds from 15 to 25 to allow more gentle scrolling
        
        console.log(`[SCROLL START] Beginning infinite scroll loop for pagination...`);
        while (hasMore && noNewCount < maxRetries) {
            // We NO LONGER break when client disconnects
            // Background job will continue
            
            // Enhanced human-like scrolling to bypass strict lazy loading
            await page.evaluate(async () => {
                // Find scrollable container on PC Douyin
                const scroller = document.documentElement || document.body;
                scroller.scrollBy(0, 800);
                
                // Scroll inside the video container list (this is the key for PC Douyin layout)
                const lists = document.querySelectorAll('ul, [data-e2e="user-post-list"], div');
                for (let el of lists) {
                    if (el.scrollHeight > el.clientHeight) el.scrollBy(0, 800);
                }
            });
            
            const delay = 2000 + Math.floor(Math.random() * 1500);
            await new Promise(r => setTimeout(r, delay));
            
            if (allVideos.length === previousLength) {
                noNewCount++;
                console.log(`[SCROLL] No new videos detected. Attempt ${noNewCount}/${maxRetries}. Total so far: ${allVideos.length}`);
                sendEvent('progress', { stage: 'extracting', message: `等待更多数据加载 (尝试 ${noNewCount}/${maxRetries})... 已捕获 ${allVideos.length} 个视频` });
                
                if (noNewCount > 3) {
                    // Try to move mouse to trigger lazy load
                    try {
                        await page.mouse.move(500 + Math.random() * 100, 500 + Math.random() * 100);
                        await page.mouse.wheel({ deltaY: 500 });
                    } catch(e) {}
                }
                
                if (noNewCount > 6) {
                    // Try clicking the videos tab again just in case the DOM was detached
                    try {
                        await page.evaluate(() => {
                            const tabs = Array.from(document.querySelectorAll('div, span, a')).filter(el => el.textContent.includes('作品'));
                            for (let tab of tabs) {
                                if (tab.innerText === '作品') {
                                    tab.click();
                                    break;
                                }
                            }
                        });
                    } catch(e) {}
                }
            } else {
                console.log(`[SCROLL] Successfully fetched new videos via scroll! Previous: ${previousLength}, Current: ${allVideos.length}`);
                noNewCount = 0;
                previousLength = allVideos.length;
            }
        }
        
        console.log(`[SCROLL END] Finished scrolling. Total collected: ${allVideos.length}. hasMore: ${hasMore}`);

        // Try extracting all video keys directly from _ROUTER_DATA cache without relying on network pagination
        if (hasMore && allVideos.length < 80) { // arbitrary threshold to trigger deep cache sweep
            try {
                sendEvent('progress', { stage: 'extracting', message: `尝试从深度页面缓存中补全数据...` });
                const html = await page.content();
                const routerDataMatch = html.match(/window\._ROUTER_DATA\s*=\s*(.*?);?<\/script>/s);
                if (routerDataMatch) {
                    const data = JSON.parse(routerDataMatch[1].trim().replace(/;$/, ''));
                    let deepCount = 0;
                    const existingIds = new Set(allVideos.map(v => v.aweme_id));
                    function extractDeep(obj) {
                        if (Array.isArray(obj)) {
                            for (const item of obj) extractDeep(item);
                        } else if (typeof obj === 'object' && obj !== null) {
                            if (Array.isArray(obj.aweme_list)) {
                                for (const v of obj.aweme_list) {
                                    if (v.aweme_id && !existingIds.has(v.aweme_id)) {
                                        existingIds.add(v.aweme_id);
                                        allVideos.push(v);
                                        deepCount++;
                                    }
                                }
                            } else if (Array.isArray(obj.itemList)) {
                                for (const v of obj.itemList) {
                                    if (v.aweme_id && !existingIds.has(v.aweme_id)) {
                                        existingIds.add(v.aweme_id);
                                        allVideos.push(v);
                                        deepCount++;
                                    }
                                }
                            }
                            for (const key in obj) extractDeep(obj[key]);
                        }
                    }
                    extractDeep(data);
                    if (deepCount > 0) {
                        sendEvent('progress', { stage: 'extracting', message: `从深度缓存中补充了 ${deepCount} 个视频。总计：${allVideos.length}` });
                    }
                }
            } catch(e) {}
        }
        
        // Manual Fetch Fallback for Profiles
        const secUidMatch = url.match(/user\/([^?]+)/);
        let secUid = secUidMatch ? secUidMatch[1] : '';
        if (hasMore && !secUid) {
             // Fallback: try to extract secUid from ROUTER_DATA if regex failed
             try {
                 const html = await page.content();
                 const routerDataMatch = html.match(/window\._ROUTER_DATA\s*=\s*(.*?);?<\/script>/s);
                 if (routerDataMatch) {
                     const data = JSON.parse(routerDataMatch[1].trim().replace(/;$/, ''));
                     if (data.app && data.app.user && data.app.user.secUid) {
                         secUid = data.app.user.secUid;
                     }
                 }
             } catch(e) {}
        }

        if (hasMore && secUid) {
            sendEvent('progress', { stage: 'extracting', message: `滑动加载受限，尝试通过接口强行拉取剩余数据...` });
            let fetchCount = 0;
            const absoluteMaxPages = 100; // Increased significantly to allow truly unbounded scraping (up to ~1800 videos)
            
            while (hasMore && fetchCount < absoluteMaxPages) {
                // Background job keeps running even if client disconnects
                fetchCount++;
                const fetchUrl = `https://www.douyin.com/aweme/v1/web/aweme/post/?device_platform=webapp&aid=6383&sec_user_id=${secUid}&max_cursor=${maxCursor}&count=18`;
                try {
                    const res = await page.evaluate(async (fUrl) => {
                        const r = await fetch(fUrl);
                        return await r.json();
                    }, fetchUrl);
                    
                    if (res && res.aweme_list && res.aweme_list.length > 0) {
                        allVideos = allVideos.concat(res.aweme_list);
                        sendEvent('progress', { stage: 'extracting', message: `强行拉取成功，已捕获 ${allVideos.length} 个视频...` });
                        if (res.has_more) {
                            maxCursor = res.max_cursor || res.cursor;
                        } else {
                            hasMore = false;
                        }
                    } else {
                        hasMore = false;
                    }
                } catch(e) {
                    break;
                }
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
            }
        }
        
        await browser.close();
        browser = null;

        // Deduplicate
        let uniqueVideos = [];
        const ids = new Set();
        for (const v of allVideos) {
            if (!ids.has(v.aweme_id)) {
                ids.add(v.aweme_id);
                uniqueVideos.push(v);
            }
        }

        // Sort exactly like the Douyin UI: 
        // 1. Pinned (is_top) videos first
        // 2. Then by create_time descending (newest first)
        uniqueVideos.sort((a, b) => {
            const isTopA = a.is_top ? 1 : 0;
            const isTopB = b.is_top ? 1 : 0;
            if (isTopA !== isTopB) {
                return isTopB - isTopA; // Pinned videos come first
            }
            // If both are pinned or both are not, sort by time
            return b.create_time - a.create_time;
        });

        // Apply Range if provided
        const { startIdx, endIdx } = req.query;
        if (startIdx && endIdx) {
            let start = parseInt(startIdx, 10) - 1;
            let end = parseInt(endIdx, 10);
            start = Math.max(0, start);
            end = Math.min(uniqueVideos.length, end);
            if (start < end) {
                uniqueVideos = uniqueVideos.slice(start, end);
                console.log(`[INFO] Range applied: sliced videos from ${start+1} to ${end}. Total: ${uniqueVideos.length}`);
            } else if (start >= end || start >= uniqueVideos.length) {
                sendEvent('error', { message: `指定的范围无效或超出了主页实际视频总数 (${uniqueVideos.length})。` });
                return res.end();
            }
        }

        if (uniqueVideos.length === 0) {
            sendEvent('error', { message: '未在该主页提取到任何视频数据，请检查链接或稍后重试。' });
            return res.end();
        }

        // Load Checkpoint if exists
        let checkpoint = loadCheckpoint(url);
        let processed = [];
        let startIndex = 0;

        if (checkpoint && checkpoint.totalVideos === uniqueVideos.length) {
            sendEvent('progress', { stage: 'processing', message: `检测到未完成的任务进度！已恢复之前处理的 ${checkpoint.processed.length} 个视频。继续处理剩余视频...` });
            processed = checkpoint.processed;
            startIndex = processed.length;
        } else {
            sendEvent('progress', { stage: 'processing', message: `主页抓取完成，共提取到 ${uniqueVideos.length} 个独立视频。开始逐个分析视频详情...` });
            // Save initial checkpoint
            saveCheckpoint(url, { totalVideos: uniqueVideos.length, processed: [] });
        }
        
        for (let i = startIndex; i < uniqueVideos.length; i++) {
            // Decouple from SSE disconnect: we just note the disconnect but don't break the loop
            if (job.clients.length === 0 && !res.locals.isBackgroundJob) {
                console.log(`[INFO] No active clients. Background job processing at index ${i}`);
                res.locals.isBackgroundJob = true;
            }
            
            // Check if user manually clicked STOP via the stop endpoint
            if (activeJobs.get(jobId) && activeJobs.get(jobId).isCancelled) {
                console.log(`[INFO] Job was manually cancelled by user.`);
                break;
            }
            
            const v = uniqueVideos[i];
            const videoUrl = `https://www.douyin.com/video/${v.aweme_id}`;
            sendEvent('progress', { stage: 'processing', message: `正在处理视频 (${i + 1}/${uniqueVideos.length}): 获取完整数据...` });
            
            let record = null;
            try {
                const videoData = await fetchVideoData(videoUrl, `batch-${v.aweme_id}`);
                record = {
                    "标题": videoData.title,
                    "文案": videoData.transcript,
                    "点赞量": Number(videoData.likes),
                    "收藏量": Number(videoData.favorites),
                    "评论量": Number(videoData.comments),
                    "视频URL": videoUrl
                };
            } catch (e) {
                console.error(`[ERROR] Failed to fetch full data for video ${v.aweme_id}:`, e);
                const title = v.desc || v.item_title || v.chapter_abstract || '无标题';
                const likes = v.statistics ? v.statistics.digg_count : 0;
                const comments = v.statistics ? v.statistics.comment_count : 0;
                const favorites = v.statistics ? v.statistics.collect_count : 0;
                
                record = {
                    "标题": title ? t2sConverter(title) : title,
                    "文案": '暂无文案（获取失败）',
                    "点赞量": Number(likes),
                    "收藏量": Number(favorites),
                    "评论量": Number(comments),
                    "视频URL": videoUrl
                };
            }

            processed.push(record);
            
            // Save progress to checkpoint
            saveCheckpoint(url, { totalVideos: uniqueVideos.length, processed });

            // Anti-bot delay
            if (i < uniqueVideos.length - 1) {
                const delayMs = 2000 + Math.floor(Math.random() * 2000);
                await new Promise(r => setTimeout(r, delayMs));
            }
        }

        if (res.locals.isBackgroundJob) {
            console.log(`[INFO] Background job finished parsing videos. Proceeding to Feishu upload.`);
        }

        sendEvent('progress', { stage: 'uploading', message: '所有视频数据解析完毕，正在上传至飞书多维表格...' });
        
        // Upload to Feishu
        let tablesRes;
        try {
            tablesRes = await client.bitable.appTable.list({
                path: { app_token: appToken }
            });
        } catch (feishuErr) {
            console.error(`[ERROR] Feishu API Request Failed:`, feishuErr);
            let detailMsg = '认证失败或网络错误';
            if (feishuErr.response && feishuErr.response.data) {
                detailMsg = JSON.stringify(feishuErr.response.data);
            } else if (feishuErr.message) {
                detailMsg = feishuErr.message;
            }
            throw new Error(`无法连接到飞书API (状态码: ${feishuErr.response?.status || '未知'})。详细信息: ${detailMsg}。请检查您的 App ID 和 App Secret 是否填写正确。`);
        }
        
        if (tablesRes.code !== 0 || !tablesRes.data || tablesRes.data.items.length === 0) {
            throw new Error(`无法访问飞书表格，请检查凭证是否有效及是否开通对应权限。`);
        }
        
        const tableId = tablesRes.data.items[0].table_id;

        // Custom Logger for Feishu API
        const logFeishuApi = (action, reqPayload, resPayload, err) => {
            const logData = {
                timestamp: new Date().toISOString(),
                action,
                request: reqPayload,
                response: resPayload,
                error: err ? {
                    message: err.message,
                    code: err.code,
                    stack: err.stack,
                    detail: err.response?.data || err.data
                } : null
            };
            if (err) {
                console.error(`[FEISHU_API_ERROR]\n${JSON.stringify(logData, null, 2)}`);
            } else {
                console.log(`[FEISHU_API_SUCCESS]\n${JSON.stringify(logData, null, 2)}`);
            }
        };

        // Ensure all required fields exist
        try {
            sendEvent('progress', { stage: 'uploading', message: '正在检查并配置多维表格字段...' });
            const fieldsRes = await client.bitable.appTableField.list({
                path: { app_token: appToken, table_id: tableId }
            });
            const existingFields = fieldsRes.data?.items?.map(f => f.field_name) || [];
            
            const requiredFields = [
                { field_name: '标题', type: 1 },
                { field_name: '文案', type: 1 },
                { field_name: '点赞量', type: 2 },
                { field_name: '收藏量', type: 2 },
                { field_name: '评论量', type: 2 },
                { field_name: '视频URL', type: 1 } // 1 is text, safest for string URLs
            ];

            for (const rf of requiredFields) {
                if (!existingFields.includes(rf.field_name)) {
                    console.log(`[INFO] Creating missing field: ${rf.field_name}`);
                    const reqPayload = { field_name: rf.field_name, type: rf.type };
                    try {
                        const createFieldRes = await client.bitable.appTableField.create({
                            path: { app_token: appToken, table_id: tableId },
                            data: reqPayload
                        });
                        logFeishuApi('create_field', reqPayload, createFieldRes, null);
                    } catch (e) {
                        logFeishuApi('create_field', reqPayload, null, e);
                        throw e; // Rethrow to be caught by the outer catch
                    }
                }
            }
        } catch (fieldErr) {
            console.error(`[ERROR] Failed to check or create fields. Proceeding anyway, but it may fail.`, fieldErr.message);
            // We don't throw here immediately, maybe some fields exist or it was just a temporary network issue.
            // But we log it. If it fails, the batchCreate will likely throw FieldNameNotFound again.
        }

        const feishuRecords = processed.map(r => ({ fields: r }));
        const chunkSize = 100;
        
        sendEvent('progress', { stage: 'uploading', message: '正在批量写入数据到飞书多维表格...' });
        for (let i = 0; i < feishuRecords.length; i += chunkSize) {
            const chunk = feishuRecords.slice(i, i + chunkSize);
            const reqPayload = { records: chunk };
            try {
                const createRes = await client.bitable.appTableRecord.batchCreate({
                    path: { app_token: appToken, table_id: tableId },
                    data: reqPayload
                });
                
                logFeishuApi('batch_create_records', reqPayload, createRes, null);

                if (createRes.code !== 0) {
                    throw new Error(`飞书批量写入失败: ${createRes.msg}`);
                }
            } catch (batchErr) {
                logFeishuApi('batch_create_records', reqPayload, null, batchErr);
                let detail = batchErr.message;
                if (batchErr.response && batchErr.response.data) {
                    const code = batchErr.response.data.code;
                    if (code === 91403) detail = "飞书应用权限不足。请确保您已将该机器人（应用）添加为飞书表格的协作者，并且具备'可编辑'权限。";
                    else detail = JSON.stringify(batchErr.response.data);
                }
                throw new Error(`批量写入数据失败 (HTTP 403 / 91403): ${detail}`);
            }
        }
        
        const bitableUrl = `https://feishu.cn/base/${appToken}`;
        if (job.clients.length > 0) {
            sendEvent('success', { 
                message: '全量解析与上传成功！',
                count: processed.length,
                url: bitableUrl
            });
        } else {
            console.log(`[INFO] Background job finished successfully. ${processed.length} videos uploaded.`);
            activeJobs.delete(jobId);
        }

        // Clear checkpoint on success
        clearCheckpoint(url);

    } catch (error) {
        console.error('Batch error:', error);
        if (job.clients.length > 0) {
            sendEvent('error', { message: error.message || '任务执行过程中发生未知错误。' });
        } else {
            activeJobs.delete(jobId);
        }
    } finally {
        clearInterval(keepAliveInterval);
        if (browser) {
            await browser.close();
        }
        for (const c of job.clients) c.end();
    }
});

// Endpoint to manually stop a background job
app.post('/api/batch/stop', (req, res) => {
    const { url } = req.body;
    if (!url) return res.json({ success: false });
    const jobId = Buffer.from(url).toString('base64');
    const activeJobs = app.locals.activeJobs;
    if (activeJobs && activeJobs.has(jobId)) {
        const job = activeJobs.get(jobId);
        job.isCancelled = true;
        // Notify all clients immediately
        for (const c of job.clients) {
            c.write(`event: error\ndata: ${JSON.stringify({ message: '解析任务已由用户主动中止。' })}\n\n`);
            c.end();
        }
        job.clients = [];
        activeJobs.delete(jobId);
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Job not found' });
    }
});
const multiJobData = new Map();

app.post('/api/multi/init', (req, res) => {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ success: false, error: '请至少提供一个有效的视频链接' });
    }
    const jobId = crypto.randomUUID();
    multiJobData.set(jobId, urls);
    
    // Auto cleanup after 2 hours to prevent memory leaks
    setTimeout(() => {
        multiJobData.delete(jobId);
    }, 2 * 60 * 60 * 1000);
    
    res.json({ success: true, jobId });
});

app.get('/api/multi/stream', async (req, res) => {
    req.setTimeout(0);
    res.setTimeout(0);
    
    const { jobId, appId, appSecret, appToken } = req.query;
    const urlList = multiJobData.get(jobId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let isConnectionClosed = false;

    const sendEvent = (type, data) => {
        if (!isConnectionClosed) {
            res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        }
    };
    
    const keepAliveInterval = setInterval(() => {
        if (!isConnectionClosed) res.write(':\n\n');
    }, 15000);

    req.on('close', () => {
        isConnectionClosed = true;
        clearInterval(keepAliveInterval);
        console.log(`[WARN] Client disconnected prematurely for multi parse stream ${jobId}`);
    });

    if (!urlList || !appId || !appSecret || !appToken) {
        sendEvent('error', { message: '任务已过期或参数缺失，请重新提交任务。' });
        return res.end();
    }

    const reqId = jobId;

    try {
        sendEvent('progress', { stage: 'connecting', message: '正在初始化飞书多维表格...' });
        const feishuClient = new lark.Client({ appId, appSecret });
        const tableUrl = `https://feishu.cn/base/${appToken}`;
        
        let viewId;
        try {
            const tableRes = await feishuClient.bitable.appTable.list({ path: { app_token: appToken } });
            if (!tableRes || !tableRes.data || !tableRes.data.items || tableRes.data.items.length === 0) {
                throw new Error("找不到多维表格的数据表");
            }
            const tableId = tableRes.data.items[0].table_id;
            
            const fieldsRes = await feishuClient.bitable.appTableField.list({ path: { app_token: appToken, table_id: tableId } });
            const existingFields = fieldsRes.data.items.map(f => f.field_name);
            const requiredFields = [
                { field_name: '标题', type: 1 },
                { field_name: '文案', type: 1 },
                { field_name: '点赞量', type: 2 },
                { field_name: '收藏量', type: 2 },
                { field_name: '评论量', type: 2 },
                { field_name: '视频URL', type: 1 }
            ];
            
            for (const field of requiredFields) {
                if (!existingFields.includes(field.field_name)) {
                    await feishuClient.bitable.appTableField.create({
                        path: { app_token: appToken, table_id: tableId },
                        data: { field_name: field.field_name, type: field.type }
                    });
                }
            }
            viewId = tableId;
        } catch (e) {
            console.error('[ERROR] Feishu Table Init Failed:', e);
            throw new Error('飞书多维表格初始化失败，请检查凭证及权限');
        }

        sendEvent('progress', { stage: 'extracting', message: `准备解析 ${urlList.length} 个视频...` });
        
        const processedRecords = [];
        const failedUrls = [];

        for (let i = 0; i < urlList.length; i++) {
            if (isConnectionClosed) {
                console.log(`[INFO] Multi-parse aborted because client disconnected.`);
                break;
            }
            
            const targetUrl = urlList[i];
            sendEvent('progress', { stage: 'processing', message: `正在解析视频 (${i + 1}/${urlList.length}): 获取完整数据...` });
            
            try {
                const videoData = await fetchVideoData(targetUrl, `${reqId}-${i}`);
                processedRecords.push({
                    "标题": videoData.title,
                    "文案": videoData.transcript,
                    "点赞量": Number(videoData.likes),
                    "收藏量": Number(videoData.favorites),
                    "评论量": Number(videoData.comments),
                    "视频URL": targetUrl
                });
            } catch (e) {
                console.error(`[ERROR] Failed to parse ${targetUrl}:`, e);
                failedUrls.push({ url: targetUrl, reason: e.message || '未知错误' });
            }

            // Anti-bot delay
            if (i < urlList.length - 1) {
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
            }
        }

        if (processedRecords.length > 0) {
            sendEvent('progress', { stage: 'uploading', message: `正在将 ${processedRecords.length} 条数据批量写入飞书...` });
            
            try {
                // Feishu batchCreate limit is 500 records per request
                const chunks = [];
                for (let i = 0; i < processedRecords.length; i += 500) {
                    chunks.push(processedRecords.slice(i, i + 500));
                }

                for (const chunk of chunks) {
                    const feishuRecords = chunk.map(r => ({ fields: r }));
                    await feishuClient.bitable.appTableRecord.batchCreate({
                        path: { app_token: appToken, table_id: viewId },
                        data: { records: feishuRecords }
                    });
                }
            } catch (e) {
                console.error('[ERROR] Feishu Write Failed:', e);
                let detail = e.message;
                if (e.code === 91403) detail = "飞书应用权限不足。请确保已将机器人添加为协作者。";
                throw new Error(`写入飞书失败: ${detail}`);
            }
        }

        sendEvent('success', { 
            message: `多视频解析完成！成功提取 ${processedRecords.length} 条数据。`, 
            url: tableUrl,
            stats: { success: processedRecords.length, failed: failedUrls.length, failures: failedUrls }
        });

    } catch (error) {
        logEvent('error', reqId, 'error', 'Multi Parsing failed', { error: String(error && error.message ? error.message : error) });
        sendEvent('error', { message: (error && error.message) ? error.message : '解析失败，请检查链接或稍后重试' });
    } finally {
        clearInterval(keepAliveInterval);
        multiJobData.delete(jobId);
    }
});

app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: `API route ${req.method} ${req.originalUrl} not found.`
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(err.status || 500).json({
        success: false,
        error: '内部服务器错误，请稍后重试'
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
