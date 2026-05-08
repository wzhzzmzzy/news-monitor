import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import type { NewsSourceConfig } from "../../config/src/index.js";
import type { NewsNowAdapter } from "./newsnow-adapter.js";
import { ToolRegistry } from "./tool-registry.js";

type WindowNewsItem = {
  id?: unknown;
  publishedAt?: unknown;
  fetchedAt?: unknown;
};

export interface BuiltinToolsOptions {
  archive: ArchiveStore;
  sources: NewsSourceConfig[];
  newsFetcher: Pick<NewsNowAdapter, "fetchSource">;
  now?: () => Date;
  workflowStatus?: (runId: string) => Promise<unknown>;
  workflowRun?: (workflowId: string, input: Record<string, unknown>) => Promise<unknown>;
}

export function createBuiltinTools(options: BuiltinToolsOptions): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: "crawl_news",
    description: "抓取已配置的 NewsNow 信源并写入 raw news artifact。",
    inputSchema: {
      type: "object",
      properties: { windowHours: { type: "number" } },
      required: ["windowHours"]
    },
    execute: async (input) => {
      const windowHours = (input as { windowHours?: number }).windowHours ?? 24;
      const endedAt = options.now?.() ?? new Date();
      const startedAt = new Date(endedAt.getTime() - windowHours * 60 * 60 * 1000);
      const enabledSources = options.sources.filter((source) => source.enabled);
      const sourceResults = await Promise.all(enabledSources.map((source) => options.newsFetcher.fetchSource(source)));
      const fetchedItems = sourceResults.flatMap((result) => result.items);
      const archivedItems = await readArchivedRawNewsItems(options.archive);
      const items = dedupeById([...fetchedItems, ...archivedItems])
        .filter((item) => isInWindow(item, startedAt, endedAt));
      const sourceErrors = sourceResults
        .filter((result) => result.error)
        .map((result) => ({ sourceId: result.sourceId, error: result.error }));
      const artifactRef = await options.archive.writeArtifact({
        type: "news.raw",
        data: {
          windowHours,
          window: {
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString()
          },
          fetchedAt: endedAt.toISOString(),
          items,
          sourceErrors
        },
        metadata: { itemCount: items.length, sourceCount: enabledSources.length }
      });
      return { artifactRef, itemCount: items.length, sourceErrors };
    }
  });

  registry.register({
    name: "read_archive",
    description: "按 ref 读取 archive artifact。",
    inputSchema: { type: "object", properties: { ref: { type: "object" } }, required: ["ref"] },
    execute: async (input) => options.archive.readArtifact((input as { ref: ArtifactRef }).ref)
  });

  registry.register({
    name: "write_archive",
    description: "写入 archive artifact。",
    inputSchema: { type: "object", properties: { type: { type: "string" }, data: {} }, required: ["type", "data"] },
    execute: async (input) => options.archive.writeArtifact(input as never)
  });

  registry.register({
    name: "list_reports",
    description: "列出 report artifacts。",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    execute: async (input) => options.archive.listArtifacts({ type: "reports", limit: (input as { limit?: number }).limit })
  });

  registry.register({
    name: "read_report",
    description: "按 ref 读取 report artifact。",
    inputSchema: { type: "object", properties: { ref: { type: "object" } }, required: ["ref"] },
    execute: async (input) => options.archive.readArtifact((input as { ref: ArtifactRef }).ref)
  });

  registry.register({
    name: "run_workflow",
    description: "运行固定 workflow。",
    inputSchema: { type: "object", properties: { workflowId: { type: "string" }, input: { type: "object" } }, required: ["workflowId"] },
    execute: async (input) => {
      if (!options.workflowRun) {
        throw new Error("Workflow runner 未配置");
      }
      const request = input as { workflowId: string; input?: Record<string, unknown> };
      return options.workflowRun(request.workflowId, request.input ?? {});
    }
  });

  registry.register({
    name: "get_workflow_status",
    description: "读取 workflow run 状态。",
    inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
    execute: async (input) => {
      if (!options.workflowStatus) {
        throw new Error("Workflow status reader 未配置");
      }
      return options.workflowStatus((input as { runId: string }).runId);
    }
  });

  return registry;
}

async function readArchivedRawNewsItems(archive: ArchiveStore): Promise<WindowNewsItem[]> {
  const refs = await archive.listArtifacts({ type: "news.raw" });
  const artifacts = await Promise.all(refs.map((ref) => archive.readArtifact(ref)));
  return artifacts.flatMap((artifact) => {
    const data = artifact.data as { items?: WindowNewsItem[] };
    return data.items ?? [];
  });
}

function dedupeById<TItem extends WindowNewsItem>(items: TItem[]): TItem[] {
  const seen = new Set<string>();
  const deduped: TItem[] = [];
  for (const item of items) {
    const id = String(item.id ?? "");
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(item);
  }
  return deduped;
}

function isInWindow(item: WindowNewsItem, startedAt: Date, endedAt: Date): boolean {
  const timestamp = typeof item.publishedAt === "string" ? item.publishedAt : item.fetchedAt;
  if (typeof timestamp !== "string") {
    return true;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return true;
  }
  return date.getTime() >= startedAt.getTime() && date.getTime() <= endedAt.getTime();
}
