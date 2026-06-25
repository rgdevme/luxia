import fs from "node:fs/promises";
import path from "node:path";
import type { AgnosConfig, CommandSpec, Domain, ResolveContext } from "../../core/index.js";
import {
  buildPaths,
  prepareSkills,
  readConfigOrDefault,
  skillNameSchema,
  skillRefSchema,
  writeConfig,
} from "../../core/index.js";
import { MIGRATE_FLAGS, policyFromFlags, reqArg, writeChange } from "../cli-helpers.js";
import { runSkillPipeline } from "./pipeline.js";
import { mergeSkillSources } from "./migrate.js";
import { createSkillSteps, updateSkills } from "./steps.js";

export * from "./pipeline.js";
export * from "./migrate.js";

const DEFAULT_SKILLS_DIR = "./.agnos/skills";

/** Run a single read-only step over every declared skill and report failures. */
async function diagnose(
  which: "fetch" | "version" | "integrity",
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const sources = config.skills?.sources ?? {};
  if (Object.keys(sources).length === 0) {
    ctx.logger.info("no skills declared");
    return;
  }
  const { steps } = await createSkillSteps(config, ctx);
  const bad: string[] = [];
  for (const [name, composite] of Object.entries(sources)) {
    const f = await steps.fetch(name, composite);
    if (!f.ok || !f.src) {
      if (which === "fetch") bad.push(name);
      continue;
    }
    if (which === "version" && !(await steps.version(name, f.src))) bad.push(name);
    else if (which === "integrity" && !(await steps.integrity(name, f.src))) bad.push(name);
  }
  const label = which === "fetch" ? "moved" : which === "version" ? "outdated" : "changed";
  if (bad.length > 0) ctx.logger.warn(`${which}: ${bad.length} ${label} (${bad.join(", ")})`);
  else ctx.logger.success(`${which}: all skills OK`);
}

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
  fetch: {
    name: "fetch",
    description: "Check that every skill source still resolves (reports moved)",
    async run(ctx) {
      await diagnose("fetch", await readConfigOrDefault(ctx.configPath), ctx);
    },
  },
  version: {
    name: "version",
    description: "Check whether skills are on their pinned commit (reports outdated)",
    async run(ctx) {
      await diagnose("version", await readConfigOrDefault(ctx.configPath), ctx);
    },
  },
  integrity: {
    name: "integrity",
    description: "Verify skill content matches the lock (reports changed)",
    async run(ctx) {
      await diagnose("integrity", await readConfigOrDefault(ctx.configPath), ctx);
    },
  },
  install: {
    name: "install",
    description: "Run the prep pipeline (fetch → version → integrity → install)",
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const sources = config.skills?.sources ?? {};
      if (Object.keys(sources).length === 0) {
        ctx.logger.info("no skills declared");
        return;
      }
      const handle = await createSkillSteps(config, ctx);
      const res = await runSkillPipeline(sources, handle.steps, ctx.logger);
      await handle.flush();
      if (res.installed.length > 0)
        ctx.logger.success(`installed ${res.installed.length} skill(s)`);
    },
  },
  update: {
    name: "update",
    description: "Re-pin + reinstall skills, accepting upstream changes",
    args: [
      { name: "names", required: false, variadic: true, description: "skills (default: all)" },
    ],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const updated = await updateSkills(ctx.args, config, ctx);
      ctx.logger.success(`updated ${updated.length} skill(s)${ctx.dryRun ? " (dry)" : ""}`);
    },
  },
  migrate: {
    name: "migrate",
    description: "Import skill sources from a lock file (name → ref JSON)",
    args: [{ name: "file", required: false, description: "lock file (default skills-lock.json)" }],
    flags: MIGRATE_FLAGS,
    async run(ctx) {
      const file = ctx.args[0] ?? "skills-lock.json";
      let raw: string;
      try {
        raw = await fs.readFile(path.resolve(ctx.projectRoot, file), "utf8");
      } catch {
        throw new Error(`cannot read ${file}`);
      }
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`${file} is not valid JSON`);
      }
      const map =
        data && typeof data === "object" && "skills" in data
          ? (data as { skills: unknown }).skills
          : data;
      const discovered: Record<string, string> = {};
      for (const [name, ref] of Object.entries((map ?? {}) as Record<string, unknown>)) {
        if (typeof ref !== "string") continue;
        if (!skillNameSchema.safeParse(name).success || !skillRefSchema.safeParse(ref).success) {
          ctx.logger.warn(`skipping invalid skill "${name}"`);
          continue;
        }
        discovered[name] = ref;
      }
      const config = await readConfigOrDefault(ctx.configPath);
      const res = mergeSkillSources(config.skills?.sources ?? {}, discovered, policyFromFlags(ctx));
      if (res.aborted) {
        throw new Error(
          `skills migrate aborted: ${res.conflicts.length} conflict(s). Re-run with --force or --missing.`,
        );
      }
      await writeChange(
        ctx,
        `skills migrate: +${res.added.length} added, ${res.overwritten.length} overwritten`,
        { ...config, skills: { ...config.skills, sources: res.sources } },
      );
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
