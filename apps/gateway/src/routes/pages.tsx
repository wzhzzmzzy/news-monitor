import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import type { AppPaths } from "../../../../packages/app-paths/src/index.js";
import { getSettings } from "../settings/settings-service.js";
import { ChatPage } from "../ui/chat-page.js";
import { SettingsPage } from "../ui/settings-page.js";

export function createPageRoutes(deps: { paths: AppPaths }) {
  const app = new Hono();
  app.get("/", (c) => c.redirect("/chat"));
  app.get("/chat", async (c) => {
    const settings = await getSettings(deps.paths);
    return c.html(`<!doctype html>${renderToString(<ChatPage config={settings.config} />)}`);
  });
  app.get("/settings", async (c) => {
    const settings = await getSettings(deps.paths);
    return c.html(`<!doctype html>${renderToString(
      <SettingsPage
        config={settings.config}
        sources={settings.sources}
        analysisProfiles={settings.analysisProfiles}
      />
    )}`);
  });
  return app;
}
