# 抖音视频分析工具 (Douyin Video Analysis)

一个基于 Node.js + Puppeteer 的抖音视频数据采集与分析工具。支持从抖音抓取视频元数据，通过 Whisper 进行 AI 语音转写（听写文案），并将结果自动写入**飞书多维表格**。

## 功能特性

工具提供五大采集模式，前端为深色沉浸式界面，后端通过 Server-Sent Events (SSE) 实时推送进度：

| 功能 | 入口 | 说明 |
|------|------|------|
| **单视频解析** | `/` | 输入单个视频链接，解析并写入飞书 |
| **多视频解析** | `/multi.html` | 输入任意多个视频链接，逐个解析、批量写入，失败链接自动跳过并标注原因 |
| **主页全量采集** | `/batch.html?type=profile` | 自动遍历博主主页全部视频（无限滚动分页） |
| **主页范围采集** | `/batch.html?type=range` | 指定第 x 到第 y 条视频进行精准采集 |
| **合集视频采集** | `/batch.html?type=mix` | 采集指定合集内的全部视频 |

**核心能力：**
- 🎯 自动分页 / 无限滚动，遍历博主全部作品
- 🗣️ Whisper 本地语音转写，自动提取视频文案
- 🔄 断点续传（checkpoint），任务中断后可从上次进度恢复
- 🛡️ Puppeteer Stealth 反爬伪装 + 验证码检测提示
- 🈶 OpenCC 简繁转换，统一输出简体中文
- 📊 结果标准化写入飞书多维表格，五种模式字段结构一致
- 🔌 后台常驻任务，前端断开连接不影响采集继续执行

## 技术栈

- **后端**：Node.js、Express、Puppeteer (Stealth)、FFmpeg、whisper-node、OpenCC-js
- **前端**：原生 HTML / JavaScript、TailwindCSS (CDN)、SSE
- **持久化**：飞书多维表格 (Lark Bitable API)

## 环境要求

- Node.js >= 18
- macOS / Linux（Puppeteer 需下载 Chromium）
- 首次安装会通过 `postinstall` 自动下载 Whisper `base` 模型（约 148MB）

## 快速开始

### 1. 克隆并安装依赖

```bash
git clone https://github.com/wuhaadesign/douyin_video_analysis.git
cd douyin_video_analysis
npm install
```

> `npm install` 会自动下载 Puppeteer 的 Chromium 以及 Whisper 语音模型，首次安装耗时较长，请耐心等待。

### 2. 配置环境变量（可选）

复制示例文件并按需填写：

```bash
cp .env.example .env
```

| 变量 | 说明 | 是否必填 |
|------|------|----------|
| `PROXY_SERVER` | 代理服务器地址，用于轮换 IP 规避风控 | 否 |
| `LLM_API_KEY` | LLM API Key，启用后自动修正转写中的中英混杂错误 | 否 |
| `LLM_API_BASE_URL` | LLM 接口地址（OpenAI / DeepSeek 等） | 否 |
| `LLM_MODEL` | 使用的模型，如 `gpt-4o-mini`、`deepseek-chat` | 否 |

> 未配置 `LLM_API_KEY` 时，系统会跳过 AI 文案修正，其余功能不受影响。

### 3. 启动服务

```bash
npm start
```

服务默认运行在 [http://localhost:3000](http://localhost:3000)（可通过环境变量 `PORT` 修改）。

## 飞书多维表格配置

在前端页面填入以下三项凭证即可将数据写入飞书：

- **App ID** / **App Secret**：飞书开放平台创建的企业自建应用凭证
- **App Token**：目标多维表格的标识（表格 URL 中 `base/` 后的字符串）

程序会自动检测并创建以下字段（若不存在）：

| 字段名 | 类型 |
|--------|------|
| 标题 | 文本 |
| 文案 | 文本 |
| 点赞量 | 数字 |
| 收藏量 | 数字 |
| 评论量 | 数字 |
| 视频URL | 文本 |

> ⚠️ 请确保已将该应用（机器人）添加为多维表格的**协作者**并授予**可编辑**权限，否则会返回 `91403 Forbidden` 错误。

## 项目结构

```
.
├── server.js              # 后端核心：采集引擎 + 飞书写入 + SSE + 断点续传
├── package.json           # 依赖与脚本
├── .env.example           # 环境变量模板
├── checkpoints/           # 断点续传缓存（运行时自动生成）
└── public/                # 前端静态资源
    ├── index.html/script.js   # 单视频解析
    ├── multi.html/multi.js    # 多视频解析
    ├── batch.html/batch.js    # 主页全量 / 范围 / 合集采集
    └── style.css              # 视频封面比例样式
```

## API 接口

所有采集接口均基于 SSE（`text/event-stream`）实时推送进度。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/parse/stream` | 单视频解析 |
| POST | `/api/multi/init` | 初始化多视频任务，返回 jobId |
| GET | `/api/multi/stream` | 多视频解析（持 jobId 连接） |
| GET | `/api/batch/stream` | 主页全量 / 范围采集（`startIdx`、`endIdx` 可选） |
| GET | `/api/mix/stream` | 合集采集 |
| POST | `/api/batch/stop` | 停止后台采集任务 |
| GET | `/api/checkpoint` | 查询断点 / 任务运行状态 |

## 免责声明

本工具仅供学习与研究使用。请遵守抖音平台的服务条款及相关法律法规，合理控制抓取频率，尊重内容创作者的版权，切勿用于商业或非法用途。
