import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy every domain's `templates/` into a single flat `dist/templates/`.
 *
 * The template readers use `new URL("./templates/<name>.md", import.meta.url)`.
 * In dev that resolves next to the source file (co-located per domain); in the
 * bundled build the readers live in `dist/*.js`, so the templates must sit at
 * `dist/templates/`. Template filenames are unique across domains.
 */
const TEMPLATE_DIRS = ["src/domains/rules/templates"];

async function main() {
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const destDir = path.join(repoRoot, "dist", "templates");
    await mkdir(destDir, { recursive: true });
    for (const rel of TEMPLATE_DIRS) {
      const dir = path.join(repoRoot, rel);
      for (const name of await readdir(dir)) {
        await cp(path.join(dir, name), path.join(destDir, name), { recursive: true });
      }
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

void main();
