# NewsNow 来源迁移

来源探测记录日期：2026-09-21（Asia/Shanghai）；“配置与行为迁移”已按 2026-09-24 当前流程更新。原仓库 `b7fe7b624b92ec236217181ec71fe5d196ad2550` 的两个配置文件实际使用了 6 个媒体来源；其中 5 家已迁移成功。“联合早报四个频道”指它内部的中港台、国际、新加坡和财经，不是全部媒体的数量。新配置全部改为 Feed/X，运行入口不再访问 NewsNow。

## 映射与内容变化

| 原来源 | RSSHub 路由 | 示例实例 | 本次单源验证 | 与原抓取的差异 |
| --- | --- | --- | --- | --- |
| 华尔街见闻热门 `wallstreetcn-hot` | `/wallstreetcn/hot/day` | `https://hub.slarker.me` | RSS 10 条 | 日热门文章，包含正文/简介；不再保留旧抓取次数/排名热度模型 |
| 澎湃新闻 `thepaper` | `/thepaper/sidebar/hotNews` | `https://rss.injahow.cn` | RSS 20 条 | 保留热榜选题；不以 `/thepaper/featured` 冒充热榜 |
| 财联社热门 `cls-hot` | `/cls/hot` | `https://hub.slarker.me` | RSS 13 条 | 热门文章，包含正文/简介；受上游反爬影响 |
| 金十数据 `jin10` | `/jin10` | `https://hub.slarker.me` | RSS 20 条 | 快讯流；18 条无文章链接，使用 GUID 入库，1 条无描述 |
| 联合早报 `zaobao` | `/zaobao/realtime/china` | `https://hub.slarker.me` | RSS 24 条 | 中港台即时流，并非保证与旧全站结果一一对应 |
| 联合早报（覆盖扩展） | `/zaobao/realtime/world`、`/zaobao/realtime/singapore`、`/zaobao/realtime/zfinance` | `https://hub.slarker.me` | 分别 24 / 24 / 27 条 | 国际、新加坡、财经；财经首次超时，有限重试成功；新加坡有无正文音频链接 |
| 微博热搜 `weibo` | `/weibo/search/hot` | 停用 | 三实例均 503 错误页 | 仅热搜关键词/搜索链接，不等于新闻正文。保留停用项及原因，未接回 NewsNow |

以上为当时单源验证的 Feed 数量；独立 collect 按普通来源的 `limit` 取样，当前报告刷新保存 Feed 返回的全部条目，后续数量会变化。除上述原来源，还保留已试采的 Simon Willison、Econlib、Works in Progress 原生 RSS/Atom 和本机 `@simonw` X 来源。

这里的 Feed 由 RSSHub 转换，并非已找到媒体原生官方 RSS。公共实例没有 SLA；可修改全局 `rsshub.baseUrl` 或来源的 `baseUrl` 换成自建实例。路由语义来自固定版本源码，实例部署版本可能不同，代码阅读与本次请求成功不能证明长期稳定。

应用级完整复测（接入 IT之家前）：12 个启用来源全部成功，共 86 条（含 5 条 X）；24 小时归档报告汇总 93 个唯一条目。首轮财联社及早报两个频道曾失败，定向复测恢复，错误记录保留。公共实例仍有间歇失败风险。

## 新增 IT之家

