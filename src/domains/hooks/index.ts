import { input } from "@inquirer/prompts";
import type {
  AgnosConfig,
  CliCommand,
  DomainPlugin,
  HookHandler,
  HookMatcherGroup,
  HooksDeclaration,
  ResolveContext,
} from "../../core/index.js";
import { hooksConfigSchema, readConfigOrDefault, writeConfig } from "../../core/index.js";
import type { z } from "zod";

/**
 * Stable JSON stringify (recursively sorted keys) so two structurally-equal
 * matcher groups compare equal regardless of key ordering produced by
 * different agents' native files.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function groupsEqual(a: HookMatcherGroup, b: HookMatcherGroup): boolean {
  return stableStringify(a) === stableStringify(b);
}

async function readHooks(ctx: ResolveContext): Promise<HooksDeclaration> {
  const config = await readConfigOrDefault(ctx.configPath);
  return config.hooks ?? {};
}

const listCmd: CliCommand = {
  description: "List the hooks declared in agnos.json.",
  async run(_args, ctx) {
    const hooks = await readHooks(ctx);
    const events = Object.keys(hooks);
    if (events.length === 0) {
      ctx.logger.info("no hooks declared");
      return;
    }
    for (const event of events) {
      const groups = hooks[event] ?? [];
      ctx.logger.info(`${event} (${groups.length} group${groups.length === 1 ? "" : "s"})`);
      for (const group of groups) {
        const matcher = group.matcher ? `matcher=${group.matcher}` : "matcher=*";
        const handlers = group.hooks
          .map((h) => h.type + (typeof h["command"] === "string" ? `:${h["command"]}` : ""))
          .join(", ");
        ctx.logger.info(`  ${matcher} -> [${handlers}]`);
      }
    }
  },
};

const addCmd: CliCommand = {
  description: "Add a command hook interactively.",
  async run(_args, ctx) {
    const event = await input({
      message: "Hook event (e.g. PreToolUse, PostToolUse, SessionStart):",
      default: "PreToolUse",
      validate: (v) => (v.trim().length > 0 ? true : "event is required"),
    });
    const matcher = await input({
      message: "Matcher (tool/source pattern; blank = match all):",
    });
    const command = await input({
      message: "Command to run:",
      validate: (v) => (v.trim().length > 0 ? true : "command is required"),
    });
    const timeoutRaw = await input({ message: "Timeout in seconds (blank = agent default):" });

    const handler: HookHandler = { type: "command", command: command.trim() };
    if (timeoutRaw.trim()) {
      const t = Number(timeoutRaw.trim());
      if (Number.isFinite(t) && t > 0) handler["timeout"] = t;
    }
    const group: HookMatcherGroup = { hooks: [handler] };
    if (matcher.trim()) group.matcher = matcher.trim();

    if (ctx.dryRun) {
      ctx.logger.info(`would: add ${event} hook`);
      return;
    }
    const config = await readConfigOrDefault(ctx.configPath);
    const hooks = config.hooks ?? {};
    hooks[event.trim()] = [...(hooks[event.trim()] ?? []), group];
    config.hooks = hooks;
    await writeConfig(ctx.configPath, config);
    ctx.logger.success(`added ${event.trim()} hook`);
    ctx.logger.info("run `agnos install` to materialize it into each agent.");
  },
};

const removeCmd: CliCommand = {
  description: "Remove all hooks for an event: agnos hooks remove <event>",
  async run(args, ctx) {
    const event = args.positional[0];
    if (!event) throw new Error("usage: agnos hooks remove <event>");
    if (ctx.dryRun) {
      ctx.logger.info(`would: remove ${event} hooks`);
      return;
    }
    const config = await readConfigOrDefault(ctx.configPath);
    if (!config.hooks || !(event in config.hooks)) {
      ctx.logger.warn(`no hooks declared for event "${event}"`);
      return;
    }
    const remaining: HooksDeclaration = {};
    for (const [name, groups] of Object.entries(config.hooks)) {
      if (name !== event) remaining[name] = groups;
    }
    if (Object.keys(remaining).length === 0) {
      delete config.hooks;
    } else {
      config.hooks = remaining;
    }
    await writeConfig(ctx.configPath, config);
    ctx.logger.success(`removed ${event} hooks`);
    ctx.logger.info("run `agnos install` to update each agent.");
  },
};

const hooksPlugin: DomainPlugin<HooksDeclaration, HooksDeclaration> = {
  name: "hooks",
  // Between mcp (20) and skills (30): hooks may reference MCP tools by name.
  priority: 25,
  declarationSchema: hooksConfigSchema as unknown as z.ZodType<HooksDeclaration>,

  async resolve(decl) {
    return decl;
  },

  async list(ctx) {
    const hooks = await readHooks(ctx);
    return Object.keys(hooks).length > 0 ? [hooks] : [];
  },

  /**
   * Reverse-import merge. Each agent's `handles.hooks.onImport` returns a hooks
   * registry parsed from its native file; we additively merge it into
   * `config.hooks`, skipping any matcher group already present (structural
   * equality) so existing declarations are never blindly overwritten.
   */
  async importMerge(imported, config: AgnosConfig, _opts, ctx) {
    const parsed = hooksConfigSchema.safeParse(imported);
    if (!parsed.success) {
      ctx.logger.warn(`skipping invalid imported hooks: ${parsed.error.message}`);
      return false;
    }
    const incoming = parsed.data as HooksDeclaration;
    const current: HooksDeclaration = config.hooks ?? {};
    let added = 0;
    let kept = 0;

    for (const [event, groups] of Object.entries(incoming)) {
      const merged = [...(current[event] ?? [])];
      for (const group of groups) {
        if (merged.some((g) => groupsEqual(g, group))) {
          kept++;
          continue;
        }
        merged.push(group);
        added++;
      }
      current[event] = merged;
    }

    if (added === 0) {
      if (kept > 0) ctx.logger.info(`hooks.onImport (kept ${kept} existing)`);
      return false;
    }
    config.hooks = current;
    const parts = [`imported ${added}`];
    if (kept > 0) parts.push(`kept ${kept} existing`);
    ctx.logger.info(`hooks.onImport (${parts.join(", ")})`);
    return true;
  },

  cli: {
    default: listCmd,
    list: listCmd,
    add: addCmd,
    remove: removeCmd,
  },
};

export default hooksPlugin;
