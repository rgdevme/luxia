import fs from "node:fs/promises";
import yaml from "js-yaml";
import type { MetadataSchema } from "./schema.js";

const FENCE_LANG = "frontmatter";
const FRONTMATTER_BLOCK_RE = /^```frontmatter[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m;

/**
 * Returns the full fenced code block (with the `frontmatter` language tag) that
 * mirrors the keys/descriptions in `agnos.json#docs.metadata`. Values are emitted
 * through js-yaml so prose that contains colons or quotes round-trips safely.
 */
export function renderMetadataBlock(metadata: MetadataSchema): string {
  const body = yaml.dump(metadata, { lineWidth: -1, noRefs: true }).trimEnd();
  return ["```" + FENCE_LANG, "---", body, "---", "```"].join("\n");
}

/**
 * Replace the first ```frontmatter fenced block in `text` with `block`. If no
 * such block exists, prepend `block` to the file (so a user who deletes the
 * block gets it back on the next generate).
 *
 * `changed` is false only when an existing block already matched `block` exactly.
 */
export function replaceFrontmatterBlock(
  text: string,
  block: string,
): { result: string; changed: boolean } {
  const match = FRONTMATTER_BLOCK_RE.exec(text);
  if (match) {
    if (match[0] === block) return { result: text, changed: false };
    const result = text.slice(0, match.index) + block + text.slice(match.index + match[0].length);
    return { result, changed: true };
  }
  const separator = text.length === 0 ? "" : text.startsWith("\n") ? "\n" : "\n\n";
  return { result: `${block}${separator}${text}`, changed: true };
}

/**
 * Read the default doc-rules.md template that ships with this package.
 * Resolved relative to the compiled bundle (or src/ in dev) via import.meta.url,
 * so it works in both built and ts-source contexts.
 */
export async function readDefaultDocRulesTemplate(): Promise<string> {
  const url = new URL("../templates/doc-rules.md", import.meta.url);
  return fs.readFile(url, "utf8");
}
