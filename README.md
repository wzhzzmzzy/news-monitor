# news-monitor · RSS / X 个人简报

基于 Node.js 22 + TypeScript 的个人信息采集与邮件简报工具。`monitor`、`report`、`serve` 统一使用 RSS/Atom、RSSHub 和 X 原文，已移除 NewsNow 抓取路径。来源覆盖技术、商业与人文，保留原文证据，默认逐条生成中文翻译和 200 字以内的核心摘要。

## 快速开始

环境：Node.js 22、pnpm 10.12.4（与 `packageManager` 一致）。以下命令在仓库根目录执行。首次使用从示例创建配置；已有 `config.yaml` 时先备份并按新结构迁移，不要直接覆盖。

```bash
pnpm install --frozen-lockfile
cp config.example.yaml config.yaml
# 在 config.yaml 中选择并填写一个 llm 配置，再运行
pnpm dev monitor --config config.yaml
pnpm dev report --config config.yaml --hours 24
```

默认开启逐条中文处理和阅读筛选，需要配置模型。示例文件中的 `llm`、`email` 都只是注释，复制后不会自动启用。可以采用下文的 Pi 配置，或在 `config.yaml` 中添加 OpenAI 兼容服务配置（地址和模型改为服务商实际提供的值）：

```yaml
llm:
  baseUrl: https://api.deepseek.com
  model: deepseek-chat
  apiKeyEnv: NEWS_FEED_LLM_API_KEY
  mode: json
```

密钥通过运行命令的进程环境传入。程序**不会自动加载 `.env` 文件**；终端或系统服务启动 `serve` 时也必须提供相同环境变量。`apiKeyEnv` / `passwordEnv` 填环境变量名，不是密钥本身。

```bash
export NEWS_FEED_LLM_API_KEY='替换为你的 API Key'
pnpm dev monitor --config config.yaml
```

两条命令默认不发邮件，完成后输出 JSON，其中 `preview` 是可用浏览器打开的本地 HTML 路径。缺少模型且没有可复用缓存时，仍保存原文并生成标有“待处理”的预览，退出码为 1；只采集原文可设置 `localization.enabled: false`，阅读筛选也会随之停用。

**省略 `--config` 使用的是 `config.example.yaml`，不会自动读取 `config.yaml`。** `config.dev.yaml`、`config.feed.example.yaml` 使用同一结构。`config.feed.local.yaml` 是可选的本机私有配置，不随仓库分发；已有该文件时才使用它。`feed` 是 `monitor` 的兼容别名。

内置来源：华尔街见闻热门、澎湃热榜、财联社热门、金十快讯、联合早报四个即时新闻频道，以及 IT之家、Simon Willison、Econlib、Works in Progress。X 在公共示例中默认停用，配置浏览器后启用。微博热搜因实测实例故障保留停用项，失败原因会出现在页面中。详见 [来源映射、实测和迁移差异](docs/source-migration.md)。

