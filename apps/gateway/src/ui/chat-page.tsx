import type { RuntimeConfig } from "../../../../packages/config/src/index.js";
import { HtmlDocument } from "./layout.js";
import {
  IconArrowUp,
  IconLayoutSidebarLeftCollapse,
  IconMoon,
  IconSettings
} from "./icons.js";

export function ChatPage(props: { config: RuntimeConfig }) {
  const variant = props.config.theme.mode === "dark" ? props.config.theme.darkVariant : props.config.theme.lightVariant;
  return (
    <HtmlDocument title="Hot Board Chat" variant={variant} mode={props.config.theme.mode} script="/assets/chat.js">
      <div class="hot-board-shell" data-page="chat">
        <aside class="sidebar" data-sidebar>
          <div class="brand">Hot Board</div>
          <button class="icon-button" data-sidebar-toggle title="收起侧栏" type="button">
            <IconLayoutSidebarLeftCollapse />
          </button>
          <button class="new-session-button" data-new-session type="button">新会话</button>
          <nav class="session-list" data-session-list></nav>
          <a class="settings-link icon-button" href="/settings" title="设置">
            <IconSettings />
          </a>
        </aside>
        <main class="main-panel">
          <header class="chat-topbar">
            <div>
              <h1 data-session-title>新会话</h1>
              <p data-session-subtitle>Agent chat</p>
            </div>
            <button class="icon-button" data-theme-toggle title="切换主题" type="button">
              <IconMoon />
            </button>
          </header>
          <section class="message-list" data-message-list></section>
          <form class="composer" data-composer>
            <textarea data-message-input rows={1}></textarea>
            <button class="send-button icon-button" type="submit" title="发送">
              <IconArrowUp />
            </button>
          </form>
        </main>
      </div>
    </HtmlDocument>
  );
}
