# Agent 与 Workflow Core 技术设计

## 1. 目标

本设计覆盖 Hot Board Monitor 的 Agent Core 与 Workflow Core。目标是形成一个有发展空间、但首版不过度完善的核心架子，支撑后续 CLI、TUI、Web UI、定时任务、新闻抓取、热点分析、报告生成和报告阅读。

本设计不深入展开 UI 实现。CLI、TUI 和 Web UI 都作为接入方，复用同一套 core。

## 2. 总体方案

采用 **SDK Chat + 自研 Workflow Core** 的混合路线。

OpenAI 官方 SDK 负责：

- 普通 chat 调用。
- streaming。
- tool calling。
- structured output 能力。
- 兼容 OpenAI API 的模型接入。

项目自研 core 负责：

- `AgentSession` 抽象。
- `ToolRegistry`。
- `Skill` prompt 与 schema 规范。
- `WorkflowRunner`。
- `ArchiveStore`。
- `RunRecord`。
- 业务 workflow 状态推进。
- 归档 artifact 结构。

核心边界是：SDK 是模型通信层和普通 chat tool calling 层，不拥有业务 runtime；WorkflowRunner 和 ArchiveStore 才拥有长期业务状态。

推荐目录骨架：

```text
apps/
  cli/
  tui/
  gateway/
packages/
  agent-core/
  workflow-core/
  archive/
  tools/
  skills/
  config/
```

## 3. Agent Core

`AgentSession` 是面向用户的主会话抽象。它不自己实现完整 ReAct runtime，而是通过 OpenAI SDK 使用普通 chat 和 tool calling。

`AgentSession` 负责：

- 组织用户输入、会话上下文和系统提示。
- 暴露可用 tools。
- 加载必要的 skill prompt。
- 调用 OpenAI SDK。
- 把 tool calling 分发到 `ToolRegistry`。
- 读取报告和归档内容回答用户问题。
- 触发 workflow 或查询 workflow 状态。

`AgentSession` 不负责：

- 新闻抓取细节。
- 归档文件写入细节。
- 长 workflow 状态推进。
- 定时任务调度。
- 并发 subagent runtime。

首版保留 subagent 抽象，但不实现并发 runtime：

```ts
interface SubagentService {
  spawn(task: SubagentTask): Promise<SubagentResult>;
}
```

首版可以提供 `NotImplementedSubagentService`。这样未来可以扩展 main session spawn subagent 的能力，但当前不会引入任务池、取消、超时、并发聚合等复杂度。

## 4. Tool、Skill 与 Workflow

### Tool

Tool 是稳定、可测试的代码能力。Tool 输入输出需要有 schema 或类型约束。

首批 tools：

- `crawl_news`：执行新闻爬取 script，返回固定格式新闻结果，并写入 raw news artifact。
- `read_archive`：读取归档 artifact。
- `write_archive`：写入归档 artifact。
- `run_workflow`：启动固定 workflow。
- `get_workflow_status`：查询 workflow run 状态。
- `list_reports`：列出报告。
- `read_report`：读取报告。

`crawl_news` 不依赖 LLM 自由浏览。它作为稳定 script/tool，负责新闻抓取、基础清洗、去重、信源信息写入和 raw news 归档。

### Skill

Skill 不是 workflow node，也不拥有执行生命周期。Skill 只是给 LLM 的知识和约束。

每个 skill 使用轻量文件组织：

```text
packages/skills/
  analyze-hot-topics/
    SKILL.md
    output.schema.json
  generate-report/
    SKILL.md
    output.schema.json
  read-report/
    SKILL.md
    output.schema.json
```

Workflow 中的 LLM step 执行时加载 skill prompt 和 output schema，再调用 OpenAI SDK。LLM 输出必须通过 schema 校验后才能写入 archive。

首批 skills：

- `analyze-hot-topics`：指导 LLM 为新闻增加 score/topic annotations，并生成轻量 topic index。
- `generate-report`：指导 LLM 基于窗口内 annotated news 和 topic index 生成报告。
- `read-report`：指导 LLM 阅读历史报告并回答问题。

### Workflow

首版使用 TypeScript descriptor 定义 workflow，但保留未来演进到声明式 JSON/YAML 的空间。

示例：

```ts
defineWorkflow({
  id: "news_hot_report",
  steps: [
    step({
      id: "crawl_news",
      kind: "tool",
      uses: "crawl_news",
      output: "news.raw"
    }),
    step({
      id: "annotate_news",
      kind: "llm",
      skill: "analyze-hot-topics",
      input: "news.raw",
      output: ["news.annotated", "topics.index"],
      outputSchema: "skills/analyze-hot-topics/output.schema.json"
    }),
    step({
      id: "generate_report",
      kind: "llm",
      skill: "generate-report",
      input: ["news.annotated", "topics.index"],
      output: "report"
    })
  ]
})
```

WorkflowRunner 负责：

- 创建 run record。
- 顺序执行 workflow steps。
- 调用 tool 或 LLM step。
- 加载 skill prompt 和 schema。
- 校验 step 输出。
- 写入 archive artifact。
- 记录 step 日志和 artifact refs。

## 5. 新闻、信源、权重与分析倾向

每条新闻必须包含信源 meta：

```json
{
  "id": "news-001",
  "source": {
    "id": "source-x",
    "name": "Example News",
    "url": "https://example.com",
    "type": "rss"
  },
  "title": "...",
  "content": "...",
  "publishedAt": "...",
  "fetchedAt": "...",
  "metadata": {}
}
```

不同信源可以配置权重：

```json
{
  "id": "source-x",
  "name": "Example News",
  "weight": 0.8
}
```

