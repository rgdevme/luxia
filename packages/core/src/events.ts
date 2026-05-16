import type {
  AgentPlugin,
  MaterializeContext,
  ResolveContext,
  ResolvedMcp,
  ResolvedRule,
  ResolvedSkill,
} from "./types/public.js";
import { refToId, resolveAgentByRef, type PluginRegistry } from "./plugin-loader.js";
import type { AgnosConfig } from "./types/public.js";

function materializeCtx(ctx: ResolveContext, agentId: string): MaterializeContext {
  return { ...ctx, agentId };
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
      ctx.logger.warn(`agent "${refToId(ref)}" declared but plugin not installed — skipping`);
      continue;
    }
    out.push(reg.plugin);
  }
  return out;
}

// ---------- per-domain dispatch helpers ----------

export async function dispatchSkillAdded(item: ResolvedSkill, agents: AgentPlugin[], ctx: ResolveContext): Promise<void> {
  for (const a of agents) {
    const fn = a.handles?.skills?.onAdded;
    if (!fn) continue;
    await fn(item, materializeCtx(ctx, a.id));
  }
}

export async function dispatchSkillUpdated(item: ResolvedSkill, agents: AgentPlugin[], ctx: ResolveContext): Promise<void> {
  for (const a of agents) {
    const fn = a.handles?.skills?.onUpdated;
    if (!fn) continue;
    await fn(item, materializeCtx(ctx, a.id));
  }
}

export async function dispatchSkillRemoved(name: string, agents: AgentPlugin[], ctx: ResolveContext): Promise<void> {
  for (const a of agents) {
    const fn = a.handles?.skills?.onRemoved;
    if (!fn) continue;
    await fn(name, materializeCtx(ctx, a.id));
  }
}

export async function dispatchMcpAdded(item: ResolvedMcp, agents: AgentPlugin[], ctx: ResolveContext): Promise<void> {
  for (const a of agents) {
    const fn = a.handles?.mcp?.onAdded;
    if (!fn) continue;
    await fn(item, materializeCtx(ctx, a.id));
  }
}

export async function dispatchMcpUpdated(item: ResolvedMcp, agents: AgentPlugin[], ctx: ResolveContext): Promise<void> {
  for (const a of agents) {
    const fn = a.handles?.mcp?.onUpdated;
    if (!fn) continue;
    await fn(item, materializeCtx(ctx, a.id));
  }
}

export async function dispatchMcpRemoved(name: string, agents: AgentPlugin[], ctx: ResolveContext): Promise<void> {
  for (const a of agents) {
    const fn = a.handles?.mcp?.onRemoved;
    if (!fn) continue;
    await fn(name, materializeCtx(ctx, a.id));
  }
}

export async function dispatchRulesAdded(decl: ResolvedRule, agents: AgentPlugin[], ctx: ResolveContext): Promise<void> {
  for (const a of agents) {
    const fn = a.handles?.rules?.onAdded;
    if (!fn) continue;
    await fn(decl, materializeCtx(ctx, a.id));
  }
}

export async function dispatchRulesMoved(from: ResolvedRule, to: ResolvedRule, agents: AgentPlugin[], ctx: ResolveContext): Promise<void> {
  for (const a of agents) {
    const fn = a.handles?.rules?.onMoved;
    if (!fn) continue;
    await fn(from, to, materializeCtx(ctx, a.id));
  }
}

export async function dispatchRulesRemoved(prev: ResolvedRule, agents: AgentPlugin[], ctx: ResolveContext): Promise<void> {
  for (const a of agents) {
    const fn = a.handles?.rules?.onRemoved;
    if (!fn) continue;
    await fn(prev, materializeCtx(ctx, a.id));
  }
}
