import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../../../packages/agent-core/src/index.js";
import type { AppPaths } from "../../../packages/app-paths/src/index.js";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import { SessionStore, type ToolCallRecord } from "../../../packages/session-store/src/index.js";
import { createRuntime } from "../../cli/src/runtime.js";
import { renderMarkdown } from "./markdown/render-markdown.js";
import { createPageRoutes } from "./routes/pages.js";
import { getSettings, saveSettings, validateSettings } from "./settings/settings-service.js";
import type { RunEvent } from "./stream/run-registry.js";
import { RunRegistry } from "./stream/run-registry.js";

export interface GatewayAppOptions {
  paths?: AppPaths;
  runtime?: Awaited<ReturnType<typeof createRuntime>>;
  titleGenerator?: (input: { user: string; assistant: string }) => Promise<string>;
}

export async function createGatewayApp(options: GatewayAppOptions = {}) {
  const paths = options.paths ?? resolveAppPaths();
  const runtime = options.runtime ?? await createRuntime({ paths });
  const sessionStore = new SessionStore({ sessionsDir: paths.sessionsDir });
  const runRegistry = new RunRegistry();
  const app = new Hono();

  app.route("/", createPageRoutes({ paths }));
  app.get("/assets/:file", async (c) => {
    const file = c.req.param("file");
    const content = await readFile(join(process.cwd(), "apps/gateway/src/public", file), "utf8");
    return c.body(content, 200, { "content-type": contentTypeFor(file) });
  });

  app.post("/api/sessions", async (c) => {
    const session = await sessionStore.createSession();
    return c.json(session, 201);
  });

  app.get("/api/sessions", async (c) => c.json({ sessions: await sessionStore.listSessions() }));

  app.get("/api/sessions/:sessionId", async (c) => c.json(await sessionStore.getSession(c.req.param("sessionId"))));

  app.post("/api/sessions/:sessionId/messages", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ content?: string }>();
    const userMessage = await sessionStore.addUserMessage(sessionId, { content: body.content ?? "" });
    const assistantMessage = await sessionStore.createAssistantMessage(sessionId, { parentId: userMessage.id });
    const runId = crypto.randomUUID();
    runRegistry.createRun(runId);
    void streamAgentResponse({
      runId,
      content: userMessage.content,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      sessionId,
      runtime,
      sessionStore,
      runRegistry,
      titleGenerator: options.titleGenerator
    });
    return c.json({ runId, sessionId, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id }, 202);
  });

  app.post("/api/sessions/:sessionId/messages/:messageId/edit-resend", async (c) => {
    const sessionId = c.req.param("sessionId");
    const messageId = c.req.param("messageId");
    const body = await c.req.json<{ content?: string }>();
    const userMessage = await sessionStore.editAndResendUserMessage(sessionId, messageId, { content: body.content ?? "" });
    const assistantMessage = await sessionStore.createAssistantMessage(sessionId, { parentId: userMessage.id });
    const runId = crypto.randomUUID();
    runRegistry.createRun(runId);
    void streamAgentResponse({
      runId,
      content: userMessage.content,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      sessionId,
      runtime,
      sessionStore,
      runRegistry,
      titleGenerator: options.titleGenerator
    });
    return c.json({ runId, sessionId, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id }, 202);
  });

  app.post("/api/markdown", async (c) => {
    const body = await c.req.json<{ markdown?: string }>();
    return c.json({ html: renderMarkdown(body.markdown ?? "") });
  });

  app.get("/api/runs/:runId/events", (c) => {
    const runId = c.req.param("runId");
    return streamSSE(c, async (stream) => {
      const pending: RunEvent[] = [];
      let notify: (() => void) | undefined;
      const nextEvent = () => new Promise<void>((resolve) => {
        notify = resolve;
      });
      const unsubscribe = runRegistry.subscribe(runId, (event) => {
        pending.push(event);
        notify?.();
      });

      try {
        while (!stream.aborted) {
          while (pending.length) {
            const event = pending.shift();
            if (!event) {
              continue;
            }
            await stream.writeSSE({ event: event.type, data: JSON.stringify(event.payload) });
            if (event.type === "run.failed" || event.type === "assistant.completed") {
              return;
            }
          }
          if (runRegistry.isComplete(runId)) {
            return;
          }
          await nextEvent();
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.get("/api/settings", async (c) => c.json(await getSettings(paths)));

  app.put("/api/settings/theme-mode", async (c) => {
    const body = await c.req.json<{ mode?: "light" | "dark" }>();
    const settings = await getSettings(paths);
    settings.config.theme.mode = body.mode === "dark" ? "dark" : "light";
    await saveSettings(paths, settings);
    return c.json(await getSettings(paths));
  });

  app.put("/api/settings", async (c) => {
    const body = await c.req.json<Parameters<typeof saveSettings>[1]>();
    const fields = validateSettings(body);
    if (Object.keys(fields).length) {
      return c.json({ error: "settings.validation_failed", fields }, 400);
    }
    await saveSettings(paths, body);
    return c.json(await getSettings(paths));
  });

  return app;
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (file.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

async function streamAgentResponse(input: {
  runId: string;
  content: string;
  userMessageId: string;
  assistantMessageId: string;
  sessionId: string;
  runtime: Awaited<ReturnType<typeof createRuntime>>;
  sessionStore: SessionStore;
  runRegistry: RunRegistry;
  titleGenerator?: (input: { user: string; assistant: string }) => Promise<string>;
}): Promise<void> {
  try {
    const history = await activeHistoryBefore(input.sessionStore, input.sessionId, input.userMessageId);
    for await (const event of input.runtime.agent.streamAsk({
      message: input.content,
      history,
      maxToolIterations: input.runtime.appConfig.llm.maxToolIterations
    })) {
      await persistAgentEvent(input.sessionStore, input.sessionId, input.assistantMessageId, event);
      if (event.type === "assistant.completed") {
        const titleEvent = await maybeUpdateTitle(input);
        if (titleEvent) {
          input.runRegistry.publish(input.runId, titleEvent);
        }
      }
      input.runRegistry.publish(input.runId, event);
      if (event.type === "assistant.completed") {
        input.runRegistry.complete(input.runId);
      }
    }
  } catch (error) {
    const message = (error as Error).message;
    await input.sessionStore.failAssistantMessage(input.sessionId, input.assistantMessageId, message);
    input.runRegistry.publish(input.runId, { type: "run.failed", payload: { error: message } });
    input.runRegistry.complete(input.runId);
  }
}

async function activeHistoryBefore(
  sessionStore: SessionStore,
  sessionId: string,
  messageId: string
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const session = await sessionStore.getSession(sessionId);
  const messagesById = new Map(session.messages.map((message) => [message.id, message]));
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const activeMessageId of session.activePath) {
    if (activeMessageId === messageId) {
      break;
    }
    const message = messagesById.get(activeMessageId);
    if (!message || !message.content) {
      continue;
    }
    history.push({ role: message.role, content: message.content });
  }
  return history;
}

async function maybeUpdateTitle(input: {
  sessionId: string;
  content: string;
  sessionStore: SessionStore;
  titleGenerator?: (titleInput: { user: string; assistant: string }) => Promise<string>;
  runtime: Awaited<ReturnType<typeof createRuntime>>;
}): Promise<AgentEvent | undefined> {
  const session = await input.sessionStore.getSession(input.sessionId);
  if (session.titleSource === "manual") {
    return undefined;
  }
  const assistant = [...session.messages].reverse().find((message) => message.role === "assistant" && session.activePath.includes(message.id));
  const flashConfigured = Boolean(input.runtime.appConfig.flash.baseUrl && input.runtime.appConfig.flash.apiKey && input.runtime.appConfig.flash.model);
  const title = flashConfigured && input.titleGenerator
    ? await input.titleGenerator({ user: input.content, assistant: assistant?.content ?? "" })
    : deterministicTitleFromUserMessage(firstActiveUserMessage(session) ?? input.content);
  const titleSource = flashConfigured && input.titleGenerator ? "flash" : "default";
  await input.sessionStore.updateTitle(input.sessionId, { title, titleSource });
  return { type: "title.updated", payload: { title, titleSource } };
}

function firstActiveUserMessage(session: Awaited<ReturnType<SessionStore["getSession"]>>): string | undefined {
  for (const messageId of session.activePath) {
    const message = session.messages.find((candidate) => candidate.id === messageId);
    if (message?.role === "user") {
      return message.content;
    }
  }
  return undefined;
}

function deterministicTitleFromUserMessage(content: string): string {
  const compact = content.trim().replace(/\s+/g, " ");
  return compact ? compact.slice(0, 24) : "新会话";
}

async function persistAgentEvent(
  sessionStore: SessionStore,
  sessionId: string,
  assistantMessageId: string,
  event: AgentEvent
): Promise<void> {
  if (event.type === "assistant.delta") {
    const payload = event.payload as { text?: string };
    await sessionStore.appendAssistantDelta(sessionId, assistantMessageId, payload.text ?? "");
    return;
  }
  if (event.type === "assistant.completed") {
    await sessionStore.completeAssistantMessage(sessionId, assistantMessageId);
    return;
  }
  if (event.type === "tool.started" || event.type === "tool.succeeded" || event.type === "tool.failed") {
    await sessionStore.updateToolCall(sessionId, assistantMessageId, toToolCallRecord(event));
  }
}

function toToolCallRecord(event: AgentEvent): ToolCallRecord {
  const payload = event.payload as { id?: string; name?: string; summary?: string; error?: string };
  const now = new Date().toISOString();
  if (event.type === "tool.started") {
    return {
      id: payload.id ?? crypto.randomUUID(),
      name: payload.name ?? "tool",
      status: "running",
      startedAt: now,
      error: null
    };
  }
  if (event.type === "tool.succeeded") {
    return {
      id: payload.id ?? crypto.randomUUID(),
      name: payload.name ?? "tool",
      status: "succeeded",
      finishedAt: now,
      summary: payload.summary,
      error: null
    };
  }
  return {
    id: payload.id ?? crypto.randomUUID(),
    name: payload.name ?? "tool",
    status: "failed",
    finishedAt: now,
    error: payload.error ?? "Tool failed"
  };
}