信源权重是热点评分参考项，不直接决定 topic。评分可以综合：

- 新闻内容重要性。
- 信源权重。
- 多信源交叉出现情况。
- 时间新鲜度。
- 用户分析倾向。

用户可以配置分析倾向，但系统不使用固定枚举标签作为 topic 空间。

示例 `analysisProfile`：

```json
{
  "id": "default",
  "focus": ["民生", "国际大事", "经济", "军事", "科技热点"],
  "instruction": "在不忽略重大公共事件的前提下，更关注科技和经济热点。"
}
```

`analysisProfile` 只影响 LLM 的关注方向。最终 topic 由 LLM 根据新闻内容开放生成，不局限在预设类别内。

## 6. ArchiveStore 与数据流

首版使用纯文件 artifact，不引入 SQL。所有读写通过 `ArchiveStore` 接口完成，未来可以替换成 document db 实现。

接口方向：

```ts
interface ArchiveStore {
  writeArtifact(input: WriteArtifactInput): Promise<ArtifactRef>;
  readArtifact(ref: ArtifactRef): Promise<Artifact>;
  listArtifacts(query: ArtifactQuery): Promise<ArtifactRef[]>;
}
```

推荐目录：

```text
.hot-board/
  artifacts/
    news/
      raw/
      annotated/
    topics/
    reports/
    runs/
  config/
    sources.json
    analysis-profiles.json
```

数据流：

```text
news sources
 -> crawl_news tool
 -> raw news artifact
 -> analyze-hot-topics skill
 -> annotated news artifact + topic index artifact
 -> generate-report skill
 -> report artifact
 -> read-report skill / read_report tool
 -> user conversation
```

不要单独建立 `scores` 目录。score 和 topic 信息作为新闻 annotation 追加到新闻 artifact 上：

```json
{
  "id": "news-001",
  "title": "...",
  "content": "...",
  "annotations": {
    "score": 0.91,
    "topicIds": ["topic-001"],
    "reason": "..."
  }
}
```

topic index 只保存聚合信息和 news refs，不重复保存完整正文：

```json
{
  "topicId": "topic-001",
  "title": "...",
  "heat": 0.87,
  "keywords": ["能源", "供应链"],
  "newsRefs": ["news-001", "news-002"]
}
```

报告生成节点读取窗口内的 annotated news 和 topic index。这样报告输入仍接近原始新闻数据量，避免重复语料污染。

## 7. 报告窗口与定时工作流

首版核心 user stories：

- 每天生成最近 24 小时新闻总结日报。
- 每周生成两次最近 96 小时新闻总结周报。

报告窗口使用相对运行时间回看，而不是固定自然日或自然周。

示例：

```text
runAt = 2026-05-07 08:00
daily window = 2026-05-06 08:00 ~ 2026-05-07 08:00

runAt = 2026-05-07 08:00
96h window = 2026-05-03 08:00 ~ 2026-05-07 08:00
```

Workflow input：

```json
{
  "reportType": "daily",
  "windowHours": 24,
  "analysisProfileId": "default"
}
```

推荐内置 workflow：

- `daily_news_report`：窗口为最近 24 小时。
- `semiweekly_news_report`：窗口为最近 96 小时。

Scheduler 只负责触发 workflow，不直接执行 LLM 调用或写 archive。

## 8. RunRecord 与日志

错误处理首版只要求日志可追溯、问题可定位，不做复杂恢复系统。

每次 workflow 运行产生 `RunRecord`：

```json
{
  "id": "run-001",
  "workflowId": "daily_news_report",
  "status": "running",
  "startedAt": "...",
  "finishedAt": null,
  "steps": [
    {
      "id": "crawl_news",
      "status": "succeeded",
      "startedAt": "...",
      "finishedAt": "...",
      "inputRefs": [],
      "outputRefs": ["artifact-news-raw-001"],
      "error": null
    }
  ]
}
```

日志要求：

- 每个 step 记录开始、结束、状态、输入 refs、输出 refs。
- Tool 失败记录错误消息和必要上下文。
- 单个新闻信源失败需要记录 source-level error。
- LLM 输出 schema 校验失败需要记录校验错误和原始输出摘要。
- 已成功写入的 artifact 不删除。

首版不要求自动重试或 resume。失败时 workflow 标记 failed，并保留 run record、日志和已生成 artifact refs，确保问题可发现、可追溯、可定位。

## 9. 入口接入

CLI、TUI、Web UI 都复用同一套 core：

```text
CLI chat -> AgentSession
TUI chat -> AgentSession
Web /chat -> AgentSession

CLI workflow run -> WorkflowRunner
Scheduler -> WorkflowRunner
Web action -> WorkflowRunner
```

Gateway 使用 Hono 和 SSR JSX，但 UI 不是本设计重点。Gateway 不复制业务逻辑，只调用 agent core、workflow core 和 archive API。

## 10. 首版边界

首版需要做到：

- `AgentSession` 抽象。
- OpenAI SDK adapter。
- `ToolRegistry`。
- Skill prompt + schema 目录规范。
- TypeScript workflow descriptor。
- `WorkflowRunner`。
- `FileArchiveStore`。
- `RunRecord`。
- `daily_news_report` 和 `semiweekly_news_report` 工作流设计。
- 新闻信源 meta、信源权重和 analysis profile 作为 workflow 输入。

首版不做：

- 并发 subagent runtime。
- 声明式 workflow 文件格式。
- SQL 或 document db 存储实现。
- 复杂 workflow resume。
- 复杂 Web UI workflow builder。
- 多用户权限系统。
