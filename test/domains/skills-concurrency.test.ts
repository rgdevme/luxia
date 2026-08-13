import { describe, expect, it } from "vitest";
import { runSkillTasks } from "../../src/domains/skills/concurrency.js";

describe("runSkillTasks", () => {
  it("waits for active workers before reporting a failure", async () => {
    let completed = false;
    const run = runSkillTasks(["fail", "finish"], async (value) => {
      if (value === "fail") throw new Error("failed");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
      completed = true;
      return value;
    });

    await expect(run).rejects.toThrow("failed");
    expect(completed).toBe(true);
  });
});
