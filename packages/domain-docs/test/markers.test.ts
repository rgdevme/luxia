import { describe, it, expect } from "vitest";
import { replaceUnderHeading, stripFrontmatter } from "../src/inject/markers.js";

const HEADING = "## Documentation Rules";

describe("replaceUnderHeading", () => {
  it("appends the heading + payload when absent", () => {
    const result = replaceUnderHeading("hello world\n", HEADING, "first body");
    expect(result.appended).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.text).toContain(HEADING);
    expect(result.text).toContain("first body");
    expect(result.text.indexOf(HEADING)).toBeLessThan(result.text.indexOf("first body"));
  });

  it("replaces content under heading up to the next ## boundary", () => {
    const text = [
      "Preamble",
      HEADING,
      "old line 1",
      "old line 2",
      "",
      "## Next Section",
      "Trailer",
    ].join("\n");
    const result = replaceUnderHeading(text, HEADING, "new body");
    expect(result.appended).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.text).toContain("Preamble");
    expect(result.text).toContain(HEADING);
    expect(result.text).toContain("new body");
    expect(result.text).toContain("## Next Section");
    expect(result.text).toContain("Trailer");
    expect(result.text).not.toContain("old line 1");
    expect(result.text).not.toContain("old line 2");
    // Single blank line between payload and next heading.
    expect(result.text).toContain("new body\n\n## Next Section");
  });

  it("stops at a `# ` (level-1) heading", () => {
    const text = [HEADING, "old", "# Top-Level", "kept"].join("\n");
    const result = replaceUnderHeading(text, HEADING, "fresh");
    expect(result.text).toContain("fresh");
    expect(result.text).not.toContain("old");
    expect(result.text).toContain("# Top-Level");
    expect(result.text).toContain("kept");
  });

  it("replaces everything to EOF when heading is the last ## section", () => {
    const text = [HEADING, "old line", "### sub", "more"].join("\n");
    const result = replaceUnderHeading(text, HEADING, "fresh body");
    expect(result.text).toContain("fresh body");
    expect(result.text).not.toContain("old line");
    expect(result.text).not.toContain("### sub");
    expect(result.text).not.toContain("more");
  });

  it("preserves nested ### subsections inside the replaced payload", () => {
    const text = [HEADING, "old"].join("\n");
    const payload = "### Sub\n- item";
    const result = replaceUnderHeading(text, HEADING, payload);
    expect(result.text).toContain("### Sub");
    expect(result.text).toContain("- item");
    expect(result.text).not.toContain("old");
  });

  it("is idempotent when content already matches", () => {
    const text = [HEADING, "same body", "", "## Next", "trail"].join("\n");
    const result = replaceUnderHeading(text, HEADING, "same body");
    expect(result.changed).toBe(false);
    expect(result.text).toBe(text);
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
