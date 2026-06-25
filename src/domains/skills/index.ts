import fs from "node:fs/promises";
import type { AgnosConfig, CommandSpec, Domain } from "../../core/index.js";
import {
  buildPaths,
  prepareSkills,
  readConfigOrDefault,
  skillNameSchema,
  skillRefSchema,
  writeConfig,
} from "../../core/index.js";
import { reqArg, writeChange } from "../cli-helpers.js";

export * from "./pipeline.js";
export * from "./migrate.js";

const DEFAULT_SKILLS_DIR = "./.agnos/skills";

const commands: Record<string, CommandSpec> = {
  add: {
    name: "add",
    description: "Add a skill source (name → composite ref)",
    args: [
      { name: "name", required: true, description: "local skill name" },
      { name: "ref", required: true, description: "e.g. github:owner/repo/skills/pdf" },
    ],
    async run(ctx) {
      const name = skillNameSchema.parse(reqArg(ctx, 0, "name"));
      const ref = skillRefSchema.parse(reqArg(ctx, 1, "ref"));
      const config = await readConfigOrDefault(ctx.configPath);
      const sources = { ...(config.skills?.sources ?? {}) };
      if (name in sources) throw new Error(`skill "${name}" already exists`);
      sources[name] = ref;
      await writeChange(ctx, `added skill "${name}"`, {
        ...config,
        skills: { ...config.skills, sources },
      });
    },
  },
  remove: {
    name: "remove",
    description: "Remove a skill source by name",
    args: [{ name: "name", required: true, description: "local skill name" }],
    async run(ctx) {
      const name = reqArg(ctx, 0, "name");
      const config = await readConfigOrDefault(ctx.configPath);
      const all = config.skills?.sources ?? {};
      if (!(name in all)) throw new Error(`skill "${name}" not found`);
      const { [name]: _removed, ...sources } = all;
      await writeChange(ctx, `removed skill "${name}"`, {
        ...config,
        skills: { ...config.skills, sources },
      });
    },
  },
};

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
  commands,
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
    // No skill sources declared → nothing to fetch/verify.
    if (Object.keys(config.skills?.sources ?? {}).length === 0) return undefined;
    await prepareSkills(config, ctx);
    return undefined;
  },
};

export default skillsDomain;
