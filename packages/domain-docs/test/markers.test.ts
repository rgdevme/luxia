import { describe, it, expect } from "vitest";
import { replaceBetweenMarkers, stripFrontmatter } from "../src/inject/markers.js";

const RULES_START = "## Documentation Rules";
const RULES_END = ">__Documentation rules end__";

describe("replaceBetweenMarkers", () => {
  it("appends both markers when absent", () => {
    const result = replaceBetweenMarkers("hello world\n", RULES_START, RULES_END, "first body");
    expect(result.appended).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.text).toContain(RULES_START);
    expect(result.text).toContain("first body");
    expect(result.text).toContain(RULES_END);
    // payload is between the markers
    const a = result.text.indexOf(RULES_START);
    const b = result.text.indexOf("first body");
    const c = result.text.indexOf(RULES_END);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("replaces content between existing markers without removing them", () => {
    const text = [
      "Preamble",
      RULES_START,
      "old line 1",
      "old line 2",
      RULES_END,
      "Trailer",
    ].join("\n");
    const result = replaceBetweenMarkers(text, RULES_START, RULES_END, "new body");
    expect(result.appended).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.text).toContain("Preamble");
    expect(result.text).toContain(RULES_START);
    expect(result.text).toContain("new body");
    expect(result.text).toContain(RULES_END);
    expect(result.text).toContain("Trailer");
    expect(result.text).not.toContain("old line 1");
  });

  it("idempotent when content already matches", () => {
    const text = [RULES_START, "same body", RULES_END].join("\n");
    const result = replaceBetweenMarkers(text, RULES_START, RULES_END, "same body");
    expect(result.changed).toBe(false);
    expect(result.text).toBe(text);
  });

  it("appends marker pair when only start marker is present", () => {
    const text = [RULES_START, "dangling content"].join("\n");
    const result = replaceBetweenMarkers(text, RULES_START, RULES_END, "fresh");
    expect(result.appended).toBe(true);
    expect(result.changed).toBe(true);
    // the new markers are appended at the end, leaving the dangling start in place
    expect(result.text.lastIndexOf(RULES_START)).toBeGreaterThan(result.text.indexOf(RULES_START));
  });
});

describe("stripFrontmatter", () => {
  it("removes a leading --- ... --- block", () => {
    const input = "---\ntitle: hi\n---\nbody here\n";
    expect(stripFrontmatter(input)).toBe("body here\n");
  });

  it("leaves text unchanged when no frontmatter is present", () => {
    expect(stripFrontmatter("# heading\n")).toBe("# heading\n");
  });
});
