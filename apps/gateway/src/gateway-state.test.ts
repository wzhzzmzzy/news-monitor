import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import { writeGatewayState } from "./gateway-state.js";

const roots: string[] = [];

async function tempPaths() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-gateway-state-"));
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

describe("writeGatewayState", () => {
  it("writes gateway state under XDG state", async () => {
    const paths = await tempPaths();
    await writeGatewayState({
      paths,
      pid: 1234,
      host: "127.0.0.1",
      port: 14577,
      startedAt: "2026-05-07T12:00:00.000Z"
    });

    expect(JSON.parse(await readFile(paths.gatewayStateFile, "utf8"))).toMatchObject({
      pid: 1234,
      host: "127.0.0.1",
      port: 14577,
      startedAt: "2026-05-07T12:00:00.000Z"
    });
  });
});