IT之家使用官网直接提供的 [RSS](https://www.ithome.com/rss/)，来源 ID 为 `ithome`，归入“技术”，默认每次取 10 条。此次实采 10 条均含内容、发布时间和原文链接，重跑全部识别为已见。

## 新增英文新闻与人文来源

| 来源 | 用途 | 每次条数 | 内容边界 |
| --- | --- | --- | --- |
| [Hacker News / HNRSS](https://hnrss.org/frontpage?count=10) | 开发者社区选题与讨论线索 | 10 | 社区提交/分数/讨论信息，未采集外链文章正文 |
| [Ars Technica](https://feeds.arstechnica.com/arstechnica/index) | 科技与科学报道 | 5 | Feed 内容，不承诺全文 |
| [TechCrunch](https://techcrunch.com/feed/) | 创业、科技商业 | 5 | 摘要 |
| [NPR 国际新闻](https://feeds.npr.org/1004/rss.xml) | 国际报道 | 5 | 摘要 |
| [Our World in Data](https://ourworldindata.org/atom.xml) | 社会、经济、环境数据研究 | 3 | 研究文章简介，数据年份须回原文核对 |
| [Aeon](https://aeon.co/feed.rss) | 哲学、文化与社会思想 | 3 | 长文/视频简介，观点与事实分开 |

六项默认启用，已加入全部示例及本机配置。Hacker News 官方 RSS 在当前设备连接超时，因此使用 [HNRSS](https://hnrss.github.io/) 第三方转换；其余五项为发布方 Feed。BBC、Guardian 在本次设备网络下未通过连接测试，暂未加入配置。

Hacker News 的投稿者、投稿时间不当成外链文章的作者/发布时间，预览同时提供文章和“查看讨论”链接。社区条目以来源内 GUID 单独去重，避免其分数/评论元数据覆盖相同 URL 的媒体正文。摘要与社区元数据会把相应标记传给模型。

## 来源配置

所有来源都有唯一 `id`、`name`、`category`、`limit`（1–100，默认 10），可设 `enabled: false` 和 `disabledReason`。RSS/RSSHub 可用 `contentKind: feed-summary` 显式标注已知摘要源，或 `contentKind: link-metadata` 标注社区链接信息；缺少内容时仍显示“仅标题”。

| 类型 | 必需配置 | 含义 |
| --- | --- | --- |
| `rss` | `url` | 直接读取 RSS/Atom |
| `rsshub` | `route` | 从 `rsshub.baseUrl` 读取，可用来源自己的 `baseUrl` 覆盖 |
| `x-user` | `username` | OpenCLI 读取账号帖子 |
| `x-list` | `listId`（数字字符串） | OpenCLI 读取 List，不需要创建或关注列表 |

```yaml
archiveDir: ./archive/feed-v1
rsshub:
  baseUrl: https://hub.slarker.me
sources:
  - id: jin10
    name: 金十数据
    category: 商业
    type: rsshub
    route: /jin10
    limit: 20
```

RSSHub 是网站内容转 Feed 的适配器；示例使用经实测的社区实例，不能视为媒体官方 RSS，也没有可用性保证。长期使用可以替换为自建实例，不必改采集代码。每个 RSS 请求超时 20 秒，网络错误/HTTP 5xx 最多重试一次；无效 XML、429 和其他 4xx 不重试。来源串行采集，X 的 OpenCLI 子进程超时为 120 秒。部分来源失败时，其余结果仍归档，`monitor` 退出码为 1，并在预览中展示失败。停用项单独显示，不记为本次请求失败。

RSS 保留 Feed 提供的正文、简介、发布时间和解析器原始条目；`content` 字段不代表已核验全文。没有链接但有 GUID 的快讯也会保存，没有正文则标为“仅标题”。首版不补抓文章链接、图片 OCR 或付费全文。

## 当前 Brave 的 X 会话

使用固定依赖 OpenCLI 1.8.7 和 [OpenCLI 官方扩展](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)，保持 Brave 运行并登录 `x.com`。该读取路径使用现有浏览器会话，不需要 X 开发者 API Key。扩展具有浏览器桥接权限；本项目不在配置中复制 Cookie。

```bash
pnpm exec opencli doctor
pnpm exec opencli profile list
pnpm exec opencli --profile '替换为 Brave contextId' twitter tweets simonw --limit 5 -f json
```

将 Brave 的 contextId 写入 `opencli.profile`，把对应 X 来源改成 `enabled: true`。返回的长帖和引用帖正文会保留。X 是有限条目快照：上游可能在部分分页失败后仍返回数据，不保证完整时间覆盖、完整 thread 或 X Article。

## 中文翻译与逐条摘要

每条已采集内容都生成一条简体中文核心摘要，硬性校验 **不超过 200 个 Unicode 字符（包括标点和空格）**。非中文标题和正文完整翻译，中文原文保持不变；专有名词、代码、URL 保留。正文很长时分段翻译，再综合所有分段的摘要，不受专题简报的 `maxItems` / `maxCharsPerItem` 截断限制。

页面先展示中文标题和核心摘要，展开可读完整中文内容及原文。只处理实际采集到的内容：RSS 简介和 Hacker News 社区元数据不会被当成外链全文，只有标题的条目不补造正文。模型判断语言和生成内容仍需抽样核对。

本机可复用 Pi 的 `gateway`，无需复制密钥：

```yaml
localization:
  enabled: true
  chunkChars: 3000
  concurrency: 2
llm:
  piProvider: gateway
  model: deepseek-v4-flash
  mode: json
  # piModelsPath: ~/.pi/agent/models.json
```

运行时只读取选定 provider，支持 `openai-completions` 和 provider 的字面密钥或环境变量名。不修改 Pi 配置；暂不执行 Pi 的凭据命令，不支持自定义鉴权头或 OAuth。模型须存在于该 provider。也可省略 `piProvider`，使用 `baseUrl`、`model`、`apiKeyEnv` 配置 OpenAI 兼容服务。不要将密钥写入项目文件。

已归档内容可以一次性补处理，无需重新采集：

```bash
pnpm dev report --config config.yaml --all
```

译文、摘要和成功分段都有缓存；相同原文和模型配置重跑时复用，原文或模型变化时重新生成。长度或格式校验失败会重试一次；仍失败则标为“处理失败”并保留原文，下次从已成功的分段继续。部分完成时返回非零退出码，且不发送未完成的中文报告。缓存是派生数据，原始证据包保持不变。

首次处理长文和大量归档可能产生多次模型请求；`curation.maxPicks` 只限制精选数量，不限制翻译数量。`localization.concurrency` 可设 1–4，默认 2；遇到模型限流可降低并发。模型调用按所用服务计费，建议先减少来源或 `limit` 验证效果，再执行 `--all`。

## 阅读筛选与页面

中文处理后默认再做阅读价值筛选：先覆盖每一条内容评级，再比较整批条目，挑选最多 10 条精选，并识别同一事件中信息重复的报道。使用同一 `llm` 配置，不需要 `--analyze`。

- **精选**：默认打开，按编辑优先级排列，附“为什么值得读”。
- **继续阅读**：未入选精选、但有阅读价值的内容，按优先级排序。
- **其他资讯**：低优先级与重复报道，默认折叠；同一事件提供主报道跳转。内容不删除。

默认偏好技术、商业与人文，优先重要变化、原始信息和深入分析，降低日常行情、推广上新、重复报道与无上下文闲聊的优先级。未入选精选且评级低于 60 的内容，以及重复报道，收进“其他资讯”；评级是主观阅读判断，不是事实可信度评分，也不在页面上展示精确分数。

```yaml
curation:
  enabled: true
  maxPicks: 10
  # interests: 自定义关注方向、想多看和少看的内容
```

技术内容中的 AI 模型、工具、智能体与研究单独归入“AI”；已有评级通过标题与中文摘要的明确 AI 关键词细分，无需重新打分。商业和人文分类保持原有取舍。

页面提供优先级 Tab、AI/技术/商业/人文/综合分类和标题/摘要/来源搜索。未启用 JavaScript 时按三个分组顺序展示，全部内容可访问。邮件使用不带脚本、Tab 或搜索控件的顺序分组版本；尚未做真实邮箱客户端验收。

逐条评级与整批精选分别缓存。相同归档窗口重跑可复用；模型、偏好、中文摘要或采集时间变化会影响缓存，重新执行 `monitor` 后即使条目标为 `seen`，也可能重新评级。调整 `maxPicks` 或窗口条目集合会重新做整批精选。筛选失败时显示全部内容，不自行把未评级条目隐藏；重跑复用已完成评级。开启筛选时，未完成筛选的报告也不会投递。可用 `curation.enabled: false` 单独关闭筛选；关闭中文处理也会停用依赖中文摘要的筛选。

推荐仅根据已采集的标题和摘要，未补采外链正文或核实新闻；事件分组和排序需要结合阅读反馈继续调整。

## 报告、模型与邮件

`monitor` 采集入库；`report` 读取指定**采集时间窗口**内所有批次，按稳定 ID 合并，不再次访问新闻网站。翻译、筛选缓存未命中或启用 `--analyze` 时仍会调用模型，因此 `report` 不保证离线执行。窗口采用 `[start, end)`，默认最近 24 小时，最长 7 天；原始发布时间另行保留。这样热榜中发布时间较早、今天首次观察到的文章仍能出现。

```bash
pnpm dev report --config config.yaml --hours 24
pnpm dev report --config config.yaml --date 2026-09-21
pnpm dev report --config config.yaml --start '2026-09-21T08:00:00+08:00' --end '2026-09-21T20:00:00+08:00'
```

`--date` 按运行机器本地日期；Cron 另用 `schedule.timezone`。旧的 `yy-MM-dd HH:mm` 时间格式仍接受。`--date` 不能与 `--start` / `--end` 混用；仅给 `--end` 时向前取 `--hours` 小时，仅给 `--start` 时截止当前时刻。`--all` 读取全部 RSS/X 归档，不受 7 天窗口限制，也不能与 `--date` / `--start` / `--end` 混用。窗口内没有证据时报错，不会自动补采。

逐条翻译和摘要自动执行，无需 `--analyze`。如需额外的跨条目专题简报，再加 `--analyze`，它复用同一 `llm` 配置。只有这个附加专题分析的输入受 `maxItems` 和 `maxCharsPerItem` 限制，截断会记录；逐条中文处理与原始归档不受影响。模型必须引用证据 ID，出现不存在的引用就报错；这仍不能替代逐句事实核验。

要投递邮件，配置 `email` 和其 `passwordEnv` 对应的环境变量，再显式增加 `--send`：

```bash
pnpm dev report --config config.yaml --hours 24 --analyze --send
# 单独验证邮件配置（会实际发送测试邮件）
pnpm dev test-email --config config.yaml
```

`--send` 只用于 `report`；`monitor` / `feed` 不发送邮件。未加 `--send` 不发送邮件，即便配置了 SMTP；`test-email` 则会直接向 `emailTo` 的全部地址发送测试邮件。旧 `--id` 收件人参数已移除，需要单独投递时使用独立配置。SMTP 465 使用 TLS，其他端口使用 Nodemailer 的非隐式 TLS 模式；自定义邮箱应显式设置主机和端口。

重复执行 `--send` 会重复投递；尚未实现已发送事件去重。**采集来源失败本身不会阻止报告邮件发送**：只要已有可读证据且中文处理、筛选完成，就可能发送带来源失败状态的报告；请检查页尾来源状态。凭据不写入证据包或报告。已用本机 Pi gateway 验证真实模型；邮件仅验证模拟传输，尚未发送真实邮件。

## 定时运行

```bash
pnpm build
node dist/index.js serve --config config.yaml
```

```yaml
schedule:
  collect: '*/30 * * * *'
  report: '5 8,20 * * *'
  timezone: Asia/Shanghai
  analyze: false
  sendEmail: false
serverPort: 12440
```

示例每 30 分钟采集，08:05 / 20:05 生成最近 24 小时报告；早晚窗口会重叠，尚未按已发送内容去重。默认中文处理需要可用模型，启动时检查模型配置及必需凭据，但不执行模型请求或 SMTP 连通性测试；`analyze` 仅控制附加专题分析。启动本身不立即采集；先手动执行 `monitor` 可建立首批证据。配置在启动时读取，修改 YAML 或环境变量后需重启。

采集与报告串行执行，上一轮未完成时不重复排入同类任务。状态接口仅监听 `http://127.0.0.1:12440/`，返回最近任务状态，不托管 HTML 报告；状态保存在内存中，重启后回到 `idle`。旧的 `/run/*` HTTP 触发接口已移除，手动运行使用 CLI。停止用 Ctrl-C。程序不会自行安装系统服务或开机任务。

## 数据与兼容性

路径相对于配置文件；默认归档到被 Git 忽略的 `archive/feed-v1/`：

- `runs/<runId>/raw.json`：本次解析后的原始条目；`source-pack.json`：正文、时间和来源状态；`preview.html`：中文阅读预览；`reading-pack.json`：逐条译文、摘要和处理状态。
- `items/`：内容最新版本；`index.json`：规范 URL、X 帖子 ID，或无链接/社区元数据条目的 `来源 ID + GUID` 去重索引（社区无 GUID 时退回来源内 URL）。
- `reports/<reportId>/source-pack.json`、`report.html`：窗口报告及完整证据；`reading-pack.json` 保存中文处理结果，额外 `--analyze` 时增加 `analysis.json`（专题分析的实际模型输入和结果）。
- `chinese/items/`：完整条目中文缓存；`chinese/steps/`：成功分段和归纳步骤缓存，文件名是内容与模型配置的哈希。
- `editorial/ratings/` 与 `editorial/selections/`：逐条评级和整批精选缓存；每次运行目录的 `editorial.json` 保存完整筛选结果及重复事件引用。
- `latest.json` / `latest-report.json`：最近运行结果及完成、缓存、待处理、失败计数。

`new` / `updated` / `seen` 是采集状态，表示首次观察、标题/正文变化、已采集，并非已读/已发送状态。报告内同一 ID 只出现一次，来源状态显示窗口内该来源最近批次的结果。不同 URL 的同一事件仍可能重复；模型整理不等于持久化事件聚合。

`.lock` 覆盖整次采集或报告（包括模型处理与邮件投递），不是只锁写文件的一瞬间；不要让独立 CLI 与正在执行任务的 `serve` 共用同一归档。锁文件记录进程 PID，异常退出遗留锁时，确认对应进程及其他使用该归档的任务均已停止后再删除锁。

旧归档不会删除，但新报告不混入只有标题的旧索引。旧 `newsApiBaseUrl` / `hotlist_sources` / `stream_sources` 配置会报迁移提示，参照示例重写。旧离线分析/存储库暂时保留供读取历史数据，不再接入运行入口；自动历史趋势、热度排名与旧 HTTP API 不再提供，后续如需趋势应基于新的正文证据实现。`docs/PRD*`、`docs/DATA_SOURCE_GUIDE.md`、`docs/superpowers/` 和 `specs/` 保留历史设计，当前使用方式以本 README、配置示例及 [迁移说明](docs/source-migration.md) 为准。

升级已有部署时，先停止旧进程，备份个人配置与归档；更新代码后执行 `pnpm install --frozen-lockfile`、迁移配置并重新 `pnpm build`。先运行一次 `monitor` / `report` 核对输出，再启动 `serve`。`pnpm start` 等价于 `node dist/index.js`，需提供子命令，例如 `pnpm start serve --config config.yaml`；修改源码后必须重新构建。

## 常见运行状态

| 情况 | 含义与处理 |
| --- | --- |
| `monitor` 退出码 1，但有 `preview` | 可能部分来源失败、中文处理未完成或筛选失败；检查输出的 `results`、`localization`、`curation`，成功条目已归档 |
| `report` 退出码 1 | 检查时间窗口、配置、模型处理及投递错误；`deliveryError` 表示处理未完成而阻止投递 |
| `report` 退出码 0，但部分来源失败 | 退出码不单独反映归档的来源失败状态，仍须检查 `results`；`serve` 将这类任务标为 `partial` |
| `pending` / `failed` | 补齐模型配置、凭据或恢复服务后，重跑同一窗口的 `report`，可复用已成功步骤 |
| `Feed archive is locked` | 先检查正在运行的采集、报告和定时任务；不要直接删除活跃锁 |
| `No RSS/X evidence` | 窗口没有新格式归档；先执行 `monitor`，或使用正确的窗口 / `--all` |

## 开发验证

```bash
pnpm test --run
pnpm build
```

测试使用本地数据与模拟模型/邮件，不会访问私人账号或发送邮件。
