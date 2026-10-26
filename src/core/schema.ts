import { z } from "zod";

export const harnessRefSchema = z.string().min(1);

/** Current `agnos.json` schema version. Configs without it are rejected (see config.ts). */
export const SCHEMA_VERSION = 1;

/**
 * Rules domain. Map of generated artifact paths to ordered Markdown sources.
 */
export const rulesDeclarationSchema = z
  .object({
    dir: z.string().min(1).optional(),
    fragments: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
  })
  .strict();

/** Local-name pattern for `agnos.json#skills` keys. */
export const skillNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, "skill name must be alphanumeric/dash");

export const repositoryRequestSchema = z.object({
  source: z
    .string()
    .min(1)
    .refine((value) => !/[\r\n]/.test(value), "source must be a single line"),
  branch: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  glob: z.string().min(1).default("."),
});

export const repositorySourcesSchema = z.record(skillNameSchema, repositoryRequestSchema);
export const skillSourcesSchema = repositorySourcesSchema;

export const referencesConfigSchema = z
  .object({
    dir: z.string().min(1).default(".agnos/references"),
    sources: repositorySourcesSchema.default({}),
  })
  .strict();

export const skillsConfigSchema = z
  .object({
    dir: z.string().min(1).optional(),
    sources: skillSourcesSchema.optional(),
  })
  .strict();

export const mcpDeclarationSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.array(z.string().min(1)).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  transport: z.enum(["stdio", "sse", "http"]).optional(),
});

export const mcpConfigSchema = z.object({
  envFile: z.string().min(1).optional(),
  servers: z.array(mcpDeclarationSchema).optional(),
});

/**
 * Docs domain. Watches `dir`, compiles an index. The doc-frontmatter shape is
 * fixed (see `docFrontmatterSchema`) and not user-overridable.
 */
export const docsConfigSchema = z
  .object({
    dir: z.string().min(1).default(".agnos/docs"),
    ignore: z.array(z.string().min(1)).default([]),
  })
  .strict();

/**
 * Fixed frontmatter shape every doc must carry, aligned with Google's Open
 * Knowledge Format. `type`/`title`/`description`/`timestamp` are required and
 * non-empty; `resource`/`tags` must be present but may be empty. Unknown keys
 * are tolerated (OKF: consumers ignore fields they don't recognize). The
 * `.describe()` hints are surfaced when a doc's metadata is incomplete.
 */
export const docFrontmatterSchema = z
  .object({
    type: z
      .string()
      .min(1)
      .describe("Concept kind, e.g. 'Technical Doc', 'Playbook', 'BigQuery Table'."),
    title: z.string().min(1).describe("Short, human-readable title of the document."),
    description: z
      .string()
      .min(1)
      .describe("One- or two-sentence summary of what the document covers."),
    resource: z.string().describe("URI uniquely identifying the underlying asset. May be empty."),
    tags: z.array(z.string()).describe("List of categorization strings. May be empty."),
    // YAML auto-parses an unquoted ISO 8601 datetime into a Date, so accept both.
    timestamp: z
      .union([z.string().min(1), z.date()])
      .describe("ISO 8601 datetime of the last change."),
  })
  .passthrough();

export const agnosConfigSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(SCHEMA_VERSION),
    harness: z.array(harnessRefSchema).optional(),
    rules: rulesDeclarationSchema.optional(),
    skills: skillsConfigSchema.optional(),
    references: referencesConfigSchema.optional(),
    mcp: mcpConfigSchema.optional(),
    docs: docsConfigSchema.optional(),
  })
  .passthrough();

export type AgnosConfigParsed = z.infer<typeof agnosConfigSchema>;

export const skillLockEntrySchema = z.object({
  computedHash: z.string().regex(/^[a-f0-9]{64}$/, "computedHash must be a 64-char hex SHA-256"),
  resolvedAt: z.string(),
  /** Upstream commit the skill resolved to (used by the `version` freshness check). */
  resolvedCommit: z.string().optional(),
  /** Tracked symbolic ref (branch/tag) the skill follows. */
  ref: z.string().optional(),
});

export const lockFileSchema = z.object({
  version: z.literal(1),
  skills: z.record(z.string(), skillLockEntrySchema),
});

export type LockFileParsed = z.infer<typeof lockFileSchema>;
export type SkillLockEntry = z.infer<typeof skillLockEntrySchema>;
