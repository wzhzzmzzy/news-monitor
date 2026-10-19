# 可恢复的日报流程

完整日报用 `briefing prepare → Agent 编辑 → briefing deliver`。程序管理快照、发布与通知；Agent 只负责阅读证据、合并事件、精选和综述。`state.json` 是执行结果的依据，聊天是否正常结束不决定日报是否成功。

## 1. 部署与执行

运行环境为 Node 22、已构建仓库、现有 Feed 配置、Koalablog 已部署的 `/news-feed`、Citadel CLI 和已登录的大象/CatDesk。复制 [delivery.example.json](../config/delivery.example.json) 到仓库外，填入已授权的站点、学城父目录、MIS 和通知目标。文件只保存令牌环境变量名；令牌由进程环境提供。`ledgerDir` 使用绝对路径，并在所有重跑中复用。

每天 10:00 后执行以下步骤。命令在仓库根运行；`node` 替换为宿主的 Node 22 绝对路径。日期按 Asia/Shanghai，目录保持为 `<产物根目录>/YYYY-MM-DD/morning`。

```bash
node dist/index.js briefing prepare --dir <当期目录> \
  --day YYYY-MM-DD --edition morning -c <Feed配置>
# Agent 阅读当期 news.json / reading-pack.json，写当期 editorial.json
node dist/index.js briefing deliver --dir <当期目录> -c <Delivery配置>
node dist/index.js briefing status --dir <当期目录>
```

需要登录 shell 导出的令牌时，在该 shell 中运行整个 `deliver`。代理也通过该进程环境提供。命令执行过程中不打印环境或令牌。

`prepare` 固定前一天 10:00 到当天 10:00 的发布时间窗口，统一采集 RSS/X/Blog，等待全部中文摘要 ready/failed，验证证据并保存快照及状态。来源或摘要部分失败会保留缺口；非空且摘要终态的 partial 快照可成稿。空新闻窗口停止编辑，不能用旧新闻填充。10:00 前不发布名为正式早报的未来窗口。

Agent 按 [news-monitor Skill](../skills/news-monitor/SKILL.md) 处理候选。`editorial.json` 绑定同一 snapshotId；报告标题为 `YYYY 年 M 月 D 日早报`。发布开始后，快照、证据、决策和目标配置均冻结，恢复时保持原样。

## 2. 发布顺序与完成条件

| 阶段 | 持久化产物 | 完成条件 |
| --- | --- | --- |
| 快照 | news.json、reading-pack.json、state.json | 发布时间窗口和摘要终态有效，证据哈希一致 |
| 本地定稿 | report.html、report.html.report.md、report.html.latest-candidate.md、km.html | 同一快照和 editorial，文件内容冻结 |
| Koalablog | koalablog.json | 当期 data Markdown 与 latest 匿名数据回读一致，阅读入口已部署 |
| 学城 | km-create.xml、km-readback.xml、state.json 中 contentId | 父目录/标题正确，回读 HTML 逐字一致 |
| 各通知目标 | state.json 和共享日期通知回执 | CatDesk 双层 success 或聊天查证确认已发送 |
| 汇总 | state.json、STATUS.md | 全部上述阶段 done，complete 为 true |

Koalablog 仅写 `/data/news-feed/YYYY-MM-DD/morning` 和 `/data/news-feed/latest` 的 data Markdown，保留 `news-feed-reader-v1` / `news-feed-latest-v1` 协议。日常 `deliver` 使用 data-only 模式，既不更新 `/news-feed` Source，也不触发部署。页面模板可独立升级；日报发布不要求模板字节相同。阅读页 `deployment_drift` 表示保存的 Source 与仍在线的已部署 Artifact 不同；data-only 在匿名阅读入口核验成功后可继续发布数据，保留实际状态，不部署或改写 Source。已有不同正文的同日路径或 revision 冲突会停止该平台。补发旧日报不会让 latest 倒退；相同截止的不同路径会报告冲突。

本地 HTML 复用 `templates/news-feed.svelte` 的阅读样式，并保留交互阅读、事件分组与全部采集原文。学城 `km.html` 与 `report.html` 为同一份完整 HTML，逐字一致，不另生成无样式的摘要版。超出 2 MiB 时暂停学城发布；当前协调器不自动导入附件版回执。需要该模式时由 Agent 按 [Citadel 恢复规则](../skills/news-monitor/references/delivery.md) 单独完成附件发布、核验与通知，并保留其回执，不能把统一命令的未完成状态当作成功。

学城通过 Citadel 创建父目录下的子文档，保留父目录权限；本流程不额外授予权限。创建前查同标题子文档；多个匹配或正文不一致时保留远端内容并报告。创建前记录尝试，返回后立即保存 contentId，再回读。结果不明时先查子文档；没有可确认的匹配就暂停，不再次猜测性创建。

两个平台独立：Koalablog 失败仍可发布学城。两个平台及本地产物均核验完成后才发送通知；群与个人独立，一个失败不阻止另一个。消息均为 `今天的草台新闻推送来了： <真实当期学城URL>`，唯一链接标题为 `YYYY 年 M 月 D 日`，不 @人员、不发送附件。每次发送前按群名称或精确 MIS/UID 查证身份；群 ID unknown 时，仅唯一精确结果允许按名称发送。

