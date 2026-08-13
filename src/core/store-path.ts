import os from "node:os";
import path from "node:path";

export interface GlobalStorePathOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export function resolveGlobalStoreDir(options: GlobalStorePathOptions = {}): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const paths = platform === "win32" ? path.win32 : path.posix;
  const override = env["AGNOS_STORE_DIR"];
  const baseDir = override
    ? paths.resolve(override)
    : resolveDefaultStoreBase(env, homeDir, platform, paths);
  return paths.join(baseDir, "v1");
}

function resolveDefaultStoreBase(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform,
  paths: path.PlatformPath,
): string {
  if (platform === "win32") {
    return paths.join(
      env["LOCALAPPDATA"] ?? paths.join(homeDir, "AppData", "Local"),
      "agnos",
      "store",
    );
  }
  if (platform === "darwin") return paths.join(homeDir, "Library", "agnos", "store");
  return paths.join(
    env["XDG_DATA_HOME"] ?? paths.join(homeDir, ".local", "share"),
    "agnos",
    "store",
  );
}
