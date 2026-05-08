import { z } from "zod";
import type { NewsSourceConfig } from "../../config/src/index.js";

const NewsNowItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((value) => String(value)),
  title: z.string(),
  url: z.string().url().optional(),
  pubDate: z.union([z.number(), z.string()]).optional(),
  extra: z.record(z.string(), z.unknown()).optional()
});

const NewsNowResponseSchema = z.object({
  status: z.enum(["success", "cache"]),
  id: z.string(),
  updatedTime: z.number().optional(),
  items: z.array(NewsNowItemSchema)
});

export interface RawNewsItem {
  id: string;
  source: {
    id: string;
    name: string;
    url?: string;
    type: "newsnow";
    weight: number;
  };
  title: string;
  url?: string;
  content: string;
  publishedAt?: string;
  fetchedAt: string;
  metadata: Record<string, unknown>;
}

export interface NewsNowAdapterOptions {
  newsApiBaseUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface FetchSourceResult {
  sourceId: string;
  items: RawNewsItem[];
  error?: string;
}

export class NewsNowAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(options: NewsNowAdapterOptions) {
    this.baseUrl = options.newsApiBaseUrl.replace(/\/$/, "");
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async fetchSource(source: NewsSourceConfig): Promise<FetchSourceResult> {
    const sourceId = source.sourceId ?? source.id;
    const url = `${this.baseUrl}/api/s?id=${encodeURIComponent(sourceId)}`;

    try {
      const response = await this.fetchFn(url);
      if (!response.ok) {
        return { sourceId: source.id, items: [], error: `NewsNow 请求失败：${source.id}: ${response.status}` };
      }

      const payload = NewsNowResponseSchema.parse(await response.json());
      const fetchedAt = this.now().toISOString();
      const items = payload.items.map((item, index): RawNewsItem => ({
        id: `${source.id}:${item.id}`,
        source: {
          id: source.id,
          name: source.name,
          type: source.type,
          weight: source.weight
        },
        title: item.title,
        url: item.url,
        content: "",
        publishedAt: normalizePublishedAt(item.pubDate, item.extra?.date),
        fetchedAt,
        metadata: {
          rank: index + 1,
          newsnow: {
            id: item.id,
            updatedTime: payload.updatedTime,
            extra: item.extra ?? {}
          }
        }
      }));

      return { sourceId: source.id, items };
    } catch (error) {
      return { sourceId: source.id, items: [], error: `NewsNow 请求失败：${source.id}: ${(error as Error).message}` };
    }
  }
}

function normalizePublishedAt(pubDate: number | string | undefined, extraDate: unknown): string | undefined {
  if (typeof pubDate === "number" || typeof pubDate === "string") {
    const date = new Date(pubDate);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof extraDate === "number" || typeof extraDate === "string") {
    const date = new Date(extraDate);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}
