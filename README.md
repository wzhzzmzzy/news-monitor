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
| `news` | 按窗口输出新闻与博客快照；`--refresh` 在早晚报生成前统一采集；不精选 |
| `render` | 接收 Agent 编写的 JSON，校验并输出 HTML；`--email` 为邮件版，`--publish-koalablog` 可发布固定 Svelte 阅读页的报告数据 |
| `serve` | 可选的独立采集调度器；随早晚报采集时无需启动 |
| `report` | 兼容命令：未经精选的归档阅读预览，可 `--all` 补处理历史内容 |

`collect` / `news` 从不调用内置精选或专题分析模型，即便旧配置中 `curation.enabled: true`。`curation.interests` / `maxPicks` 仅作为偏好交给外部 Agent。旧 `--analyze` 已从 CLI 移除。旧编辑模块和缓存保留供历史实验读取，不在新运行流程中使用。

Skill 本身不提供网络连接。具备本机命令工具的 ChatGPT/其他 Agent 可直接调用；远程 ChatGPT 宿主还需要可达的受控工具桥接。当前没有 MCP 服务或公开 HTTP 新闻接口，`serve` 的端口只返回本机状态。

## 10:00 早报与 20:00 增量报

默认随每天早报、晚报各采集一次：新闻 RSS/X 与博客共用同一轮抓取、归档和中文处理，无需另启博客定时任务或 `serve`。全部按北京时间，窗口采用半开区间 `[start, end)`：先限定采集批次，再限定新闻和博客的发布时间。

```bash
# 10:00 开始生成早报：先统一采集，按固定 10:00 往前 24 小时筛选，保存 snapshotPath
node dist/index.js news -c config.yaml --edition morning --refresh

# 20:00 开始生成晚报：先统一采集，从当天早报的发布时间截止接续，到固定 20:00
node dist/index.js news -c config.yaml --edition evening --refresh --baseline /absolute/morning/news.json

# Agent 根据列表写 editorial.json；此步骤由 Agent 完成
node dist/index.js render --snapshot /absolute/news.json --decisions /absolute/editorial.json --output /absolute/report.html
```

`news` 对早报、晚报和自定义窗口统一筛选新闻和博客：来源提供的 `publishedAt` 必须落在报告窗口内。早报固定取前一天 10:00 至当天 10:00，晚报取早报 `window.end` 至当天 20:00；包括起点，不包括终点。缺少或无效的发布时间、旧文及截止后的文章不进入报告；再次采集或正文变化不会绕过发布时间限制。HN 等社区 Feed 的时间是提交时间，不保证等于外链原文发布时间。

筛选发生在快照层：RSS 返回的原始条目照常归档；报告刷新阶段只翻译窗口内的新闻和博客，历史博客不占当天翻译额度；独立 `collect` 的中文处理与归档预览仍保留。快照 `publicationFilter` 和 `blogPublicationFilter` 分别记录新闻、博客的纳入数量及排除原因；缺少或无效日期导致内容被排除时，非空快照标记为 partial。旧快照和已发布报告不会自动改写，重新生成后才应用新规则。

Agent 在精选前将同一具体事件的重复报道、连续进展写入可选 `events`（`eventId`、`title`、`summary`、`itemIds`），同一事件只精选一次、综述一次。脚本校验 ID、分组互斥与引用；时间线折叠相关报道，按最新成员发布时间排序，搜索与主题筛选覆盖全部成员。所有来源、链接和原文继续保留，博客独立展示；旧报告不含分组字段时保持原有行为。语义判断复用现有编辑 Agent，不增加逐条模型调用，主题相近但事实不同的新闻不合并。完整约束见[调用协议](skills/news-monitor/references/protocol.md)。

晚报的工具层给出 new/updated/unchanged/resurfaced 和基线全部候选；Agent 再判断“旧事件是否有新进展、意义是什么”。同链接文本更新不等于事件进展，不同链接也可能是同一事件，未再次出现不等于撤稿。增量报告优先展示前后变化及对应引用，重复内容折叠保留。

早报快照不回写，晚报不使用可变的“最新报告”代替基线。没有早报快照就不能假装有对照；空基线会保留为空，报告应说明数据缺口。未到截止时间拒绝生成正式版，可用自定义窗口做中途预览。

`--refresh` 仅用于当天且已到 10:00/20:00 的版次。刷新保持报告发布时间窗口不变：10:45 抓到的 08:00 新闻可以进入 10:00 早报，10:30 发布的新闻只归档，留给晚报。`observedThrough` 单独记录本次证据读取的采集截止（半开区间），包含补采批次；即使采集跨午夜也不移动报告日期。博客使用相同发布时间窗口，早报补采时先观察到的 10:30 博客仍可进入晚报；旧文即使正文更新也只留归档。省略 `--refresh` 仍只读取截止前归档，适合历史回放；要补采当天固定截止的早报，请使用 `--refresh`，无需为了保留 10:00 而省略它。

