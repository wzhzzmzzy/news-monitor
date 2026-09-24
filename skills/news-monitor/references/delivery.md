# 发布、通知与断点恢复

在用户要求发布、通知或恢复失败日报时读取。本文件与 [protocol.md](protocol.md) 一起使用：协议负责快照和编辑格式，本文件负责所选平台的外部操作。仓库、配置、产物根目录、平台地址、凭据环境变量名和接收人从用户或宿主任务取得。只执行明确授权的目标；已存在的每日授权持续有效，不因重试重新询问。Skill 不提供凭据或默认收件人。

## 1. 先检查回执，再采集

1. 根据 Asia/Shanghai 的报告日期与版次定位产物目录。首次建立目录；重跑先读快照、决策、发布和每个通知目标的回执。已有可用且全部摘要终态的冻结快照时直接复用，不启动重复采集。旧快照不符合窗口/摘要规则时原样保留，并依协议重新导出，不手改状态。
2. 保存 `snapshotPath`、`snapshotId`、固定 `window`、`observedThrough`、新闻/博客条数、筛选统计、摘要 ready/failed 数与来源覆盖缺口。晚报基线从当天早报回执取得。
3. 成稿前确认 `items` 和 `blogs` 均满足发布时间 `[start,end)`，`languageStatus` 全部为 ready 或 failed，且 `blogPublicationFilter.included` 与博客数量一致。仍有任务运行时继续等待；锁冲突等待已有进程完成，不删除活跃锁。有限重试耗尽的明确失败可保留原文进入报告。
4. 保存绑定该 snapshotId 的 `editorial.json`。渲染器核验 reading-pack 哈希、引用、分组和摘要状态；编辑 Agent 核验文字有事实证据。保留一个本期决定版本，恢复时不重新选稿导致正文漂移。

完成条件：冻结快照与决策可追溯、全部摘要已结束、没有窗口外博客，且原文与引用保留。

## 2. 本地 HTML 与 Koalablog

只生成本地文件时执行离线 `render` 即完成所选目标；后续平台按授权选择。所有命令中的 `node` 替换为宿主已验证的 Node 22 路径。

```bash
node dist/index.js render --snapshot <SNAPSHOT> --decisions <EDITORIAL> --output <HTML>
# 仅当授权发布时；实际令牌已在进程环境中
node dist/index.js render --snapshot <SNAPSHOT> --decisions <EDITORIAL> --output <HTML> \
  --publish-koalablog --koalablog-url <HTTPS_ORIGIN> --koalablog-token-env <TOKEN_ENV_NAME>
```

命令在仓库工作目录运行。若宿主凭据仅由登录 shell 导出，使用该 shell 的登录模式执行，并保留 Node 22 绝对路径；不要打印环境或复制令牌到文件。只为需要的进程设置代理。保存 stdout JSON 与 HTML 旁的 `.koalablog.json` 回执。

按协议核验报告数据与本地 `.report.md` 一致、latest 指向正确目标、`artifactStatus: deployed`、`deploymentRequired: false`，并匿名访问当期 `reportUrl`。补发旧报告允许 latest 保持更新的一期；以回执中的实际 current 为准。已部署入口日常只写数据，不加 `--koalablog-update-shell`。首次部署或明确授权的模板更新才走 Dashboard Deploy。

同日路径不同内容或 revision 冲突时保留远端内容，报告冲突；写入超时先回读确认，不直接重发。渲染成功、Source 上传成功都不等于发布核验完成。

## 3. 学城子文档（可选，依赖 citadel Skill）

