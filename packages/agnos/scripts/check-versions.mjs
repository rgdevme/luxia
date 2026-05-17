#!/usr/bin/env node
// Asserts that the meta-package's bundled deps line up with each plugin's
// own version. Runs on build/typecheck/prepublish so a coordinated release
// can't accidentally ship mismatched plugin versions.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const metaPkgPath = path.resolve(here, "..", "package.json");
const meta = JSON.parse(await fs.readFile(metaPkgPath, "utf8"));
const myVersion = meta.version;

const problems = [];
for (const [dep, spec] of Object.entries(meta.dependencies ?? {})) {
  if (spec === "workspace:*") continue; // workspace dev — pnpm rewrites on publish
  // After `pnpm publish` rewrites, deps point at concrete versions. Confirm
  // those match this meta-package's version (we publish in lockstep).
  if (spec.replace(/^[\^~]/, "") !== myVersion) {
    problems.push(`${dep}: declared ${spec}, expected ${myVersion}`);
  }
}

if (problems.length > 0) {
  console.error(`agnos meta-package version mismatch:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
