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
  settings.config.llm.timeoutMs = optionalNumberValue(data, "llm.timeoutMs");
  settings.config.llm.maxToolIterations = optionalNumberValue(data, "llm.maxToolIterations");
  settings.config.flash.baseUrl = value(data, "flash.baseUrl");
  settings.config.flash.apiKey = value(data, "flash.apiKey");
  settings.config.flash.model = value(data, "flash.model");
  settings.config.flash.thinking = value(data, "flash.thinking");
  settings.config.flash.timeoutMs = optionalNumberValue(data, "flash.timeoutMs");
  settings.config.newsnow.baseUrl = value(data, "newsnow.baseUrl");
  settings.config.newsnow.timeoutMs = optionalNumberValue(data, "newsnow.timeoutMs");
  settings.config.newsnow.maxItemsPerSource = optionalNumberValue(data, "newsnow.maxItemsPerSource");
  settings.config.theme.mode = value(data, "theme.mode");
  settings.config.theme.lightVariant = value(data, "theme.lightVariant");
  settings.config.theme.darkVariant = value(data, "theme.darkVariant");
  settings.config.gateway.host = value(data, "gateway.host");
  settings.config.gateway.port = optionalNumberValue(data, "gateway.port");
  settings.config.gateway.openBrowserOnStart = data.get("gateway.openBrowserOnStart") === "on";
  settings.sources = readRows("[data-source-row]", readSourceRow);
  settings.analysisProfiles = readRows("[data-profile-row]", readProfileRow);
  return settings;
}

function renderSources(sources) {
  const root = document.querySelector("[data-sources-editor]");
  root.replaceChildren(...sources.map((source) => row("source", source.id, [
    labeled("ID", input("id", source.id)),
    labeled("名称", input("name", source.name)),
    labeled("NewsNow ID", input("sourceId", source.sourceId)),
    labeled("权重", input("weight", source.weight, "number")),
    labeled("启用", checkbox("enabled", source.enabled)),
    removeButton("删除这个信源？")
  ])));
}

function renderProfiles(profiles) {
  const root = document.querySelector("[data-profiles-editor]");
  root.replaceChildren(...profiles.map((profile) => row("profile", profile.id, [
    labeled("ID", input("id", profile.id)),
    labeled("名称", input("name", profile.name)),
    labeled("关注点", input("focus", profile.focus.join(", "))),
    labeled("指令", textarea("instruction", profile.instruction)),
    labeled("默认", checkbox("default", profile.default)),
    removeButton("删除这个分析配置？")
  ])));
}

async function saveSettings(event) {
  event.preventDefault();
  const error = document.querySelector("[data-settings-error]");
  const success = document.querySelector("[data-settings-success]");
  error.textContent = "";
  success.textContent = "";
  clearFieldErrors();
  try {
    const next = readSettingsForm();
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next)
    });
    if (!response.ok) {
      const payload = await response.json();
      if (payload.fields) {
        showFieldErrors(payload.fields);
        throw new Error("请检查高亮字段");
      }
      throw new Error(payload.error ?? `保存失败：${response.status}`);
    }
    state.settings = await response.json();
    success.textContent = "设置已保存";
  } catch (saveError) {
    error.textContent = saveError.message;
  }
}

function value(data, name) {
  const raw = data.get(name);
  return raw === "" || raw === null ? undefined : String(raw);
}

function optionalNumberValue(data, name) {
  const raw = value(data, name);
  return raw === undefined ? undefined : Number(raw);
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

function labeled(labelText, control) {
  const label = document.createElement("label");
  label.append(labelText, control);
  return label;
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
document.querySelector("[data-add-source]")?.addEventListener("click", () => {
  const root = document.querySelector("[data-sources-editor]");
  const index = root.querySelectorAll("[data-source-row]").length + 1;
  root.append(row("source", `source-${index}`, [
    labeled("ID", input("id", `source-${index}`)),
    labeled("名称", input("name", "新信源")),
    labeled("NewsNow ID", input("sourceId", `source-${index}`)),
    labeled("权重", input("weight", 1, "number")),
    labeled("启用", checkbox("enabled", true)),
    removeButton("删除这个信源？")
  ]));
});
document.querySelector("[data-add-profile]")?.addEventListener("click", () => {
  const root = document.querySelector("[data-profiles-editor]");
  const index = root.querySelectorAll("[data-profile-row]").length + 1;
  root.append(row("profile", `profile-${index}`, [
    labeled("ID", input("id", `profile-${index}`)),
    labeled("名称", input("name", "新分析配置")),
    labeled("关注点", input("focus", "")),
    labeled("指令", textarea("instruction", "")),
    labeled("默认", checkbox("default", false)),
    removeButton("删除这个分析配置？")
  ]));
});
void loadSettings();

function clearFieldErrors() {
  for (const control of document.querySelectorAll("[name]")) {
    control.setCustomValidity?.("");
  }
}

function showFieldErrors(fields) {
  let firstInvalid;
  for (const [name, message] of Object.entries(fields)) {
    const control = document.querySelector(`[name="${name}"]`);
    control?.setCustomValidity?.(message);
    firstInvalid ??= control;
  }
  firstInvalid?.reportValidity?.();
  firstInvalid?.focus?.();
}

export { loadSettings, readSettingsForm, renderProfiles, renderSources, saveSettings };
