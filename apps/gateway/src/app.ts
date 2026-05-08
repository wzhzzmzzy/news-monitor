import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AgentEvent } from "../../../packages/agent-core/src/index.js";
import type { AppPaths } from "../../../packages/app-paths/src/index.js";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import { SessionStore, type ToolCallRecord } from "../../../packages/session-store/src/index.js";
import { createRuntime } from "../../cli/src/runtime.js";
import { renderMarkdown } from "./markdown/render-markdown.js";
import { getSettings, saveSettings } from "./settings/settings-service.js";
import type { RunEvent } from "./stream/run-registry.js";
import { RunRegistry } from "./stream/run-registry.js";

export interface GatewayAppOptions {
  paths?: AppPaths;
  runtime?: Awaited<ReturnType<typeof createRuntime>>;
}

export async function createGatewayApp(options: GatewayAppOptions = {}) {
  const paths = options.paths ?? resolveAppPaths();
  const runtime = options.runtime ?? await createRuntime({ paths });
  const sessionStore = new SessionStore({ sessionsDir: paths.sessionsDir });
  const runRegistry = new RunRegistry();
  const app = new Hono();

  app.get("/", (c) => c.redirect("/chat"));
  app.get("/chat", (c) => c.html(renderChatShell()));
  app.get("/settings", (c) => c.html(renderSettingsShell()));

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
      assistantMessageId: assistantMessage.id,
      sessionId,
      runtime,
      sessionStore,
      runRegistry
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
      assistantMessageId: assistantMessage.id,
      sessionId,
      runtime,
      sessionStore,
      runRegistry
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

  app.put("/api/settings", async (c) => {
    const body = await c.req.json<Parameters<typeof saveSettings>[1]>();
    await saveSettings(paths, body);
    return c.json(await getSettings(paths));
  });

  return app;
}

async function streamAgentResponse(input: {
  runId: string;
  content: string;
  assistantMessageId: string;
  sessionId: string;
  runtime: Awaited<ReturnType<typeof createRuntime>>;
  sessionStore: SessionStore;
  runRegistry: RunRegistry;
}): Promise<void> {
  try {
    for await (const event of input.runtime.agent.streamAsk({
      message: input.content,
      maxToolIterations: input.runtime.appConfig.llm.maxToolIterations
    })) {
      await persistAgentEvent(input.sessionStore, input.sessionId, input.assistantMessageId, event);
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

function renderChatShell(): string {
  return "<!doctype html><html><body><div class=\"hot-board-shell\" data-page=\"chat\"></div></body></html>";
}

function renderSettingsShell(): string {
  return "<!doctype html><html><body><form class=\"settings-form\" data-page=\"settings\"></form></body></html>";
}
