# 本机 Agent 调用协议

运行要求：Node.js 22、pnpm，仓库已安装依赖并 `pnpm build`，配置了 RSS/X 来源和摘要模型。以下命令在仓库根目录执行；独立安装 Skill 时，运行环境必须提供仓库绝对路径及配置路径。

```bash
node dist/index.js news -c config.yaml --edition morning --refresh
node dist/index.js news -c config.yaml --edition evening --refresh --baseline /absolute/morning/news.json
# 手动补采或历史回放
node dist/index.js collect -c config.yaml
node dist/index.js news -c config.yaml --edition morning --day 2026-09-21
node dist/index.js render --snapshot /absolute/news.json --decisions /absolute/editorial.json --output /absolute/report.html
```

`collect` 返回运行位置与来源/中文处理状态；`monitor`、`feed` 是别名。`news --refresh` 在当天早晚报生成前统一执行一轮新闻与博客采集、归档和中文处理，然后冻结快照；不加 `--refresh` 则只读取归档并补齐中文处理。两种方式都只返回一个 JSON 对象到 stdout。命令错误输出 stderr，退出码 1；`news` 的 `partial` / `empty` 也退出 1，此时 JSON 与快照仍有效。成功不表示已核实新闻或覆盖全部信息流。源失败不能被解释成该源没有新闻。

`--refresh` 必须搭配 `--edition morning|evening`，仅支持北京时间当天且已到 10:00/20:00 的版次；历史日期、缺失或非当天早报基线会在抓取前拒绝。新闻和博客按固定发布时间窗口筛选，早报 `[前一天10:00, 当天10:00)`，晚报 `[早报 window.end, 当天20:00)`；即使刷新跨午夜也不改变此窗口。`observedThrough` 记录刷新后可用证据的采集截止，包含本轮批次。例如 10:45 拉到 08:00 的文章应进入 10:00 早报，而 10:30 发布的文章只归档供晚报使用。博客以发布时间归期，早报补采时观察到的截止后文章保留给晚报；采集阶段只归档，摘要在报告阶段统一处理窗口内全部候选。

不加 `--refresh` 时，`news` 支持自定义 `--start/--end` 或 `--hours`（1–168，默认 24）。历史预设版次只使用北京时间：早报 `[前一天10:00, 当天10:00)`，晚报 `[当天10:00, 当天20:00)`；`--day` 默认北京时间当天。未到截止时间会拒绝生成正式版次，可用明确截止当前的自定义窗口生成预览。基线结束必须恰好等于新窗口开始。晚报必须使用 `edition: morning` 的快照。不加 `--refresh` 时只读截止前采集证据；当天固定窗口补采应加 `--refresh`，将证据读取范围延至 `observedThrough`，报告发布时间范围保持不变。新闻和博客都必须满足 `start <= publishedAt < end`，用于早报、晚报和自定义窗口；日期缺失、无效、过早或达到/超过截止时间的文章不会进入 items、blogs 或快照 reading-pack。原文归档保留，独立 collect 的中文处理与归档预览仍可包含窗口外文章；报告刷新只摘要窗口内新闻和博客，历史博客不占当天额度。

发布时间使用来源提供的字段；HN 时间是社区提交时间，不代表核实过外链原文日期。不用采集时间填补缺失的发布时间，也不因旧文再次出现或正文变化而放宽筛选。早报基线保留原样供对照；`change` 仍描述已入选文章的首次观察/文本版本变化。旧快照保持可读，原有报告不会自动重写，重新生成后才应用筛选。

## 摘要与配置

当前日常配置为 `localization.mode: summary`，所有 RSS、X、Blog 只生成中文标题和 200 字以内摘要，不调用全文翻译。原文与链接保留，长文按 `summaryChunkChars` 分段摘要后合并；优先复用兼容缓存。不要为了生成报告额外逐篇翻译，也不要重写历史快照。

主配置支持 `includes` 与 `sourceFiles`，源、LLM、运行参数和提示词可分别维护；相对路径以声明文件为准，具体字段、合并规则、缓存失效与 X 总开关见仓库 `config/README.md`。来源失败时查看 `source-pack.json` 的 `failure.code/httpStatus/exitCode`；旧批次只有通用错误时不能反推具体原因。原始 stderr 不进入报告。

## news-list-v1

