# X 账号来源

从原来的 Simon Willison 单账号扩展为 25 个账号（12 个厂商、4 个组织、9 位人物）。以模型/产品发布、研究与工程一手材料为主。此清单配置在 `sources` 中，使用 `x-user` 读取公开时间线；不是对用户 X 社交关注或平台 List 成员的修改。

本机 `config.feed.local.yaml` 启用全部 25 个；三份公开示例提供同一清单，默认停用，安装 OpenCLI 扩展、登录 X 并指定浏览器 profile 后开启。账号少发帖不等于抓取失败，窗口内没有更新时不进入当日报告。

| 类型 | 来源 | X 账号 | 关注内容 |
| --- | --- | --- | --- |
| 厂商 | OpenAI | [@OpenAI](https://x.com/OpenAI) | 模型、API 与产品发布 |
| 厂商 | Anthropic | [@AnthropicAI](https://x.com/AnthropicAI) | Claude、开发工具与安全研究 |
| 厂商 | Google DeepMind | [@GoogleDeepMind](https://x.com/GoogleDeepMind) | Gemini、科学研究与模型进展 |
| 厂商 | Microsoft | [@Microsoft](https://x.com/Microsoft) | 开发平台、云与企业产品 |
| 厂商 | NVIDIA AI | [@NVIDIAAI](https://x.com/NVIDIAAI) | GPU 计算、AI 框架与开发者生态 |
| 厂商 | Hugging Face | [@huggingface](https://x.com/huggingface) | 开放模型、数据集与工具 |
| 厂商 | GitHub | [@github](https://x.com/github) | 代码托管、Copilot 与开发流程 |
| 厂商 | Cloudflare | [@Cloudflare](https://x.com/Cloudflare) | 网络、安全与边缘计算 |
| 厂商 | Vercel | [@vercel](https://x.com/vercel) | Web 部署、前端框架与 AI SDK |
| 厂商 | Qwen | [@Alibaba_Qwen](https://x.com/Alibaba_Qwen) | 通义模型与开放模型生态 |
| 厂商 | DeepSeek | [@deepseek_ai](https://x.com/deepseek_ai) | DeepSeek 模型与 API |
| 厂商 | Mistral AI | [@MistralAI](https://x.com/MistralAI) | 模型、代码智能与部署 |
| 组织 | MIT CSAIL | [@MIT_CSAIL](https://x.com/MIT_CSAIL) | 计算机科学、机器人与 AI 研究 |
| 组织 | Stanford HAI | [@StanfordHAI](https://x.com/StanfordHAI) | AI 研究、政策与社会影响 |
| 组织 | Allen Institute for AI | [@allen_ai](https://x.com/allen_ai) | 开放模型、科学工具与研究 |
| 组织 | Cloud Native Computing Foundation | [@CloudNativeFdn](https://x.com/CloudNativeFdn) | 云原生项目、技术报告与社区 |
| 人物 | Sam Altman | [@sama](https://x.com/sama) | AI 产品与行业观点 |
| 人物 | Andrej Karpathy | [@karpathy](https://x.com/karpathy) | 模型机制、工程实践与 AI 教育 |
| 人物 | Demis Hassabis | [@demishassabis](https://x.com/demishassabis) | AI 与科学研究进展 |
| 人物 | Andrew Ng | [@AndrewYNg](https://x.com/AndrewYNg) | AI 应用、教育与工程实践 |
| 人物 | Fei-Fei Li | [@drfeifei](https://x.com/drfeifei) | 视觉、空间智能与人本 AI |
| 人物 | Yann LeCun | [@ylecun](https://x.com/ylecun) | 机器学习研究与技术讨论 |
| 人物 | François Chollet | [@fchollet](https://x.com/fchollet) | 推理、评测与机器学习 |
| 人物 | Mitchell Hashimoto | [@mitchellh](https://x.com/mitchellh) | 开发工具、系统软件与工程实践 |
| 人物 | Simon Willison | [@simonw](https://x.com/simonw) | LLM 工具、数据工程与实用实验 |

## 采集与编辑

- 随早晚报 `news --refresh` 统一采集，X 使用已有 OpenCLI 浏览器适配器串行读取。无需新增定时任务或启动 serve。
- 早报仅纳入截止前 24 小时发布的动态；晚报仍按早报截止到 20:00 的增量窗口。窗口外原文保留归档。
- 新账号独立 collect 的 limit 为 20；原 Simon 配置保留。报告刷新仍从每源至少 100 条开始，按既有规则回溯，受 `collection.xMaxItems` 限制。未确认覆盖窗口起点时仍标 partial，不声称完整覆盖。
- 中文标题与摘要沿用新闻处理，不生成全文译文；这些 X 条目是新闻候选，可参与 Agent 精选和时间线。博客仍为独立频道。
- 模型厂商公告是来源方陈述，人物动态是个人观点；编辑时标明归属，同一公告在公司与个人时间线重复出现时应合并处理。
- 增加来源会延长串行采集时间并增加窗口内中文处理量；验证的小样本耗时不是整轮日报耗时保证。

## 身份与可用性核验

2026-09-22 使用现有已登录 Brave 会话逐个读取公开 profile（核对 screen_name、显示名称、简介）和最近 3 条动态，并通过 news-monitor collectSource 校验 ID、链接及发布时间。该记录只证明当时可读取，不保证未来登录、限流及网页接口稳定。

身份入口除表中账号主页外，亦参考 [OpenAI 官方账号说明](https://help.openai.com/en/articles/11725090-verifying-communications-from-openai)、[Karpathy 个人主页](https://karpathy.ai/)、[Ai2 官网的 X 链接](https://allenai.org/)、[Stanford HAI 账号简介](https://x.com/StanfordHAI/with_replies)。[Qwen 官方社交链接](https://qwenlm.github.io/about/) 指向 @Alibaba_Qwen，Ai2 官网指向 @allen_ai，[DeepSeek 官网](https://www.deepseek.com/) 指向 @deepseek_ai，[CNCF 官网](https://www.cncf.io/) 指向 @cloudnativefdn。使用这些官方入口确认账号，避免相似拼写账号。

公开来源配置在 `config/sources/x.yaml`；本机覆盖可放 `config/local/x.yaml` 并通过主配置的 `sourceFiles` 引用。`opencli.enabled: false` 全局停用 X 采集，逐项 `enabled` 控制单个账号。
