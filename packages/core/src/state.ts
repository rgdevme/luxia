import fs from "node:fs/promises";
import path from "node:path";

export interface AgnosState {
  version: 1;
  installedAgents: string[];
  initializedDomains: string[];
}

const DEFAULT_STATE: AgnosState = {
  version: 1,
  installedAgents: [],
  initializedDomains: [],
};

export async function readState(statePath: string): Promise<AgnosState> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgnosState>;
    return normalize(parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(DEFAULT_STATE);
    throw err;
  }
}

export async function writeState(statePath: string, state: AgnosState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const json = JSON.stringify(state, null, 2) + "\n";
  await fs.writeFile(statePath, json, "utf8");
}

export function isAgentInstalled(state: AgnosState, id: string): boolean {
  return state.installedAgents.includes(id);
}

export function isDomainInitialized(state: AgnosState, name: string): boolean {
  return state.initializedDomains.includes(name);
}

export function markAgentInstalled(state: AgnosState, id: string): AgnosState {
  if (state.installedAgents.includes(id)) return state;
  return { ...state, installedAgents: [...state.installedAgents, id] };
}

export function unmarkAgentInstalled(state: AgnosState, id: string): AgnosState {
  if (!state.installedAgents.includes(id)) return state;
  return { ...state, installedAgents: state.installedAgents.filter((x) => x !== id) };
}

export function markDomainInitialized(state: AgnosState, name: string): AgnosState {
  if (state.initializedDomains.includes(name)) return state;
  return { ...state, initializedDomains: [...state.initializedDomains, name] };
}

function normalize(parsed: Partial<AgnosState>): AgnosState {
  return {
    version: 1,
    installedAgents: Array.isArray(parsed.installedAgents) ? parsed.installedAgents.filter((x): x is string => typeof x === "string") : [],
    initializedDomains: Array.isArray(parsed.initializedDomains) ? parsed.initializedDomains.filter((x): x is string => typeof x === "string") : [],
  };
}
