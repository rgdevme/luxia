import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/core/logger.js";

const originalIsTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");

afterEach(() => {
  vi.restoreAllMocks();
  if (originalIsTTY) Object.defineProperty(process.stderr, "isTTY", originalIsTTY);
  else Reflect.deleteProperty(process.stderr, "isTTY");
});

describe("logger progress", () => {
  it("replaces a live TTY progress line and clears it on completion", () => {
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((value) => {
      writes.push(String(value));
      return true;
    });
    const logger = createLogger();

    const progress = logger.progress({
      message: "Installing skills 0%",
      status: "total 4 | reused 0 | fetched 0",
    });
    progress.update({
      message: "Installing skills 50%",
      status: "total 4 | reused 1 | fetched 1",
    });
    progress.stop();

    const output = writes.join("");
    expect(output).toContain("Installing skills 0%");
    expect(output).toContain("Installing skills 50%");
    expect(output).toContain("total 4 | reused 1 | fetched 1");
    expect(output).toContain("\x1b[?25h");
  });
});
