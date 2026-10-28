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
| `config/editorial.yaml` | 精选数量、四类质量标准与领域/来源集中度规则，传给报告编辑 Agent |
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
  maxPicks: 10
  interests: 综合日报；优先重要变化、原始信息和深入分析。
```

`includes` 按顺序加载，本文件最后覆盖；对象递归合并，数组和标量整体替换。各文件均为普通 YAML 对象，可以拆分邮件、调度和编辑偏好等任意现有配置块，不限于这些文件名。`sourceFiles` 中每个文件必须是来源数组，按顺序与同文件内的 `sources` 拼接，然后整体替换被包含文件的来源列表；全局 ID 重复直接报错，不静默覆盖。循环引用、缺失文件和非法参数在采集前报错。旧版单文件 `sources` 配置继续可用。

`includes`、`sourceFiles`、`archiveDir`、`blogCatalog`、`llm.piModelsPath` 的相对路径均基于声明它的配置文件（符号链接按实际文件位置）；`~/` 仅用于 Pi 模型路径。`blogCatalog` 仍使用现有 JSON 结构，不接受裸来源数组。进程启动时加载配置；修改后重新运行 CLI，已有 `serve` 需要重启。部署时需一并带上 `config/` 和被引用的文件。

## 模型与摘要

初次接入可把 [LLM 模板](llm.example.yaml)复制到 `config/local/llm.yaml`，并在主配置 includes 中引用；`apiKeyEnv` 填宿主已导出的环境变量名。复用 Pi 时改为：

```yaml
llm:
  piProvider: gateway
  model: deepseek-v4-flash
  mode: json
```

模型必须存在于该 provider。默认运行时读取 `~/.pi/agent/models.json`，支持 openai-completions 及文件内的字面密钥或环境变量引用；凭据留在仓库外，不复制、不执行凭据命令，不支持 OAuth 或自定义鉴权头。

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

首次连接浏览器、选择 `opencli.profile`、验证 X 小样本或停止采集，见 [OpenCLI 与 serve 操作](../docs/operations.md)。该 profile 不限定浏览器品牌。宿主任务使用[独立的定时流程模板](../docs/automation.md)，不是把任务提示词写进 CLI YAML。

`collection` 支持 `rssConcurrency`（4）、`rssTimeoutMs`（20000）、`rssRetries`（1）、`retryDelayMs`（500）、`rssProxyUrl`（可选 HTTP(S) 代理地址）、`userAgent`、`xMaxItems`（1000）。RSS 对连接和正文读取的网络错误/超时、5xx 做有限重试，不对认证、限流或无效 XML 重试；每次尝试的超时覆盖响应头和完整正文。`opencli` 支持 `enabled`（true）、`profile`、`timeoutMs`（120000）、`maxBufferBytes`（10485760）。X 仍串行采集；关闭总开关会记录 disabled，不能解释为没有新闻。来源错误只保存脱敏类别、HTTP 状态与退出码，不保存可能带凭据的 stderr。

RSS、Atom、RSSHub 和博客请求默认遵循 `HTTP_PROXY`/`HTTPS_PROXY`（也支持小写，优先于大写）及 `NO_PROXY`/`no_proxy`；没有代理配置时直连。定时任务不一定继承交互 shell 的环境，可在本机主配置的 `collection` 下填写 `rssProxyUrl: http://127.0.0.1:7897`（端口按实际代理调整）。该字段覆盖 HTTP/HTTPS 代理地址，仍尊重 `NO_PROXY`，只作用于 Feed 请求。代理需要认证时使用环境变量，不在 YAML 保存凭据；代理服务需在采集时运行，代理失败按来源报错，不自动切换直连。升级源码后执行 `pnpm build`；只修改配置时，下次运行 CLI 即生效，现有 `serve` 需重启。

来源字段为 `id/name/category/type/limit/enabled/disabledReason`，RSS 使用 `url`，RSSHub 使用 `route/baseUrl`，X 使用 `username` 或数字 `listId`。可加 `channel: blogs` 作为独立博客来源。报告刷新时 RSS 不受小 `limit` 限制；`x-user` 严格按来源 `limit` 采集最近帖子，当前账号配置为 5 条，不因报告窗口自动扩量；`x-list` 仍按需扩大到 `xMaxItems`。窗口筛选不变，账号快照未回溯到窗口起点时保持 partial，不保证全天完整覆盖。