1. 先读取环境提供的 citadel Skill，并核对 CLI 可用与登录状态。父目录必须来自本次任务，创建前检查本地回执以及 `getChildContent --contentId <PARENT_ID>`；按日期/版次/标题核对可能已存在的文档。
2. 根节点为 `km-doc`，首个且唯一标题为 `km-title`，HTML 写入 `km-html` 的 CDATA。将 HTML 中 `]]>` 分段转义为 `]]]]><![CDATA[>`，通过文件传输。执行 `oa-skills citadel createDocument --title <标题> --file <XML> --parentId <PARENT_ID>`，立即保存真实 contentId 与 URL。
3. 已存在同次报告时，先 `getDocumentXml --contentId <ID> --output <READBACK_XML>`。正文一致则复用；若需恢复同次未完成写入，保留现有 nodeId 与用户额外内容，使用实时 stepVersion 调用 `updateDocumentByXml --contentId <ID> --file <XML> --step-version <VERSION>`。用户另有修改时报告冲突，不自动替换。
4. 完整 HTML 可直接嵌入时保持同一份内容。若达数 MB 或服务返回 HTTP 413，先核对是否已创建，避免失败重试生成空白/重复文档；改用轻量正文加完整 ZIP 附件。轻量 HTML 保留全部新闻/博客、所有已有摘要、原文链接、精选、事件组和综述，支持分页及搜索；失败摘要显示明确失败和原文入口，不截断列表。标注正文为轻量版、附件含完整 HTML。
5. ZIP 解压内容与本地完整 HTML 逐字节一致后，调用 `uploadAttachmentToDocument --contentId <ID> --file <ZIP>`。上传不等于插入正文：按 citadel 的附件说明使用返回的真实附件节点，经 getDocumentXml → 保留 nodeId 编辑 → stepVersion 保护写入；不得编造附件地址。
6. 回读 `getDocumentMetaInfo` 确认父目录，再回读 `getDocumentXml`，用 XML 解析器提取 km-html 内容，与实际嵌入的完整/轻量 HTML 逐字比对。轻量模式还要核验真实附件节点存在，保存 XML、版本、正文哈希、附件信息和核验结果。

权限遵循用户任务范围，不额外扩大。登录失效时保留本地产物与其他平台结果，说明需恢复授权；某平台失败不回滚已成功平台。

完成条件：正确父目录、正文回读一致；轻量模式同时满足无截断与完整附件验证。只有完成后才能发送依赖学城链接的通知。

## 4. 大象通知（可选，依赖 CatDesk）

CatDesk 与大象登录须可用。确认授权的目标身份：群使用 `catdesk daxiang search --keyword <GROUP_NAME> --type group`，个人使用 `--keyword <MIS> --type user`。优先真实群 ID；个人按唯一精确 MIS 核验 UID，不按同名人员猜测。群 ID 为 unknown 时，仅在结果唯一且名称精确匹配，并确认该部署支持按群名发送的情况下使用 `--group`；歧义停止该目标，其余目标独立处理。

日期按报告所属的北京时间日期格式化，不按重试时间。取学城实际回执 URL，群与个人内容完全相同。默认的本流程消息格式为：

```bash
catdesk daxiang send --group-id <GROUP_ID> \
  --message '今天的草台新闻推送来了： <当期学城URL>' --link-title 'YYYY 年 M 月 D 日'
catdesk daxiang send --user-id <VERIFIED_UID> \
  --message '今天的草台新闻推送来了： <当期学城URL>' --link-title 'YYYY 年 M 月 D 日'
```

按用户范围只发日期链接，不 @成员，不额外发文件。Koalablog 失败时，已核验的学城日报仍可通知；平台与目标分别记状态。

### 每个目标独立记录与去重

单群可用 `daxiang-push.json`，个人使用 `daxiang-push-<target>.json`；多个群时各用独立文件。不要因群已发送而跳过尚未发送的个人。回执至少记录：报告日期/版次、群身份或个人 UID、contentId、URL、消息正文、linkTitle、状态、准备时间、发送时间、结构化 CLI 回执。

| 已有状态 | 下一步 |
| --- | --- |
| 无记录 | 将目标、报告、链接、正文写入 sending，原子保存成功后仅调用一次发送 |
| sent | 同目标同日已发送则跳过；重生成报告或换 contentId 也不自动重发，除非用户明确要求补发/另一期通知 |
| sending / unknown / 超时 | 核对该目标聊天记录；确认已发送则补记 sent，无法确认保持 unknown 并报告，不盲目重发 |
| 明确未发送的失败 | 修复连接或登录，发送前重新检查回执，确认无并发运行后再恢复 |

写回执使用同目录临时文件加原子替换，宿主任务之间也应避免并发；CLI 的归档锁不覆盖外部发送。发送命令的结构化回执确认 success 后更新为 sent 并保留时间和原始回执，不能只根据进程退出或“命令已执行”判定。查聊天记录需要相应工具可用；无法查证时保持 unknown，不推测成功或失败。

## 5. 收尾

汇总回执记录快照路径、窗口、数量、本地 HTML、各平台真实链接与核验结果、各接收人状态。`dataStatus: partial` 与发布是否成功分开记录：来源不完整仍可发布，但报告必须保留缺口。全部所选发布目标通过核验、全部所选通知目标明确 sent（或去重确认先前已发送），才能说流程完成。其余情况逐项报告阻碍和可恢复步骤。

代码提交、服务常驻、邮箱投递、项目登记属于各部署的独立约定，不由发布流程自动触发。
