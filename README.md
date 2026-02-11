# TrendAnalyzor (TrendRadar Refactor)

基于 Node.js 22 + TypeScript 的新闻趋势追踪与分析工具。该工具可自动抓取多源热榜及实时新闻流，通过 LLM (DeepSeek/OpenAI/Anthropic) 进行小时级关键词提取与多日趋势聚类，并生成深度趋势报告通过邮件发送。

## 特性

- **多维抓取**：支持“热榜 (Hotlist)”与“实时流 (Stream)”两种模式，集成 `newsnow.busiyi.world` API。
- **智能分析**：利用 LLM 实现自动化新闻摘要、趋势聚类及跨周期（多日）深度分析。
- **本地存储**：数据以 JSON 格式按日期存储在本地 `archive/` 目录，轻量高效。
- **常驻服务**：支持 `serve` 模式，内置 Cron 调度器与 Hono 状态监控接口。
- **类型安全**：全量 TypeScript 开发，使用 Zod 进行严格的配置校验与数据转换。

## 快速开始

### 1. 安装依赖

确保你已安装 Node.js 22 和 pnpm：

```bash
pnpm install
```

### 2. 配置文件

在项目根目录创建 `config.yaml`，参考以下配置（详见 `config.example.yaml`）：

```yaml
# 抓取配置
newsApiBaseUrl: "https://newsnow.busiyi.world"

# 热榜源 (定期抓取并分析)
hotlist_sources:
  - { id: weibo, name: "微博", type: api, url: "/api/s?id=weibo" }
  - { id: zhihu, name: "知乎", type: api, url: "/api/s?id=zhihu" }

# 实时新闻流 (高频抓取)
stream_sources:
  - { id: jin10, name: "金十数据", type: api, url: "/api/s?id=jin10" }

# 分析配置
analysis_window_days: 7    # 多日分析的时间窗口
enable_stream_analysis: true
monitorCron: "*/30 * * * *" # 监控任务频率
reportCron: "0 23 * * *"    # 日报生成时间
serverPort: 12440

# LLM 配置 (支持 OpenAI, DeepSeek, Anthropic)
llmProvider: "deepseek"
llmApiKey: "your-api-key"
llmBaseUrl: "https://api.deepseek.com"
llmModel: "deepseek-chat"

# 邮件通知配置 (SMTP)
smtpPass: "your-app-password"
emailFrom: "sender@example.com"
emailTo:
  - "receiver@example.com"
```

### 3. 运行命令

项目使用 `cac` 构建 CLI 接口：

- **启动常驻服务 (推荐)**：
  ```bash
  pnpm dev serve
  ```
  启动内置调度器，按 Cron 配置自动执行监控与汇报任务，并开启状态监控服务（默认端口 12440）。

- **手动运行监控**：
  ```bash
  pnpm dev monitor
  ```
  抓取配置中的所有源，更新索引并进行 AI 关键词提取。

- **手动生成日报**：
  ```bash
  pnpm dev report [--date YYYY-MM-DD] [--id index]
  ```
  生成指定日期的趋势报告并发送邮件。

- **测试邮件配置**：
  ```bash
  pnpm dev test-email
  ```

## 部署建议

### 使用 PM2 (推荐)
```bash
pm2 start "pnpm dev serve" --name trend-radar
```

### 使用 Crontab
如果不想使用常驻进程，可利用 `start.sh` 配合系统 Crontab：
```bash
# 每小时运行一次抓取
0 * * * * /path/to/project/start.sh monitor
# 每天 23:30 发送日报
30 23 * * * /path/to/project/start.sh report
```

## 开发与测试

- **运行单元测试**：`pnpm test`
- **编译项目**：`pnpm build`
- **类型检查**：`pnpm run build` (执行 tsc)

## 目录结构

- `src/core`: 核心编排逻辑 (Monitor, Reporter, Config 加载)
- `src/services`: 外部服务 (Crawler 抓取, Analyzer AI分析, Storage 存储, Notifier 邮件)
- `src/schema`: 数据校验 (Zod Schemas)
- `src/types`: 类型定义
- `src/utils`: 工具类 (Logger, Retry, Renderer)
- `archive/`: 数据归档目录 (自动生成)