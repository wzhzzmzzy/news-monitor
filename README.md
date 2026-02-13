# TrendAnalyzor (TrendRadar Refactor)

基于 Node.js 22 + TypeScript 的新闻趋势追踪与分析工具。该工具可自动抓取多源热榜及实时新闻流，通过 LLM (DeepSeek/OpenAI/Anthropic) 进行小时级关键词提取与多日趋势聚类，并生成深度趋势报告通过邮件发送。

## 特性

- **多维抓取**：支持“热榜 (Hotlist)”与“实时流 (Stream)”两种模式，集成 `newsnow.busiyi.world` API。
- **双模汇报**：独立配置“当日简报”与“历史趋势报告”触发时间，灵活覆盖不同粒度的观察需求。
- **智能分析**：利用 LLM 实现自动化新闻摘要、趋势聚类及跨周期（多日）深度分析。

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
analysis_window_days: 7    # 历史趋势报告的回溯天数
enable_stream_analysis: true

monitorCron: "*/30 * * * *"          # 监控任务频率
dailyReportCron: "0 10,17 * * *"     # 当日简报触发时间 (每天10点和17点)
historicalReportCron: "0 9 * * 1"    # 历史报告触发时间 (每周一早9点)
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

*   **GET `/`**：返回系统健康状态、运行时间 (Uptime) 及监控/报告任务的最近运行结果（包含 `dailyReport` 和 `historicalReport`）。
*   **GET `/run/monitor`**：手动触发一次抓取与分析任务。
*   **GET `/run/daily-report`**：手动触发生成当日简报。
*   **GET `/run/historical-report`**：手动触发历史报告。不带参数时默认回溯 `analysis_window_days` 天；支持 `start` 和 `end` 参数自定义范围。
*   **GET `/run/report?start=26-02-10_10:00&end=26-02-13_18:00&id=0`**：向后兼容接口。有时间参数走历史模式，无参数走日报模式。

### 3. 配置参数详解 (Zod Schema)

| 键名 | 类型 | 必填 | 描述 |
| :--- | :--- | :--- | :--- |
| `newsApiBaseUrl` | String (URL) | 是 | 数据抓取 API 的基础地址。 |
| `hotlist_sources` | Array<Object> | 是 | 热榜源配置。包含 `id`, `name`, `type` (api/rss/html), `url`。 |
| `stream_sources` | Array<Object> | 否 | 实时流配置。结构同热榜源。 |
| `analysis_window_days` | Number | 否 | 历史趋势报告默认的回溯天数（默认 3）。 |
| `monitorCron` | String (Cron) | 否 | 抓取任务调度。默认 `*/30 * * * *`（每30分钟）。 |
| `dailyReportCron` | String (Cron) | 否 | 当日简报触发时间。默认 `0 23 * * *`。 |
| `historicalReportCron` | String (Cron) | 否 | 历史周报/周期报告触发时间。默认每周一 10:00。 |
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