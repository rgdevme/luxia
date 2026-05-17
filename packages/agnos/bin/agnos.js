#!/usr/bin/env node
// Thin shim: expose this meta-package directory as the bundle root so the
// core plugin loader can discover the default plugins shipped here, then
// hand off to the core CLI.
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundleRoot = path.resolve(here, "..");
process.env.AGNOS_BUNDLE_ROOT ??= bundleRoot;

void (async () => {
  await import("@luxia/core/cli.js");
})();
