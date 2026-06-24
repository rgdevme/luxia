import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import {
  renderMetadataBlock,
  replaceFrontmatterBlock,
} from "../../src/domains/docs/metadata-block.js";

describe("renderMetadataBlock", () => {
  it("wraps the metadata in a ```frontmatter fenced block with a YAML body", () => {
    const block = renderMetadataBlock({ title: "Short title", owner: "Doc owner" });
    expect(block.startsWith("```frontmatter\n---\n")).toBe(true);
    expect(block.endsWith("\n---\n```")).toBe(true);
  });

  it("safely serializes values containing colons", () => {
    const block = renderMetadataBlock({
      agent_cant: "One of: read, write, delete",
    });
    const yamlBody = block.split("\n").slice(2, -2).join("\n");
    const parsed = yaml.load(yamlBody) as Record<string, string>;
    expect(parsed["agent_cant"]).toBe("One of: read, write, delete");
  });

  it("preserves key order from the input record", () => {
    const block = renderMetadataBlock({ a: "first", b: "second", c: "third" });
    const keys = block
      .split("\n")
      .filter((line) => /^[a-z_]+:/.test(line))
      .map((line) => line.split(":")[0]);
    expect(keys).toEqual(["a", "b", "c"]);
  });
});

describe("replaceFrontmatterBlock", () => {
  const block = "```frontmatter\n---\ntitle: new\n---\n```";

  it("replaces the first ```frontmatter fenced block", () => {
    const input = [
      "intro",
      "",
      "```frontmatter",
      "---",
      "title: old",
      "---",
      "```",
      "",
      "outro",
    ].join("\n");
    const { result, changed } = replaceFrontmatterBlock(input, block);
    expect(changed).toBe(true);
    expect(result).toContain("title: new");
    expect(result).not.toContain("title: old");
    expect(result).toContain("intro");
    expect(result).toContain("outro");
  });

  it("returns changed=false when the existing block already matches", () => {
    const input = `prefix\n\n${block}\n\nsuffix`;
    const { result, changed } = replaceFrontmatterBlock(input, block);
    expect(changed).toBe(false);
    expect(result).toBe(input);
  });

  it("prepends the block when none exists in the file", () => {
    const input = "some user-written intro\n\nrest\n";
    const { result, changed } = replaceFrontmatterBlock(input, block);
    expect(changed).toBe(true);
    expect(result.startsWith(block)).toBe(true);
    expect(result).toContain("some user-written intro");
  });

  it("only replaces the first block when multiple exist", () => {
    const second = "```frontmatter\n---\ntitle: keep\n---\n```";
    const input = `before\n\n${"```frontmatter\n---\ntitle: old\n---\n```"}\n\nmid\n\n${second}\n\nafter`;
    const { result } = replaceFrontmatterBlock(input, block);
    expect(result).toContain("title: new");
    expect(result).toContain("title: keep");
  });
});
