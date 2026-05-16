import { z } from "zod";

export const metadataFieldSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("string"),
    description: z.string(),
  }),
  z.object({
    type: z.literal("enum"),
    values: z.array(z.string()).min(1),
    description: z.string(),
  }),
]);

export type MetadataFieldSchema = z.infer<typeof metadataFieldSchema>;

export const docsConfigSchema = z.object({
  route: z.string().optional(),
  metadata: z.record(z.string(), metadataFieldSchema).optional(),
  index: z.string().optional(),
  content: z.union([z.string(), z.literal(false)]).optional(),
  docRules: z.string().optional(),
  injectIndex: z.boolean().optional(),
  injectRules: z.boolean().optional(),
});

export type DocsConfig = z.infer<typeof docsConfigSchema>;

export const DEFAULT_DOCS_METADATA: Record<string, MetadataFieldSchema> = {
  title: { type: "string", description: "Title" },
  description: { type: "string", description: "Brief description of the document." },
  read_when: { type: "string", description: "When you need to..." },
  agent_cant: {
    type: "enum",
    values: ["read", "write", "delete"],
    description: "Limit (in natural language) what the agent cannot do with this file.",
  },
};

export const DEFAULTS = {
  route: ".agnos/.docs",
  indexName: "index",
  contentName: "content" as const,
  docRulesName: "doc-rules",
  injectIndex: true,
  injectRules: true,
};

export const RULES_BLOCK = {
  start: "## Documentation Rules",
  end: ">__Documentation rules end__",
};

export const INDEX_BLOCK = {
  start: "## Documentation Index",
  end: ">__Documentation index end__",
};
