import type { AgentAdapter } from "../../core/index.js";
import claudeCode from "./claude-code/index.js";
import codex from "./codex/index.js";

/** Static set of built-in agent adapters (the closed agent set). */
export const ADAPTERS: AgentAdapter[] = [claudeCode, codex];

export function adapterById(id: string): AgentAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
