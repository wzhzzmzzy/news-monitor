import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import {
  getGatewayStatus,
  restartGateway,
  startGateway,
  stopGateway,
  type GatewayProcessOps
} from "./gateway-process.js";

const roots: string[] = [];

async function tempPaths() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-gateway-cli-"));
  roots.push(root);
  return resolveAppPaths({
    homeDir: join(root, "home"),
    env: {
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_STATE_HOME: join(root, "state")
    }
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fakeOps(alivePids: Set<number>, spawnedPids: number[] = [], firstPid = 4200): GatewayProcessOps {
  return {
    spawnDetached: async () => {
      const pid = firstPid + spawnedPids.length;
      spawnedPids.push(pid);
      alivePids.add(pid);
      return { pid };
    },
    isProcessAlive: async (pid) => alivePids.has(pid),
    terminateProcess: async (pid) => {
      alivePids.delete(pid);
    },
    now: () => new Date("2026-05-07T12:00:00.000Z")
  };
}

describe("gateway process lifecycle", () => {
  it("reports stopped when state file is missing", async () => {
    const paths = await tempPaths();

    await expect(getGatewayStatus({ paths, ops: fakeOps(new Set()) })).resolves.toEqual({
      state: "stopped"
    });
  });

  it("starts gateway and records pid, host, port, and startedAt", async () => {
    const paths = await tempPaths();
    const spawnedPids: number[] = [];
    const status = await startGateway({
      paths,
      config: { host: "127.0.0.1", port: 14577 },
      ops: fakeOps(new Set(), spawnedPids)
    });

    expect(status).toMatchObject({ state: "running", pid: 4200, host: "127.0.0.1", port: 14577 });
    expect(spawnedPids).toEqual([4200]);
    expect(JSON.parse(await readFile(paths.gatewayStateFile, "utf8"))).toMatchObject({
      pid: 4200,
      host: "127.0.0.1",
      port: 14577,
      startedAt: "2026-05-07T12:00:00.000Z"
    });
  });

  it("reports stale when state pid is not alive", async () => {
    const paths = await tempPaths();
    await mkdir(dirname(paths.gatewayStateFile), { recursive: true });
    await writeFile(paths.gatewayStateFile, JSON.stringify({ pid: 99, host: "127.0.0.1", port: 14577, startedAt: "old" }));

    await expect(getGatewayStatus({ paths, ops: fakeOps(new Set()) })).resolves.toMatchObject({
      state: "stale",
      pid: 99
    });
  });

  it("stops a running gateway", async () => {
    const paths = await tempPaths();
    const alive = new Set([4200]);
    await mkdir(dirname(paths.gatewayStateFile), { recursive: true });
    await writeFile(paths.gatewayStateFile, JSON.stringify({ pid: 4200, host: "127.0.0.1", port: 14577, startedAt: "old" }));

    const status = await stopGateway({ paths, ops: fakeOps(alive) });

    expect(status).toEqual({ state: "stopped" });
    expect(alive.has(4200)).toBe(false);
  });

  it("restarts by stopping then starting", async () => {
    const paths = await tempPaths();
    const alive = new Set([4200]);
    const spawnedPids: number[] = [];
    await mkdir(dirname(paths.gatewayStateFile), { recursive: true });
    await writeFile(paths.gatewayStateFile, JSON.stringify({ pid: 4200, host: "127.0.0.1", port: 14577, startedAt: "old" }));

    const status = await restartGateway({
      paths,
      config: { host: "127.0.0.1", port: 14577 },
      ops: fakeOps(alive, spawnedPids, 4300)
    });

    expect(status).toMatchObject({ state: "running", pid: 4300 });
    expect(spawnedPids).toEqual([4300]);
  });
});
