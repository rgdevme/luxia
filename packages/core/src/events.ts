import type {
  AgentPlugin,
  AgnosConfig,
  MaterializeContext,
  ResolveContext,
  ResolvedMcp,
  ResolvedRule,
  ResolvedSkill,
} from "./types/public.js";
import { resolveAgentByRef, type PluginRegistry } from "./plugin-loader.js";
import { buildAgentDomainStates } from "./orchestrator.js";
import { runHook } from "./hooks.js";

function materializeCtx(ctx: ResolveContext, agentId: string): MaterializeContext {
  return { ...ctx, agentId, indent: ctx.indent ?? "" };
}

/**
 * Returns the activated agent plugins in declaration order, skipping any that
 * aren't installed (with a warning).
 */
export function activeAgents(config: AgnosConfig, registry: PluginRegistry, ctx: ResolveContext): AgentPlugin[] {
  const out: AgentPlugin[] = [];
  for (const ref of config.agents ?? []) {
    const reg = resolveAgentByRef(registry, ref);
    if (!reg) {
      ctx.logger.warn(`agent "${ref}" declared but plugin not installed — skipping`);
      continue;
    }
    out.push(reg.plugin);
  }
  return out;
}

// ---------- per-domain dispatch helpers ----------
//
// Each dispatcher: tries the specific per-event handler first. If absent,
// falls back to `handles.<domain>.onInitialize(currentState, ctx)` so agents
// that regenerate from full state only need to write one handler.

type AnyHandlers = {
  onInitialize?: (state: unknown, ctx: MaterializeContext) => Promise<void>;
} & Record<string, ((...args: never[]) => Promise<void>) | undefined>;

function handlersFor(agent: AgentPlugin, domainName: string): AnyHandlers | undefined {
  if (!agent.handles) return undefined;
  return (agent.handles as unknown as Record<string, AnyHandlers | undefined>)[domainName];
}

async function fallbackToInit(
  agent: AgentPlugin,
  handlers: AnyHandlers,
  domainName: string,
  config: AgnosConfig,
  ctx: ResolveContext,
  fallbackState: { value?: Record<string, unknown> },
): Promise<void> {
  if (!handlers.onInitialize) return;
  if (ctx.dryRun) {
    ctx.logger.info(`would: ${agent.id}.${domainName}.onInitialize (fallback)`);
    return;
  }
  if (!fallbackState.value) fallbackState.value = await buildAgentDomainStates(config, ctx);
  const mctx = materializeCtx(ctx, agent.id);
  await runHook(`${agent.id}.${domainName}.onInitialize (fallback)`, () =>
    handlers.onInitialize!(fallbackState.value![domainName], mctx),
  );
}

