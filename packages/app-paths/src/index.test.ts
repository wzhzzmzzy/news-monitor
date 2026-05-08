import { describe, expect, it } from "vitest";
import { resolveAppPaths } from "./index.js";

describe("resolveAppPaths", () => {
  it("uses XDG environment variables when provided", () => {
    const paths = resolveAppPaths({
      env: {
        XDG_CONFIG_HOME: "/xdg/config",
        XDG_DATA_HOME: "/xdg/data",
        XDG_CACHE_HOME: "/xdg/cache",
        XDG_STATE_HOME: "/xdg/state"
      },
      homeDir: "/home/test"
    });

    expect(paths.configDir).toBe("/xdg/config/hot-board-monitor");
    expect(paths.dataDir).toBe("/xdg/data/hot-board-monitor");
    expect(paths.cacheDir).toBe("/xdg/cache/hot-board-monitor");
    expect(paths.stateDir).toBe("/xdg/state/hot-board-monitor");
    expect(paths.configFile).toBe("/xdg/config/hot-board-monitor/config.toml");
    expect(paths.sessionsDir).toBe("/xdg/data/hot-board-monitor/sessions");
    expect(paths.gatewayStateFile).toBe("/xdg/state/hot-board-monitor/gateway.json");
  });

  it("falls back to home directory defaults", () => {
    const paths = resolveAppPaths({ env: {}, homeDir: "/Users/alice" });

    expect(paths.configDir).toBe("/Users/alice/.config/hot-board-monitor");
    expect(paths.dataDir).toBe("/Users/alice/.local/share/hot-board-monitor");
    expect(paths.cacheDir).toBe("/Users/alice/.cache/hot-board-monitor");
    expect(paths.stateDir).toBe("/Users/alice/.local/state/hot-board-monitor");
  });
});
