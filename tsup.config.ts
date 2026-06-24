import { defineConfig } from "tsup";

const base = {
  format: ["esm"] as const,
  target: "node24",
  platform: "node" as const,
  sourcemap: true,
  splitting: false,
  shims: false,
  treeshake: true,
};

export default defineConfig([
  {
    ...base,
    clean: true,
    dts: true,
    entry: {
      index: "src/core/index.ts",
      "fs/index": "src/core/fs/index.ts",
    },
  },
  {
    ...base,
    clean: false,
    dts: false,
    entry: { cli: "src/core/cli.ts" },
    banner: { js: "#!/usr/bin/env node" },
  },
]);
