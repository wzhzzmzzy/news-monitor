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
          {field("llm.baseUrl", props.config.llm.baseUrl)}
          {field("llm.apiKey", props.config.llm.apiKey, "password")}
          {field("llm.model", props.config.llm.model)}
          {select("llm.thinking", props.config.llm.thinking, ["minimal", "low", "medium", "high"])}
          {field("llm.timeoutMs", props.config.llm.timeoutMs, "number")}
          {field("llm.maxToolIterations", props.config.llm.maxToolIterations, "number")}
          {field("flash.baseUrl", props.config.flash.baseUrl)}
          {field("flash.apiKey", props.config.flash.apiKey, "password")}
          {field("flash.model", props.config.flash.model)}
          {select("flash.thinking", props.config.flash.thinking, ["minimal", "low", "medium", "high"])}
          {field("flash.timeoutMs", props.config.flash.timeoutMs, "number")}
          {field("newsnow.baseUrl", props.config.newsnow.baseUrl)}
          {field("newsnow.timeoutMs", props.config.newsnow.timeoutMs, "number")}
          {field("newsnow.maxItemsPerSource", props.config.newsnow.maxItemsPerSource, "number")}
          {select("theme.mode", props.config.theme.mode, ["light", "dark"])}
          {select("theme.lightVariant", props.config.theme.lightVariant, ["latte", "frappe", "macchiato", "mocha"])}
          {select("theme.darkVariant", props.config.theme.darkVariant, ["latte", "frappe", "macchiato", "mocha"])}
          {field("gateway.host", props.config.gateway.host)}
          {field("gateway.port", props.config.gateway.port, "number")}
          <label><input type="checkbox" name="gateway.openBrowserOnStart" checked={props.config.gateway.openBrowserOnStart} /> openBrowserOnStart</label>
          <section data-sources-editor>{props.sources.map((source) => <div data-source-id={source.id}>{source.name}</div>)}</section>
          <section data-profiles-editor>{props.analysisProfiles.map((profile) => <div data-profile-id={profile.id}>{profile.name}</div>)}</section>
          <button type="submit">保存</button>
        </form>
      </main>
    </HtmlDocument>
  );
}

function field(name: string, value: unknown, type = "text") {
  return <label>{name}<input name={name} type={type} value={value === undefined ? "" : String(value)} /></label>;
}

function select(name: string, value: unknown, options: string[]) {
  return (
    <label>{name}
      <select name={name}>
        {options.map((option) => <option value={option} selected={option === value}>{option}</option>)}
      </select>
    </label>
  );
}
