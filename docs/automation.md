# 每日 Agent 任务与流程复用

`serve` 是可选采集定时器；完整日报需要宿主定时唤起能运行本机 CLI、阅读证据并写作的 Agent。只把 `news` 放进系统 cron，得到的是快照，不会自动完成精选与发布。

## 配置宿主任务

在支持定时运行 Agent 的宿主中，设置 **Asia/Shanghai 每天 10:00**。若宿主采用五字段 cron，该时间对应 `0 10 * * *`，时区需单独设置；不同宿主的调度格式以其文档为准。20:00 增量晚报是可选的另一项授权，不随早报自动启用。

10:00 同时是计划启动时间和固定新闻截止时间。采集、摘要、编辑结束后才发布，不承诺十点整上线；晚启动仍以十点截止。错过一整天时按协议做历史回放，不能把历史日期传给 `--refresh`。需要本地登录会话的任务，应确保机器、宿主、所用浏览器及发布工具可用；后台进程须获得正确的 Node 22、PATH 与凭据环境。

创建前检查宿主中的现有任务，更新同一任务，避免另建博客轮询或重复日报。日常保持 `serve` 停止。仓库提供流程和模板，不会自动安装宿主任务，也没有通用的 `schedule.report` 配置开关。

## 复用现有 Skill

复用 [skills/news-monitor](../skills/news-monitor/SKILL.md)，不必另建一个“日报 Skill”：采集、编辑、发布和恢复共享冻结快照与回执。入口负责流程选择，[协议](../skills/news-monitor/references/protocol.md)定义数据，[发布与恢复](../skills/news-monitor/references/delivery.md)定义外部操作及完成条件。

最简单的接入方式是在任务里给出仓库路径，并要求 Agent 每次读取 `skills/news-monitor/SKILL.md`。若宿主支持安装本地 Skill，可把整个 `skills/news-monitor/` 目录放到它的 Skill 搜索路径；保持 references 子目录完整，并继续提供仓库的实际路径。已有安装时先比较版本再更新，避免多个不同版本并存。安装副本不会随仓库更新自动同步。

仓库中的 OpenCLI、serve 与配置教程通过实际仓库路径读取；已安装 Skill 的相对位置不用于推测仓库路径。只生成本地报告时不需要学城或通知工具；选择对应发布目标时，才准备相应依赖。

## 可复制的每日早报任务提示词

先按[可恢复日报流程](briefing.md)准备仓库外的 Delivery JSON，确定父目录与每个通知目标已授权。提示词只传部署路径，具体恢复规则保持单一来源。

```text
每天 Asia/Shanghai 10:00 在本任务生成当天早报。
仓库：<REPO_ABSOLUTE_PATH>
Node 22：<NODE22_ABSOLUTE_PATH>
Feed 配置：<FEED_CONFIG_ABSOLUTE_PATH>
Delivery 配置：<DELIVERY_JSON_ABSOLUTE_PATH>
产物目录：<OUTPUT_ROOT>/YYYY-MM-DD/morning

读取仓库 skills/news-monitor/SKILL.md、references/protocol.md 与 docs/briefing.md。
先检查当期 state.json；仅新一期执行 briefing prepare，已有状态按 docs/briefing.md 恢复。
阅读冻结 news.json/reading-pack.json，按 Skill 写一次
editorial.json，精选目标为 preferences 中配置的 10 条；在 fish 登录 shell 中
导出既有令牌给 Node 子进程，执行 briefing deliver；读取 briefing
status。命令使用上述 Node 22 与仓库 cwd。成功状态以 state.json 为准。

本任务授权 Delivery 配置列出的 Koalablog 数据发布、学城父目录创建与两个
大象目标的通知。学城操作前读取 citadel Skill，保持既有父目录权限。
复用部署的阅读入口；程序生成本地 HTML 和 data Markdown，管理阶段回执、
同一完整 HTML 的学城回读、双平台完成后的通知与查重。来源不完整仍记录 partial，消息内容按 docs/briefing.md。

已有当期状态时恢复剩余阶段；摘要未结束先等待；采集被中断先查归档，已有
合格快照用 --snapshot 接管，未确认结果不盲目采集或再次发送。
每账号 X 采集按源配置 limit，未覆盖起点说明缺口，不以扩量绕过部署约定。
通知 unknown 先查对应聊天，查证后通过 reconcile-notification 补记或允许重试。
仅在 state.complete 为 true 时说全部完成，其余逐目标报告可恢复的阻碍。
不启动 serve/博客轮询、不发送邮件、不修改代码或提交 Git。项目登记按宿主要求收尾。
```

填写模板或安装 Skill 不会执行发布。首次真实运行还需确认本机登录与连接；任务保持暂停时只更新提示词，不执行 prepare/deliver。

## 增量晚报与重跑

需要晚报时，在另一项已授权的 20:00 任务中使用 `--edition evening --refresh --baseline <当天实际早报 snapshotPath>`，产物放同日 `evening/`。先读取早报回执获取真实基线；输出标题、版次及通知策略也要相应调整。没有早报时，报告基线缺失，不能拿另一日的快照或可变 latest 冒充。

同日重跑先查回执，再决定恢复哪一步。`render` 可复用完全相同的本地 HTML 进行发布；不同内容的同日远端报告不能强制覆盖。通知状态为 sending/unknown 时先核对对应聊天记录。完整完成条件和重试边界见 [delivery.md](../skills/news-monitor/references/delivery.md)。