RSS 示例包含科技、经济、国际公共事务、科学医疗、环境与文化频道；X 清单及启用建议见 [账号与领域](../feeds/x-accounts.md)。RSS 新增 BBC、Guardian、Nature、联合国新闻、The Conversation 和 NASA 的 11 个频道。主配置若引用 `config/local/`，应同步调整对应本机来源文件；修改公开示例不会自动改变本机任务。

调度、时区、端口、SMTP 和编辑偏好仍由 `schedule`、`serverPort`、`email`、`curation` 配置。`schedule.collect` 只影响可选 serve，实际每日 10:00 的宿主自动任务独立维护。精选与综述由宿主 Agent 按 `skills/news-monitor` 协议完成；旧 `curate/report` 模型模块已不在 CLI 主链路，旧 `llm.maxItems/maxCharsPerItem` 不控制摘要长度。

## 报告完成条件与编辑偏好

报告阶段固定等待全部候选摘要任务结束，不提供跳过等待的开关。`news --refresh` 的采集阶段不调用模型，筛选完报告窗口后统一处理全部新闻和博客；只在每条成为 ready 或 failed 后导出快照。失败使用配置的有限重试，不无限等待或重复采集。`render` 拒绝尚有 pending/disabled 的快照，失败项仍保留原文和明确状态。

`curation.minPicks/maxPicks` 默认 10/10，`selectionCriteria` 是四类入选条件的列表。日常目标为 10 条，每条必须有证据支持至少一个条件，在 reason 中具体说明。同一事件去重后只选一次；博客独立展示。优质候选确实不足时，报告说明原因，不降低质量凑数。旧配置只设置较小 maxPicks 时，minPicks 会下调至该上限；新日常配置明确为 10 条。语义判断属于编辑 Agent，脚本检查数量上限、ID 和引用关系。

`curation.editorialPolicy` 是可配置的编辑规则列表，随 interests 和质量标准冻结在快照 preferences 中；修改后仅影响新快照。当前配置要求日常 10 条中 AI/互联网通常最多 4 条、有合格候选时覆盖至少 4 类实质领域、同一媒体或机构通常最多 2 条。按文章实际内容判断，跨 RSS/X 的同一机构也计入同一来源；质量优先，重大事件可例外并在 reason 说明。具体规则以 [editorial.yaml](editorial.yaml) 为准，属于 Agent 的语义判断，不是按来源 category 强行凑配额；旧快照缺少该字段仍可读取。

## 凭据与归档隔离

凭据只能通过环境变量或仓库外的 Pi 配置读取；config/local/ 被 Git 忽略，但也不要在其中保存明文密钥。采集的网页可能自带第三方 token、签名链接或公开站点标识，建议将 archiveDir 指向 Git 仓库之外。本机归档已迁至项目 data/news-monitor-archive/feed-v1，config.feed.local.yaml 使用相对路径 `../../data/news-monitor-archive/feed-v1`。历史原始证据不作脱敏改写；查看旧回执时按新归档根定位，勿把归档拷回源码仓库。

提交前可用 Gitleaks 扫描：`gitleaks dir . --redact` 与 `gitleaks git . --log-opts="--all --full-history" --redact`。扫描历史前须补齐浅克隆及全部远端分支/标签；日志中不打印凭据。规则扫描不等于能识别所有未知格式的秘密，仍须核对暂存文件及外部配置引用。

归档目录内，`runs/` 保存批次的 raw/source-pack/reading-pack 与阅读预览，`items/` 和 `index.json` 保存最新版本及去重索引，`chinese/` 保存摘要和成功分段缓存。`snapshots/<uuid>/news.json` 与同目录 `reading-pack.json` 用 SHA-256 绑定；Agent 另存 editorial.json、HTML 与发布回执。旧 reports/editorial 及译文缓存保留，不倒填或改写旧快照。
