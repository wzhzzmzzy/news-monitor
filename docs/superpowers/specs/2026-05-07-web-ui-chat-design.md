# Web UI Chat 设计

## 1. 目标

Hot Board Monitor 的 Web UI 首版只提供两个页面：

- `/chat`：纯粹的 agent chat 工作台。
- `/settings`：应用配置页面。

本设计以当前确认的视觉稿为目标：左侧是 session list，右侧是圆角 main panel；侧栏与背景融为一体，main section 负责形成主要层级。页面不做报告 dashboard、独立 run 管理页或营销式首页。用户进入 Web UI 后首先看到可对话、可 streaming、可查看 tool 状态的 agent chat。

## 2. 技术路线

使用 Hono 作为 gateway，SSR JSX 渲染首屏页面，配合少量浏览器端 JavaScript 处理 session 切换、SSE streaming、Markdown 渲染、消息编辑和设置保存。

不引入完整 SPA 构建链。首版可以通过普通 CSS、少量客户端模块脚本和服务端 HTML 组成应用，后续如果交互复杂度明显上升，再评估是否引入前端构建工具。

核心新增模块：

- `apps/gateway`：Hono server、SSR JSX 页面、API routes、静态资源。
- `packages/app-paths`：XDG 路径解析。
- `packages/session-store`：JSON session 存储、message tree、session index。
- `packages/theme`：Catppuccin theme token 定义，Web UI 和未来 TUI 复用。
- `packages/agent-core` 扩展：streaming chat 与 tool event 输出。

## 3. XDG 路径

应用不再使用 `--config <path>` 或从当前目录探测 `config.dev.toml` 的配置方式。CLI、Gateway、TUI 和 core runtime 都从固定 XDG 目录解析。

目录规则：

```text
config: ${XDG_CONFIG_HOME:-~/.config}/hot-board-monitor
data:   ${XDG_DATA_HOME:-~/.local/share}/hot-board-monitor
cache:  ${XDG_CACHE_HOME:-~/.cache}/hot-board-monitor
state:  ${XDG_STATE_HOME:-~/.local/state}/hot-board-monitor
```

文件归属：

```text
config/
  config.toml
  sources.json
  analysis-profiles.json

data/
  artifacts/
  sessions/
    index.json
    <session-id>.json

cache/
  markdown/
  title-generation/
  stream-renders/

state/
  gateway.json
  logs/
```

测试可以通过注入环境变量或 path resolver 隔离目录，但用户入口不暴露任意配置文件路径。

## 4. Chat 页面

Chat 页面结构：

- 左侧 sidebar：品牌、侧栏收起按钮、新会话按钮、session list、左下角 settings icon button。
- 右侧 main section：圆角独立 panel，包含顶栏、消息流、输入区。
- 顶栏左侧展示当前 session title 和说明文字；右侧只有 light/dark toggle icon button。
- 顶栏不提供 Chat / Settings 文本按钮。
- Settings 入口只在左下角提供 `IconSettings`。

视觉约束：

- sidebar 不使用额外底色，直接融入页面背景。
- main section 与 sidebar 贴合，中间不留 gap。
- main section 有圆角、边界和轻微阴影，用于建立层级。
- 用户消息右对齐，使用浅色气泡。
- assistant 消息不展示 avatar 和 name，以 Markdown 文档流正常渲染。
- 历史用户消息的重编辑入口使用小型 `IconPencil` icon button，不使用文字按钮。
- 输入区固定在 main 底部，支持多行文本。

响应式行为：

- 窄屏时 sidebar 默认收起。
- 收起 sidebar 后，main 占满宽度。
- 移动端 main panel 可以取消外层圆角，避免窄屏浪费空间。

## 5. Settings 页面

Settings 页面从 `/settings` 进入。左上角使用 `IconArrowLeft` 返回 `/chat`，不提供多页导航栏。

配置项需要覆盖首版运行所需的全部关键能力。

### 5.1 LLM 主模型

主模型用于普通 agent chat、workflow LLM step、报告阅读和 tool calling。

字段：

- `llm.baseUrl`
- `llm.apiKey`
- `llm.model`
- `llm.thinking`
- `llm.timeoutMs`
- `llm.maxToolIterations`

`thinking` 可选值与当前 OpenAI adapter 保持一致：`minimal`、`low`、`medium`、`high`。

### 5.2 Flash 模型

Flash 模型单独配置，不隐式等同于主模型。它用于低成本、低延迟任务，例如 session title 生成。

字段：

- `flash.baseUrl`
- `flash.apiKey`
- `flash.model`
- `flash.thinking`
- `flash.timeoutMs`

默认行为：

