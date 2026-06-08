import { z } from "zod";

export const agentRefSchema = z.string().min(1);

export const rulesDeclarationSchema = z.object({
  source: z.string().min(1),
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

/**
 * Hooks registry. Modeled on Claude Code's hook shape (the superset across
 * agents) and intentionally permissive: each handler must carry a `type`, but
 * all other fields pass through so agent dialects (Codex `command_windows`,
 * Claude `if`/`once`/`async`/`statusMessage`, …) survive a round-trip.
 */
export const hookHandlerSchema = z.object({ type: z.string().min(1) }).passthrough();

export const hookMatcherGroupSchema = z
  .object({
    matcher: z.string().optional(),
    hooks: z.array(hookHandlerSchema),
  })
  .passthrough();

/** event name (e.g. "PreToolUse") → matcher groups. */
export const hooksConfigSchema = z.record(z.string().min(1), z.array(hookMatcherGroupSchema));

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
    hooks: hooksConfigSchema.optional(),
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
