import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  agnosConfigSchema,
  hookEventSchema,
  mcpDeclarationSchema,
  SCHEMA_VERSION,
} from "../../src/core/schema.js";
import { SCHEMA_URL } from "../../src/core/config.js";

/**
 * `schema.json` (the published JSON Schema for editor validation) is
 * hand-maintained. These assertions fail if it drifts from the zod schema in
 * `src/core/schema.ts` — most importantly when a top-level domain or a hook
 * event is added/removed, the schema version bumps, or the `$id` URL changes.
 */
const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), "schema.json"), "utf8")) as {
  $id: string;
  properties: Record<string, { const?: unknown; enum?: string[]; items?: unknown }>;
};

const sorted = (a: readonly string[]): string[] => [...a].sort();

describe("schema.json stays aligned with the zod schema", () => {
  it("$id matches SCHEMA_URL", () => {
    expect(schema.$id).toBe(SCHEMA_URL);
  });

  it("schemaVersion const matches SCHEMA_VERSION", () => {
    expect(schema.properties["schemaVersion"]?.const).toBe(SCHEMA_VERSION);
  });

  it("top-level properties match the zod config object's keys", () => {
    const zodKeys = sorted(Object.keys(agnosConfigSchema.shape));
    const jsonKeys = sorted(Object.keys(schema.properties));
    expect(jsonKeys).toEqual(zodKeys);
  });

  it("hook event enum matches hookEventSchema.options", () => {
    const json = schema.properties["hooks"]?.items as { properties: { event: { enum: string[] } } };
    expect(sorted(json.properties.event.enum)).toEqual(sorted(hookEventSchema.options));
  });

  it("mcp transport enum matches mcpDeclarationSchema", () => {
    const json = schema.properties["mcp"]?.items as {
      properties: { transport: { enum: string[] } };
    };
    const zodTransport = mcpDeclarationSchema.shape.transport.unwrap().options;
    expect(sorted(json.properties.transport.enum)).toEqual(sorted(zodTransport));
  });
});