- 如果 flash 配置完整，标题生成只使用 flash model。
- 如果 flash 配置缺失，标题生成退化为默认标题，例如“新会话”或用户首条消息摘要的确定性截断。
- 不自动调用主模型补位，避免用户误以为标题生成是低成本任务。

标题生成触发时机：

- 新 session 的第一轮 assistant 回复完成后。
- 用户重编辑导致 active branch 语义明显变化后，如果 session 尚未被用户手动命名。

`updatedAt` 永远由最新消息时间计算，不由模型生成。

### 5.3 NewsNow

字段：

- `newsnow.baseUrl`
- `newsnow.timeoutMs`
- `newsnow.maxItemsPerSource`

Settings 页面应显示连接配置，但首版不需要做实时连通性测试。后续可以增加“测试连接”按钮。

### 5.4 Sources

信源配置使用 JSON 文件保存，但 Settings 页面提供轻量编辑体验。

字段：

- `id`
- `name`
- `type`
- `sourceId`
- `weight`
- `enabled`

首版支持添加、编辑、禁用和删除 NewsNow 类型信源。删除前需要确认；禁用不删除配置。

### 5.5 Analysis Profiles

分析倾向配置继续使用开放 topic，不使用固定枚举 topic 空间。

字段：

- `id`
- `name`
- `focus`
- `instruction`
- `default`

Settings 页面支持选择默认 profile。Workflow 默认使用该 profile，除非 API input 显式覆盖。

### 5.6 Theme

主题分为两个层次：

- mode：`light` 或 `dark`，Chat 顶栏的 icon button 只切换这个值。
- variant：Catppuccin palette，Settings 中选择。

支持 variant：

- `latte`
- `frappe`
- `macchiato`
- `mocha`

推荐映射：

- light 默认使用 `latte`。
- dark 默认使用 `mocha`。

用户可以在 Settings 中指定 light variant 和 dark variant。Chat 页 toggle 只在这两套已配置 variant 间切换。

### 5.7 Gateway

Gateway 配置固定写入 XDG config/state，不通过 CLI 任意路径传入。

字段：

- `gateway.host`
- `gateway.port`
- `gateway.openBrowserOnStart`

Gateway 运行状态写入 XDG state，例如 `state/gateway.json`，包含 pid、host、port、startedAt。

## 6. Theme 与 Icon 系统

`packages/theme` 提供 Catppuccin token：

```ts
type ThemeVariant = "latte" | "frappe" | "macchiato" | "mocha";
type ThemeMode = "light" | "dark";
```

Web UI 使用 CSS variables，例如：

- `--base`
- `--mantle`
- `--crust`
- `--surface0`
- `--surface1`
- `--text`
- `--subtext0`
- `--green`
- `--yellow`
- `--red`
- `--blue`
- `--mauve`

TUI 后续复用同一份 token，再映射到终端颜色。

所有图标统一使用 Tabler Icons。首版需要：

- `IconPencil`
- `IconSettings`
- `IconArrowUp`
- `IconArrowLeft`
- `IconMoon`
- `IconSun`
- `IconLayoutSidebarLeftCollapse`
- `IconLayoutSidebarLeftExpand`

## 7. Session 存储

Session 使用 JSON 文本文件，存放在 XDG data：

```text
sessions/index.json
sessions/<session-id>.json
```

`index.json` 保存列表摘要：

```json
{
  "sessions": [
    {
      "id": "session_01",
      "title": "今日科技与经济热点追踪",
      "titleSource": "flash",
      "updatedAt": "2026-05-07T11:09:00.000Z",
      "status": "idle"
    }
  ]
}
```

单个 session 保存 message tree：

```json
{
  "id": "session_01",
  "title": "今日科技与经济热点追踪",
  "titleSource": "flash",
  "createdAt": "2026-05-07T11:07:00.000Z",
  "updatedAt": "2026-05-07T11:09:00.000Z",
  "activePath": ["msg_1", "msg_2"],
  "messages": [
    {
      "id": "msg_1",
      "role": "user",
      "content": "基于最近 24 小时的新闻，生成一份热点报告。",
      "parentId": null,
      "createdAt": "2026-05-07T11:07:00.000Z",
      "updatedAt": "2026-05-07T11:07:00.000Z"
    },
    {
      "id": "msg_2",
      "role": "assistant",
      "content": "生成的 Markdown 内容",
      "parentId": "msg_1",
      "createdAt": "2026-05-07T11:07:03.000Z",
      "updatedAt": "2026-05-07T11:09:00.000Z",
      "completedAt": "2026-05-07T11:09:00.000Z",
      "toolCalls": []
    }
  ]
}
```

写入要求：

- 所有 session 写入使用原子写：先写临时文件，再 rename。
- `index.json` 从 session 文件派生或同步维护；如果损坏，可以从 session 文件重建。
- JSON 保持可读格式，使用两个空格缩进。

