import { describe, it, expect } from "vitest";
import { render } from "@inquirer/testing";
import { exclusiveCheckbox } from "../../src/domains/cli-helpers.js";

const choices = [
  { name: "pdf [one/repo]", value: "0", group: "pdf" },
  { name: "pdf [two/repo]", value: "1", group: "pdf" },
  { name: "lint [one/repo]", value: "2", group: "lint" },
];

describe("exclusiveCheckbox", () => {
  it("renders each row with a [ ] box and the given label", async () => {
    const { getScreen, events, answer } = await render(exclusiveCheckbox, {
      message: "Select skills:",
      choices,
    });
    const screen = getScreen();
    expect(screen).toContain("[ ] pdf [one/repo]");
    expect(screen).toContain("[ ] pdf [two/repo]");
    expect(screen).toContain("[ ] lint [one/repo]");
    events.keypress("enter");
    await expect(answer).resolves.toEqual([]);
  });

  it("checking a row in a group unchecks the previously checked row of that group", async () => {
    const { getScreen, events, answer } = await render(exclusiveCheckbox, {
      message: "Select skills:",
      choices,
    });
    // Cursor starts on row 0 (pdf/one). Select it.
    events.keypress("space");
    expect(getScreen()).toContain("[x] pdf [one/repo]");
    // Move to row 1 (pdf/two) and select it → row 0 must auto-deselect.
    events.keypress("down");
    events.keypress("space");
    const screen = getScreen();
    expect(screen).toContain("[ ] pdf [one/repo]");
    expect(screen).toContain("[x] pdf [two/repo]");
    events.keypress("enter");
    await expect(answer).resolves.toEqual(["1"]);
  });

  it("selections in different groups coexist", async () => {
    const { events, answer } = await render(exclusiveCheckbox, {
      message: "Select skills:",
      choices,
    });
    events.keypress("space"); // pdf/one
    events.keypress("down");
    events.keypress("down"); // lint/one
    events.keypress("space");
    events.keypress("enter");
    await expect(answer).resolves.toEqual(["0", "2"]);
  });
});
