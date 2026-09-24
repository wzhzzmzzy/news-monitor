# news-monitor · Agent 的 RSS / X 新闻工具

采集 RSS/Atom、RSSHub、X 与 HN 热门博客，保留原文，生成中文标题和不超过 200 字符的摘要。Agent 基于冻结快照合并同一事件、精选 10–20 条并撰写报告，CLI 负责校验与渲染。

```text
宿主定时唤起 Agent → news --refresh → 采集归档 → 窗口内全部摘要完成或失败
                                                ↓
                       发布核验与通知 ← render ← Agent 编辑 ← 冻结快照
```

报告提供精选、博客、时间线三个 Tab。博客独立展示、不参与精选；新闻和博客均按发布时间归期，历史内容保留归档。

## 快速开始

环境：Node.js 22、pnpm 10.12.4。在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
cp config.example.yaml config.yaml  # 已有个人配置时不要覆盖
# 按配置指南设置来源、LLM 和仓库外的 archiveDir
pnpm build

# 北京时间当天 10:00 后：采集并导出固定 24 小时早报快照
node dist/index.js news -c config.yaml --edition morning --refresh
```

先按[配置指南](config/README.md)接入模型；密钥由进程环境或 Pi 提供，程序不自动加载 `.env`。X 默认停用，启用前完成 [OpenCLI 浏览器连接](docs/operations.md#2-连接-opencli-支持的浏览器)。

将仓库和配置路径交给 Agent，让它读取 [news-monitor Skill](skills/news-monitor/SKILL.md)，完成精选、成稿和已授权的发布。每天 10:00 自动执行使用[宿主任务模板](docs/automation.md)，无需启动 `serve`。命令返回 `partial` 时退出码可能为 1，仍须保留并检查有效 JSON。

## 使用指南

| 需要做什么 | 阅读文档 |
| --- | --- |
| 安装、连接 OpenCLI 支持的浏览器、选择 profile、启停 serve、升级和排错 | [操作指南](docs/operations.md) |
| 设置 RSS/X/Blog、LLM、提示词、摘要与精选规则、归档和凭据 | [配置指南](config/README.md) |
| 每天早报、可选增量晚报、安装 Skill、复用任务提示词 | [定时任务指南](docs/automation.md) |
| 让 Agent 采集、判断、成稿并恢复中断任务 | [Agent Skill](skills/news-monitor/SKILL.md) |
| 查看命令参数、时间窗口、快照与 editorial.json 格式 | [CLI 与数据协议](skills/news-monitor/references/protocol.md) |
| 发布 Koalablog/学城、发送大象通知、查重与断点恢复 | [发布与恢复](skills/news-monitor/references/delivery.md) |
| 查看来源清单与接入记录 | [RSS](config/sources/rss.yaml) · [X](feeds/x-accounts.md) · [HN 博客](feeds/README.md) · [来源迁移](docs/source-migration.md) |

## 命令速览

| 命令 | 职责 |
| --- | --- |
| `collect` | 独立采集、归档与中文处理；`monitor` / `feed` 是别名 |
| `news` | 按窗口生成冻结快照；`--refresh` 在早晚报前统一采集 |
| `render` | 校验 Agent 决策并生成 HTML，可显式发布 Koalablog |
| `serve` | 可选的独立采集调度器，仅提供本机状态，不负责精选与发布 |
| `report` | 兼容的未精选归档预览 |

日常流程以以上指南和 Skill 为准，`docs/PRD*`、`docs/superpowers/` 保留历史设计。有限 Feed/X 快照不保证全量覆盖，来源失败与摘要失败会随快照保留。
