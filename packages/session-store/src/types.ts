export type SessionStatus = "idle" | "running" | "failed";
export type SessionTitleSource = "default" | "flash" | "manual";
export type MessageRole = "user" | "assistant";
export type ToolCallStatus = "waiting" | "running" | "succeeded" | "failed";

export interface SessionSummary {
  id: string;
  title: string;
  titleSource: SessionTitleSource;
  updatedAt: string;
  status: SessionStatus;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  status: ToolCallStatus;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  error: string | null;
}

export interface SessionMessage {
  id: string;
  role: MessageRole;
  content: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  toolCalls?: ToolCallRecord[];
}

export interface ChatSession {
  id: string;
  title: string;
  titleSource: SessionTitleSource;
  createdAt: string;
  updatedAt: string;
  activePath: string[];
  messages: SessionMessage[];
  status: SessionStatus;
}

export interface SessionIndex {
  sessions: SessionSummary[];
}