10:00/20:00 编辑任务由宿主 Agent 安排，调用上面的 `news --refresh` 并保存实际早报快照。只采集两次会降低高频来源的覆盖，RSS 已滚出的条目无法补回；报告只处理窗口内文章的翻译；需要处理历史博客时可手动运行 `collect --channel blogs`。程序不会自行安装定时任务。

仅需独立持续采集时才启动可选的 `serve`，其频率由配置决定，30 分钟只是示例：

```yaml
schedule:
  collect: '*/30 * * * *'
  timezone: Asia/Shanghai
serverPort: 12440
```

```bash
node dist/index.js serve -c config.yaml
```

随早晚报采集时保持 `serve` 停止，避免重复抓取。启动 `serve` 本身不立即采集，也不生成报告。旧 `schedule.report/analyze/sendEmail` 请移除。独立采集串行执行，状态在 `http://127.0.0.1:12440/`，配置变更需重启。

## 来源与证据

来源包括 IT之家、Hacker News（HNRSS 转换）、Ars Technica、TechCrunch、NPR、Our World in Data、Aeon、Simon Willison、Econlib、Works in Progress，以及 RSSHub 的财联社、金十、澎湃、华尔街见闻和联合早报频道。[迁移表](docs/source-migration.md) 记录来源、限制和实测；微博因实例故障仍停用。NewsNow 已退出运行路径。

源类型 `rss` 使用 url，`rsshub` 使用 route 与 baseUrl，`x-user` 使用 username，`x-list` 使用数字 listId。所有源可配置 id/name/category/limit/enabled。RSS 请求超时 20 秒，瞬时网络/5xx 最多重试一次；X 每次子进程超时 120 秒。报告刷新时，RSS 保存 Feed 返回的全部条目，不受来源 `limit` 截断；X 从至少 100 条开始，借助 OpenCLI 的 cursor 翻页按需扩大请求，直到读到发布时间早于窗口起点的条目、返回不足、失败或达到 `collection.xMaxItems`（默认 1000，范围 100–10000）。扩大请求失败时保留已取得条目。未确认到达起点的 X 来源列入 `coverage.incompleteSources`，非空报告为 partial；返回不足不等于已取完历史。独立 `collect` 仍遵循普通来源的 `limit`。失败的来源单独记录，其余数据仍归档。

X 来源清单已扩充至 25 个账号（12 个厂商、4 个组织、9 位人物），包括 OpenAI、Anthropic、DeepMind、Qwen、DeepSeek、GitHub、Cloudflare、MIT CSAIL、Stanford HAI、Karpathy、Andrew Ng 等，见[账号清单与采集约定](feeds/x-accounts.md)。公开示例默认停用 X，完成登录配置后启用；日常随报告统一采集。

X 使用固定依赖 OpenCLI 1.8.7、已授权的官方扩展和 Brave 的登录会话，不需要 X 开发者 API Key。用 `pnpm exec opencli doctor` / `profile list` 检查，并将 Brave contextId 填入 `opencli.profile`；公共示例默认停用 X。程序不复制 Cookie。

RSS 可能只有摘要；HN 是社区链接元数据，不代表外链正文；X 不保证完整分页/thread/Article。保留 `contentKind`、原始发布时间和观察时间。当前不补抓付费全文、图片 OCR 或外链正文，有限快照不能保证覆盖过去所有新闻。

## HN 热门博客订阅