## 3. 断点恢复

再次执行相同 `deliver`，已完成阶段跳过，失败平台重试。改变正文或目标会拒绝续跑，避免同一期多种内容。`status` 与磁盘回执始终可检查，即使 Agent 没有给出最后回复。

- `prepare` 被中断：先检查进程、归档中当期快照和摘要状态。已有完整快照可用 `briefing prepare --dir <当期目录> --day YYYY-MM-DD --snapshot <真实归档news.json>` 接管。程序不盲目重新采集。仅失效锁阻碍恢复时调用 `briefing unlock --dir <当期目录>`；它只允许同主机且原 PID 已退出的锁，活跃进程保持不变。不要并发执行解锁和新任务。
- `local` 中断：重复渲染允许复用字节一致的 HTML/Markdown，任何不同内容保留原文件并停止。
- Koalablog 请求超时：重复同一数据发布前先回读当前数据；相同正文复用，latest 使用 revision 保护。
- 学城创建/回读中断：按已保存 contentId 或同标题子文档回读，正文一致才完成。创建结果不明且目录无匹配时，需要查证该次请求结果，保留 creationAttempted 状态。
- 通知 running/sending/unknown：不自动重发。共享 `<ledgerDir>/YYYY-MM-DD/<targetKey>.json` 跨报告目录去重，因此重生成同日数据也不会重复通知。

CatDesk 当前 CLI 只有 search/send/members，没有聊天历史查询命令。须通过可用聊天读取工具或人工查证结果；无法查证就保持 unknown。确认后将证据写入 JSON，再运行：

```bash
node dist/index.js briefing reconcile-notification --dir <当期目录> \
  -c <Delivery配置> --target <targetKey> --proof <查证JSON>
node dist/index.js briefing deliver --dir <当期目录> -c <Delivery配置>
```

查证 JSON 字段为 `reportDate`、`targetKey`、`contentId`、`outcome`（sent 或 not-sent）、`checkedAt`（带时区的 ISO 时间）、`checkedBy`、`evidence`（具体查证依据）。sent 只补记回执；not-sent 才允许重试。命令保留原状态及证据文件，拒绝确认另一日期/接收人的回执。

旧日报回执仍按旧流程恢复；不能把没有共享通知回执的旧报告直接当作未发送的新任务。先检查原来的 daxiang-push*.json，已发目标保持去重。新流程默认目录每日期每版次一份，日常只配置早报。

## 4. 宿主任务

定时器唤起 Agent，Agent 读取 Skill、运行 prepare、编辑一次、运行 deliver、按 state.json 报告结果。调度提示词只记录入口与部署信息；恢复细节集中在本文，避免把整套规则复制进自动任务。每次唤起优先接续已存在的当期目录；只发布成功的目标无需重做。独立 `serve` 和博客轮询保持关闭。

`deliver` 返回退出码 1 表示有必需阶段未完成；它仍保存有效回执和 STATUS.md。数据质量 partial 单独记录，不等于平台发布失败。`complete: true` 写入磁盘后才输出命令结果，项目登记和 Agent 最终回复属于其后的收尾动作。

定时日报采用 curl HTTP/1.1 传输，复用发布进程 HTTPS_PROXY，凭据经标准输入传递；临时响应完成后清理。GET 允许最多两次重试，POST 只尝试一次，结果不明先回读。精选目标由 config/editorial.yaml 进入冻结快照 preferences，日常 minPicks/maxPicks 均为 10；优质候选不足时明确说明，不凑数。

## 5. 发布后与单独修复的检查

本地摘要终态不等于线上同步成功。所有发布模式均匿名回读完整当期 JSON，核验博客 ID、中文标题与摘要；再匿名核验 latest 的日期、版次、路径与 cutoff，并检查日期入口和默认阅读入口。新期推进 latest，旧期补发不倒退。任一步失败不视为发布完成，不通知。

同日不同正文冲突仍停止覆盖，明确说明线上旧报告和本地新报告的差异。未经用户授权不手工覆盖或拼接。用户授权单独补摘要时，必须使用实时 revision 保护，保存原正文和修改回执，核验当期数据后继续检查 latest 与两个入口；不能以 data 更新成功结束整个修复。单独修复不自动把原 briefing.state 标为 complete，也不自动重发通知。重跑复用冻结快照与决策。

## 6. 历史补报与不通知发布

历史日期先用 `news --edition morning --day YYYY-MM-DD` 回放归档。需使用后来采集的证据时显式添加 `--observed-through <ISO时间>`，只扩展证据读取截止，不改变发布时间窗口；不能搭配 --refresh，不能晚于现在。报告注明事后补录与覆盖缺口。所得合格快照通过 `briefing prepare --snapshot <归档news.json>` 接管。

仅发布不通知时，使用当期专用 Delivery 文件设置 `notifications.targets: []`；两平台核验成功即完成，不调用 CatDesk。勿修改日常配置或将通知伪标 sent。