export async function dispatchSkillAdded(
  item: ResolvedSkill,
  agents: AgentPlugin[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const state: { value?: Record<string, unknown> } = {};
  for (const agent of agents) {
    const handlers = handlersFor(agent, "skills");
    if (!handlers) continue;
    const fn = (handlers as { onAdded?: (item: ResolvedSkill, ctx: MaterializeContext) => Promise<void> }).onAdded;
    if (fn) {
      if (ctx.dryRun) { ctx.logger.info(`would: ${agent.id}.skills.onAdded`); continue; }
      await runHook(`${agent.id}.skills.onAdded`, () => fn(item, materializeCtx(ctx, agent.id)));
      continue;
    }
    await fallbackToInit(agent, handlers, "skills", config, ctx, state);
  }
}

export async function dispatchSkillUpdated(
  item: ResolvedSkill,
  agents: AgentPlugin[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const state: { value?: Record<string, unknown> } = {};
  for (const agent of agents) {
    const handlers = handlersFor(agent, "skills");
    if (!handlers) continue;
    const fn = (handlers as { onUpdated?: (item: ResolvedSkill, ctx: MaterializeContext) => Promise<void> }).onUpdated;
    if (fn) {
      if (ctx.dryRun) { ctx.logger.info(`would: ${agent.id}.skills.onUpdated`); continue; }
      await runHook(`${agent.id}.skills.onUpdated`, () => fn(item, materializeCtx(ctx, agent.id)));
      continue;
    }
    await fallbackToInit(agent, handlers, "skills", config, ctx, state);
  }
}

export async function dispatchSkillRemoved(
  name: string,
  agents: AgentPlugin[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const state: { value?: Record<string, unknown> } = {};
  for (const agent of agents) {
    const handlers = handlersFor(agent, "skills");
    if (!handlers) continue;
    const fn = (handlers as { onRemoved?: (name: string, ctx: MaterializeContext) => Promise<void> }).onRemoved;
    if (fn) {
      if (ctx.dryRun) { ctx.logger.info(`would: ${agent.id}.skills.onRemoved`); continue; }
      await runHook(`${agent.id}.skills.onRemoved`, () => fn(name, materializeCtx(ctx, agent.id)));
      continue;
    }
    await fallbackToInit(agent, handlers, "skills", config, ctx, state);
  }
}

export async function dispatchMcpAdded(
  item: ResolvedMcp,
  agents: AgentPlugin[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const state: { value?: Record<string, unknown> } = {};
  for (const agent of agents) {
    const handlers = handlersFor(agent, "mcp");
    if (!handlers) continue;
    const fn = (handlers as { onAdded?: (item: ResolvedMcp, ctx: MaterializeContext) => Promise<void> }).onAdded;
    if (fn) {
      if (ctx.dryRun) { ctx.logger.info(`would: ${agent.id}.mcp.onAdded`); continue; }
      await runHook(`${agent.id}.mcp.onAdded`, () => fn(item, materializeCtx(ctx, agent.id)));
      continue;
    }
    await fallbackToInit(agent, handlers, "mcp", config, ctx, state);
  }
}

export async function dispatchMcpUpdated(
  item: ResolvedMcp,
  agents: AgentPlugin[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const state: { value?: Record<string, unknown> } = {};
  for (const agent of agents) {
    const handlers = handlersFor(agent, "mcp");
    if (!handlers) continue;
    const fn = (handlers as { onUpdated?: (item: ResolvedMcp, ctx: MaterializeContext) => Promise<void> }).onUpdated;
    if (fn) {
      if (ctx.dryRun) { ctx.logger.info(`would: ${agent.id}.mcp.onUpdated`); continue; }
      await runHook(`${agent.id}.mcp.onUpdated`, () => fn(item, materializeCtx(ctx, agent.id)));
      continue;
    }
    await fallbackToInit(agent, handlers, "mcp", config, ctx, state);
  }
}

export async function dispatchMcpRemoved(
  name: string,
  agents: AgentPlugin[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const state: { value?: Record<string, unknown> } = {};
  for (const agent of agents) {
    const handlers = handlersFor(agent, "mcp");
    if (!handlers) continue;
    const fn = (handlers as { onRemoved?: (name: string, ctx: MaterializeContext) => Promise<void> }).onRemoved;
    if (fn) {
      if (ctx.dryRun) { ctx.logger.info(`would: ${agent.id}.mcp.onRemoved`); continue; }
      await runHook(`${agent.id}.mcp.onRemoved`, () => fn(name, materializeCtx(ctx, agent.id)));
      continue;
    }
    await fallbackToInit(agent, handlers, "mcp", config, ctx, state);
  }
}

export async function dispatchRulesAdded(
  decl: ResolvedRule,
  agents: AgentPlugin[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const state: { value?: Record<string, unknown> } = {};
  for (const agent of agents) {
    const handlers = handlersFor(agent, "rules");
    if (!handlers) continue;
    const fn = (handlers as { onAdded?: (decl: ResolvedRule, ctx: MaterializeContext) => Promise<void> }).onAdded;
    if (fn) {
      if (ctx.dryRun) { ctx.logger.info(`would: ${agent.id}.rules.onAdded`); continue; }
      await runHook(`${agent.id}.rules.onAdded`, () => fn(decl, materializeCtx(ctx, agent.id)));
      continue;
    }
    await fallbackToInit(agent, handlers, "rules", config, ctx, state);
  }
}

export async function dispatchRulesMoved(
  from: ResolvedRule,
  to: ResolvedRule,
  agents: AgentPlugin[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const state: { value?: Record<string, unknown> } = {};
  for (const agent of agents) {
    const handlers = handlersFor(agent, "rules");
    if (!handlers) continue;
    const fn = (handlers as {
      onMoved?: (from: ResolvedRule, to: ResolvedRule, ctx: MaterializeContext) => Promise<void>;
    }).onMoved;
    if (fn) {
      if (ctx.dryRun) { ctx.logger.info(`would: ${agent.id}.rules.onMoved`); continue; }
      await runHook(`${agent.id}.rules.onMoved`, () => fn(from, to, materializeCtx(ctx, agent.id)));
      continue;
    }
    await fallbackToInit(agent, handlers, "rules", config, ctx, state);
  }
}

export async function dispatchRulesRemoved(
  prev: ResolvedRule,
  agents: AgentPlugin[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const state: { value?: Record<string, unknown> } = {};
  for (const agent of agents) {
    const handlers = handlersFor(agent, "rules");
    if (!handlers) continue;
    const fn = (handlers as { onRemoved?: (prev: ResolvedRule, ctx: MaterializeContext) => Promise<void> }).onRemoved;
    if (fn) {
      if (ctx.dryRun) { ctx.logger.info(`would: ${agent.id}.rules.onRemoved`); continue; }
      await runHook(`${agent.id}.rules.onRemoved`, () => fn(prev, materializeCtx(ctx, agent.id)));
      continue;
    }
    await fallbackToInit(agent, handlers, "rules", config, ctx, state);
  }
}
