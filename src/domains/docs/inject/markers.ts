export interface ReplaceResult {
  text: string;
  changed: boolean;
  appended: boolean;
}

/**
 * Replace the content under a `## Heading` (or `# Heading`) line.
 * The block ends at the next sibling-or-higher heading (`## ` or `# `) or EOF.
 *
 * - Heading absent: append `<blank line><heading>\n<payload>\n` at end.
 * - Heading present: replace lines after the heading up to the boundary with
 *   `payload`, then a single blank line before the boundary (or EOF).
 * - Equality short-circuit: if the resulting text equals input, changed=false.
 *
 * Payload is inserted verbatim; callers strip leading/trailing whitespace as
 * desired.
 */
export function replaceUnderHeading(text: string, heading: string, payload: string): ReplaceResult {
  const lines = text.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => line === heading);

  if (startIdx < 0) {
    const trailingNewline = text.endsWith("\n") ? "" : "\n";
    const sep = text.length === 0 ? "" : "\n";
    const newText = `${text}${trailingNewline}${sep}${heading}\n${payload}\n`;
    return { text: newText, changed: true, appended: true };
  }

  let endIdx = lines.length;
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (/^#{1,2} /.test(lines[j]!)) {
      endIdx = j;
      break;
    }
  }

  const before = lines.slice(0, startIdx + 1);
  const after = lines.slice(endIdx);
  const payloadLines = payload.split(/\r?\n/);
  const tail = after.length === 0 ? [] : ["", ...after];
  const next = [...before, ...payloadLines, ...tail].join("\n");
  return { text: next, changed: next !== text, appended: false };
}

export interface ExtractedFrontmatter {
  body: string;
}

/**
 * Removes a YAML frontmatter block (--- … ---) from the beginning if present.
 * Returns only the body. If no frontmatter, returns the input unchanged.
 */
export function stripFrontmatter(text: string): string {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return text;
  return text.slice(match[0].length).replace(/^\s+/, "");
}
