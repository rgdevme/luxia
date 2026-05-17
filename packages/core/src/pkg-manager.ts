import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Logger } from "./types/public.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8")) as {
      packageManager?: string;
    };
    const pm = pkg.packageManager?.split("@")[0];
    if (pm === "pnpm" || pm === "yarn" || pm === "bun" || pm === "npm") return pm;
  } catch {
    // fall through
  }
  for (const [file, pm] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ] as const) {
    try {
      await fs.access(path.join(cwd, file));
      return pm;
    } catch {
      // continue
    }
  }
  return "npm";
}

export async function hasPackageJson(cwd: string): Promise<boolean> {
  try {
    await fs.access(path.join(cwd, "package.json"));
    return true;
  } catch {
    return false;
  }
}

export async function createMinimalPackageJson(cwd: string): Promise<void> {
  const name =
    path
      .basename(cwd)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-") || "project";
  const pkg = {
    name,
    version: "0.0.0",
    private: true,
    type: "module",
  };
  await fs.writeFile(path.join(cwd, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

export function addCommand(pm: PackageManager, packages: string[], dev: boolean): string[] {
  const devFlag = dev ? (pm === "yarn" ? ["--dev"] : ["-D"]) : [];
  switch (pm) {
    case "pnpm":
      return ["add", ...devFlag, ...packages];
    case "yarn":
      return ["add", ...devFlag, ...packages];
    case "bun":
      return ["add", ...devFlag, ...packages];
    case "npm":
      return ["install", ...(dev ? ["--save-dev"] : []), ...packages];
  }
}

export function runPackageManager(
  pm: PackageManager,
  args: string[],
  cwd: string,
  logger: Logger,
): Promise<void> {
  logger.info(`${pm} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const proc = spawn(pm, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${pm} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
