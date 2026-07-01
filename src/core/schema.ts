import { z } from "zod";

export const agentRefSchema = z.string().min(1);

/** Current `agnos.json` schema version. Configs without it are rejected (see config.ts). */
export const SCHEMA_VERSION = 1;

/**
 * Rules domain. Map of canonical rules file → injectable fragment files. The
 * rules domain injects each fragment as a titled section into its canonical
 * file. Replaces the former `filename`/`root`/`dirs` canonical-tree model.
 */
export const rulesDeclarationSchema = z.object({
  files: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
});

/** Local-name pattern for `agnos.json#skills` keys. */
export const skillNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, "skill name must be alphanumeric/dash");

/**
 * A composite skill reference, e.g. "github:vercel-labs/agent-skills/skills/pdf".
 */
export const skillRefSchema = z
  .string()
  .min(1)
  .refine((v) => !v.includes("\n") && !v.includes("\r"), "skill ref must be a single line");

export const skillSourcesSchema = z.record(skillNameSchema, skillRefSchema);

export const skillsConfigSchema = z.object({
  route: z.string().min(1).optional(),
  sources: skillSourcesSchema.optional(),
});

export const mcpDeclarationSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  transport: z.enum(["stdio", "sse", "http"]).optional(),
});

/**
 * Closed, normalized vocabulary of hook events. Each agent adapter maps the
 * subset it supports and skips the rest. (Proposed set — finalize against the
 * agents' real event names in a later milestone.)
 */
export const hookEventSchema = z.enum([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "SessionStart",
  "SessionEnd",
]);

/**
 * A single hook entry — a flat, strict 5-field shape. Agents render it into
 * their native format (regrouping by event/matcher as needed). `message` is
 * user-facing status text; agents without an equivalent ignore it. Identity for
 * dedup/removal is `(event, matcher, command)`.
 */
export const hookEntrySchema = z
  .object({
    event: hookEventSchema,
    matcher: z.string().optional(),
    type: z.literal("command"),
    command: z.string().min(1),
    message: z.string().optional(),
  })
  .strict();

/** Hooks registry: a flat array of entries. */
export const hooksConfigSchema = z.array(hookEntrySchema);

/**
 * Docs domain. Watches `root`, compiles an index. The doc-frontmatter shape is
 * fixed (see `docFrontmatterSchema`) and not user-overridable.
 */
export const docsConfigSchema = z.object({
  root: z.string().min(1).default(".docs"),
});

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
    agents: z.array(agentRefSchema).optional(),
    rules: rulesDeclarationSchema.optional(),
    skills: skillsConfigSchema.optional(),
    mcp: z.array(mcpDeclarationSchema).optional(),
    hooks: hooksConfigSchema.optional(),
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
