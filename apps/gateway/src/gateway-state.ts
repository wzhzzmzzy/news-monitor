import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppPaths } from "../../../packages/app-paths/src/index.js";

export interface GatewayStateInput {
  paths: AppPaths;
  pid: number;
  host: string;
  port: number;
  startedAt: string;
}

export async function writeGatewayState(input: GatewayStateInput): Promise<void> {
  await mkdir(dirname(input.paths.gatewayStateFile), { recursive: true });
  await writeFile(input.paths.gatewayStateFile, `${JSON.stringify({
    pid: input.pid,
    host: input.host,
    port: input.port,
    startedAt: input.startedAt
  }, null, 2)}\n`);
}
