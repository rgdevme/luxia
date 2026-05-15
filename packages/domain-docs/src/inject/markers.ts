export interface ReplaceResult {
  text: string;
  changed: boolean;
  appended: boolean;
}

/**
 * Replace content between `startMarker` and `endMarker` lines.
 * Markers themselves are preserved verbatim.
 *
 * - If both markers are present and in correct order, replace the lines between them with `payload`.
 * - If either marker is missing, append `<blank line><startMarker>\n<payload>\n<endMarker>` at the end.
 * - Equality short-circuit: if the resulting text equals input, returns changed=false.
 *
 * `payload` is inserted verbatim between markers; callers strip leading/trailing whitespace as desired.
 */
export function replaceBetweenMarkers(
  text: string,
  startMarker: string,
  endMarker: string,
  payload: string,
): ReplaceResult {
  const lines = text.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => line === startMarker);
  const endIdx = startIdx >= 0 ? lines.findIndex((line, i) => i > startIdx && line === endMarker) : -1;

  if (startIdx < 0 || endIdx < 0) {
    const trailingBlank = text.endsWith("\n") ? "" : "\n";
    const sep = text.length === 0 ? "" : "\n";
    const newText = `${text}${trailingBlank}${sep}${startMarker}\n${payload}\n${endMarker}\n`;
    return { text: newText, changed: true, appended: true };
  }

  const before = lines.slice(0, startIdx + 1);
  const after = lines.slice(endIdx);
  const payloadLines = payload.split(/\r?\n/);
  const next = [...before, ...payloadLines, ...after].join("\n");
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
