import { defineConfig } from "tsup";
import { baseConfig } from "../../tsup.base";

export default defineConfig({
  ...baseConfig,
  entry: { index: "src/index.ts", template: "src/template.ts" },
  external: ["@luxia/core"],
});