## 8. 历史消息编辑与重发

用户可以对历史中任意 user message 点击 `IconPencil`。

交互流程：

1. 当前 user bubble 进入编辑态。
2. 编辑态显示多行输入框、取消按钮和发送按钮。
3. 用户提交后，在原消息 parent 之后创建一个新的 user message。
4. 新 user message 继承原消息之前的历史上下文。
5. `activePath` 切换到新分支。
6. 从新 user message 开始重新生成 assistant 回复。
7. 原分支继续保存在 message tree 中，但默认不展示。

首版不做分支切换 UI。数据结构保留分支能力，后续可以增加 branch picker。

如果用户编辑的是 active path 中间的消息，该消息之后的旧 active path 不删除，只是不再属于当前 active path。

## 9. Streaming 与 Tool 状态

Gateway 提供 SSE streaming。推荐 API：

```text
POST /api/sessions
GET  /api/sessions
GET  /api/sessions/:sessionId
POST /api/sessions/:sessionId/messages
POST /api/sessions/:sessionId/messages/:messageId/edit-resend
GET  /api/runs/:runId/events
GET  /api/settings
PUT  /api/settings
```

事件类型：

```text
assistant.thinking
assistant.created
assistant.delta
tool.started
tool.succeeded
tool.failed
assistant.completed
title.updated
run.failed
```

UI 行为：

- 发送 user message 后立即创建 assistant placeholder。
- 等待第一个 `assistant.delta` 前显示“思考中”。
- 收到任意 tool event 后，在当前 assistant 消息下方以小字状态行展示。
- tool 状态至少包括 `waiting`、`running`、`succeeded`、`failed`。
- assistant 输出结束后显示完成时间。
- `assistant.delta` 到达时增量显示文本。
- `assistant.completed` 后用 Markdown renderer 重新渲染完整内容。

Tool call 数据结构：

```json
{
  "id": "toolcall_01",
  "name": "crawl_news",
  "status": "succeeded",
  "startedAt": "2026-05-07T11:07:05.000Z",
  "finishedAt": "2026-05-07T11:07:12.000Z",
  "summary": "抓取 3 个信源，获得 86 条新闻",
  "error": null
}
```

## 10. Markdown 渲染

Assistant 输出默认是 Markdown。

渲染要求：

- 支持标题、段落、列表、引用、代码块、表格和链接。
- streaming 中可以先显示纯文本或轻量 Markdown，完成后统一渲染。
- HTML 输出必须 sanitize，避免直接渲染模型返回的危险 HTML。
- 代码块首版只要求等宽字体和换行，不要求语法高亮。

## 11. Agent Core 扩展

现有 `AgentSession.ask()` 是一次性返回，不满足 Web UI。新增 streaming 入口：

```ts
interface AgentEvent {
  type: string;
  payload: unknown;
}

class AgentSession {
  streamAsk(input: StreamAskInput): AsyncIterable<AgentEvent>;
}
```

`OpenAIModelClient` 增加：

```ts
generateWithToolsStream(input): AsyncIterable<AgentEvent>
```

Tool 执行继续走现有 `ToolRegistry`。Model client 在调用 tool 前后产生 tool event，Gateway 将事件转发给浏览器并写回 session JSON。

## 12. 错误处理

- 模型调用失败：assistant placeholder 显示失败状态，并保留用户消息。
- Tool 调用失败：tool 状态行显示 failed；是否继续由模型后续输出决定。
- SSE 连接断开：前端显示可重试状态，刷新后从 session JSON 恢复已完成内容。
- Session JSON 损坏：跳过损坏 session，在日志中记录错误；不阻止其他 session 加载。
- Settings 保存失败：保持页面输入值，显示错误。

## 13. 测试

单元测试：

- XDG path resolver。
- Settings loader/saver。
- SessionStore 创建、更新、原子写、index 重建。
- Message tree activePath 与 edit-resend 分支。
- Theme token 输出。
- SSE event 编码。

集成测试：

- Hono route 渲染 `/chat` 和 `/settings`。
- 创建 session、发送消息、写入 JSON。
- 模拟 streaming event，验证 session 中 assistant 内容和 toolCalls 更新。
- flash title generation 独立使用 flash config。

浏览器验证：

- Chat 页面初始布局。
- 用户消息右对齐浅色气泡。
- Assistant Markdown 渲染。
- Tool 状态行随事件变化。
- `IconPencil` 编辑并重发流程。
- Settings 页面保存主模型、flash 模型、主题和 NewsNow 配置。

## 14. 非目标

首版不做：

- 独立报告 dashboard。
- 分支切换 UI。
- 多用户登录。
- 云同步。
- 富文本编辑器。
- 复杂代码高亮。
- 前端 SPA 构建链。
