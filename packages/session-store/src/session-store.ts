import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ChatSession,
  SessionIndex,
  SessionMessage,
  SessionStatus,
  SessionSummary,
  SessionTitleSource,
  ToolCallRecord
} from "./types.js";

export interface SessionStoreOptions {
  sessionsDir: string;
  now?: () => Date;
  idPrefix?: string;
}

export class SessionStore {
  private readonly sessionsDir: string;
  private readonly now: () => Date;
  private readonly idPrefix: string;

  constructor(options: SessionStoreOptions) {
    this.sessionsDir = options.sessionsDir;
    this.now = options.now ?? (() => new Date());
    this.idPrefix = options.idPrefix ?? "";
  }

  async createSession(): Promise<ChatSession> {
    const timestamp = this.timestamp();
    const session: ChatSession = {
      id: this.createId("session"),
      title: "新会话",
      titleSource: "default",
      createdAt: timestamp,
      updatedAt: timestamp,
      activePath: [],
      messages: [],
      status: "idle"
    };
    await this.writeSession(session);
    return session;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const sessions = await this.readAllSessions();
    const summaries = sessions
      .map((session) => this.toSummary(session))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await writeJsonAtomic(this.indexPath(), { sessions } satisfies SessionIndex);
    return summaries;
  }

  async getSession(sessionId: string): Promise<ChatSession> {
    return this.readSession(sessionId);
  }

  async addUserMessage(sessionId: string, input: { content: string; parentId?: string | null }): Promise<SessionMessage> {
    const session = await this.readSession(sessionId);
    const parentId = input.parentId ?? session.activePath.at(-1) ?? null;
    const message = this.createMessage("user", input.content, parentId);
    session.messages.push(message);
    session.activePath = [...this.parentChain(session, parentId), message.id];
    this.touchSession(session, "idle");
    await this.writeSession(session);
    return message;
  }

  async createAssistantMessage(sessionId: string, input: { parentId: string }): Promise<SessionMessage> {
    const session = await this.readSession(sessionId);
    const message = this.createMessage("assistant", "", input.parentId);
    message.toolCalls = [];
    session.messages.push(message);
    session.activePath = [...this.parentChain(session, input.parentId), message.id];
    this.touchSession(session, "running");
    await this.writeSession(session);
    return message;
  }

  async appendAssistantDelta(sessionId: string, messageId: string, delta: string): Promise<void> {
    await this.updateMessage(sessionId, messageId, (session, message) => {
      message.content += delta;
      message.updatedAt = this.timestamp();
      this.touchSession(session, "running");
    });
  }

  async completeAssistantMessage(sessionId: string, messageId: string): Promise<void> {
    await this.updateMessage(sessionId, messageId, (session, message) => {
      const timestamp = this.timestamp();
      message.completedAt = timestamp;
      message.updatedAt = timestamp;
      this.touchSession(session, "idle", timestamp);
    });
  }

  async failAssistantMessage(sessionId: string, messageId: string, error: string): Promise<void> {
    await this.updateMessage(sessionId, messageId, (session, message) => {
      const timestamp = this.timestamp();
      message.failedAt = timestamp;
      message.error = error;
      message.updatedAt = timestamp;
      this.touchSession(session, "failed", timestamp);
    });
  }

  async updateToolCall(sessionId: string, messageId: string, toolCall: ToolCallRecord): Promise<void> {
    await this.updateMessage(sessionId, messageId, (session, message) => {
      const toolCalls = message.toolCalls ?? [];
      const existingIndex = toolCalls.findIndex((candidate) => candidate.id === toolCall.id);
      if (existingIndex >= 0) {
        toolCalls[existingIndex] = toolCall;
      } else {
        toolCalls.push(toolCall);
      }
      message.toolCalls = toolCalls;
      message.updatedAt = this.timestamp();
      this.touchSession(session, session.status);
    });
  }

  async editAndResendUserMessage(sessionId: string, messageId: string, input: { content: string }): Promise<SessionMessage> {
    const session = await this.readSession(sessionId);
    const original = this.requireMessage(session, messageId);
    if (original.role !== "user") {
      throw new Error(`Only user messages can be edited: ${messageId}`);
    }
    const message = this.createMessage("user", input.content, original.parentId);
    session.messages.push(message);
    session.activePath = [...this.parentChain(session, original.parentId), message.id];
    this.touchSession(session, "idle");
    await this.writeSession(session);
    return message;
  }

  async updateTitle(sessionId: string, input: { title: string; titleSource: SessionTitleSource }): Promise<void> {
    const session = await this.readSession(sessionId);
    session.title = input.title;
    session.titleSource = input.titleSource;
    this.touchSession(session, session.status);
    await this.writeSession(session);
  }

  private async updateMessage(
    sessionId: string,
    messageId: string,
    update: (session: ChatSession, message: SessionMessage) => void
  ): Promise<void> {
    const session = await this.readSession(sessionId);
    update(session, this.requireMessage(session, messageId));
    await this.writeSession(session);
  }

  private createMessage(role: "user" | "assistant", content: string, parentId: string | null): SessionMessage {
    const timestamp = this.timestamp();
    return {
      id: this.createId("msg"),
      role,
      content,
      parentId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private parentChain(session: ChatSession, parentId: string | null): string[] {
    if (!parentId) {
      return [];
    }
    const chain: string[] = [];
    let current: SessionMessage | undefined = this.requireMessage(session, parentId);
    while (current) {
      chain.unshift(current.id);
      current = current.parentId ? session.messages.find((message) => message.id === current?.parentId) : undefined;
    }
    return chain;
  }

  private requireMessage(session: ChatSession, messageId: string): SessionMessage {
    const message = session.messages.find((candidate) => candidate.id === messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }
    return message;
  }

  private touchSession(session: ChatSession, status: SessionStatus, timestamp = this.timestamp()): void {
    session.updatedAt = timestamp;
    session.status = status;
  }

  private async readAllSessions(): Promise<ChatSession[]> {
    await mkdir(this.sessionsDir, { recursive: true });
    const files = await readdir(this.sessionsDir);
    const sessions: ChatSession[] = [];
    for (const file of files.filter((name) => name.endsWith(".json") && name !== "index.json")) {
      try {
        sessions.push(JSON.parse(await readFile(join(this.sessionsDir, file), "utf8")) as ChatSession);
      } catch {
        // Corrupt sessions are ignored so one bad file does not break the list.
      }
    }
    return sessions;
  }

  private async readSession(sessionId: string): Promise<ChatSession> {
    const raw = await readFile(this.sessionPath(sessionId), "utf8");
    return JSON.parse(raw) as ChatSession;
  }

  private async writeSession(session: ChatSession): Promise<void> {
    await writeJsonAtomic(this.sessionPath(session.id), session);
    await writeJsonAtomic(this.indexPath(), { sessions: [this.toSummary(session), ...await this.otherSummaries(session.id)] } satisfies SessionIndex);
  }

  private async otherSummaries(sessionId: string): Promise<SessionSummary[]> {
    const sessions = await this.readAllSessions();
    return sessions
      .filter((session) => session.id !== sessionId)
      .map((session) => this.toSummary(session))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private toSummary(session: ChatSession): SessionSummary {
    return {
      id: session.id,
      title: session.title,
      titleSource: session.titleSource,
      updatedAt: session.updatedAt,
      status: session.status
    };
  }

  private sessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }

  private indexPath(): string {
    return join(this.sessionsDir, "index.json");
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private createId(prefix: string): string {
    return `${this.idPrefix}${prefix}_${crypto.randomUUID()}`;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}