- `snapshotId` / `snapshotPath`：本次不可覆盖的快照 ID 与文件路径。每次导出产生独立 ID；重复渲染使用相同快照。早报使用哪份快照，就以那份快照作晚报基线。
- `window`：`start`、`end`、`basis: publishedAt`，固定的新闻和博客发布时间窗口，ISO 时间与半开区间。兼容旧快照的 `basis: collectedAt`。
- `observedThrough`：可用采集批次的截止（半开区间）；刷新可晚于 `window.end`，不刷新时等于 `window.end`。博客同样使用 `window` 筛选发布时间，不以此字段划分版次。
- `publicationFilter`：新快照记录 `basis: publishedAt`、`scope: news`、`missingDate: exclude`、`included`，以及 `excluded.beforeStart / atOrAfterEnd / missingDate / invalidDate` 数量。`blogPublicationFilter` 使用同样结构，`scope: blogs`，单独记录博客筛选统计。缺失或无效日期被排除时，非空快照为 partial；旧快照可无这些筛选字段。
- `edition`：`morning | evening | custom`；`status`：`ready | partial | empty`。
- `coverage`：实际采集批次时间 `observations`，`failedSources`、`missingSources`、`incompleteSources`（X 未确认回溯到窗口起点）；`complete` 固定 false，RSS/X 有限快照不承诺全量覆盖。
- `preferences`：`interests`、`minPicks`、`maxPicks`、`selectionCriteria`，给 Agent 的偏好、10–20 条范围与四类入选门槛；新字段在旧快照中可不存在。
- `items`：每条有 `id`、`revision`、`title`、`summary`、`languageStatus`、`source`、`sourceId`、`category`、`url`、可选 `discussionUrl`、`publishedAt`、`observedAt`、`firstSeen`、`contentKind`、`change`。摘要未完成时为 null，标题可能仍是原文。`contentKind` 限定证据是全文未核验的 RSS 内容、摘要、社区链接元数据、仅标题或 X 原文。
- `change`：无基线时 `observed`；有基线时 `new`（窗口内首次观察）、`resurfaced`（更早见过但基线里没有）、`updated`（同 ID 原文版本不同）、`unchanged`（同 ID 原文版本相同）。这是文本变化，不是事件判断；社区分数若写在正文中也会触发 updated。
- `baseline`：基线 ID、位置、窗口、状态、覆盖与完整候选列表，供跨 URL 事件关联。无基线则为 null。基线未在当前出现的条目不会被标成删除或撤稿。
- `counts`：总量及各 change 数量；`evidenceSha256`：对应 `reading-pack.json` 的哈希，渲染前核验。

同目录 `reading-pack.json` 保存完整原文、中文标题、摘要、来源状态（旧全文模式还可有译文）；原始 runs 与中文摘要缓存继续保存。输出不包含模型密钥、浏览器 Cookie 或原始传输 payload。模型或来源失败会保留已成功内容；修复后可重试 `news` 获取新快照，旧快照保持不变。

报告冻结前必须等待全部新闻与博客摘要结束，每条 languageStatus 只能为 ready 或 failed；并发任务未完成不能开始 Agent 成稿。模型重试耗尽保留 failed；配置不可用明确记录本次无法执行摘要。旧 pending/disabled 快照可读取，但 render 拒绝成稿，须重新导出；不得手改状态绕过，不能无限重试或重复采集。

## agent-report-v1

配置 `blogCatalog` 时，`news-list-v1` 还含 `blogs` 数组，字段与 `items` 相同；`baseline.blogs` 保存对应基线。`items` 只含新闻候选，博客全部进入独立“博客”分组，不进入 picks、readingIds、sections.evidenceIds 或 beforeIds。`counts.total = counts.news + counts.blogs`。旧快照缺少 blogs 时视为空数组。

博客只包含发布时间落在报告窗口内的条目；早报为截止前 24 小时，晚报与新闻共用增量窗口。历史、无有效日期的博客保留归档；正文更新或重复采集不会绕过时间筛选。博客完整保存 Feed 返回的条目，独立 collect 的中文处理默认每轮新处理 20 篇；报告忽略该额度，窗口内所有博客必须等待摘要完成或失败，历史积压仍通过独立 collect 处理。`collect --channel blogs` 仅采集博客，`--channel news` 仅采集新闻；默认两者都采集。

由调用方 Agent 编写，news-monitor 只校验、排版。所有 ID 使用新闻列表的稳定字符串 ID。

```json
{
  "version": "agent-report-v1",
  "snapshotId": "替换为实际 UUID",
  "title": "9 月 22 日 · 晚间变化",
  "summary": "概括本窗口真正值得注意的变化，并说明影响判断的数据缺口。",
  "picks": [{ "id": "当前条目ID", "topic": "AI", "reason": "具体的阅读价值或新增信息。" }],
  "readingIds": ["其他值得补读的当前条目ID"],
  "events": [{
    "eventId": "本期唯一的事件ID",
    "title": "同一事件的合并标题",
    "summary": "合并共同事实，并保留各报道独有的进展和必要归因。",
    "itemIds": ["当前条目ID", "同一事件的另一条目ID"]
  }],
  "sections": [{
    "title": "一个事件的新进展",
    "kind": "update",
    "body": "早报已有……；现在新增……；变化的意义是……。",
    "evidenceIds": ["当前条目ID"],
    "beforeIds": ["基线条目ID"]
  }]
}
```

