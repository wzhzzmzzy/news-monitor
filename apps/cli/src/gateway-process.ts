import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import type { AppPaths } from "../../../packages/app-paths/src/index.js";
import { writeGatewayState } from "../../gateway/src/gateway-state.js";

export type GatewayStatus =
  | { state: "stopped" }
  | { state: "running"; pid: number; host: string; port: number; startedAt: string }
  | { state: "stale"; pid: number; host?: string; port?: number; startedAt?: string };

export interface GatewayProcessOps {
  spawnDetached(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ pid: number }>;
  isProcessAlive(pid: number): Promise<boolean>;
  terminateProcess(pid: number): Promise<void>;
  now(): Date;
}

export const nodeGatewayProcessOps: GatewayProcessOps = {
  async spawnDetached(command, args, env) {
    const child = spawn(command, args, { detached: true, stdio: "ignore", env });
    child.unref();
    if (!child.pid) {
      throw new Error("Gateway process did not provide a pid");
    }
    return { pid: child.pid };
  },
  async isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  async terminateProcess(pid) {
    process.kill(pid, "SIGTERM");
  },
  now: () => new Date()
};

export async function getGatewayStatus(input: { paths: AppPaths; ops?: GatewayProcessOps }): Promise<GatewayStatus> {
  const ops = input.ops ?? nodeGatewayProcessOps;
  let state: { pid: number; host?: string; port?: number; startedAt?: string };
  try {
    state = JSON.parse(await readFile(input.paths.gatewayStateFile, "utf8")) as typeof state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "stopped" };
    }
    throw error;
  }

  if (await ops.isProcessAlive(state.pid)) {
    return {
      state: "running",
      pid: state.pid,
      host: state.host ?? "127.0.0.1",
      port: state.port ?? 14577,
      startedAt: state.startedAt ?? ""
    };
  }
  return {
    state: "stale",
    pid: state.pid,
    host: state.host,
    port: state.port,
    startedAt: state.startedAt
  };
}

export async function startGateway(input: {
  paths: AppPaths;
  config: { host: string; port: number };
  ops?: GatewayProcessOps;
}): Promise<GatewayStatus> {
  const ops = input.ops ?? nodeGatewayProcessOps;
  const current = await getGatewayStatus({ paths: input.paths, ops });
  if (current.state === "running") {
    return current;
  }

  const child = await ops.spawnDetached("pnpm", ["run", "gateway"], {
    ...process.env,
    XDG_CONFIG_HOME: dirname(input.paths.configDir),
    XDG_DATA_HOME: dirname(input.paths.dataDir),
    XDG_CACHE_HOME: dirname(input.paths.cacheDir),
    XDG_STATE_HOME: dirname(input.paths.stateDir)
  });
  const startedAt = ops.now().toISOString();
  await writeGatewayState({
    paths: input.paths,
    pid: child.pid,
    host: input.config.host,
    port: input.config.port,
    startedAt
  });
  return { state: "running", pid: child.pid, host: input.config.host, port: input.config.port, startedAt };
}

export async function stopGateway(input: { paths: AppPaths; ops?: GatewayProcessOps }): Promise<GatewayStatus> {
  const ops = input.ops ?? nodeGatewayProcessOps;
  const current = await getGatewayStatus({ paths: input.paths, ops });
  if (current.state === "running") {
    await ops.terminateProcess(current.pid);
  }
  await rm(input.paths.gatewayStateFile, { force: true });
  return { state: "stopped" };
}

export async function restartGateway(input: {
  paths: AppPaths;
  config: { host: string; port: number };
  ops?: GatewayProcessOps;
}): Promise<GatewayStatus> {
  const ops = input.ops ?? nodeGatewayProcessOps;
  await stopGateway({ paths: input.paths, ops });
  return startGateway({ paths: input.paths, config: input.config, ops });
}
