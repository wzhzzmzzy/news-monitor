import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import type { NewsSourceConfig } from "../../config/src/index.js";
import type { NewsNowAdapter } from "./newsnow-adapter.js";
import { ToolRegistry } from "./tool-registry.js";

export interface BuiltinToolsOptions {
  archive: ArchiveStore;
  sources: NewsSourceConfig[];
  newsFetcher: Pick<NewsNowAdapter, "fetchSource">;
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
      const sourceResults = await Promise.all(options.sources.map((source) => options.newsFetcher.fetchSource(source)));
      const items = sourceResults.flatMap((result) => result.items);
      const sourceErrors = sourceResults
        .filter((result) => result.error)
        .map((result) => ({ sourceId: result.sourceId, error: result.error }));
      const artifactRef = await options.archive.writeArtifact({
        type: "news.raw",
        data: {
          windowHours,
          fetchedAt: new Date().toISOString(),
          items,
          sourceErrors
        },
        metadata: { itemCount: items.length, sourceCount: options.sources.length }
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
