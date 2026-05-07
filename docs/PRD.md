# Hot Board Monitor Agent PRD

## 1. 产品定位

Hot Board Monitor 是一个基于 Node.js 22 的 agent 应用。它的核心目标是帮助用户持续抓取新闻、分析热点、生成阶段性热点报告，并通过对话方式阅读和理解这些报告。

应用需要提供三个入口：

- CLI：核心入口。
- TUI：通过 CLI 启动的终端交互界面。
- Web UI：通过 gateway 启动后访问的浏览器界面。

## 2. 核心能力

Agent 需要支持以下能力：

- 执行固定工作流。
- 执行定时任务。
- 爬取新闻。
- 分析爬取到的新闻并提取热点信息。
- 整合较长时间段内的热点信息并生成报告。
- 阅读已经生成的报告，并支持基于报告内容进行对话。

## 3. CLI 与 Gateway

CLI 是系统的核心入口，需要至少支持：

- 与 agent 对话。
- 打开 TUI。
- `start gateway`。
- `stop gateway`。
- `status gateway`。
- `restart gateway`。

启动 gateway 后，用户可以进入 Web UI，与 agent 对话或进行设置。

## 4. TUI 与 Web UI

TUI 的具体实现方案可以自由选择，目标是提供终端内的 agent 交互体验。

Web UI gateway 需要满足：

- 使用 Hono 开发。
- 使用 SSR JSX 绘制页面。
- 提供与 agent 对话的页面。
- 提供设置页面。

## 5. 待确认事项

- TUI 的具体技术方案。
- 固定工作流的第一批内置流程。
- 定时任务的配置方式。
- 新闻源的类型和配置格式。
- 报告的存储格式与阅读方式。

