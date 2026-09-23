# 配置入口

运行 `node dist/index.js news -c config.feed.local.yaml --edition morning --refresh`。命令会访问来源；只想改配置时不用执行采集。默认配置为根目录 `config.example.yaml`，本机任务显式使用 `config.feed.local.yaml`。

| 文件 | 用途 |
| --- | --- |
| `config.example.yaml`（根目录） | 主入口：引用文件、归档路径、RSSHub、调度、邮件、编辑偏好 |
| `config/sources/rss.yaml` | RSS/Atom/RSSHub 来源数组 |
| `config/sources/x.yaml` | X 用户/List 来源数组；公开示例默认停用 |
| `feeds/hn-popular-blogs.json` | Blog 排名、Feed URL、别名、启用状态和未接入原因，通过 `blogCatalog` 引用 |
| `config/runtime.yaml` | 采集超时、重试、并发、X 开关与摘要处理预算 |
| `config/llm.example.yaml` | LLM 接口、模型、鉴权变量、请求与输出参数模板 |
| `config/editorial.yaml` | 精选数量范围与四类入选标准，传给报告编辑 Agent |
| `config/prompts.yaml` | 中文摘要、长文合并、格式重试及可选全文模式提示词 |
| `config/local/` | Git 忽略的本机覆盖：`rss.yaml`、`x.yaml`、`llm.yaml`；可自行增加文件 |

主配置可写成：

```yaml
includes:
  - ./config/runtime.yaml
  - ./config/prompts.yaml
  - ./config/editorial.yaml
  - ./config/local/llm.yaml
sourceFiles:
  - ./config/local/rss.yaml
  - ./config/local/x.yaml
blogCatalog: ./feeds/hn-popular-blogs.json
archiveDir: ./archive/feed-v1
localization:
  mode: summary
opencli:
  enabled: false # 要恢复 X 采集时设为 true；也可逐个 source.enabled 控制
curation:
  minPicks: 10
  maxPicks: 20
  interests: 技术、商业与人文；优先重要变化、原始信息和深入分析。
```

`includes` 按顺序加载，本文件最后覆盖；对象递归合并，数组和标量整体替换。各文件均为普通 YAML 对象，可以拆分邮件、调度和编辑偏好等任意现有配置块，不限于这些文件名。`sourceFiles` 中每个文件必须是来源数组，按顺序与同文件内的 `sources` 拼接，然后整体替换被包含文件的来源列表；全局 ID 重复直接报错，不静默覆盖。循环引用、缺失文件和非法参数在采集前报错。旧版单文件 `sources` 配置继续可用。

`includes`、`sourceFiles`、`archiveDir`、`blogCatalog`、`llm.piModelsPath` 的相对路径均基于声明它的配置文件（符号链接按实际文件位置）；`~/` 仅用于 Pi 模型路径。`blogCatalog` 仍使用现有 JSON 结构，不接受裸来源数组。进程启动时加载配置；修改后重新运行 CLI，已有 `serve` 需要重启。部署时需一并带上 `config/` 和被引用的文件。

## 模型与摘要

默认 `localization.mode: summary` 对 RSS、X、Blog 全部生成中文标题和不超过 200 个 Unicode 字符的中文摘要，不生成正文译文。原始内容、发布时间和链接继续归档；HTML 可展开原文。中文原题保持，外语标题在同一次摘要请求中处理。

- `summaryChunkChars: 24000`：每段最大输入字符数；常规文章一次调用，超长文本逐段摘要，再递归合并全部段落，保留尾部信息。按模型上下文容量调小即可。
- `concurrency: 2`：最多并发处理文章数（1–4）。
- `blogBatchSize: 20`：独立 collect 每轮新处理博客数（0–500，0 只复用缓存）；报告忽略此额度，窗口内全部新闻和博客必须处理到成功或失败。
- `enabled: false`：独立采集只归档原文并标记 disabled；报告流程明确记为无法执行摘要的 failed，保留原文。
- `mode: full` 与 `chunkChars: 3000`：仅显式选择时恢复旧全文模式；日常配置统一用 summary。

LLM 配置通过 `includes` 引用 `config/local/llm.yaml`，从 `llm.example.yaml` 复制修改即可。`piProvider`/`piModelsPath` 可复用 Pi 模型目录；也可直接设置 `baseUrl`、`model`、`apiKeyEnv`。`apiKeyEnv` 是环境变量名，禁止把密钥写进提示词或提交到仓库；程序不自动加载 `.env`，不执行配置里的凭据命令。

