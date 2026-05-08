import { join } from "node:path";
import { FileArchiveStore } from "../../../packages/archive/src/index.js";
import { AgentSession, OpenAIModelClient, type AgentModelClient, type ToolChatInput } from "../../../packages/agent-core/src/index.js";
import { resolveAppPaths, type AppPaths } from "../../../packages/app-paths/src/index.js";
import { ConfigLoader, loadAppConfig, type RuntimeConfig } from "../../../packages/config/src/index.js";
import { SkillLoader } from "../../../packages/skills/src/index.js";
import { createBuiltinTools, NewsNowAdapter, type ToolRegistry } from "../../../packages/tools/src/index.js";
import { builtinWorkflows, WorkflowRunner } from "../../../packages/workflow-core/src/index.js";

export interface RuntimeOptions {
  paths?: AppPaths;
  newsApiBaseUrl?: string;
  modelClient?: AgentModelClient;
}

export async function createRuntime(options: RuntimeOptions = {}) {
  const paths = options.paths ?? resolveAppPaths();
  const appConfig = await loadAppConfig({ configFile: paths.configFile });
  const archive = new FileArchiveStore({ rootDir: paths.dataDir });
  const config = await new ConfigLoader({
    sourcesFile: paths.sourcesFile,
    analysisProfilesFile: paths.analysisProfilesFile
  }).load();
  const modelClient = createLazyModelClient(options.modelClient, appConfig);
  const newsFetcher = new NewsNowAdapter({
    newsApiBaseUrl: options.newsApiBaseUrl ?? appConfig.newsnow.baseUrl ?? process.env.NEWS_API_BASE_URL ?? "http://localhost:13000"
  });
  let runner: WorkflowRunner;
  const tools: ToolRegistry = createBuiltinTools({
    archive,
    sources: config.sources,
    newsFetcher,
    workflowRun: async (workflowId, input) => {
      const workflow = builtinWorkflows[workflowId as keyof typeof builtinWorkflows];
      if (!workflow) {
        throw new Error(`找不到 workflow：${workflowId}`);
      }
      return runner.run(workflow, input);
    },
    workflowStatus: async (runId) => {
      const refs = await archive.listArtifacts({ type: "runs" });
      const artifacts = await Promise.all(refs.map((ref) => archive.readArtifact(ref)));
      const match = artifacts.find((artifact) => (artifact.data as { id?: string }).id === runId);
      if (!match) {
        throw new Error(`找不到 run：${runId}`);
      }
      return match.data;
    }
  });
  runner = new WorkflowRunner({
    archive,
    tools,
    skillLoader: new SkillLoader({ skillsDir: join(process.cwd(), "packages/skills/skills") }),
    analysisProfiles: config.analysisProfiles,
    modelClient
  });

  const agent = new AgentSession({ archive, tools, modelClient });
  return { paths, archive, appConfig, config, tools, workflows: builtinWorkflows, runner, agent };
}

function createLazyModelClient(initialClient: AgentModelClient | undefined, appConfig: RuntimeConfig): AgentModelClient {
  let client = initialClient;
  const getClient = () => {
    client ??= new OpenAIModelClient({
      apiKey: appConfig.llm.apiKey,
      baseUrl: appConfig.llm.baseUrl,
      model: appConfig.llm.model,
      thinking: appConfig.llm.thinking
    });
    return client;
  };

  return {
    generateStructured: (input) => getClient().generateStructured(input),
    generateWithTools: (input: ToolChatInput) => {
      const activeClient = getClient();
      if (!activeClient.generateWithTools) {
        throw new Error("当前 model client 不支持 tool calling");
      }
      return activeClient.generateWithTools(input);
    }
  };
}
