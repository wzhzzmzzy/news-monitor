const state = {
  settings: null
};

async function loadSettings() {
  const response = await fetch("/api/settings");
  state.settings = await response.json();
  renderSources(state.settings.sources);
  renderProfiles(state.settings.analysisProfiles);
  return state.settings;
}

function readSettingsForm() {
  const form = document.querySelector("[data-settings-form]");
  const data = new FormData(form);
  const settings = structuredClone(state.settings);
  settings.config.llm.baseUrl = value(data, "llm.baseUrl");
  settings.config.llm.apiKey = value(data, "llm.apiKey");
  settings.config.llm.model = value(data, "llm.model");
  settings.config.llm.thinking = value(data, "llm.thinking");
  settings.config.llm.timeoutMs = numberValue(data, "llm.timeoutMs");
  settings.config.llm.maxToolIterations = numberValue(data, "llm.maxToolIterations");
  settings.config.flash.baseUrl = value(data, "flash.baseUrl");
  settings.config.flash.apiKey = value(data, "flash.apiKey");
  settings.config.flash.model = value(data, "flash.model");
  settings.config.flash.thinking = value(data, "flash.thinking");
  settings.config.flash.timeoutMs = numberValue(data, "flash.timeoutMs");
  settings.config.newsnow.baseUrl = value(data, "newsnow.baseUrl");
  settings.config.newsnow.timeoutMs = numberValue(data, "newsnow.timeoutMs");
  settings.config.newsnow.maxItemsPerSource = numberValue(data, "newsnow.maxItemsPerSource");
  settings.config.theme.mode = value(data, "theme.mode");
  settings.config.theme.lightVariant = value(data, "theme.lightVariant");
  settings.config.theme.darkVariant = value(data, "theme.darkVariant");
  settings.config.gateway.host = value(data, "gateway.host");
  settings.config.gateway.port = numberValue(data, "gateway.port");
  settings.config.gateway.openBrowserOnStart = data.get("gateway.openBrowserOnStart") === "on";
  settings.sources = readRows("[data-source-row]", readSourceRow);
  settings.analysisProfiles = readRows("[data-profile-row]", readProfileRow);
  return settings;
}

function renderSources(sources) {
  const root = document.querySelector("[data-sources-editor]");
  root.replaceChildren(...sources.map((source) => row("source", source.id, [
    input("id", source.id),
    input("name", source.name),
    input("sourceId", source.sourceId),
    input("weight", source.weight, "number"),
    checkbox("enabled", source.enabled),
    removeButton("删除这个信源？")
  ])));
}

function renderProfiles(profiles) {
  const root = document.querySelector("[data-profiles-editor]");
  root.replaceChildren(...profiles.map((profile) => row("profile", profile.id, [
    input("id", profile.id),
    input("name", profile.name),
    input("focus", profile.focus.join(", ")),
    textarea("instruction", profile.instruction),
    checkbox("default", profile.default)
  ])));
}

async function saveSettings(event) {
  event.preventDefault();
  const error = document.querySelector("[data-settings-error]");
  error.textContent = "";
  try {
    const next = readSettingsForm();
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next)
    });
    if (!response.ok) {
      throw new Error(`保存失败：${response.status}`);
    }
    state.settings = await response.json();
  } catch (saveError) {
    error.textContent = saveError.message;
  }
}

function value(data, name) {
  const raw = data.get(name);
  return raw === "" || raw === null ? undefined : String(raw);
}

function numberValue(data, name) {
  const raw = value(data, name);
  return raw === undefined ? 0 : Number(raw);
}

function row(kind, id, children) {
  const node = document.createElement("div");
  node.dataset[`${kind}Row`] = id;
  node.append(...children);
  return node;
}

function input(name, value, type = "text") {
  const element = document.createElement("input");
  element.name = name;
  element.type = type;
  element.value = value === undefined ? "" : String(value);
  return element;
}

function textarea(name, value) {
  const element = document.createElement("textarea");
  element.name = name;
  element.value = value ?? "";
  return element;
}

function checkbox(name, checked) {
  const element = document.createElement("input");
  element.name = name;
  element.type = "checkbox";
  element.checked = Boolean(checked);
  return element;
}

function removeButton(message) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "删除";
  button.addEventListener("click", () => {
    if (window.confirm(message)) {
      button.closest("div").remove();
    }
  });
  return button;
}

function readRows(selector, mapper) {
  return [...document.querySelectorAll(selector)].map(mapper);
}

function readSourceRow(row) {
  return {
    id: row.querySelector("[name=id]").value,
    name: row.querySelector("[name=name]").value,
    type: "newsnow",
    sourceId: row.querySelector("[name=sourceId]").value,
    weight: Number(row.querySelector("[name=weight]").value),
    enabled: row.querySelector("[name=enabled]").checked
  };
}

function readProfileRow(row) {
  return {
    id: row.querySelector("[name=id]").value,
    name: row.querySelector("[name=name]").value,
    focus: row.querySelector("[name=focus]").value.split(",").map((item) => item.trim()).filter(Boolean),
    instruction: row.querySelector("[name=instruction]").value,
    default: row.querySelector("[name=default]").checked
  };
}

document.querySelector("[data-settings-form]")?.addEventListener("submit", (event) => void saveSettings(event));
void loadSettings();

export { loadSettings, readSettingsForm, renderProfiles, renderSources, saveSettings };
