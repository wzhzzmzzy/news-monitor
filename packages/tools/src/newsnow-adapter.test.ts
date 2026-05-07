import { describe, expect, it, vi } from "vitest";
import type { NewsSourceConfig } from "../../config/src/index.js";
import { NewsNowAdapter } from "./newsnow-adapter.js";

describe("NewsNowAdapter", () => {
  it("抓取并标准化 NewsNow items", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: "success",
      id: "weibo",
      updatedTime: 1778136000000,
      items: [
        {
          id: "item-1",
          title: "重大新闻",
          url: "https://example.com/news",
          pubDate: 1778135900000,
          extra: { mobileUrl: "https://m.example.com/news" }
        },
        {
          id: 2,
          title: "补充新闻",
          url: "https://example.com/extra",
          extra: { date: "2026-05-06T23:30:00.000Z" }
        },
        {
          id: "item-3",
          title: "字符串时间新闻",
          url: "https://example.com/string-date",
          pubDate: "2026-05-06T22:00:00.000Z",
          extra: {}
        }
      ]
    })));

    const source: NewsSourceConfig = {
      id: "weibo",
      name: "微博热搜",
      type: "newsnow",
      sourceId: "weibo",
      weight: 1
    };

    const adapter = new NewsNowAdapter({
      newsApiBaseUrl: "https://news.example.test",
      fetch: fetchMock,
      now: () => new Date("2026-05-07T00:00:00.000Z")
    });

    const result = await adapter.fetchSource(source);

    expect(fetchMock).toHaveBeenCalledWith("https://news.example.test/api/s?id=weibo");
    expect(result.items).toEqual([
      {
        id: "weibo:item-1",
        source: {
          id: "weibo",
          name: "微博热搜",
          url: undefined,
          type: "newsnow",
          weight: 1
        },
        title: "重大新闻",
        url: "https://example.com/news",
        content: "",
        publishedAt: "2026-05-07T06:38:20.000Z",
        fetchedAt: "2026-05-07T00:00:00.000Z",
        metadata: {
          rank: 1,
          newsnow: {
            id: "item-1",
            updatedTime: 1778136000000,
            extra: { mobileUrl: "https://m.example.com/news" }
          }
        }
      },
      {
        id: "weibo:2",
        source: {
          id: "weibo",
          name: "微博热搜",
          url: undefined,
          type: "newsnow",
          weight: 1
        },
        title: "补充新闻",
        url: "https://example.com/extra",
        content: "",
        publishedAt: "2026-05-06T23:30:00.000Z",
        fetchedAt: "2026-05-07T00:00:00.000Z",
        metadata: {
          rank: 2,
          newsnow: {
            id: "2",
            updatedTime: 1778136000000,
            extra: { date: "2026-05-06T23:30:00.000Z" }
          }
        }
      },
      {
        id: "weibo:item-3",
        source: {
          id: "weibo",
          name: "微博热搜",
          url: undefined,
          type: "newsnow",
          weight: 1
        },
        title: "字符串时间新闻",
        url: "https://example.com/string-date",
        content: "",
        publishedAt: "2026-05-06T22:00:00.000Z",
        fetchedAt: "2026-05-07T00:00:00.000Z",
        metadata: {
          rank: 3,
          newsnow: {
            id: "item-3",
            updatedTime: 1778136000000,
            extra: {}
          }
        }
      }
    ]);
  });

  it("服务失败时返回信源级错误", async () => {
    const adapter = new NewsNowAdapter({
      newsApiBaseUrl: "https://news.example.test",
      fetch: async () => new Response("网关错误", { status: 502 }),
      now: () => new Date("2026-05-07T00:00:00.000Z")
    });

    const result = await adapter.fetchSource({
      id: "weibo",
      name: "微博热搜",
      type: "newsnow",
      sourceId: "weibo",
      weight: 1
    });

    expect(result.items).toEqual([]);
    expect(result.error).toContain("NewsNow 请求失败：weibo: 502");
  });
});
