import type { HarnessAdapter } from "../../core/index.js";
import claudeCode from "./claude-code/index.js";
import codex from "./codex/index.js";
import geminiCli from "./gemini-cli/index.js";

/** Static set of built-in agent adapters (the closed agent set). */
export const HARNESS_ADAPTERS: HarnessAdapter[] = [claudeCode, codex, geminiCli];

/**
 * Agents pre-selected by `agnos --init` (and the set written when init runs
 * non-interactively). The single place to curate the out-of-the-box default as
 * new harnesses are added to {@link HARNESS_ADAPTERS}.
 */
export const DEFAULT_HARNESS_IDS: string[] = ["claude-code", "codex", "gemini-cli"];

export function harnessById(id: string): HarnessAdapter | undefined {
  return HARNESS_ADAPTERS.find((a) => a.id === id);
}
