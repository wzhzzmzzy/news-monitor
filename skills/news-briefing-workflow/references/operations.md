# 部署、运行与恢复

## 依赖与文件

需要 Node 22、已安装依赖并 `pnpm build` 的当前 news-monitor 仓库、Dagu 2.24.0、Aside CLI/运行中的已登录浏览器、Pi（含 DeepSeek provider）、Codex CLI 登录、fish 登录 shell，以及原有 Citadel/Delivery 依赖。默认不安装或升级宿主程序。

同目录资源：

- `dagu/morning.yaml`：日期固定 → 预检 → 采集 → Pi中文处理 → 快照冻结 → Codex精选 → Codex调用发布器 → 完成检查。
- `scripts/workflow.mjs`：阶段入口，调用引擎现有公开模块；`aside.mjs`、`pi.mjs` 为替换适配器。
- `scripts/publish.mjs`：固定交付入口；`prompts/` 包含采集、中文处理、精选、发布四类提示词。
- `config/example.json`：无密钥模板；`config/local.json` 是忽略提交的宿主路径与模型配置。

外部来源配置、Delivery、原始归档属于已有 news-monitor 数据资产，不复制凭据和整套历史到 Skill。运行结果存入配置的 outputRoot/YYYY-MM-DD/morning。Dagu 运行记录位于本目录 `.runtime`，也不提交。

## 首次配置

从本目录执行 `node scripts/setup.mjs`；填写 local.json 中的绝对 feedConfig/deliveryConfig/outputRoot、CLI路径、Aside profile（`aside host profiles`）、Pi provider/model。默认模型沿用 `gateway/deepseek-v4-flash`，凭据仍由 Pi 自己读取。预检 `scripts/run.sh preflight` 必须能连接宿主 Aside。CLI运行须具备宿主配置、浏览器和必要文件权限；受限环境的认证失败不代表浏览器已退出登录。

单独运行脚本时，`NEWS_WORKFLOW_CONFIG` 可指定另一份完整配置；Dagu调用必须用 `dagu start dagu/preview.yaml -- CONFIG_FILE=/absolute/config.json` 显式传入，避免调度器未继承临时shell变量而落到默认配置。`NEWS_NODE` 指定Node22可执行文件，`NEWS_LOGIN_SHELL` 默认fish。run.sh从fish登录shell继承既有KOALA_API_TOKEN；代理使用feed配置和进程HTTPS_PROXY。脚本不输出密钥，也不把Pi凭据转存。

## 调度与手动运行

`dagu validate dagu/morning.yaml` 检查编排；`dagu dry dagu/morning.yaml` 仅模拟。`dagu start dagu/morning.yaml` 执行整条链。`dagu start dagu/preview.yaml` 执行到本地渲染，不发布。两者都支持CONFIG_FILE参数，测试时使用隔离archiveDir和outputRoot。`scripts/scheduler.sh` 前台启动专用Dagu调度器，进程退出后不再定时运行；常驻部署由宿主服务管理器托管该命令。启动前完成新链实际验证和旧自动任务切换；同日不同正文冲突会保留线上内容并失败退出。

### 装入常驻 Dagu

本机常驻调度器是 Homebrew 服务 `sh.brew.dagu`（`dagu start-all`，DAG 目录 `~/.config/dagu`，UI `127.0.0.1:13488`）。`scripts/install.sh` 把 `dagu/morning.yaml` 渲染成 `$DAGU_HOME/dags/news-briefing-morning.yaml`：把 `working_dir: ..` 换成 Skill 目录绝对路径，并在 DAG 级 `env` 固定 `NEWS_NODE`（fnm 中最新 v22）与 `NEWS_LOGIN_SHELL`（`fish` 绝对路径）——launchd 启动的调度器 PATH 里没有 fish 和 fnm，只写 `run.sh` 会以 127 失败。`scripts/install.sh remove` 只删渲染出的文件，不改常驻服务。

常驻调度器监控 DAG 目录并热重载，无需重启服务；`dagu ls -n` 与 `GET /api/v1/dags` 都显示 `CRON_TZ=Asia/Shanghai 0 10 * * *` 即视为已装载。Skill 改动后要重新执行 `scripts/install.sh`，否则常驻副本仍是旧编排。装载只改变调度归属，不解除旧 Codex 自动任务冲突，切换旧任务仍需用户确认。

单阶段调试使用 `scripts/run.sh <phase> YYYY-MM-DD`。支持preflight/collect/localize/freeze/editorial/preview/publish/verify/status。历史重放只能使用已有合格快照：将原snapshotPath写入当期snapshot.json，再freeze；不得为历史日期调用collect。已有归档快照/完整当期目录优先复用，不能靠重新采集解决冻结后的失败。

## 恢复与约束

工作流对日期、窗口、配置及提示词计算哈希绑定，已存在的当期配置变化会停止。采集按来源持久化成功或失败，重跑不会扩大X预算；来源失败作为本期partial保留。采集进程中断而尚未保存该来源回执时，可能需要重读该来源；其余来源复用。`.workflow/.briefing.lock`用于保护阶段；失效锁先检查host/PID确实退出，再按引擎unlock规则处理。禁止删除活跃锁。

中文处理使用Pi无工具、无扩展、无MCP、无会话的一次性调用；校验及缓存仍由引擎负责。它支持summary和full两种模式，当前使用summary。新Pi缓存以不同提示词指纹隔离。摘要全部ready/failed后才能冻结，失败保留原文与原因，不填造摘要。

Codex精选以JSON Schema限制输出，引擎再次验证快照ID、新闻ID、事件归组、博客排除、标题与数量上限。editorial一旦存在就复用，发布绑定其哈希。第二次Codex调用只允许执行固定发布器，不改脚本和回执；外部审批拒绝时保持失败并报告原因。

发布采用原引擎可恢复协调器：GET有限重试，POST不盲重发，学城创建未知先目录回读；相同日期不同正文冲突停止。Koala完整匿名数据/latest/日期与默认入口均核验；学城HTML与本地逐字一致。全文超过2MiB时停止学城发布，按原Citadel附件恢复规则人工处理，不能伪造完成状态。

通知默认关闭以保留已存在的人工审批限制。获准开启后，发布器每次身份查询/发送前核对真实上海日期；跨日时停止，保留本期旧Delivery绑定及回执，需明确缩减当期交付范围后恢复，不直接篡改账本。两平台验证前不发送；共享日期账本防重复。未知发送结果保持unknown，使用原 `briefing reconcile-notification` 和查证证据恢复。

权威完成条件为当期state.complete；Dagu退出码和Agent文字只是辅助。数据来源/摘要partial与发布失败分别报告。测试未执行真实外部发布时必须明确说明。
