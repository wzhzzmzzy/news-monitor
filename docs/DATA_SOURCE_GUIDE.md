# 数据源与缓存指南 (Data Source & Cache Guide)

本文档说明了 NewsNow 项目的数据获取方式、缓存机制、底层数据库结构以及支持的数据源列表。

## 1. 通过 API 获取数据

在本地开发或私有化部署环境下，API 基础地址通常为：`http://localhost:13000`。

### 1.1 获取单个数据源
- **路径**: `/api/s`
- **方法**: `GET`
- **参数**:
  - `id` (必填): 数据源 ID（如 `weibo`, `zhihu`, `36kr`）。具体可用 ID 列表见下文。
  - `latest` (可选): 强制刷新。如果服务器允许登录且用户已登录，带上此参数将跳过 TTL 检查，直接从原站抓取最新数据。
- **示例**: `GET http://localhost:13000/api/s?id=weibo`
- **响应格式**:
  ```json
  {
    "status": "success", // 或 "cache"
    "id": "weibo",
    "updatedTime": 1700000000000,
    "items": [...]
  }
  ```

### 1.2 批量获取缓存状态
- **路径**: `/api/s/entire`
- **方法**: `POST`
- **请求体**: `{"sources": ["weibo", "zhihu", "36kr"]}`
- **说明**: 主要用于首屏快速加载，一次性返回多个源的缓存内容和更新时间。

## 2. 支持的数据源列表 (Data Sources)

以下是当前系统支持的所有数据源 ID 及其对应的名称。

| ID | 名称 (备注) |
| :--- | :--- |
| `weibo` | 微博热搜 |
| `zhihu` | 知乎热榜 |
| `bilibili-hot-search` | 哔哩哔哩热搜 |
| `bilibili-hot-video` | 哔哩哔哩热门视频 |
| `bilibili-ranking` | 哔哩哔哩排行榜 |
| `coolapk` | 酷安今日最热 |
| `v2ex-share` | V2EX 最新分享 |
| `ithome` | IT之家最新 |
| `36kr-quick` | 36氪快讯 |
| `36kr-renqi` | 36氪人气榜 |
| `wallstreetcn-quick` | 华尔街见闻快讯 |
| `wallstreetcn-news` | 华尔街见闻最新 |
| `wallstreetcn-hot` | 华尔街见闻最热 |
| `cls-telegraph` | 财联社电报 |
| `cls-depth` | 财联社深度 |
| `cls-hot` | 财联社热门 |
| `jin10` | 金十数据 |
| `xueqiu-hotstock` | 雪球热门股票 |
| `gelonghui` | 格隆汇事件 |
| `fastbull-express` | 法布财经快讯 |
| `fastbull-news` | 法布财经头条 |
| `mktnews-flash` | MKTNews 快讯 |
| `baidu` | 百度热搜 |
| `toutiao` | 今日头条热榜 |
| `tieba` | 百度贴吧热议 |
| `hupu` | 虎扑主干道热帖 |
| `thepaper` | 澎湃新闻热榜 |
| `ifeng` | 凤凰网热点资讯 |
| `zaobao` | 联合早报实时 |
| `sputniknewscn` | 卫星通讯社 |
| `cankaoxiaoxi` | 参考消息 |
| `kaopu` | 靠谱新闻 |
| `nowcoder` | 牛客热帖 |
| `juejin` | 稀土掘金热榜 |
| `sspai` | 少数派热榜 |
| `github-trending-today` | Github 今日趋势 |
| `producthunt` | Product Hunt |
| `hackernews` | Hacker News |
| `solidot` | Solidot |
| `pcbeta-windows11` | 远景论坛 Win11 |
| `chongbuluo-latest` | 虫部落最新 |
| `chongbuluo-hot` | 虫部落最热 |
| `douban` | 豆瓣热门电影 |
| `douyin` | 抖音热榜 |
| `kuaishou` | 快手热榜 |
| `steam` | Steam 在线人数 |
| `tencent-hot` | 腾讯新闻综合早报 |
| `qqvideo-tv-hotsearch` | 腾讯视频热搜榜 |
| `iqiyi-hot-ranklist` | 爱奇艺热播榜 |
| `freebuf` | Freebuf 网络安全 |

> **注**: 部分 ID (如 `v2ex`, `36kr`) 会自动重定向到其默认子项 (如 `v2ex-share`, `36kr-quick`)。

## 3. 缓存机制 (Cache Logic)

### 3.1 刷新间隔 (Interval)
在 `interval` 时间窗口内，系统始终返回数据库缓存，不请求原站。

- **Realtime (2 min)**: 微博、MKTNews 等。
- **Fast (5 min)**: 华尔街见闻、财联社、百度等。
- **Common/Slow (30-60 min)**: 36氪、联合早报、RSS 源等。

### 3.2 全局 TTL (Time To Live)
- **默认 TTL**: **30 分钟**。
- 超过 TTL 后，任何请求都会尝试触发原站抓取并更新数据库。

## 4. 数据库结构 (Database)

- **路径**: `.data/db.sqlite3`
- **表名**: `cache` (字段: `id`, `updated`, `data`)

## 5. 读取示例 (Node.js)

```javascript
const db = useDatabase();
const row = await db.prepare('SELECT data FROM cache WHERE id = ?').get('weibo');
const newsItems = JSON.parse(row.data);
```