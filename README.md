# TrendRadar Refactor (Node.js)

基于 Node.js 22 + TypeScript 的新闻趋势追踪工具。该工具会自动抓取多源热榜新闻，通过 LLM (OpenAI/DeepSeek) 进行小时级关键词提取，并生成每日趋势日报通过邮件发送。

## 特性

- **多源抓取**：集成 `newsnow.busiyi.world` API，支持微博、知乎、36氪等数十个数据源。
- **智能分析**：利用 Vercel AI SDK 接入 LLM，实现自动化的新闻摘要与趋势聚类。
- **本地存储**：数据以 JSON 格式存储在本地 `archive/` 目录，无需数据库。
- **可靠性**：内置指数退避重试机制，确保在网络波动时依然稳定。
- **类型安全**：全量 TypeScript 开发，使用 Zod 进行配置校验。

## 快速开始

### 1. 安装依赖

确保你已安装 Node.js 22 和 pnpm：

```bash
pnpm install
```

### 2. 配置文件

在项目根目录创建 `config.yaml`，参考以下配置：

```yaml
# 抓取配置
newsApiBaseUrl: "https://newsnow.busiyi.world"
sources:
  - weibo
  - zhihu
  - 36kr-quick
monitorCron: "*/30 * * * *"
reportCron: "0 23 * * *"
serverPort: 12440

# 存储配置
archiveDir: "./archive"

# LLM 配置 (支持 OpenAI 兼容接口)
llmProvider: "openai"
llmApiKey: "your-api-key"
llmBaseUrl: "https://api.deepseek.com" # 可选，如使用 DeepSeek
llmModel: "deepseek-chat"

# 邮件通知配置 (SMTP)
# 对于常用邮箱 (Gmail, QQ, Outlook, 163 等)，smtpHost, smtpPort, smtpUser 可选
# smtpUser 默认使用 emailFrom
smtpPass: "your-app-password"
emailFrom: "your-email@example.com"
emailTo:
  - "receiver@example.com"
```

### 3. 运行命令

项目使用 `cac` 构建 CLI 接口，你可以通过以下命令操作：

- **抓取并分析新闻（每小时）**：
  ```bash
  pnpm dev monitor
  ```
  该命令会抓取 `config.yaml` 中配置的所有源，更新每日索引，并对新内容进行 AI 关键词提取。

- **生成并发送日报（每天）**：
  ```bash
  pnpm dev report
  ```
  该命令会根据全天的分析记录，生成一份 Markdown 格式的深度趋势报告并发送邮件。

- **测试邮件配置**：
  ```bash
  pnpm dev test-email
  ```

- **查看帮助**：
  ```bash
  pnpm dev --help
  ```

## 自动化部署 (Crontab)

使用项目根目录下的 `start.sh` 脚本进行定时任务部署。

1. 给脚本执行权限：`chmod +x start.sh`
2. 编辑 crontab：`crontab -e`
3. 添加任务：

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

- `src/core`: 核心编排逻辑 (Monitor, Reporter, Config)
- `src/services`: 外部服务 (Crawler, Analyzer, Storage, Notifier)
- `src/schema`: Zod 校验 Schema
- `src/types`: TypeScript 类型定义
- `src/utils`: 常用工具 (Logger, Retry)