| LLM 字段 | 默认值 / 作用 |
| --- | --- |
| `mode` | `json`，结构化输出模式；支持 `auto`、`tool` |
| `timeoutMs` | 120000，单次生成超时 |
| `maxRetries` | 1，SDK 请求重试次数，0–5 |
| `validationRetries` | 1，生成/格式/中文/长度失败后的处理层重试，0–5；总尝试数最多 `(maxRetries+1)*(validationRetries+1)` |
| `summaryMaxTokens` | 1024，摘要和合并请求输出上限 |
| `translationMaxTokens` | 8192，仅可选全文模式 |
| `temperature` | 省略时使用 SDK/服务默认值，可指定 0–2 |

`prompts.common` 是共享指令，`summaryPart` 为逐篇/逐段摘要，`reduce` 合并长文摘要，`retry` 用于失败后的校验重试；`translate` 仅在 full 模式使用。支持 YAML 多行文本，无模板执行或 shell 插值。模型输出字段、中文与 200 字符上限、证据引用和发布时间范围属于程序约束，修改提示词不能解除。原文是待处理数据，不是指令。

缓存包含原文、模型、提示词内容、输出长度和 temperature；变更生成参数/提示词会重新生成，单改超时、重试或并发不会。兼容默认历史配置时优先复用旧译文缓存内的标题和摘要，丢弃输出中的旧译文，缓存原文件不改写。已发布的旧报告和冻结快照不重写。

## 采集与其他参数

`collection` 支持 `rssConcurrency`（4）、`rssTimeoutMs`（20000）、`rssRetries`（1）、`retryDelayMs`（500）、`userAgent`、`xMaxItems`（1000）。RSS 只对网络错误/5xx 重试，不对认证、限流或无效 XML 重试。`opencli` 支持 `enabled`（true）、`profile`、`timeoutMs`（120000）、`maxBufferBytes`（10485760）。X 仍串行采集；关闭总开关会记录 disabled，不能解释为没有新闻。来源错误只保存脱敏类别、HTTP 状态与退出码，不保存可能带凭据的 stderr。

来源字段为 `id/name/category/type/limit/enabled/disabledReason`，RSS 使用 `url`，RSSHub 使用 `route/baseUrl`，X 使用 `username` 或数字 `listId`。可加 `channel: blogs` 作为独立博客来源。报告刷新时 RSS 不受小 `limit` 限制，X 按需扩大到 `xMaxItems`；窗口筛选不变。

调度、时区、端口、SMTP 和编辑偏好仍由 `schedule`、`serverPort`、`email`、`curation` 配置。`schedule.collect` 只影响可选 serve，实际每日 10:00 的宿主自动任务独立维护。精选与综述由宿主 Agent 按 `skills/news-monitor` 协议完成；旧 `curate/report` 模型模块已不在 CLI 主链路，旧 `llm.maxItems/maxCharsPerItem` 不控制摘要长度。

## 报告完成条件与编辑偏好

报告阶段固定等待全部候选摘要任务结束，不提供跳过等待的开关。`news --refresh` 的采集阶段不调用模型，筛选完报告窗口后统一处理全部新闻和博客；只在每条成为 ready 或 failed 后导出快照。失败使用配置的有限重试，不无限等待或重复采集。`render` 拒绝尚有 pending/disabled 的快照，失败项仍保留原文和明确状态。

`curation.minPicks/maxPicks` 默认 10/20，`selectionCriteria` 是四类入选条件的列表。编辑 Agent 自主决定 10–20 条，每条必须有证据支持至少一个条件，在 reason 中具体说明。同一事件去重后只选一次；博客独立展示。优质候选确实不足时，报告说明原因，不降低质量凑数。旧配置只设置较小 maxPicks 时，minPicks 会下调至该上限；新日常配置明确为 10–20。语义判断属于编辑 Agent，脚本检查数量上限、ID 和引用关系。

## 凭据与归档隔离

凭据只能通过环境变量或仓库外的 Pi 配置读取；config/local/ 被 Git 忽略，但也不要在其中保存明文密钥。采集的网页可能自带第三方 token、签名链接或公开站点标识，建议将 archiveDir 指向 Git 仓库之外。本机归档已迁至项目 data/news-monitor-archive/feed-v1，config.feed.local.yaml 使用相对路径 `../../data/news-monitor-archive/feed-v1`。历史原始证据不作脱敏改写；查看旧回执时按新归档根定位，勿把归档拷回源码仓库。

提交前可用 Gitleaks 扫描：`gitleaks dir . --redact` 与 `gitleaks git . --log-opts="--all --full-history" --redact`。扫描历史前须补齐浅克隆及全部远端分支/标签；日志中不打印凭据。规则扫描不等于能识别所有未知格式的秘密，仍须核对暂存文件及外部配置引用。
