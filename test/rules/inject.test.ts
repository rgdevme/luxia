import { describe, it, expect } from "vitest";
import {
  injectSection,
  injectSections,
  pruneOrphanSections,
  slugify,
  type Section,
} from "../../src/domains/rules/inject.js";

const sec = (title: string, body: string): Section => ({ slug: slugify(title), title, body });

describe("slugify", () => {
  it("normalizes titles to a stable slug", () => {
    expect(slugify("Security Rules!")).toBe("security-rules");
    expect(slugify("  API / v2  ")).toBe("api-v2");
  });
});

describe("injectSection", () => {
  it("appends a new section", () => {
    const out = injectSection("# Existing\n\nhand-written\n", sec("Security", "no secrets"));
    expect(out).toContain("<!-- agnos:section:security -->");
    expect(out).toContain("# Security");
    expect(out).toContain("no secrets");
    expect(out).toContain("hand-written"); // preserved
  });

  it("replaces an existing section in place and is idempotent / byte-stable", () => {
    const once = injectSection("", sec("Security", "v1"));
    const replaced = injectSection(once, sec("Security", "v2"));
    expect(replaced).toContain("v2");
    expect(replaced).not.toContain("v1");
    // idempotent: same content → unchanged
    expect(injectSection(replaced, sec("Security", "v2"))).toBe(replaced);
  });
});

describe("injectSections + pruneOrphanSections", () => {
  it("injects in order and prunes orphaned sections, preserving hand edits", () => {
    let text = "# AGENTS\n\nintro kept\n";
    text = injectSections(text, [sec("Alpha", "a"), sec("Beta", "b")]);
    expect(text.indexOf("agnos:section:alpha")).toBeLessThan(text.indexOf("agnos:section:beta"));
    // drop Beta on the next run → its section is pruned, Alpha + hand edits remain
    const pruned = injectSections(text, [sec("Alpha", "a")]);
    expect(pruned).toContain("agnos:section:alpha");
    expect(pruned).not.toContain("agnos:section:beta");
    expect(pruned).toContain("intro kept");
  });

  it("pruneOrphanSections keeps listed slugs and removes the rest", () => {
    const text = injectSections("", [sec("Keep", "k"), sec("Drop", "d")]);
    const out = pruneOrphanSections(text, new Set(["keep"]));
    expect(out).toContain("agnos:section:keep");
    expect(out).not.toContain("agnos:section:drop");
  });
});
