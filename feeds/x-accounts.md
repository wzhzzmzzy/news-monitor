# X 账号与领域

当前本机启用 24 个账号：12 个 AI/互联网/工程账号与 12 个其他领域账号。公开示例默认全部停用；个人配置需通过 OpenCLI 小样本核验后启用。来源使用 x-user 读取公开时间线，不改变社交关注或 X List 成员。

| 领域 | 启用账号 |
| --- | --- |
| 经济与产业 | [@IMFNews](https://x.com/IMFNews)、[@OECD](https://x.com/OECD) |
| 公共事务与健康 | [@UN](https://x.com/UN)、[@WHO](https://x.com/WHO) |
| 科学与环境 | [@IEA](https://x.com/IEA)、[@NASA](https://x.com/NASA)、[@esa](https://x.com/esa)、[@Nature](https://x.com/Nature)、[@ScienceMagazine](https://x.com/ScienceMagazine) |
| 国际新闻与文化 | [@Reuters](https://x.com/Reuters)、[@BBCWorld](https://x.com/BBCWorld)、[@SmithsonianMag](https://x.com/SmithsonianMag) |
| AI、互联网与工程 | [@simonw](https://x.com/simonw)、[@OpenAI](https://x.com/OpenAI)、[@AnthropicAI](https://x.com/AnthropicAI)、[@GoogleDeepMind](https://x.com/GoogleDeepMind)、[@huggingface](https://x.com/huggingface)、[@github](https://x.com/github)、[@Cloudflare](https://x.com/Cloudflare)、[@MistralAI](https://x.com/MistralAI)、[@MIT_CSAIL](https://x.com/MIT_CSAIL)、[@allen_ai](https://x.com/allen_ai)、[@karpathy](https://x.com/karpathy)、[@mitchellh](https://x.com/mitchellh) |

同类重复覆盖暂停：Microsoft、NVIDIA AI、Vercel、Qwen、DeepSeek、Stanford HAI、Cloud Native Computing Foundation、Sam Altman、Demis Hassabis、Andrew Ng、Fei-Fei Li、Yann LeCun、François Chollet。条目保留在配置中，可按需恢复。世界银行 @WorldBank 官网链接已确认，但 2026-10-09 两次小样本均返回无法解析账号，暂时停用。

## 采集与编辑

- 来源配置：`config/sources/x.yaml`；本机覆盖：`config/local/x.yaml`，由主配置 sourceFiles 引用。两个文件互不自动同步。opencli.enabled 为总开关，source.enabled 为单账号开关。
- 随早晚报统一采集，OpenCLI 串行读取；当前各账号 limit=5，普通 collect 与报告刷新均不扩量。快照不能回溯到窗口起点时记录 partial，最近 5 条不代表全天完整覆盖。无需增加定时任务或启动 serve。
- 新闻按发布时间窗口筛选，窗口外内容只保留归档。中文标题与摘要处理到 ready/failed 后成稿，博客仍独立展示。
- 精选按照 config/editorial.yaml 的质量标准与 editorialPolicy 判断实质领域；跨 RSS/X 的同一媒体或机构合并计算集中度，同一具体事件只选一次。官方公告注明自述，人物意见注明归属。

## 核验与接入

2026-10-09 对 13 个新账号逐个执行一次最近 3 条小样本；12 个通过作者、发布时间与状态链接校验。WorldBank 的有限重试仍失败，保持停用。本次测试未运行整轮日报、摘要模型或通知，仅证明采样时可读，不保证长期登录、限流与接口稳定。浏览器接入与 sample 命令见 [操作指南](../docs/operations.md)。

身份入口包括账号主页、[IMF 社交账号页](https://www.imf.org/en/social-hub)、[OECD 联系页](https://www.oecd.org/en/about/contact.html)、[NASA 社交账号页](https://www.nasa.gov/social-media/)、[ESA 官网](https://www.esa.int/)、[Nature 官网](https://www.nature.com/nature/)和[Smithsonian 账号档案](https://www.si.edu/object/archives/components/sova-sia-fa19-035-refidd1e778)。原技术账号的 2026-09-22 profile 与动态核验记录继续保留在项目实验目录。