`events` 是可选的事件分组，不改变快照或原文归档；旧报告省略此字段仍正常显示。先由编辑 Agent 判断同一具体事件，再做精选和综述，不按宽泛主题或机构强行合并。事件包含本期至少 2 个新闻 ID，最多 100 个；最多 500 组。`eventId` 本期唯一（最多 100 字），`title` 最多 200 字、`summary` 最多 3000 字，三者均非空。每条新闻只能属于一组；博客和基线 ID 不能加入。脚本验证成员、重复分组和引用关系，不替代 Agent 的语义判断。

同一事件最多一个精选、一个 section；引用事件成员的 section 必须只引用该事件的当前成员，基线引用仍使用 `beforeIds`。未分组新闻继续独立展示。时间线和精选用事件标题、合并摘要展示，展开后保留所有原始标题、来源、链接和摘要；独立 HTML 还保留各条原文（显式全文模式还包含译文）。事件按成员最新发布时间排序，各条时间保留。搜索和主题筛选覆盖全部成员；页面卡片数量按折叠后的事件和独立条目计数，公开数据仍包含全部原始新闻。事件代表优先选精选条目，否则使用 `itemIds[0]`。博客不参加事件合并。

`picks` 默认在 10–20 条之间由编辑 Agent 决定，每条至少满足以下一个条件：有切实影响并且影响力大、影响程度深、影响范围广；内容非常优质、非常值得阅读；属于某领域的重大进展；非常奇怪，超出常规认知。reason 说明符合的条件与来源证据支持的具体事实，不能只抄条件或以热度、夸张标题取代证据。同事件只精选一次；合格候选不足 10 条时在报告说明原因，不凑数。数量和标准由 config/editorial.yaml 传入 preferences，按数组顺序展示；`topic` 为 AI/技术/商业/人文/综合。`readingIds` 保留为编辑优先级元数据；页面不再单设继续阅读或其他资讯 Tab，全部非博客新闻统一进入时间线，精选条目同时标记。两组 ID 必须唯一且互不重叠。条目 `reason` 最多 300 字，报告 `summary` 最多 3000 字，可留空（不渲染空段落）。报告主标题仅保留日期与版次，不附“首次观察版”等运行标签。

`overview` 用短段陈述重要新闻事实，必要时注明报道方；不写编辑议论、建议、反问或泛化免责声明。整个综述区显示“新闻综述”小标题和背景底色，各条按有序列表展示；各段 `title` 保留为结构化元数据，其他段类型保留变化标题。每个 section 只讲一条新闻或同一组证据支持的紧密相关事实，以便编号引用紧跟该条新闻末句。不同来源支持不同新闻时拆成独立 section，不将多条新闻合成一段。渲染器统一生成可点击的上标 `[1]` 尾注，完整标题和来源放在悬停提示里；body 只写正文。`summary` 用于时间范围、采集状态等必要说明，单独以小字号、弱化颜色展示。

`sections` 最多 50 段，每段 `body` 最多 5000 字。`kind` 为 overview/new/update/correction/watch，每段必须有至少一个当前证据；update/correction 必须有基线证据。渲染器验证 ID 存在、快照绑定和原始内容哈希，**不验证文字是否真实受到引用支持**，该责任属于编辑 Agent。没有证据时可生成空 sections/picks/readingIds 和诚实说明缺口的 summary。

`render` 默认离线，不调用模型，不发送邮件，输出文件必须不存在；只有显式指定 `--publish-koalablog` 时访问发布站点。`--email` 生成无脚本邮件 HTML。所有正文按纯文本转义，不接受 Agent 注入 HTML。Agent 也可不调用 render，直接使用新闻 JSON 制作其他格式。

## 发布为 Koalablog public memo

在进程环境设置 `KOALABLOG_API_TOKEN`，然后调用。需要代理时设置 `HTTPS_PROXY`（例如 `http://127.0.0.1:7897`）；发布和匿名回读都遵循 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`，不修改其他采集请求的代理配置：

```bash
node dist/index.js render --snapshot /absolute/news.json --decisions /absolute/editorial.json --output /absolute/report.html --publish-koalablog
```

默认站点为 `https://koala.wzhzzmzzy.workers.dev`；可用 `--koalablog-url <HTTPS origin>` 指定站点，用 `--koalablog-token-env <变量名>` 指定凭据变量。token 只通过 Bearer 鉴权发送到指定 origin，不接受含凭据的 URL，不跟随鉴权请求重定向，也不写入报告/回执。此 API 创建公开内容需要站点 admin token。

