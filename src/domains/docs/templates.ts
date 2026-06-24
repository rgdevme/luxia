import fs from "node:fs/promises";
import type { EffectiveDocsConfig } from "./effective-config.js";

const SLOT_PATTERN = /<!--agnos:slot:([a-z_]+)-->/g;

export async function readIndexTemplate(): Promise<string> {
  return fs.readFile(new URL("../templates/index.md", import.meta.url), "utf8");
}

export async function readContentTemplate(): Promise<string> {
  return fs.readFile(new URL("../templates/content.md", import.meta.url), "utf8");
}

export function renderTemplate(template: string, slots: Record<string, string>): string {
  let out = template;
  for (const [name, value] of Object.entries(slots)) {
    const token = `<!--agnos:slot:${name}-->`;
    if (!out.includes(token)) {
      throw new Error(`template missing declared slot: ${name}`);
    }
    out = out.split(token).join(value);
  }
  const leftover = out.match(SLOT_PATTERN);
  if (leftover) {
    throw new Error(`template has unsubstituted slots: ${leftover.join(", ")}`);
  }
  return out;
}

export function renderFrontmatter(
  cfg: EffectiveDocsConfig,
  values: Record<string, string>,
): string {
  return Object.keys(cfg.metadata)
    .map((key) => `${key}: ${values[key] ?? ""}`)
    .join("\n");
}

export const INDEX_VALUES: Record<string, string> = {
  title: "Documentation Index",
  description: "Auto-generated index of project documentation.",
  read_when:
    "You need a map to find information about architectural choices, libraries, goals, or anything else related to the project as a business.",
  agent_cant: "write, delete",
};

export const CONTENT_VALUES: Record<string, string> = {
  title: "Documentation Content",
  description: "Auto-generated concatenation of project documentation.",
  read_when:
    "You need all the docuemtned information about architectural choices, libraries, goals, or anything else related to the project as a business.",
  agent_cant: "write, delete",
};
