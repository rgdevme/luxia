import { describe, it, expect } from "vitest";
import {
  injectSection,
  injectSections,
  renderSection,
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

describe("renderSection", () => {
  it("renders a level-2 heading with the trimmed body", () => {
    expect(renderSection(sec("Security", "  no secrets\n"))).toBe("## Security\n\nno secrets");
  });
  it("renders a heading-only block when the body is empty", () => {
    expect(renderSection(sec("Empty", "   "))).toBe("## Empty");
  });
});

describe("injectSection", () => {
  it("appends a new H2 section, preserving the preamble, with no sentinels", () => {
    const out = injectSection("# AGENTS\n\nhand-written\n", sec("Security", "no secrets"));
    expect(out).toContain("# AGENTS");
    expect(out).toContain("hand-written");
    expect(out).toContain("## Security");
    expect(out).toContain("no secrets");
    expect(out).not.toContain("<!--");
  });

  it("replaces an existing section in place and is idempotent / byte-stable", () => {
    const once = injectSection("", sec("Security", "v1"));
    const replaced = injectSection(once, sec("Security", "v2"));
    expect(replaced).toContain("v2");
    expect(replaced).not.toContain("v1");
    expect(injectSection(replaced, sec("Security", "v2"))).toBe(replaced);
  });

  it("ends a section at the next H2 — replacing one does not swallow the next", () => {
    let text = injectSections("", [sec("Alpha", "a body"), sec("Beta", "b body")]);
    text = injectSection(text, sec("Alpha", "a updated"));
    expect(text).toContain("a updated");
    expect(text).toContain("## Beta");
    expect(text).toContain("b body");
  });
});

describe("injectSections", () => {
  it("injects in order and preserves hand-written H2 sections", () => {
    const text = injectSections("## Manual\n\nkeep me\n", [sec("Alpha", "a"), sec("Beta", "b")]);
    expect(text.indexOf("## Alpha")).toBeLessThan(text.indexOf("## Beta"));
    expect(text).toContain("## Manual");
    expect(text).toContain("keep me");
  });

  it("prunes only previously-managed sections that are now gone", () => {
    const first = injectSections("", [sec("Alpha", "a"), sec("Beta", "b")]);
    const pruned = injectSections(first, [sec("Alpha", "a")], ["alpha", "beta"]);
    expect(pruned).toContain("## Alpha");
    expect(pruned).not.toContain("## Beta");
  });

  it("never prunes a hand-written section absent from prevSlugs", () => {
    const out = injectSections("## Manual\n\nkeep me\n", [sec("Alpha", "a")], ["alpha"]);
    expect(out).toContain("## Manual");
    expect(out).toContain("keep me");
  });

  it("is byte-stable across repeated runs", () => {
    const first = injectSections("# Title\n\nintro\n", [sec("Alpha", "a"), sec("Beta", "b")], []);
    const second = injectSections(first, [sec("Alpha", "a"), sec("Beta", "b")], ["alpha", "beta"]);
    expect(second).toBe(first);
  });
});
