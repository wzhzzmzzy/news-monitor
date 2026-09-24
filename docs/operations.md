# 安装、OpenCLI 与 serve 运维

本文面向首次部署或迁移机器；日常 Agent 调用见 [Skill](../skills/news-monitor/SKILL.md)，每天生成与发布报告见[定时任务](automation.md)。命令均从 news-monitor 仓库根目录执行。

## 1. 准备运行环境

使用 Node.js 22 和 pnpm 10.12.4，按 [README 快速开始](../README.md#快速开始)安装依赖并构建。调度进程也必须使用同一套 Node 环境：交互终端能运行，不代表定时进程的 PATH、工作目录和环境变量正确。可在任务中指定 Node 22 的绝对路径；路径含空格时加引号。

```bash
node --version
pnpm install --frozen-lockfile
pnpm build
pnpm exec opencli --version
```

本仓库锁定 OpenCLI 1.8.7。使用 `pnpm exec opencli` 可避免误用全局的其他版本；news-monitor 内部使用自己的依赖和当前 Node 可执行文件。升级依赖后重新核验适配器参数与浏览器连接。

复制 `config.example.yaml` 为个人配置，按[配置说明](../config/README.md)选择来源、LLM 与摘要提示词。归档建议放到源码仓库之外，例如在根配置设置 `archiveDir: ../news-monitor-data/feed-v1`。凭据由宿主进程环境或仓库外 Pi 配置提供；仅把环境变量名写入配置。程序不自动加载 `.env`。不要把密钥、Cookie 或带凭据的 URL 写进仓库、任务提示词和回执。

## 2. 连接 OpenCLI 支持的浏览器

news-monitor 不绑定浏览器品牌，使用 OpenCLI 能操作的已登录浏览器会话。这里介绍 Browser Bridge 路径；具体浏览器与扩展兼容性以所用 OpenCLI 版本为准，不表示所有浏览器都支持。上游安装入口见 [OpenCLI 官方说明](https://github.com/jackwener/opencli#quick-start)。

1. 在目标浏览器的目标 profile 安装并启用官方 [Browser Bridge 扩展](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)。不能通过商店安装时，从[官方 Releases](https://github.com/jackwener/opencli/releases)获取兼容扩展包，按该浏览器的扩展管理方式加载。
2. 保持该浏览器运行，在同一 profile 手动登录 X，并确认能查看要订阅的用户或 List。不要导出 Cookie。
3. 在仓库中执行连接检查；OpenCLI 的本地 daemon 按需启动。下面的检查会连接浏览器，单纯编辑文档或配置时无需运行。

```bash
pnpm exec opencli doctor
pnpm exec opencli profile list
# 可选：给查询得到的真实 contextId 设置易记别名
pnpm exec opencli profile rename <实际contextId> news-feed
```

将真实 contextId 或已设置的别名写入个人配置：

```yaml
opencli:
  enabled: true
  profile: news-feed
  timeoutMs: 120000
```

显式 profile 可避免多个浏览器/profile 并存时选择错误。news-monitor 将它传给 OpenCLI 的 `OPENCLI_PROFILE`；不需要改变其他任务的默认 profile。环境重装或 profile 重建后，重新查询并更新。

先读帮助，再进行一次小样本验证；后两条会访问 X，仅运行需要的那一条，替换尖括号占位符：

```bash
pnpm exec opencli twitter tweets --help
pnpm exec opencli twitter list-tweets --help
pnpm exec opencli --profile news-feed twitter tweets <用户名> --limit 3 -f json
pnpm exec opencli --profile news-feed twitter list-tweets <数字ListID> --limit 3 -f json
```

验证输出为目标账号/List 的 JSON，核对来源、时间和链接后，再启用个人 `sourceFiles` 中的 `x-user` / `x-list`。示例与字段见 [X 来源](../config/sources/x.yaml)。X 需要总开关 `opencli.enabled` 和对应来源 `enabled` 均开启；公开示例中的 X 来源默认关闭。新闻采集由 CLI 调用已存在的适配器，日常使用无需另写浏览器自动化或安装 OpenCLI 的适配器开发 Skill。

## 3. 采集失败与停止

| 现象 | 检查与处理 |
| --- | --- |
| 扩展未连接 / 找不到 profile | 浏览器是否运行、目标 profile 是否启用扩展；运行 doctor 与 profile list，核对 contextId |
| `x_auth` | 在同一 profile 恢复 X 登录与必要授权后，先验证一次小样本 |
| `x_rate_limited` | 保留部分结果，等待上游恢复；减少启用账号或降低执行频率，避免循环刷新。降低 source.limit 不限制报告模式，报告仍按窗口扩量 |
| `x_timeout` | 核对浏览器连接与网络，再评估 `opencli.timeoutMs`；加大超时不能解决限流 |
| `rss_timeout` / `rss_http` / `rss_parse` | 检查 Feed/实例及 `collection` 参数，与浏览器登录问题分开处理 |
| 归档锁冲突 | 等待在途采集和摘要处理完成，复用结果；保留活跃锁，不启动并行补采 |

来源失败详情查看 `source-pack.json` / `reading-pack.json` 的 `results[].failure`；保留脱敏错误类别、HTTP 状态和退出码，不把失败解释成零新闻。

要停止后续 X 浏览器操作，在实际使用的主配置中设置 `opencli.enabled: false`；一次性 CLI 下次运行生效，已有 `serve` 需重启。配置修改不会中断已经运行的子进程。要立即停止，先暂停发起该工作的宿主任务，再对已确认属于本次工作的 CLI/serve 进程发送 Ctrl-C 或 SIGTERM，并确认其子进程结束。检查 PID、命令行和父子关系，避免宽泛地杀掉所有 Node 或浏览器进程。原文与成功摘要缓存保留；下次恢复时重新导出尚未冻结的快照。

## 4. 可选 serve：仅独立采集

按需提高采集频率时可由 Agent 启动 `serve`。配置示例：

```yaml
schedule:
  collect: '*/30 * * * *'
  timezone: Asia/Shanghai
serverPort: 12440
```

```bash
node dist/index.js serve -c config.yaml
# 另一个终端检查本机状态
curl --fail http://127.0.0.1:12440/
```

30 分钟是示例，可自行调整。启动时只注册定时器，不立即采集；首次 `tasks.monitor` 为 idle 是正常状态。后续会记录 queued/running/success/partial/failed。该端口仅提供本机状态，不是报告触发 API 或 MCP 服务。

前台用 Ctrl-C 停止；后台由所用进程管理器记录 PID、日志并发送 SIGTERM。不要重复启动同配置实例；修改配置后重启。独立采集串行执行，中文处理仍受独立 collect 的博客批量预算影响。

当前推荐的日常方案为宿主每天 10:00 唤起 Agent 执行 `news --refresh`，采集与报告一起完成，保持 `serve` 停止。`schedule.collect` 不会生成精选、发布报告或发送通知；旧 `schedule.report/analyze/sendEmail` 不再使用。

## 5. 升级与验证

停止已有 serve，保留个人配置与仓库外归档；更新源码后执行 `pnpm install --frozen-lockfile`、`pnpm build`。重新核对外部配置引用，移除旧报告调度字段；日常用宿主 Agent 的 `news --refresh` 流程。新机制不会补回已从上游 Feed 滚出的旧内容。

```bash
pnpm test --run
pnpm build
```

测试使用临时目录、本地数据和模拟模型/邮件，不访问私人账号。实际采集验证会访问来源和调用配置的模型，按需运行；不要为检查文档启动采集。

RSS 可能只提供摘要，HN 为社区链接元数据；当前不会自动补抓付费全文、图片 OCR 或外链正文，X 也不保证完整 thread/Article。保留 contentKind 和来源时间，有限快照不能视为全量覆盖。

邮件使用 `render --email` 生成文件，投递由宿主按授权安排。兼容 `report --send` 会发送未精选阅读列表，需要显式配置 email 和 passwordEnv；`test-email` 会真实发送测试邮件。邮件投递无同日幂等保证，SMTP 凭据不进入报告或快照。

阅读页模板 `templates/news-feed.svelte` 的固定简介为“每日自动更新的 RSS、X、HN 新闻汇总”。Koalablog 从已部署页面首个段落提取 description / og:description；修改简介需按[发布协议](../skills/news-monitor/references/protocol.md#发布为-koalablog-public-memo)更新 Source 并在 Dashboard Deploy，普通日报更新只写报告数据。