- 官方原生 RSS：[https://www.ithome.com/rss/](https://www.ithome.com/rss/)，[IT之家首页](https://www.ithome.com/)的“RSS订阅”入口指向该地址。
- 配置为 `id: ithome`、`type: rss`、`category: 技术`、`limit: 10`，已加入默认、开发、feed 示例和本机配置。无需 RSSHub。
- 2026-09-21 当前设备请求 HTTP 200，`text/xml; charset=utf-8`，Feed 共 60 条。取前 10 条均有内容、文章链接和发布时间，正文文本 340–1078 字符；未逐篇核验是否全文。
- 新版采集器实采 10 条，重复采集新增 0、已见 10；窗口报告可直接汇总这些归档内容。

## 新增 Hacker News 与其他来源

当时已启用 Hacker News（HNRSS）、Ars Technica、TechCrunch、NPR 国际新闻、Our World in Data 和 Aeon；独立采集的配置样本量分别为 10 / 5 / 5 / 5 / 3 / 3 条，当前实际配置与报告模式以配置文件和协议为准。RSS 地址与用途见 [RSS 来源配置](../config/sources/rss.yaml)。

选取新闻编辑部、数据研究机构与具名思想写作各自承担不同角色，不把它们统一当成“已经核实的事实”。Hacker News 是社区链接来源，本机官方 RSS 连接超时，改用公开的 HNRSS；其余五项直接读取发布方 Feed。BBC 和 Guardian 本轮网络探测失败，未放入默认配置。

社区元数据使用独立条目身份，并保留原文/讨论双链接；摘要来源显式标注 `feed-summary`，这些信息会一同进入模型证据包。

## 微博的缺口

实测 `rsshub.rssforever.com` 缺少浏览器可执行文件，`rss.injahow.cn` 返回上游字段解析错误，`hub.slarker.me` 返回访客 Cookie 获取冷却错误。默认 `enabled: false`，报告明确显示“未启用”。下一步应在可维护的 RSSHub 实例配置浏览器依赖，必要时按路由文档提供微博会话，再独立验证；不能把用户的 X 登录状态当成微博登录状态。

## 配置与行为迁移

1. 将旧配置迁为当前 [外部配置结构](../config/README.md)：主 YAML 的 includes/sourceFiles 分别加载运行、提示词、编辑规则及来源。旧 API 配置会报错，不会继续访问 NewsNow。
2. `collect`（别名 monitor/feed）用于独立采集；日常 Agent 使用 `news --edition morning --refresh` 统一采集、按发布时间筛选、等待全部中文摘要成功或失败后导出快照。默认只生成中文标题与 200 字符以内摘要，不翻译全文。
3. `serve` 只调度独立采集，完整日报由宿主 Agent 按 [定时任务模板](automation.md) 执行。旧 `schedule.report/analyze/sendEmail` 与 `--analyze` 已退出主流程；兼容 `report` 是未经 Agent 精选的归档预览。
4. 摘要依赖环境变量或 Pi provider 提供的 LLM；独立 collect 可保留 pending/disabled，报告阶段必须收敛到 ready/failed，失败保留原文。SMTP 仍为可选项，只有显式 `report --send` 等投递命令才发送；`render --email` 仅生成邮件 HTML，不负责发送。
5. 新归档路径由 archiveDir 配置，建议放在 Git 仓库之外；旧证据保留。按 URL/X ID/GUID 去重后，Agent 可在 editorial.json 的 events 中合并同一事件，脚本核验引用且保留全部原始报道。跨日发布和通知通过[独立回执与恢复流程](../skills/news-monitor/references/delivery.md)处理。

## 核验来源

RSSHub 路由核验固定提交：`63ff8ba3603937cfc21e7d8c259820005d731d59`。

- [华尔街见闻路由源码](https://github.com/DIYgod/RSSHub/tree/63ff8ba3603937cfc21e7d8c259820005d731d59/lib/routes/wallstreetcn)
- [财联社路由源码](https://github.com/DIYgod/RSSHub/tree/63ff8ba3603937cfc21e7d8c259820005d731d59/lib/routes/cls)
- [金十路由源码](https://github.com/DIYgod/RSSHub/tree/63ff8ba3603937cfc21e7d8c259820005d731d59/lib/routes/jin10)
- [澎湃路由源码](https://github.com/DIYgod/RSSHub/tree/63ff8ba3603937cfc21e7d8c259820005d731d59/lib/routes/thepaper)
- [联合早报路由源码](https://github.com/DIYgod/RSSHub/tree/63ff8ba3603937cfc21e7d8c259820005d731d59/lib/routes/zaobao)
- [微博路由源码](https://github.com/DIYgod/RSSHub/tree/63ff8ba3603937cfc21e7d8c259820005d731d59/lib/routes/weibo)
- [RSSHub 官方文档的实例列表](https://github.com/RSSNext/rsshub-docs/blob/main/src/zh/guide/instances.md)
- [社区实例讨论](https://github.com/DIYgod/RSSHub/discussions/11867)

逐次 HTTP 状态、采样日期、描述长度和已失败探测记录保存在上层 news-feed 项目的 `notes/2026-09-21-finance-rss-mapping.md` 和 `notes/2026-09-21-general-rss-mapping.md`。
