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

- **手动生成日报/历史趋势报告**：
  ```bash
  # 生成今日报告 (1 AM 至今)
  pnpm dev report
  
  # 生成指定日期的日报
  pnpm dev report --date 2026-02-13
  
  # 生成自定义时间窗口的历史报告 (支持跨度高达 7 天)
  pnpm dev report --start "26-02-10 10:00" --end "26-02-13 18:00"
  
  # 使用特定的配置文件
  pnpm dev report --config config.dev.yaml
  ```
  生成指定范围的趋势报告并发送邮件。

- **测试邮件配置**：
  ```bash
  pnpm dev test-email
  ```

## API 与参数定义

### 1. CLI 参数详解 (cac)

| 参数 | 别名 | 描述 | 默认值 | 示例 |
| :--- | :--- | :--- | :--- | :--- |
| `--config` | `-c` | 配置文件路径 | `config.yaml` | `config.dev.yaml` |
| `--date` | - | 日报指定日期 (YYYY-MM-DD) | 当天 | `2026-02-13` |
| `--start` | - | 历史报告起始时间 (yy-mm-dd hh:MM) | 当天 01:00 | `26-02-10_10:00` |
| `--end` | - | 历史报告结束时间 (yy-mm-dd hh:MM) | 当前时间 | `26-02-13_18:00` |

> **提示**：为了方便在 URL 中输入，时间格式中的空格可以用下划线 `_` 或 `T` 代替。
| `--id` | - | 收件人索引 (在 emailTo 列表中的下标) | 全部发送 | `0` |

### 2. HTTP 监控接口 (Hono)
常驻模式 (`serve`) 启动后，可通过 HTTP 访问以下接口：

*   **GET `/`**：返回系统健康状态、运行时间 (Uptime) 及监控/报告任务的最近运行结果。
*   **GET `/run/monitor`**：手动触发一次抓取与分析任务。
*   **GET `/run/report?start=26-02-10_10:00&end=26-02-13_18:00&id=0`**：手动触发一次报告生成与发送。
支持通过 `start` 和 `end` 参数指定时间段，通过 `id` 参数指定收件人索引。

### 3. 配置参数详解 (Zod Schema)

| 键名 | 类型 | 必填 | 描述 |
| :--- | :--- | :--- | :--- |
| `newsApiBaseUrl` | String (URL) | 是 | 数据抓取 API 的基础地址。 |
| `hotlist_sources` | Array<Object> | 是 | 热榜源配置。包含 `id`, `name`, `type` (api/rss/html), `url`。 |
| `stream_sources` | Array<Object> | 否 | 实时流配置。结构同热榜源。 |
| `report_window_days` | Number | 否 | 自动报告的时间窗口（默认 1）。设置为 3 则自动生成过去 3 天的趋势报告。 |
| `analysis_window_days` | Number | 否 | 多日分析的回溯天数（默认 3）。 |
| `monitorCron` | String (Cron) | 否 | 抓取任务调度。默认 `*/30 * * * *`（每30分钟）。 |
| `reportCron` | String (Cron) | 否 | 报告生成调度。默认 `0 23 * * *`（每天23:00）。 |
| `llmProvider` | String | 是 | `openai`, `deepseek` 或 `anthropic`。 |
| `llmApiKey` | String | 是 | 对应的 API Key。 |
| `llmModel` | String | 是 | 模型名称（如 `deepseek-chat`）。 |
| `emailTo` | Array<String> | 是 | 接收报告的邮箱列表。 |

## 部署建议

### 使用 PM2 (推荐常驻模式)
利用内置的 `serve` 命令配合 PM2 开启守护进程：
```bash
pm2 start "pnpm dev serve" --name trend-radar
```

### 使用 Crontab (手动模式)
如果倾向于使用系统级定时任务，可以直接调用 CLI 命令：
```bash
# 每小时运行一次抓取与分析
0 * * * * cd /path/to/project && /usr/local/bin/pnpm dev monitor >> /tmp/monitor.log 2>&1

# 每天 23:30 发送日报
30 23 * * * cd /path/to/project && /usr/local/bin/pnpm dev report >> /tmp/report.log 2>&1
```
> **注意**：请确保 cron 任务中 `pnpm` 和 `node` 的路径正确。

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