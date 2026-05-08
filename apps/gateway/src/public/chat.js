const state = {
  currentSessionId: null,
  currentAssistantNode: null
};

async function loadSessions() {
  const response = await fetch("/api/sessions");
  const { sessions } = await response.json();
  renderSessionList(sessions);
  if (!sessions.length) {
    return createSession();
  }
  state.currentSessionId = sessions[0].id;
  await selectSession(state.currentSessionId);
}

async function createSession() {
  const response = await fetch("/api/sessions", { method: "POST" });
  const session = await response.json();
  state.currentSessionId = session.id;
  renderSession(session);
  await loadSessions();
  return session;
}

async function selectSession(sessionId) {
  const response = await fetch(`/api/sessions/${sessionId}`);
  const session = await response.json();
  state.currentSessionId = session.id;
  renderSession(session);
}

async function sendMessage(content) {
  appendUserMessage({ id: "pending", content });
  state.currentAssistantNode = appendAssistantPlaceholder();
  const response = await fetch(`/api/sessions/${state.currentSessionId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content })
  });
  const run = await response.json();
  connectRun(run.runId, run.assistantMessageId);
}

async function editAndResend(messageId, content) {
  state.currentAssistantNode = appendAssistantPlaceholder();
  const response = await fetch(`/api/sessions/${state.currentSessionId}/messages/${messageId}/edit-resend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content })
  });
  const run = await response.json();
  connectRun(run.runId, run.assistantMessageId);
}

function connectRun(runId, assistantMessageId) {
  const events = new EventSource(`/api/runs/${runId}/events`);
  const assistant = state.currentAssistantNode ?? appendAssistantPlaceholder();
  const content = assistant.querySelector("[data-assistant-content]");

  events.addEventListener("assistant.delta", (event) => {
    const payload = JSON.parse(event.data);
    content.dataset.raw = `${content.dataset.raw ?? ""}${payload.text ?? ""}`;
    content.textContent = content.dataset.raw;
  });
  for (const type of ["tool.started", "tool.succeeded", "tool.failed"]) {
    events.addEventListener(type, (event) => {
      renderToolStatus(assistant, JSON.parse(event.data), type);
    });
  }
  events.addEventListener("assistant.completed", async () => {
    events.close();
    await renderCompletedMarkdown(content, content.dataset.raw ?? "");
    await selectSession(state.currentSessionId);
  });
  events.addEventListener("run.failed", () => {
    events.close();
    assistant.classList.add("failed");
  });
  assistant.dataset.messageId = assistantMessageId;
}

function renderSession(session) {
  document.querySelector("[data-session-title]").textContent = session.title;
  const list = document.querySelector("[data-message-list]");
  const messages = session.messages.filter((message) => session.activePath.includes(message.id));
  list.replaceChildren(...messages.map(renderMessage));
}

function renderSessionList(sessions) {
  const list = document.querySelector("[data-session-list]");
  list.replaceChildren(...sessions.map((session) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = session.title;
    button.addEventListener("click", () => void selectSession(session.id));
    return button;
  }));
}

function renderMessage(message) {
  if (message.role === "user") {
    return createUserMessage(message);
  }
  const node = document.createElement("article");
  node.className = "message assistant";
  node.dataset.messageId = message.id;
  const content = document.createElement("div");
  content.dataset.assistantContent = "";
  content.textContent = message.content || "思考中";
  node.append(content);
  for (const toolCall of message.toolCalls ?? []) {
    renderToolStatus(node, toolCall, `tool.${toolCall.status}`);
  }
  return node;
}

function appendUserMessage(message) {
  document.querySelector("[data-message-list]").append(createUserMessage(message));
}

function createUserMessage(message) {
  const node = document.createElement("article");
  node.className = "message user";
  node.dataset.messageId = message.id;
  const text = document.createElement("span");
  text.textContent = message.content;
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "icon-button";
  edit.dataset.editMessage = message.id;
  edit.dataset.icon = "IconPencil";
  edit.title = "编辑";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => showEditForm(node, message));
  node.append(text, edit);
  return node;
}

function appendAssistantPlaceholder() {
  const node = document.createElement("article");
  node.className = "message assistant";
  const content = document.createElement("div");
  content.dataset.assistantContent = "";
  content.textContent = "思考中";
  node.append(content);
  document.querySelector("[data-message-list]").append(node);
  return node;
}

function showEditForm(node, message) {
  const textarea = document.createElement("textarea");
  textarea.value = message.content;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  const send = document.createElement("button");
  send.type = "button";
  send.textContent = "发送";
  cancel.addEventListener("click", () => node.replaceWith(createUserMessage(message)));
  send.addEventListener("click", () => void editAndResend(message.id, textarea.value));
  node.replaceChildren(textarea, cancel, send);
}

function renderToolStatus(container, toolCall, eventType) {
  const id = toolCall.id ?? crypto.randomUUID();
  let row = container.querySelector(`[data-tool-call-id="${id}"]`);
  if (!row) {
    row = document.createElement("div");
    row.dataset.toolCallId = id;
    row.className = "tool-status";
    container.append(row);
  }
  row.dataset.status = toolCall.status ?? eventType.replace("tool.", "");
  row.textContent = `${toolCall.name ?? "tool"}: ${row.dataset.status}${toolCall.summary ? ` - ${toolCall.summary}` : ""}`;
}

async function renderCompletedMarkdown(messageElement, markdown) {
  const response = await fetch("/api/markdown", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ markdown })
  });
  const { html } = await response.json();
  messageElement.innerHTML = html;
}

document.querySelector("[data-new-session]")?.addEventListener("click", () => void createSession());
document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => void toggleThemeMode());
document.querySelector("[data-composer]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("[data-message-input]");
  const content = input.value.trim();
  if (!content) {
    return;
  }
  input.value = "";
  void sendMessage(content);
});

void loadSessions();

async function toggleThemeMode() {
  const html = document.documentElement;
  const mode = html.dataset.themeMode === "dark" ? "light" : "dark";
  html.dataset.themeMode = mode;
  await fetch("/api/settings/theme-mode", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode })
  });
}

export {
  connectRun,
  createSession,
  editAndResend,
  loadSessions,
  renderCompletedMarkdown,
  renderSession,
  renderToolStatus,
  sendMessage,
  selectSession,
  toggleThemeMode
};
