import { serve } from "@hono/node-server";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import { loadAppConfig } from "../../../packages/config/src/index.js";
import { createGatewayApp } from "./app.js";

const paths = resolveAppPaths();
const config = await loadAppConfig({ configFile: paths.configFile });
const app = await createGatewayApp({ paths });

serve({ fetch: app.fetch, hostname: config.gateway.host, port: config.gateway.port });
await mkdir(dirname(paths.gatewayStateFile), { recursive: true });
await writeFile(paths.gatewayStateFile, `${JSON.stringify({
  pid: process.pid,
  host: config.gateway.host,
  port: config.gateway.port,
  startedAt: new Date().toISOString()
}, null, 2)}\n`);

console.log(`Hot Board gateway listening on http://${config.gateway.host}:${config.gateway.port}`);
