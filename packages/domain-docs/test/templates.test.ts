import { describe, it, expect } from "vitest";
import { renderTemplate, renderFrontmatter, renderRequiredFields } from "../src/templates.js";
import type { EffectiveDocsConfig } from "../src/effective-config.js";

function cfg(metadata: Record<string, string>): EffectiveDocsConfig {
  return {
    route: "/x",
    routeRelative: "x",
    indexName: "index",
    contentName: "content",
    docRulesName: "doc-rules",
    injectIndex: true,
    injectRules: true,
    metadata,
    indexFile: "/x/index.md",
    contentFile: "/x/content.md",
    docRulesFile: "/x/doc-rules.md",
  };
}

describe("renderTemplate", () => {
  it("substitutes a declared slot", () => {
    expect(renderTemplate("a <!--agnos:slot:x--> b", { x: "Y" })).toBe("a Y b");
  });

  it("throws when a declared slot is missing from the template", () => {
    expect(() => renderTemplate("no slots here", { x: "Y" })).toThrow(/missing declared slot: x/);
  });

  it("throws when the template has unsubstituted slots", () => {
    expect(() => renderTemplate("<!--agnos:slot:x--> <!--agnos:slot:y-->", { x: "Y" })).toThrow(
      /unsubstituted slots/,
    );
  });

  it("substitutes the same slot in multiple positions", () => {
    expect(renderTemplate("<!--agnos:slot:x--><!--agnos:slot:x-->", { x: "Y" })).toBe("YY");
  });
});

describe("renderFrontmatter", () => {
  it("emits keys in metadata declaration order with supplied values", () => {
    const text = renderFrontmatter(cfg({ a: "desc a", b: "desc b" }), { a: "1", b: "2" });
    expect(text).toBe("a: 1\nb: 2");
  });

  it("emits empty string for unknown keys", () => {
    const text = renderFrontmatter(cfg({ a: "desc a", owner: "desc owner" }), { a: "1" });
    expect(text).toBe("a: 1\nowner: ");
  });
});

describe("renderRequiredFields", () => {
  it("emits a bullet per metadata entry with its description", () => {
    const text = renderRequiredFields(cfg({ title: "Short title", owner: "Document owner" }));
    expect(text).toBe("  - `title` — Short title\n  - `owner` — Document owner");
  });
});
