#!/usr/bin/env node
// Prints the next release version for the lockstep bump. Rather than bumping
// each package from its own (possibly stale) version, we anchor on the HIGHEST
// version across the whole workspace and bump that once — so packages that
// drifted apart in a partial release re-converge on the next run.
//
// Usage: node next-version.mjs <patch|minor|major>
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  console.error(`next-version: expected patch|minor|major, got '${bump ?? ""}'`);
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(here, "..", "..");

// Parse "X.Y.Z" into a comparable tuple. Versions in this repo are plain
// semver cores (no prerelease/build), so we only need the numeric triple.
const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v ?? "");
  if (!m) throw new Error(`unparseable version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const entries = await fs.readdir(packagesDir, { withFileTypes: true });
let max = [0, 0, 0];
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const pkgPath = path.join(packagesDir, entry.name, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
  } catch {
    continue; // not a package
  }
  if (pkg.private) continue;
  const v = parse(pkg.version);
  if (cmp(v, max) > 0) max = v;
}

let [major, minor, patch] = max;
if (bump === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bump === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

process.stdout.write(`${major}.${minor}.${patch}`);
