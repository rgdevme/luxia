import { describe, it, expect } from "vitest";
import { USAGE, domainHelp, commandHelp } from "../../src/core/help.js";
import type { Domain } from "../../src/core/index.js";
import skillsDomain from "../../src/domains/skills/index.js";

describe("cli help", () => {
  it("USAGE shows the top-level synopsis", () => {
    expect(USAGE).toContain("agnos [domain]");
    expect(USAGE).toContain("agnos <domain> --help");
  });

  it("domainHelp shows the id, description, and --init for a domain with init steps", () => {
    const out = domainHelp(skillsDomain);
    expect(out).toContain("agnos skills");
    expect(out).toContain(skillsDomain.description);
    expect(out).toContain("agnos skills --init");
  });

  it("domainHelp lists subcommands and their flags when present", () => {
    const fake: Domain = {
      id: "demo",
      description: "demo domain",
      kind: "writer",
      priority: 1,
      commands: {
        migrate: {
          name: "migrate",
          description: "import existing config",
          flags: [{ name: "force", type: "boolean", description: "overwrite conflicts" }],
          run: async () => {},
        },
      },
    };
    const out = domainHelp(fake);
    expect(out).toContain("Subcommands:");
    expect(out).toContain("migrate");
    expect(out).toContain("import existing config");
    expect(out).toContain("--force");
  });

  it("commandHelp shows usage, arguments, and flags", () => {
    const out = commandHelp("agents", {
      name: "remove",
      description: "remove an agent",
      args: [{ name: "agent", required: true, description: "agent id to remove" }],
      flags: [],
      run: async () => {},
    });
    expect(out).toContain("agnos agents remove <agent>");
    expect(out).toContain("agent id to remove");
  });
});
