import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { HarnessAdapter, SkillMetadataDiagnostic } from "./types/public.js";

export function validateRequiredSkillFields(
  harnessId: string,
  name: string,
  directory: string,
  frontmatter: Record<string, unknown>,
  fields: readonly string[],
): SkillMetadataDiagnostic[] {
  const file = path.join(directory, "SKILL.md");
  return fields.flatMap((field) => {
    const value = frontmatter[field];
    if (typeof value === "string" && value.trim().length > 0) return [];
    return [
      {
        code: `skill-metadata-${typeof value === "undefined" ? "missing" : "invalid"}-${field}`,
        harnessId,
        skillName: name,
        file,
        field,
        message: `frontmatter field "${field}" must be a non-empty string`,
      },
    ];
  });
}

export interface ParsedSkillMetadata {
  frontmatter?: Record<string, unknown>;
  diagnostic?: Omit<SkillMetadataDiagnostic, "harnessId">;
}

export async function parseSkillMetadata(
  name: string,
  directory: string,
): Promise<ParsedSkillMetadata> {
  const file = path.join(directory, "SKILL.md");
  let content: string;
  try {
    content = await fs.readFile(file, "utf8");
  } catch (error) {
    return {
      diagnostic: {
        code: "skill-metadata-unreadable",
        skillName: name,
        file,
        message: `cannot read SKILL.md: ${(error as Error).message}`,
      },
    };
  }

  try {
    const parsed = matter(content);
    if (!parsed.matter) {
      return {
        diagnostic: {
          code: "skill-metadata-missing-frontmatter",
          skillName: name,
          file,
          message: "SKILL.md has no YAML frontmatter",
        },
      };
    }
    if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
      return {
        diagnostic: {
          code: "skill-metadata-invalid-frontmatter",
          skillName: name,
          file,
          message: "SKILL.md frontmatter must be a YAML mapping",
        },
      };
    }
    return { frontmatter: parsed.data as Record<string, unknown> };
  } catch (error) {
    return {
      diagnostic: {
        code: "skill-metadata-invalid-frontmatter",
        skillName: name,
        file,
        message: `cannot parse YAML frontmatter: ${(error as Error).message}`,
      },
    };
  }
}

export async function validateSkillForHarnesses(
  name: string,
  directory: string,
  harnesses: readonly HarnessAdapter[],
): Promise<SkillMetadataDiagnostic[]> {
  const parsed = await parseSkillMetadata(name, directory);
  const parseDiagnostic = parsed.diagnostic;
  if (parseDiagnostic) {
    return harnesses.map((harness) => ({ ...parseDiagnostic, harnessId: harness.id }));
  }
  const frontmatter = parsed.frontmatter;
  if (!frontmatter) return [];

  const diagnostics: SkillMetadataDiagnostic[] = [];
  for (const harness of harnesses) {
    diagnostics.push(...(await harness.validateSkillMetadata({ name, directory, frontmatter })));
  }
  return diagnostics;
}
