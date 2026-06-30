import type { AgentAdapter } from "../../core/index.js";
import claudeCode from "./claude-code/index.js";
import codex from "./codex/index.js";

/** Static set of built-in agent adapters (the closed agent set). */
export const ADAPTERS: AgentAdapter[] = [claudeCode, codex];

/**
 * Agents pre-selected by `agnos --init` (and the set written when init runs
 * non-interactively). The single place to curate the out-of-the-box default as
 * new agents are added to {@link ADAPTERS}.
 */
export const DEFAULT_AGENT_IDS: string[] = ["claude-code", "codex"];

export function adapterById(id: string): AgentAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
