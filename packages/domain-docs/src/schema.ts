import { z } from "zod";

/**
 * A metadata schema is a flat map of frontmatter key → natural-language
 * description. The description tells the LLM how to populate the value
 * (allowed shapes, constraints, etc.). Validation only checks presence —
 * the prose constraint is the LLM's responsibility.
 */
export const metadataSchema = z.record(z.string(), z.string());
export type MetadataSchema = z.infer<typeof metadataSchema>;

export const docsConfigSchema = z.object({
  route: z.string().optional(),
  metadata: metadataSchema.optional(),
  index: z.string().optional(),
  content: z.union([z.string(), z.literal(false)]).optional(),
  docRules: z.string().optional(),
  injectIndex: z.boolean().optional(),
  injectRules: z.boolean().optional(),
});

export type DocsConfig = z.infer<typeof docsConfigSchema>;

export const DEFAULT_DOCS_METADATA: MetadataSchema = {
  title: "Short, human-readable title of the document.",
  description: "One- or two-sentence summary of what the document covers.",
  read_when:
    "Natural-language description of when an agent should read this document (e.g., 'when implementing authentication').",
  agent_cant:
    "What the agent must not do with this file. One of: read, write, delete (or a natural-language combination).",
};

export const DEFAULTS = {
  route: ".docs",
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
