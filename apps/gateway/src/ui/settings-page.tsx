import type { AnalysisProfile, NewsSourceConfig, RuntimeConfig } from "../../../../packages/config/src/index.js";
import { IconArrowLeft } from "./icons.js";
import { HtmlDocument } from "./layout.js";

export function SettingsPage(props: {
  config: RuntimeConfig;
  sources: NewsSourceConfig[];
  analysisProfiles: AnalysisProfile[];
}) {
  const variant = props.config.theme.mode === "dark" ? props.config.theme.darkVariant : props.config.theme.lightVariant;
  return (
    <HtmlDocument title="Hot Board Settings" variant={variant} mode={props.config.theme.mode} script="/assets/settings.js">
      <main class="settings-shell" data-page="settings">
        <a href="/chat" class="icon-button back-link" title="返回聊天"><IconArrowLeft /></a>
        <form class="settings-form" data-settings-form>
          <div data-settings-error></div>
          <div data-settings-success></div>
          {field("主模型地址", "llm.baseUrl", props.config.llm.baseUrl)}
          {field("主模型 API Key", "llm.apiKey", props.config.llm.apiKey, "password")}
          {field("主模型名称", "llm.model", props.config.llm.model, "text", true)}
          {select("主模型推理强度", "llm.thinking", props.config.llm.thinking, ["minimal", "low", "medium", "high"])}
          {field("主模型超时", "llm.timeoutMs", props.config.llm.timeoutMs, "number", true)}
          {field("工具调用上限", "llm.maxToolIterations", props.config.llm.maxToolIterations, "number", true)}
          {field("Flash 地址", "flash.baseUrl", props.config.flash.baseUrl)}
          {field("Flash API Key", "flash.apiKey", props.config.flash.apiKey, "password")}
          {field("Flash 模型", "flash.model", props.config.flash.model)}
          {select("Flash 推理强度", "flash.thinking", props.config.flash.thinking, ["minimal", "low", "medium", "high"])}
          {field("Flash 超时", "flash.timeoutMs", props.config.flash.timeoutMs, "number", true)}
          {field("NewsNow 地址", "newsnow.baseUrl", props.config.newsnow.baseUrl)}
          {field("NewsNow 超时", "newsnow.timeoutMs", props.config.newsnow.timeoutMs, "number", true)}
          {field("单信源条数上限", "newsnow.maxItemsPerSource", props.config.newsnow.maxItemsPerSource, "number", true)}
          {select("主题模式", "theme.mode", props.config.theme.mode, ["light", "dark"])}
          {select("浅色主题", "theme.lightVariant", props.config.theme.lightVariant, ["latte", "frappe", "macchiato", "mocha"])}
          {select("深色主题", "theme.darkVariant", props.config.theme.darkVariant, ["latte", "frappe", "macchiato", "mocha"])}
          {field("Gateway Host", "gateway.host", props.config.gateway.host, "text", true)}
          {field("Gateway Port", "gateway.port", props.config.gateway.port, "number", true)}
          <label><input type="checkbox" name="gateway.openBrowserOnStart" checked={props.config.gateway.openBrowserOnStart} /> 启动时打开浏览器</label>
          <section>
            <header><h2>信源</h2><button type="button" data-add-source>新增信源</button></header>
            <div data-sources-editor>{props.sources.map((source) => <div data-source-id={source.id}>{source.name}</div>)}</div>
          </section>
          <section>
            <header><h2>分析配置</h2><button type="button" data-add-profile>新增配置</button></header>
            <div data-profiles-editor>{props.analysisProfiles.map((profile) => <div data-profile-id={profile.id}>{profile.name}</div>)}</div>
          </section>
          <button type="submit">保存</button>
        </form>
      </main>
    </HtmlDocument>
  );
}

function field(label: string, name: string, value: unknown, type = "text", required = false) {
  return <label>{label}<input name={name} type={type} value={value === undefined ? "" : String(value)} required={required} /></label>;
}

function select(label: string, name: string, value: unknown, options: string[]) {
  return (
    <label>{label}
      <select name={name}>
        {options.map((option) => <option value={option} selected={option === value}>{option}</option>)}
      </select>
    </label>
  );
}
