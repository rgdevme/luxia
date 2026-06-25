/**
 * Sentinel-delimited section injection for canonical rules files. Each
 * injectable fragment becomes a titled section wrapped in HTML-comment
 * sentinels keyed by a slug, so arbitrary markdown inside the body is safe and
 * orphaned sections are trivially detected. All operations are idempotent and
 * byte-stable: re-injecting identical content returns the input unchanged.
 */

export interface Section {
  slug: string;
  title: string;
  body: string;
}

const startMarker = (slug: string): string => `<!-- agnos:section:${slug} -->`;
const endMarker = (slug: string): string => `<!-- /agnos:section:${slug} -->`;

/** Slugify a title for use as a sentinel key (stable, filesystem/anchor-safe). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionRegExp(slug: string): RegExp {
  return new RegExp(`${escapeRegExp(startMarker(slug))}[\\s\\S]*?${escapeRegExp(endMarker(slug))}`);
}

/** Render a section's sentinel block (visible `# Title` heading + body). */
export function renderSection(s: Section): string {
  const body = s.body.trim();
  return `${startMarker(s.slug)}\n# ${s.title}\n\n${body}\n${endMarker(s.slug)}`;
}

/**
 * Inject or replace a section in `text`. If a block with the same slug exists,
 * its content is replaced in place; otherwise the block is appended. Returns the
 * new text (equal to the input when nothing changed).
 */
export function injectSection(text: string, s: Section): string {
  const block = renderSection(s);
  const re = sectionRegExp(s.slug);
  if (re.test(text)) return text.replace(re, block);
  const sep =
    text.length === 0 ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${sep}${block}\n`;
}

/**
 * Inject every section (in order) into `text`, then prune any agnos section
 * whose slug is not among the provided ones (orphans left by removed fragments).
 * Hand edits *outside* the sentinels are preserved.
 */
export function injectSections(text: string, sections: Section[]): string {
  let out = text;
  for (const s of sections) out = injectSection(out, s);
  return pruneOrphanSections(out, new Set(sections.map((s) => s.slug)));
}

/** Remove agnos sections whose slug is not in `keep`. */
export function pruneOrphanSections(text: string, keep: ReadonlySet<string>): string {
  const re = /<!-- agnos:section:([a-z0-9-]+) -->[\s\S]*?<!-- \/agnos:section:\1 -->\n?/g;
  return text.replace(re, (match, slug: string) => (keep.has(slug) ? match : ""));
}
