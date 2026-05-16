import { z } from "zod";

export const agentRefSchema = z.string().min(1);

export const rulesDeclarationSchema = z.object({
  source: z.string().min(1),
});

export const skillDeclarationSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/i, "skill name must be alphanumeric/dash"),
  source: z.string().min(1),
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
    skills: z.array(skillDeclarationSchema).optional(),
    mcp: z.array(mcpDeclarationSchema).optional(),
    docs: docsConfigSchema.optional(),
  })
  .passthrough();

export type AgnosConfigParsed = z.infer<typeof agnosConfigSchema>;
