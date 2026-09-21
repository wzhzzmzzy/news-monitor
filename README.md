# news-monitor · Agent 的 RSS / X 新闻工具

news-monitor 负责采集 RSS/Atom、RSSHub 和 X，保存原文，调用配置的模型（本机为 DeepSeek）完成中文翻译和每条不超过 200 字的摘要，再输出结构化新闻列表。调用方 Agent 负责精选、事件关联、变化判断和报告写作；可选的 HTML 渲染器只负责校验与排版。

```text
RSS / X → collect → 原文归档 + DeepSeek 中文处理
                         ↓
                       news → 冻结的 JSON 新闻列表 → 任意 Agent 精选与写作
                                                        ↓
                                               render → HTML / 邮件 HTML
```

## 快速开始

环境：Node.js 22、pnpm 10.12.4。在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
cp config.example.yaml config.yaml  # 已有个人配置时不要覆盖
# 编辑 config.yaml 的来源和 llm 配置
pnpm build
node dist/index.js collect -c config.yaml
node dist/index.js news -c config.yaml --hours 24
```

不自动加载 `.env`；密钥通过进程环境或 Pi provider 读取，配置中的 `apiKeyEnv` 填变量名。省略 `-c` 使用 `config.example.yaml`，不会自动读取个人配置。

```yaml
llm:
  baseUrl: https://api.deepseek.com
  model: deepseek-chat
  apiKeyEnv: NEWS_FEED_LLM_API_KEY
  mode: json
localization:
  enabled: true
  chunkChars: 3000
  concurrency: 2
```

已有 Pi 的环境可替换成：

```yaml
llm:
  piProvider: gateway
  model: deepseek-v4-flash
  mode: json
```

模型必须存在于该 provider。运行时读取 `~/.pi/agent/models.json`，支持 openai-completions、字面密钥或环境变量名；不执行凭据命令、不复制密钥、不支持 OAuth/自定义鉴权头。密钥和 `config.feed.local.yaml` 不提交。

## Agent 接口

[薄 Skill](skills/news-monitor/SKILL.md) 可由具备本机执行能力的任意 Agent 使用。将该目录安装到宿主支持的 Skill 位置，并提供仓库和配置路径；也可以让 Agent 直接读取它。[调用协议](skills/news-monitor/references/protocol.md) 定义 JSON 字段、成稿格式、时间语义和错误处理。

| 命令 | 职责 |
| --- | --- |
| `collect` | 抓取、去重、归档、中文处理；monitor/feed 是别名 |
| `news` | 按窗口输出全部新闻、中文摘要、来源覆盖、原文版本与可选基线；不精选 |
| `render` | 接收 Agent 编写的 JSON，离线校验并输出 HTML；`--email` 为邮件版，不投递 |
| `serve` | 持续采集与翻译，提供本机状态端口；不调度 Agent 或报告 |
| `report` | 兼容命令：未经精选的归档阅读预览，可 `--all` 补处理历史内容 |

`collect` / `news` 从不调用内置精选或专题分析模型，即便旧配置中 `curation.enabled: true`。`curation.interests` / `maxPicks` 仅作为偏好交给外部 Agent。旧 `--analyze` 已从 CLI 移除。旧编辑模块和缓存保留供历史实验读取，不在新运行流程中使用。

Skill 本身不提供网络连接。具备本机命令工具的 ChatGPT/其他 Agent 可直接调用；远程 ChatGPT 宿主还需要可达的受控工具桥接。当前没有 MCP 服务或公开 HTTP 新闻接口，`serve` 的端口只返回本机状态。

## 10:00 早报与 20:00 增量报

全部按北京时间，窗口使用采集批次完成时间与半开区间：

```bash
# 早报：前一天 10:00 至当天 10:00，保存输出中的 snapshotPath
node dist/index.js news -c config.yaml --edition morning --day 2026-09-22

# 晚报：当天 10:00 至 20:00，严格使用那份早报快照
node dist/index.js news -c config.yaml --edition evening --day 2026-09-22 --baseline /absolute/morning/news.json

# Agent 根据列表写 editorial.json；此步骤由 Agent 完成
node dist/index.js render --snapshot /absolute/news.json --decisions /absolute/editorial.json --output /absolute/report.html
```

晚报的工具层给出 new/updated/unchanged/resurfaced 和基线全部候选；Agent 再判断“旧事件是否有新进展、意义是什么”。同链接文本更新不等于事件进展，不同链接也可能是同一事件，未再次出现不等于撤稿。增量报告优先展示前后变化及对应引用，重复内容折叠保留。

早报快照不回写，晚报不使用可变的“最新报告”代替基线。没有早报快照就不能假装有对照；空基线会保留为空，报告应说明数据缺口。未到截止时间拒绝生成正式版，可用自定义窗口做中途预览。

持续采集应在窗口开始前启动：

```yaml
schedule:
  collect: '*/30 * * * *'
  timezone: Asia/Shanghai
