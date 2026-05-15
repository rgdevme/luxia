import type { Options } from "tsup";

export const baseConfig: Options = {
  format: ["esm"],
  target: "node24",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: false,
  treeshake: true,
};
