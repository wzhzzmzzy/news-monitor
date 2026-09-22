# 本机 Agent 调用协议

运行要求：Node.js 22、pnpm，仓库已安装依赖并 `pnpm build`，配置了 RSS/X 来源和翻译模型。以下命令在仓库根目录执行；独立安装 Skill 时，运行环境必须提供仓库绝对路径及配置路径。

```bash
node dist/index.js news -c config.yaml --edition morning --refresh
node dist/index.js news -c config.yaml --edition evening --refresh --baseline /absolute/morning/news.json
# 手动补采或历史回放
node dist/index.js collect -c config.yaml
node dist/index.js news -c config.yaml --edition morning --day 2026-09-21
node dist/index.js render --snapshot /absolute/news.json --decisions /absolute/editorial.json --output /absolute/report.html
```

`collect` 返回运行位置与来源/中文处理状态；`monitor`、`feed` 是别名。`news --refresh` 在当天早晚报生成前统一执行一轮新闻与博客采集、归档和中文处理，然后冻结快照；不加 `--refresh` 则只读取归档并补齐中文处理。两种方式都只返回一个 JSON 对象到 stdout。命令错误输出 stderr，退出码 1；`news` 的 `partial` / `empty` 也退出 1，此时 JSON 与快照仍有效。成功不表示已核实新闻或覆盖全部信息流。源失败不能被解释成该源没有新闻。

`--refresh` 必须搭配 `--edition morning|evening`，仅支持北京时间当天且已到 10:00/20:00 的版次；历史日期、缺失或非当天早报基线会在抓取前拒绝。截止时间取采集和中文处理完成后的实际时间，包含刚保存的批次；早报覆盖此前 24 小时，晚报从当天早报的实际 `window.end` 接续。采集跨到次日则保留原文并报错，使用明确的自定义窗口处理。博客中文额度只在采集阶段使用一次，快照阶段仅复用博客缓存。

不加 `--refresh` 时，`news` 支持自定义 `--start/--end` 或 `--hours`（1–168，默认 24）。历史预设版次只使用北京时间：早报 `[前一天10:00, 当天10:00)`，晚报 `[当天10:00, 当天20:00)`；`--day` 默认北京时间当天。未到截止时间会拒绝生成正式版次，可用明确截止当前的自定义窗口生成预览。基线结束必须恰好等于新窗口开始。晚报必须使用 `edition: morning` 的快照。窗口由采集批次完成时间 collectedAt 决定；截止后完成的批次不会倒填窗口。以第一次观察到的时间区分新增与旧内容重现，不把文章发布时间等同采集时间。

## news-list-v1

- `snapshotId` / `snapshotPath`：本次不可覆盖的快照 ID 与文件路径。每次导出产生独立 ID；重复渲染使用相同快照。早报使用哪份快照，就以那份快照作晚报基线。
- `window`：`start`、`end`、`basis: collectedAt`，ISO 时间与半开区间。
- `edition`：`morning | evening | custom`；`status`：`ready | partial | empty`。
- `coverage`：实际采集批次时间 `observations`，`failedSources`、`missingSources`；`complete` 固定 false，RSS/X 有限快照不承诺全量覆盖。
- `preferences`：`interests`、`maxPicks`，给 Agent 的偏好和数量建议。
- `items`：每条有 `id`、`revision`、`title`、`summary`、`languageStatus`、`source`、`sourceId`、`category`、`url`、可选 `discussionUrl`、`publishedAt`、`observedAt`、`firstSeen`、`contentKind`、`change`。摘要未完成时为 null，标题可能仍是原文。`contentKind` 限定证据是全文未核验的 RSS 内容、摘要、社区链接元数据、仅标题或 X 原文。
- `change`：无基线时 `observed`；有基线时 `new`（窗口内首次观察）、`resurfaced`（更早见过但基线里没有）、`updated`（同 ID 原文版本不同）、`unchanged`（同 ID 原文版本相同）。这是文本变化，不是事件判断；社区分数若写在正文中也会触发 updated。
- `baseline`：基线 ID、位置、窗口、状态、覆盖与完整候选列表，供跨 URL 事件关联。无基线则为 null。基线未在当前出现的条目不会被标成删除或撤稿。
- `counts`：总量及各 change 数量；`evidenceSha256`：对应 `reading-pack.json` 的哈希，渲染前核验。

