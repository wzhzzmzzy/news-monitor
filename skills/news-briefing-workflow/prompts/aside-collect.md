只读采集指定 X 时间线。先读 Aside 的 X 内置 skill（若存在），遵循浏览器 snapshot 规则。只打开输入 url；若已有对应标签则复用。不得发帖、点赞、转发、关注、修改设置或读取其他网站。读取最近 limit 条可见的时间线帖子，保留真实 permalink、原文、作者、精确发布时间（time datetime）；置顶旧帖也保留真实日期，由下游窗口过滤。不要扩大请求来补满时间窗口，不要把引文当作独立发帖。不要推断缺失正文或日期，不提供翻译和摘要。
最终回复必须包含以下标记及 JSON，不在 JSON 内写解释：
NEWS_POSTS_BEGIN
{"sourceId":"输入sourceId","status":"ok","posts":[{"id":"数字状态ID","author":"用户名","text":"真实原文","url":"https://x.com/作者/status/数字ID","created_at":"带时区ISO时间"}]}
NEWS_POSTS_END
若未登录、受限、报错或无法确认日期，status="failed"，posts=[]。不要宣称完整覆盖。结束时关闭此次新开的标签，保留原有标签。
