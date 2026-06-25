import fs from "node:fs/promises";
import type { AgnosConfig, Domain } from "../../core/index.js";
import { buildPaths, prepareSkills, readConfigOrDefault, writeConfig } from "../../core/index.js";

export * from "./pipeline.js";
export * from "./migrate.js";

const DEFAULT_SKILLS_DIR = "./.agnos/skills";

/**
 * The skills domain: a config writer that also prepares the canonical skill
 * bytes. `run` fetches + hash-verifies every declared skill into the canonical
 * `.agnos/skills/` (via `prepareSkills`); the agents domain links that dir
 * per-agent. The `migrate`/`fetch`/`version`/`integrity`/`install` subcommands
 * are wired in the CLI; their data layer lives in pipeline.ts / migrate.ts.
 */
export const skillsDomain: Domain = {
  id: "skills",
  description: "Fetch + verify skills into the canonical skills dir (linked per-agent by agents)",
  kind: "writer",
  priority: 10,
  initSteps: [
    {
      id: "route",
      type: "text",
      message: "Canonical skills directory (relative to project root):",
      default: DEFAULT_SKILLS_DIR,
      async callback(value, ctx) {
        const route = value.trim() || DEFAULT_SKILLS_DIR;
        const config = (await readConfigOrDefault(ctx.configPath)) as AgnosConfig;
        const skills = { ...(config.skills ?? {}) };
        if (route === DEFAULT_SKILLS_DIR) delete skills.route;
        else skills.route = route;
        const next: AgnosConfig = { ...config, skills };
        if (ctx.dryRun) {
          ctx.logger.info(`would: set skills.route = ${route}`);
          return;
        }
        await writeConfig(ctx.configPath, next);
        await fs.mkdir(buildPaths(ctx.projectRoot, next).skillsDir, { recursive: true });
      },
    },
  ],
  async run(_opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    await prepareSkills(config, ctx);
    return undefined;
  },
};

export default skillsDomain;