同目录 `reading-pack.json` 保存完整中英文内容、摘要、来源状态；原始 runs 与翻译缓存继续保存。输出不包含模型密钥、浏览器 Cookie 或原始传输 payload。模型或来源失败会保留已成功内容；修复后可重试 `news` 获取新快照，旧快照保持不变。

## agent-report-v1

配置 `blogCatalog` 时，`news-list-v1` 还含 `blogs` 数组，字段与 `items` 相同；`baseline.blogs` 保存对应基线。`items` 只含新闻候选，博客全部进入独立的第四个“博客”分组，不进入 picks、readingIds、sections.evidenceIds 或 beforeIds。`counts.total = counts.news + counts.blogs`。旧快照缺少 blogs 时视为空数组。

博客窗口只包含首次发现或内容变化的条目，重复轮询不算更新；首次导入旧文章不代表刚发表。博客完整保存 Feed 返回的条目，中文处理默认每轮新处理 20 篇，pending 会在后续 collect 中继续处理；不要因为 pending 就丢弃原文或声称摘要已经完成。`collect --channel blogs` 仅采集博客，`--channel news` 仅采集新闻；默认两者都采集。

由调用方 Agent 编写，news-monitor 只校验、排版。所有 ID 使用新闻列表的稳定字符串 ID。

```json
{
  "version": "agent-report-v1",
  "snapshotId": "替换为实际 UUID",
  "title": "9 月 22 日 · 晚间变化",
  "summary": "概括本窗口真正值得注意的变化，并说明影响判断的数据缺口。",
  "picks": [{ "id": "当前条目ID", "topic": "AI", "reason": "具体的阅读价值或新增信息。" }],
  "readingIds": ["其他值得补读的当前条目ID"],
  "sections": [{
    "title": "一个事件的新进展",
    "kind": "update",
    "body": "早报已有……；现在新增……；变化的意义是……。",
    "evidenceIds": ["当前条目ID"],
    "beforeIds": ["基线条目ID"]
  }]
}
```

`picks` 最多 20 条，按数组顺序展示；`topic` 为 AI/技术/商业/人文/综合。`readingIds` 进入继续阅读；剩余全部折叠。两组 ID 必须唯一且互不重叠。条目 `reason` 最多 300 字，报告 `summary` 最多 3000 字。

`sections` 最多 50 段，每段 `body` 最多 5000 字。`kind` 为 overview/new/update/correction/watch，每段必须有至少一个当前证据；update/correction 必须有基线证据。渲染器验证 ID 存在、快照绑定和原始内容哈希，**不验证文字是否真实受到引用支持**，该责任属于编辑 Agent。没有证据时可生成空 sections/picks/readingIds 和诚实说明缺口的 summary。

`render` 完全离线，不调用模型，不发送邮件，输出文件必须不存在。`--email` 生成无脚本邮件 HTML。所有正文按纯文本转义，不接受 Agent 注入 HTML。Agent 也可不调用 render，直接使用新闻 JSON 制作其他格式。

## 宿主接入与调度

Skill 是调用说明，不会赋予 ChatGPT 或其他宿主访问本机的权限。有本机执行工具的 Agent 可直接调用 CLI；只有远程连接器能力的宿主需要另外部署可达的受控工具桥接，此仓库尚未提供 MCP/远程 HTTP 新闻接口。`serve` 的 HTTP 端口仅是本机采集状态，不是 ChatGPT 连接器。

日常只在 10:00/20:00 的 Agent 编辑任务开始时调用 `news --refresh`，新闻与博客一起采集；不另设博客定时任务，不启动 `serve`。早晚共享实际早报 snapshotPath。`serve` 保留为可选的独立采集调度器，`schedule.collect` 只影响它，30 分钟不是报告流程要求。一天两轮不能保证抓到高频 RSS 已滚出的条目，博客积压翻译也仅随这两轮继续。多进程访问同归档受锁保护，锁冲突时等待在途任务结束后重试，不删除活跃锁。
