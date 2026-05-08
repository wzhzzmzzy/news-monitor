import { serve } from "@hono/node-server";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import { loadAppConfig } from "../../../packages/config/src/index.js";
import { createGatewayApp } from "./app.js";
import { writeGatewayState } from "./gateway-state.js";

const paths = resolveAppPaths();
const config = await loadAppConfig({ configFile: paths.configFile });
const app = await createGatewayApp({ paths });

serve({ fetch: app.fetch, hostname: config.gateway.host, port: config.gateway.port });
await writeGatewayState({
  paths,
  pid: process.pid,
  host: config.gateway.host,
  port: config.gateway.port,
  startedAt: new Date().toISOString()
});

console.log(`Hot Board gateway listening on http://${config.gateway.host}:${config.gateway.port}`);