固定阅读入口是 `/news-feed`，renderer 为 `svelte`。每期报告保存为 public Markdown 数据文件，正文为 `news-feed-reader-v1` JSON 代码块；`/data/news-feed/latest` 是 `news-feed-latest-v1` 索引。早晚报路径为 `/data/news-feed/YYYY-MM-DD/morning` 或 `evening`；自定义窗口使用截止北京时间的 `custom-HHmmss`。路径无快照 ID/hash。

发布器先保存并回读报告，再确保 Svelte Source 存在，最后使用 `baseRevision` 更新 latest。按窗口截止时间比较，补发旧报告不回退 latest；同一路径不同正文拒绝覆盖。HTTP 409 表示并发冲突，重新运行相同命令会回读当前状态后再判断，不能强行忽略 revision。超时不自动重发写请求。所有文件均 `private: false`，鉴权仅用于发布；Svelte 使用 `@koala/page-runtime` 的 public Action 读取，无 token、浏览器写入或模型调用。

默认页面先读取 latest，再读相应日期目录的直接子文件；支持日期、早晚版切换、精选/博客/时间线三个 Tab（依此排序）、AI 等主题过滤和搜索。时间线按发布时间倒序，以北京时间日期分组，可折叠日期；未知发布时间独立分组，不使用采集时间冒充发布时间。日报不递归扫描全部历史。当日没有新报告时展示最近一期及其真实日期。报告只导出阅读字段，不上传原始载荷、本机路径、模型配置或凭据；内容按纯文本展示。

指定日期和版次可分享 `/news-feed?date=2026-09-21&edition=morning` 或 `edition=evening`。只传 date 时读取该日期最新一期；不传这两个参数时读取 latest。指定版次不存在时显示该版次暂无报告，不回退到另一版。日期/版次切换会同步 URL，浏览器前进/后退恢复对应选择；“最新一期”清除这两个参数。错误日期、未知版次、缺日期的 edition 和重复参数会显示错误。自定义时段可用 `edition=custom-HHmmss`。

本地额外生成 `<output>.report.md`、`<output>.latest-candidate.md` 和 `<output>.svelte`；candidate 是本次报告的索引候选，不代表已替换服务器 latest。保存 `<output>.koalablog.json` 回执，`url` 为最新入口，`reportUrl` 为本期日期/版次直达链接，并记录实际 latest、数据路径和部署状态。仅在加发布参数且 HTML 完全一致时复用已有输出文件。

**首次上传 Svelte 后，在已登录 Dashboard 对 `/news-feed` 执行 Deploy。** Source 上传不会自动附加可执行 Artifact；`publication.deploymentRequired` 为 true 时必须明确报告尚需部署，不能宣称页面可用。以后只更新报告数据，无需重新部署。修改页面模板后显式添加 `--koalablog-update-shell` 更新 Source，再执行 Dashboard Deploy；部署失败保留上一版已部署 Artifact。不要在本地编译 Artifact 后上传绕过 Dashboard 工作流。若已有入口 Source 与模板不同，默认拒绝覆盖。

## 宿主接入与调度

Skill 是调用说明，不会赋予 ChatGPT 或其他宿主访问本机的权限。有本机执行工具的 Agent 可直接调用 CLI；只有远程连接器能力的宿主需要另外部署可达的受控工具桥接，此仓库尚未提供 MCP/远程 HTTP 新闻接口。`serve` 的 HTTP 端口仅是本机采集状态，不是 ChatGPT 连接器。

日常在 10:00/20:00 或补生成当天报告时调用 `news --refresh`，新闻与博客一起采集；不另设博客定时任务，不启动 `serve`。早晚共享实际早报 snapshotPath。`serve` 保留为可选的独立采集调度器，`schedule.collect` 只影响它，30 分钟不是报告流程要求。一天两轮不能保证抓到高频 RSS 已滚出的条目，报告摘要额度仅用于窗口内博客。多进程访问同归档受锁保护，锁冲突时等待在途任务结束后重试，不删除活跃锁。

报告刷新时 RSS 不按来源 `limit` 截断，保存 Feed 当前全部条目；上游自身返回数量仍可能有限。X 复用 OpenCLI 分页，从至少 100 条按需扩大请求至 `collection.xMaxItems`（默认 1000）；读到窗口起点之前、返回不足或失败时停止，保留成功条目。未确认到达起点则列入 `coverage.incompleteSources` 并使非空快照为 partial；上游数组返回不足无法区分历史耗尽和分页截断。独立 collect 保留来源 limit 语义。
