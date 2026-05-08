import { homedir } from "node:os";
import { join } from "node:path";

export interface ResolveAppPathsOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export interface AppPaths {
  configDir: string;
  dataDir: string;
  cacheDir: string;
  stateDir: string;
  configFile: string;
  sourcesFile: string;
  analysisProfilesFile: string;
  artifactsDir: string;
  sessionsDir: string;
  sessionIndexFile: string;
  markdownCacheDir: string;
  titleGenerationCacheDir: string;
  streamRendersCacheDir: string;
  gatewayStateFile: string;
  logsDir: string;
}

export function resolveAppPaths(options: ResolveAppPathsOptions = {}): AppPaths {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const configDir = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "hot-board-monitor");
  const dataDir = join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "hot-board-monitor");
  const cacheDir = join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "hot-board-monitor");
  const stateDir = join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "hot-board-monitor");
  const sessionsDir = join(dataDir, "sessions");

  return {
    configDir,
    dataDir,
    cacheDir,
    stateDir,
    configFile: join(configDir, "config.toml"),
    sourcesFile: join(configDir, "sources.json"),
    analysisProfilesFile: join(configDir, "analysis-profiles.json"),
    artifactsDir: join(dataDir, "artifacts"),
    sessionsDir,
    sessionIndexFile: join(sessionsDir, "index.json"),
    markdownCacheDir: join(cacheDir, "markdown"),
    titleGenerationCacheDir: join(cacheDir, "title-generation"),
    streamRendersCacheDir: join(cacheDir, "stream-renders"),
    gatewayStateFile: join(stateDir, "gateway.json"),
    logsDir: join(stateDir, "logs")
  };
}
