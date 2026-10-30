---
name: news-briefing-workflow
description: 使用 Dagu 调度综合早报，Aside 采集 X、Pi DeepSeek 处理中文、Codex CLI 精选并调用固定脚本发布；用于部署、运行、恢复或修改这条工作流。
---

# 综合早报工作流

本目录包含 Dagu 编排、宿主配置模板、采集/模型/发布脚本和 Agent 提示词。依赖同仓库构建后的 news-monitor 引擎；来源配置和历史归档继续由该引擎管理。

先定位本 Skill 所在仓库，读取 [运行与恢复](references/operations.md)。所有命令从本目录执行。新部署先执行 `node scripts/setup.mjs`，填写 `config/local.json` 并运行 `scripts/run.sh preflight`。不要输出凭据。

- 完整手动执行：`dagu start dagu/morning.yaml`。日期在第一步按 Asia/Shanghai 固定，发布时间窗口始终为前日10:00至当日10:00。
- 只生成本地预览：`dagu start dagu/preview.yaml`，同样执行真实采集、Pi 和 Codex，不执行发布。可在命令末尾用 `-- CONFIG_FILE=/absolute/config.json` 选择隔离配置。
- 常驻定时执行：`scripts/install.sh` 把编排装入宿主常驻 Dagu（`~/.config/dagu/dags`，每天北京时间10:00，热重载生效），`scripts/install.sh remove` 卸下；隔离前台调度器仍用 `scripts/scheduler.sh`。启动前检查旧 Codex news-monitor 自动任务，完成明确切换后暂停旧任务，防止两个调度器同时生成不同正文；不要仅因安装 Skill 就切换。
- 中断恢复：查看当期目录的 `state.json`、`STATUS.md` 和 Dagu 运行状态；复用当期配置、采集结果、快照与 editorial。未知发布结果先回读，未知通知结果先查证，不自动重发。

Pi 仅做即时翻译/摘要，关闭工具和会话；Codex 输出绑定快照的编辑 JSON，再由第二次 Codex CLI 调用固定 `scripts/publish.mjs`。发布前读宿主 Citadel Skill，学城只走接口/XML、保留父目录权限。发布器管理本地HTML、Koala data/latest及匿名回读、学城HTML逐字回读和通知账本。`state.complete=true` 才能报告完成，数据 partial 单独说明。

已有内部聊天发送审批限制仍适用，本机 `notificationsEnabled=false`；恢复通知需要用户明确解除既有审批阻碍。历史/跨日任务禁止发送通知。所有外发目标来自原 Delivery 配置；不要添加收件人或临时覆盖同日远端不同正文。
