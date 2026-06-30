import { describe, it, expect } from "vitest";
import { render } from "@inquirer/testing";
import figures from "@inquirer/figures";
import { exclusiveCheckbox } from "../../src/domains/cli-helpers.js";

const choices = [
  { name: "pdf [one/repo]", value: "0", group: "pdf", description: "Read and edit PDFs" },
  { name: "pdf [two/repo]", value: "1", group: "pdf" },
  { name: "lint [one/repo]", value: "2", group: "lint" },
];

describe("exclusiveCheckbox", () => {
  it("renders rows with Inquirer's circle icons and the given labels", async () => {
    const { getScreen, events, answer } = await render(exclusiveCheckbox, {
      message: "Select skills:",
      choices,
    });
    const screen = getScreen();
    // Inquirer figures, not the old [ ]/[x] ASCII.
    expect(screen).toContain(figures.circle);
    expect(screen).not.toContain(figures.circleFilled); // nothing checked yet
    expect(screen).not.toContain("[ ]");
    expect(screen).toContain("pdf [one/repo]");
    expect(screen).toContain("lint [one/repo]");
    events.keypress("enter");
    await expect(answer).resolves.toEqual([]);
  });

  it("shows the active row's description on its own line", async () => {
    const { getScreen } = await render(exclusiveCheckbox, {
      message: "Select skills:",
      choices,
    });
    // Cursor starts on row 0, which carries a description.
    expect(getScreen()).toContain("Read and edit PDFs");
  });

  it("renders a filled icon once a row is checked", async () => {
    const { getScreen, events, answer } = await render(exclusiveCheckbox, {
      message: "Select skills:",
      choices,
    });
    events.keypress("space");
    expect(getScreen()).toContain(figures.circleFilled);
    events.keypress("enter");
    await expect(answer).resolves.toEqual(["0"]);
  });

  it("starts with preselected (checked) rows already filled", async () => {
    const { getScreen, events, answer } = await render(exclusiveCheckbox, {
      message: "Select skills:",
      choices: [
        { name: "pdf [one/repo]", value: "0", group: "pdf", checked: true },
        { name: "lint [one/repo]", value: "1", group: "lint" },
      ],
    });
    expect(getScreen()).toContain(figures.circleFilled); // pdf preselected
    events.keypress("enter");
    await expect(answer).resolves.toEqual(["0"]);
  });

  it("checking a row in a group unchecks the previously checked row of that group", async () => {
    const { events, answer } = await render(exclusiveCheckbox, {
      message: "Select skills:",
      choices,
    });
    // Cursor starts on row 0 (pdf/one). Select it, move to row 1 (pdf/two) and
    // select it → row 0 must auto-deselect, so only "1" survives.
    events.keypress("space");
    events.keypress("down");
    events.keypress("space");
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