serverPort: 12440
```

```bash
node dist/index.js serve -c config.yaml
```

10:00/20:00 编辑任务由宿主 Agent 的调度器安排，并持久保存当天早报的快照位置。程序不自行安装系统服务；启动 serve 本身不立即采集。旧 `schedule.report/analyze/sendEmail` 请移除，避免以为内部仍生成早晚报。采集串行执行，状态在 `http://127.0.0.1:12440/`，配置变更需重启。

## 来源与证据

来源包括 IT之家、Hacker News（HNRSS 转换）、Ars Technica、TechCrunch、NPR、Our World in Data、Aeon、Simon Willison、Econlib、Works in Progress，以及 RSSHub 的财联社、金十、澎湃、华尔街见闻和联合早报频道。[迁移表](docs/source-migration.md) 记录来源、限制和实测；微博因实例故障仍停用。NewsNow 已退出运行路径。

源类型 `rss` 使用 url，`rsshub` 使用 route 与 baseUrl，`x-user` 使用 username，`x-list` 使用数字 listId。所有源可配置 id/name/category/limit/enabled。RSS 请求超时 20 秒，瞬时网络/5xx 最多重试一次；X 子进程超时 120 秒，按有限条目采集。失败的来源单独记录，其余数据仍归档。

X 使用固定依赖 OpenCLI 1.8.7、已授权的官方扩展和 Brave 的登录会话，不需要 X 开发者 API Key。用 `pnpm exec opencli doctor` / `profile list` 检查，并将 Brave contextId 填入 `opencli.profile`；公共示例默认停用 X。程序不复制 Cookie。

RSS 可能只有摘要；HN 是社区链接元数据，不代表外链正文；X 不保证完整分页/thread/Article。保留 `contentKind`、原始发布时间和观察时间。当前不补抓付费全文、图片 OCR 或外链正文，有限快照不能保证覆盖过去所有新闻。

## 翻译、摘要与状态

完整翻译实际采集到的非中文内容，长文分段处理；中文原文保持，逐条摘要硬性校验不超过 200 个 Unicode 字符（含标点）。只总结提供的内容，不把简介当全文。缓存按原文和模型配置复用，缺少模型或失败时保留原文及 pending/failed 状态，重试可复用成功分段。模型请求按所用服务计费。

`news` 返回单个 JSON；ready 退出 0，partial/empty 退出 1 但仍保存可用快照。错误写 stderr；调用方应先区分是否拿到合法 JSON，不能把非零退出码解释成完全无数据。ready 仅表示观察到的数据与中文处理可用，不代表事实核实或来源全量覆盖。关闭中文处理仍可返回原文，状态为 partial。

## 数据与邮件

路径相对于配置文件，默认 `archive/feed-v1`，被 Git 忽略：

- `runs/` 保存每批 raw/source-pack/reading-pack 和未经精选的阅读预览；`items/` 与 `index.json` 为最新版本及去重索引。
- `chinese/` 保存翻译摘要及成功分段缓存。
- `snapshots/<uuid>/news.json` 是 Agent 使用的紧凑列表；同目录 `reading-pack.json` 保存完整中英文证据，用 SHA-256 绑定。渲染验证原始版本与摘要一致。
- Agent 自行保存成稿 JSON 与 HTML。`render` 不覆盖已有文件；HTML 全部纯文本转义，引用 ID 必须在相应当前/基线列表中。
- 旧 `reports/`、`editorial/` 和旧系统归档保留，不在新快照里混用旧 NewsNow 标题。

邮件 HTML 用 `render --email` 生成，投递由宿主安排。兼容 `report --send` 仍发送未精选阅读列表，需要显式 email 配置及 `passwordEnv`；`test-email` 会真实发送测试邮件。没有这些显式命令就不会发送，重复发送尚无幂等保障。SMTP 凭据不能进成稿或快照。

同归档共享 `.lock`，覆盖采集、中文处理和查询。锁冲突应等待在途任务完成，不删除活跃锁。原始证据损坏会报错，不静默略过。只处理原始归档窗口，不用更新后的 items/ 倒填历史。

## 升级与验证

停止旧 serve，保留个人配置与归档；更新后安装依赖、重新构建。删除旧报告调度配置，让外部 Agent 负责早晚报；用 collect/news 验证，再启动采集服务。新窗口/快照机制不会自动补回早期漏采数据。

```bash
pnpm test --run
pnpm build
```

测试使用临时目录、本地数据和模拟模型/邮件，不访问私人账号。历史 PRD/specs 描述旧系统，当前设计以本文及 Skill 协议为准。