配置中的 `blogCatalog: ./feeds/hn-popular-blogs.json` 加载[指定十年窗口的前 100 名](https://popularity.refactoringenglish.com/?start=2016-09-15&end=2026-09-15)。这是固定排名快照，不会随每次采集重排。清单保留排名、域名、已验证 Feed、别名和未接入原因，详见[博客源说明](feeds/README.md)。相同 Feed 只订阅一次；已有 Simon Willison RSS 会合并到博客频道。

博客在网页的第二个 **“博客”** Tab 中按发布时间倒序展示；邮件版为独立同名分组。所有采集到的博客原文均保留归档，报告只展示发布时间落在本期窗口内的文章（早报为最近 24 小时），不进入精选、新闻时间线或 Agent 综述。同一博客链接经 HN 再次出现时也归入博客。`news` 的 `items` 仅包含可编辑新闻，`blogs` 单独返回博客；渲染器拒绝把博客 ID 用于精选或报告引用。

```bash
# 首次采集或手动刷新，仅拉取博客
node dist/index.js collect -c config.yaml --channel blogs
# 日常由早晚报 news --refresh 同时采集新闻和博客，无需单独轮询
```

博客 RSS 不使用普通来源的 `limit` 截断，保存 Feed 当前返回的所有条目；首次订阅可能包含多年的历史内容，这些只是首次观察，不能当作今天新发表。报告只纳入窗口内发布的文章，缺少或无效发布时间的文章不进入报告；首次观察、重复采集或正文变化均不改变归期。订阅不能恢复 Feed 已移除的漏采文章，也不能保证没有 RSS 的网站持续覆盖。

博客沿用中文翻译和不超过 200 字摘要。`localization.blogBatchSize` 默认每轮新处理 20 篇（0 为只复用缓存），优先较新文章，已缓存内容不占额度；全部原文均归档，窗口内未完成项显示 pending。报告刷新只处理窗口内博客；独立 `collect` 可续处理历史积压，即便条目已退出 Feed。长文仍完整分段处理，预算按文章数而非耗时或 token 数限制；可按机器和模型用量调大。普通新闻不占博客批次额度。历史回填可手动分轮进行；报告内 pending 会使 CLI 返回部分完成状态。

RSS 并发由 `collection.rssConcurrency` 控制，默认 4、最大 8；X 仍串行。`news --refresh` 的抓取阶段使用一次博客中文额度，快照阶段仅复用博客缓存；不会叠加第二批额度。日常随早晚报采集，同归档不要重复启动调度器。来源短时失败会保留已有内容，并在来源状态显示；清单中未验证的订阅保持停用，需要修复后再启用。

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

发布到 Koalablog 时，在进程环境设置 `KOALABLOG_API_TOKEN`，再执行。需要代理时设置 `HTTPS_PROXY=http://127.0.0.1:7897`；发布与匿名回读支持 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`：

```bash
node dist/index.js render --snapshot /absolute/news.json --decisions /absolute/editorial.json --output /absolute/report.html --publish-koalablog
```

报告的时间范围和采集状态以 11px 灰色说明展示。新闻综述使用独立背景、小标题和 13px 正文，逐条以有序列表展示，每条新闻末尾以编号上标链接引用原文，悬停可查看标题和来源；Agent 按一条新闻一个 section 编写。本地 HTML 和在线阅读页保持一致。

固定入口为 `https://koala.wzhzzmzzy.workers.dev/news-feed`，使用 `templates/news-feed.svelte`。日报数据为 `/data/news-feed/YYYY-MM-DD/morning` 或 `evening`，`/data/news-feed/latest` 指向已成功发布的最新一期。均为 public memo；页面支持日期/早晚报、精选 / 博客 / 时间线三个 Tab、主题过滤、搜索和日期分组折叠。时间线包含全部非博客新闻，按发布时间倒序、北京时间分组，缺少时间的条目单列“时间未知”；精选也在时间线中标注。侧边按日期和小时快速定位，点击自动展开目标日期；搜索和主题过滤同步索引，窄屏显示横向索引。邮件顺序阅读时不重复精选。补发旧报告不会回退首页，同一报告路径的不同内容会拒绝覆盖。支持直达链接 `/news-feed?date=2026-09-21&edition=evening`（早报用 `morning`）；指定版次未发布则显示空状态，日期/版次切换自动同步 URL。

首次上传或模板更新后，必须在 Dashboard 对 `/news-feed` 执行 **Deploy**；只更新日报数据不需要部署。回执 `deploymentRequired` 会指出这一步是否尚未完成。模板更新需显式加 `--koalablog-update-shell`。发布需 admin token，浏览器只做匿名 public 读取，Source 不包含凭据。参数、冲突处理与回执见 [发布协议](skills/news-monitor/references/protocol.md#发布为-koalablog-public-memo)。

邮件 HTML 用 `render --email` 生成，投递由宿主安排。兼容 `report --send` 仍发送未精选阅读列表，需要显式 email 配置及 `passwordEnv`；`test-email` 会真实发送测试邮件。没有这些显式命令就不会发送，重复发送尚无幂等保障。SMTP 凭据不能进成稿或快照。

同归档共享 `.lock`，覆盖采集、中文处理和查询。锁冲突应等待在途任务完成，不删除活跃锁。原始证据损坏会报错，不静默略过。只处理原始归档窗口，不用更新后的 items/ 倒填历史。

## 升级与验证

停止旧 serve，保留个人配置与归档；更新后安装依赖、重新构建。删除旧报告调度配置，让外部 Agent 负责早晚报；用 collect/news 验证，日常早晚报改用 `news --refresh`，无需重启独立采集服务。新窗口/快照机制不会自动补回早期漏采数据。

```bash
pnpm test --run
pnpm build
```

测试使用临时目录、本地数据和模拟模型/邮件，不访问私人账号。历史 PRD/specs 描述旧系统，当前设计以本文及 Skill 协议为准。

阅读入口的页面描述采用模板中的固定简介“每日自动更新的 RSS、X、HN 新闻汇总”。Koalablog 从已部署 Svelte 快照的首个段落提取 description / og:description；修改简介后需要更新页面 Source 并在 Dashboard Deploy，普通日报数据更新不会覆盖它。
