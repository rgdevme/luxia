import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveGlobalStoreDir } from "../../src/core/store-path.js";

describe("resolveGlobalStoreDir", () => {
  it("uses AGNOS_STORE_DIR when configured", () => {
    expect(
      resolveGlobalStoreDir({ env: { AGNOS_STORE_DIR: "/shared/agnos" }, platform: "linux" }),
    ).toBe(path.posix.resolve("/shared/agnos", "v1"));
  });

  it("uses the platform user data directory", () => {
    expect(
      resolveGlobalStoreDir({
        env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
        homeDir: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBe(path.win32.join("C:\\Users\\test\\AppData\\Local", "agnos", "store", "v1"));
    expect(resolveGlobalStoreDir({ env: {}, homeDir: "/Users/test", platform: "darwin" })).toBe(
      path.posix.join("/Users/test", "Library", "agnos", "store", "v1"),
    );
    expect(resolveGlobalStoreDir({ env: {}, homeDir: "/home/test", platform: "linux" })).toBe(
      path.posix.join("/home/test", ".local", "share", "agnos", "store", "v1"),
    );
  });
});
