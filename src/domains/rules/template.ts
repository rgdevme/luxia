import fs from "node:fs/promises";

export async function readDefaultRulesTemplate(): Promise<string> {
  return fs.readFile(new URL("./templates/agents.md", import.meta.url), "utf8");
}
