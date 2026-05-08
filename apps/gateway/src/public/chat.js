const state = {
  currentSessionId: null,
  currentAssistantNode: null
};

const THEME_TOKENS = {
  latte: {
    base: "#eff1f5",
    mantle: "#e6e9ef",
    crust: "#dce0e8",
    surface0: "#ccd0da",
    surface1: "#bcc0cc",
    text: "#4c4f69",
    subtext0: "#6c6f85",
    green: "#40a02b",
    yellow: "#df8e1d",
    red: "#d20f39",
    blue: "#1e66f5",
    mauve: "#8839ef"
  },
  frappe: {
    base: "#303446",
    mantle: "#292c3c",
    crust: "#232634",
    surface0: "#414559",
    surface1: "#51576d",
    text: "#c6d0f5",
    subtext0: "#a5adce",
    green: "#a6d189",
    yellow: "#e5c890",
    red: "#e78284",
    blue: "#8caaee",
    mauve: "#ca9ee6"
  },
  macchiato: {
    base: "#24273a",
    mantle: "#1e2030",
    crust: "#181926",
    surface0: "#363a4f",
    surface1: "#494d64",
    text: "#cad3f5",
    subtext0: "#a5adcb",
    green: "#a6da95",
    yellow: "#eed49f",
    red: "#ed8796",
    blue: "#8aadf4",
    mauve: "#c6a0f6"
  },
  mocha: {
    base: "#1e1e2e",
    mantle: "#181825",
    crust: "#11111b",
    surface0: "#313244",
    surface1: "#45475a",
    text: "#cdd6f4",
    subtext0: "#a6adc8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    red: "#f38ba8",
    blue: "#89b4fa",
    mauve: "#cba6f7"
  }
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
  const response = await fetch(`/api/sessions/${state.currentSessionId}/messages/${messageId}/edit-resend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content })
  });
  const run = await response.json();
  await selectSession(state.currentSessionId);
  state.currentAssistantNode = document.querySelector(`[data-message-id="${run.assistantMessageId}"]`);
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
  events.addEventListener("run.failed", async (event) => {
    events.close();
    const payload = JSON.parse(event.data);
    renderAssistantFailure(assistant, payload.error ?? "运行失败");
    state.currentAssistantNode = null;
    await selectSession(state.currentSessionId);
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
    button.className = "session-list-item";
    button.dataset.sessionId = session.id;
    button.setAttribute("aria-current", session.id === state.currentSessionId ? "page" : "false");
    const title = document.createElement("span");
    title.className = "session-list-title";
    title.textContent = session.title;
    const meta = document.createElement("span");
    meta.className = "session-list-meta";
    const status = document.createElement("span");
    status.setAttribute("data-session-status", session.status);
    status.textContent = statusLabel(session.status);
    const updated = document.createElement("time");
    updated.dateTime = session.updatedAt;
    updated.textContent = formatUpdatedAt(session.updatedAt);
    meta.append(status, updated);
    button.append(title, meta);
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
  if (message.failedAt || message.error) {
    renderAssistantFailure(node, message.error ?? "运行失败");
  } else {
    content.textContent = message.content || "思考中";
    node.append(content);
  }
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

function renderAssistantFailure(container, error) {
  container.classList.add("failed");
  let content = container.querySelector("[data-assistant-content]");
  if (!content) {
    content = document.createElement("div");
    content.dataset.assistantContent = "";
    container.prepend(content);
  }
  content.dataset.raw = "";
  content.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "生成失败";
  const detail = document.createElement("p");
  detail.textContent = error;
  content.append(title, detail);
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

for (const button of document.querySelectorAll("[data-new-session]")) {
  button.addEventListener("click", () => void createSession());
}
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
  applyThemeTokens(mode);
  const response = await fetch("/api/settings/theme-mode", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode })
  });
  const settings = await response.json();
  applyThemeTokens(settings.config.theme.mode, settings.config.theme);
}

function applyThemeTokens(mode, theme = {}) {
  const html = document.documentElement;
  const variant = mode === "dark"
    ? theme.darkVariant ?? html.dataset.themeDarkVariant ?? "mocha"
    : theme.lightVariant ?? html.dataset.themeLightVariant ?? "latte";
  const tokens = THEME_TOKENS[variant] ?? THEME_TOKENS.latte;
  html.dataset.themeMode = mode;
  html.dataset.themeVariant = variant;
  for (const [name, value] of Object.entries(tokens)) {
    html.style.setProperty(`--${name}`, value);
  }
  const icon = document.querySelector("[data-theme-icon]");
  if (icon) {
    icon.dataset.iconMode = mode;
  }
  updateThemeToggleIcon(mode);
}

function updateThemeToggleIcon(mode) {
  const toggle = document.querySelector("[data-theme-toggle]");
  const icon = document.querySelector("[data-theme-icon]");
  const nextLabel = mode === "dark" ? "切换到浅色" : "切换到深色";
  if (toggle) {
    toggle.title = nextLabel;
    toggle.setAttribute("aria-label", nextLabel);
  }
  if (icon) {
    icon.innerHTML = mode === "dark"
      ? '<svg class="icon" data-icon="IconSun" aria-label="浅色" role="img" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.9 4.9l1.4 1.4"></path><path d="M17.7 17.7l1.4 1.4"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M4.9 19.1l1.4-1.4"></path><path d="M17.7 6.3l1.4-1.4"></path></svg>'
      : '<svg class="icon" data-icon="IconMoon" aria-label="深色" role="img" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6.5 6.5 0 1 0 8.7 8.7A8 8 0 1 1 12 3"></path></svg>';
  }
}

function statusLabel(status) {
  if (status === "running") {
    return "生成中";
  }
  if (status === "failed") {
    return "失败";
  }
  return "空闲";
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export {
  connectRun,
  createSession,
  editAndResend,
  loadSessions,
  applyThemeTokens,
  formatUpdatedAt,
  renderCompletedMarkdown,
  renderAssistantFailure,
  renderSession,
  renderToolStatus,
  sendMessage,
  selectSession,
  toggleThemeMode
};
