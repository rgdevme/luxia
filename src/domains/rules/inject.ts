/**
 * Heading-delimited section injection for canonical rules files. Each injectable
 * fragment becomes a level-2 heading (`## <title>`) whose section runs until the
 * next `##` heading or the end of the file. The slug of the title is the
 * section's identity (and its implicit markdown anchor). All operations are
 * idempotent and byte-stable: re-injecting identical content returns the input
 * unchanged.
 *
 * Because there are no sentinels, the injector cannot tell an agnos-managed
 * section from a hand-written one. Pruning of removed fragments is therefore
 * caller-driven: pass the previously-managed slugs to `injectSections` and only
 * those (when no longer present) are removed — hand-authored `##` sections are
 * always preserved.
 *
 * Note: a fragment body must not contain its own `##` heading — it would end the
 * section early. Fragment bodies should use `###` or deeper.
 */

export interface Section {
  slug: string;
  title: string;
  body: string;
}

/** Slugify a title for use as a section identity (stable, anchor-safe). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Render a section as a standalone `## Title` block (trailing whitespace trimmed). */
export function renderSection(s: Section): string {
  const body = s.body.trim();
  return body ? `## ${s.title}\n\n${body}` : `## ${s.title}`;
}

interface ParsedSection {
  slug: string;
  title: string;
  body: string;
}

interface ParsedDoc {
  preamble: string;
  sections: ParsedSection[];
}

const H2_LINE = /^##[ \t]+(.+?)[ \t]*$/gm;

/** Split text into the text before the first `##` and the ordered `##` sections. */
function parse(text: string): ParsedDoc {
  const heads: { index: number; end: number; title: string }[] = [];
  H2_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = H2_LINE.exec(text)) !== null) {
    heads.push({ index: m.index, end: m.index + m[0].length, title: m[1]!.trim() });
  }
  if (heads.length === 0) return { preamble: text, sections: [] };
  const preamble = text.slice(0, heads[0]!.index);
  const sections: ParsedSection[] = heads.map((h, i) => {
    const bodyStart = h.end;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1]!.index : text.length;
    return { slug: slugify(h.title), title: h.title, body: text.slice(bodyStart, bodyEnd).trim() };
  });
  return { preamble, sections };
}

/** Serialize deterministically: preamble, then each section, single trailing newline. */
function serialize(doc: ParsedDoc): string {
  const blocks: string[] = [];
  const preamble = doc.preamble.trim();
  if (preamble) blocks.push(preamble);
  for (const s of doc.sections) blocks.push(renderSection(s));
  if (blocks.length === 0) return "";
  return `${blocks.join("\n\n")}\n`;
}

function upsert(doc: ParsedDoc, s: Section): void {
  const node: ParsedSection = { slug: s.slug, title: s.title, body: s.body.trim() };
  const idx = doc.sections.findIndex((x) => x.slug === s.slug);
  if (idx === -1) doc.sections.push(node);
  else doc.sections[idx] = node;
}

/**
 * Inject or replace a single section. If a `## ` heading with the same slug
 * exists, its title and body are replaced in place; otherwise the section is
 * appended. Other sections and the preamble are preserved. Byte-stable.
 */
export function injectSection(text: string, s: Section): string {
  const doc = parse(text);
  upsert(doc, s);
  return serialize(doc);
}

/**
 * Inject every section (in order), then prune any section whose slug was in
 * `prevSlugs` (the previously-managed set) but is not among the ones provided
 * now — i.e. fragments that were removed. Sections never managed by agnos
 * (absent from `prevSlugs`) are preserved.
 */
export function injectSections(
  text: string,
  sections: Section[],
  prevSlugs: readonly string[] = [],
): string {
  const doc = parse(text);
  for (const s of sections) upsert(doc, s);
  const current = new Set(sections.map((s) => s.slug));
  const orphans = new Set(prevSlugs.filter((slug) => !current.has(slug)));
  if (orphans.size > 0) doc.sections = doc.sections.filter((s) => !orphans.has(s.slug));
  return serialize(doc);
}
