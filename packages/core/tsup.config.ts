import { defineConfig } from "tsup";
import { baseConfig } from "../../tsup.base";

export default defineConfig([
  {
    ...baseConfig,
    entry: {
      index: "src/index.ts",
      "fs/index": "src/fs/index.ts",
    },
  },
  {
    ...baseConfig,
    entry: { cli: "src/cli.ts" },
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
