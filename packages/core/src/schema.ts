import { z } from "zod";

export const agentRefSchema = z.string().min(1);

export const rulesDeclarationSchema = z.object({
  /** Canonical basename for every rule file. Agent-neutral by convention. */
  filename: z.string().min(1).default("AGENTS.md"),
  /** Base dir for canonical sources. The root file is `<root>/<filename>`. */
  root: z
    .string()
    .transform((s) => {
      const t = s.replace(/\\/g, "/").trim();
      return t === "" ? "." : t;
    })
    .default("."),
  /** Additional dirs (relative to `root`) that each hold a `<filename>`. May contain "..". */
  dirs: z.array(z.string().min(1)).default([]),
});

/** Local-name pattern for `agnos.json#skills` keys. */
export const skillNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, "skill name must be alphanumeric/dash");

/**
 * A composite skill reference, e.g. "github:vercel-labs/agent-skills/skills/pdf".
 * Validated structurally here (non-empty, no invalid chars). Full parsing happens
 * via `parseCompositeSkillRef` in `source.ts`.
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
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  transport: z.enum(["stdio", "sse", "http"]).optional(),
});

export const metadataSchema = z.record(z.string(), z.string());

export const docsConfigSchema = z.object({
  route: z.string().optional(),
  metadata: metadataSchema.optional(),
  index: z.string().optional(),
  content: z.union([z.string(), z.literal(false)]).optional(),
  docRules: z.string().optional(),
  injectIndex: z.boolean().optional(),
  injectRules: z.boolean().optional(),
});

export const agnosConfigSchema = z
  .object({
    $schema: z.string().optional(),
    agents: z.array(agentRefSchema).optional(),
    rules: rulesDeclarationSchema.optional(),
    skills: skillsConfigSchema.optional(),
    mcp: z.array(mcpDeclarationSchema).optional(),
    docs: docsConfigSchema.optional(),
  })
  .passthrough();

export type AgnosConfigParsed = z.infer<typeof agnosConfigSchema>;

export const skillLockEntrySchema = z.object({
  computedHash: z.string().regex(/^[a-f0-9]{64}$/, "computedHash must be a 64-char hex SHA-256"),
  resolvedAt: z.string(),
});

export const lockFileSchema = z.object({
  version: z.literal(1),
  skills: z.record(z.string(), skillLockEntrySchema),
});

export type LockFileParsed = z.infer<typeof lockFileSchema>;
export type SkillLockEntry = z.infer<typeof skillLockEntrySchema>;
