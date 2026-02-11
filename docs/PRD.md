# TrendRadar Node.js 重构需求文档 (PRD)

## 1. 项目概述
将原 Python 编写的 TrendRadar 工具重构为基于 **Node.js 22 + TypeScript** 的轻量化、模块化脚本工具。该工具旨在通过 API 抓取实时新闻热榜，利用 LLM 进行趋势分析，并通过邮件推送深度报告。

## 2. 核心技术栈
- **Runtime**: Node.js 22 (LTS)
- **Language**: TypeScript 5.x
- **Package Manager**: pnpm
- **CLI**: `cac`
- **Validation**: `zod` (配置验证与 LLM 输出校验)
- **HTTP Client**: `ofetch`
- **LLM Integration**: `openai` (兼容 DeepSeek)
- **Notification**: `nodemailer`
- **Utilities**: `date-fns`, `yaml`, `pino` (logging), `cron` (scheduling), `hono` (status)

## 3. 业务流程与功能模块

### 3.1 配置与初始化 (Init & Config)
- **参数解析**: 支持通过命令行参数 (Args)、环境变量 (`.env`) 和 YAML 配置文件进行配置。
- **校验机制**: 使用 `zod` 严格校验配置项（如 SMTP 服务器地址、LLM API Key 格式等）。
- **环境准备**: 自动检查并创建必要的存档目录（`archive/YYYY-MM-DD/raw`）。

### 3.2 新闻爬取模块 (Crawler)
- **数据源**: 访问 `newsnow.busiyi.world` API 获取 JSON 格式的热搜榜单。
- **采集策略**: 支持定时抓取（如每小时一次），记录新闻标题、URL、排名和原始热度值。
- **重试机制**: 实现指数退避 (Exponential Backoff) 的重试策略。

### 3.3 数据存储与去重 (Storage & Deduplication)
- **原始存档**: 将每次抓取的数据存储为 `archive/YYYY-MM-DD/raw/HH-mm.json`。
- **数据去重**: 
  - **强去重**: 基于新闻 URL 的唯一性。
  - **弱去重**: 基于标题文本的模糊匹配。
- **持久化**: 维护当日新闻索引文件，记录每条新闻的“首次发现时间”和“最高排名”。

### 3.4 LLM 分析模块 (Analysis)
- **阶段一：关键词提取 (每小时)**
  - 将当前小时的新增/热门新闻发给 LLM，提取热点关键词和核心摘要。
  - 结果存入 `archive/YYYY-MM-DD/keywords.json`。
- **阶段二：深度趋势报告 (生成日报时)**
  - **上下文聚合**: 读取当日所有的 `keywords.json` 以及前 3 天的报告摘要。
  - **提示词工程**: 利用 `.md` 提示词模板，指导 LLM 分析关键词热度演变、关联新闻聚合及趋势预测。
  - **输出**: 生成 Markdown 格式的报告文件。

### 3.5 邮件推送模块 (Notifier)
- **SMTP 集成**: 通过 `nodemailer` 发送生成的 Markdown 报告。
- **模板渲染**: 将 Markdown 转换为 HTML（内联 CSS）。

## 4. 目录结构设计
```text
theseus/
├── config/               # 存放 YAML 配置模板与 LLM Prompts
├── src/
│   ├── core/             # 核心逻辑编排
│   ├── services/
│   │   ├── crawler.ts    # API 抓取
│   │   ├── analyzer.ts   # LLM 交互与去重
│   │   ├── storage.ts    # 文件系统读写
│   │   └── notifier.ts   # SMTP 发送
│   ├── schema/           # Zod 定义的配置与数据模型
│   ├── types/            # TS 类型定义
│   ├── utils/            # 工具函数 (logger, retry, date)
│   └── index.ts          # CLI 入口
├── archive/              # 数据存档目录 (自动创建)
├── package.json
└── tsconfig.json
```

## 5. 关键改进点
1. **增量分析**: 采用“小时提取关键词+日报汇总关键词”的两级分析，节省 Token 并提高分析质量。
2. **状态记录**: 增加过往 3 天热点摘要存档，支持跨周期的趋势分析。
3. **类型安全**: 全程使用 TypeScript 和 Zod 确保数据流的可预测性。
