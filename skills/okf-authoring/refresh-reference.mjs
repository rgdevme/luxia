import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPEC_METADATA_URL =
  "https://api.github.com/repos/GoogleCloudPlatform/knowledge-catalog/contents/okf/SPEC.md?ref=main";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function buildTimestamp() {
  return new Date().toISOString();
}

function parseFrontmatter(content) {
  if (!content.startsWith("---\n")) {
    return { metadata: {}, body: content };
  }

  const end = content.indexOf("\n---\n", 4);
  if (end === -1) {
    return { metadata: {}, body: content };
  }

  const rawFrontmatter = content.slice(4, end);
  const body = content.slice(end + "\n---\n".length);
  const metadata = {};

  for (const line of rawFrontmatter.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    metadata[key] = rawValue.replace(/^"(.*)"$/, "$1");
  }

  return { metadata, body };
}

function shouldRefresh(checkedAt, forceRefresh) {
  if (forceRefresh) {
    return true;
  }

  if (!checkedAt) {
    return true;
  }

  const checkedTime = Date.parse(checkedAt);
  if (Number.isNaN(checkedTime)) {
    return true;
  }

  return Date.now() - checkedTime >= ONE_WEEK_MS;
}

function buildReferenceFile(spec, specHash, checkedAt) {
  return `---\nokfSpecHash: "${specHash}"\ncheckedAt: "${checkedAt}"\n---\n\n${spec}`;
}

async function fetchUpstreamMetadata() {
  const response = await fetch(SPEC_METADATA_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "agnos-okf-refresh",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OKF spec metadata: ${response.status} ${response.statusText}`);
  }

  const metadata = await response.json();
  if (
    typeof metadata !== "object" ||
    metadata == null ||
    !("sha" in metadata) ||
    !("download_url" in metadata) ||
    typeof metadata.sha !== "string" ||
    typeof metadata.download_url !== "string"
  ) {
    throw new Error("GitHub returned OKF spec metadata in an unexpected shape.");
  }

  return {
    hash: metadata.sha,
    downloadUrl: metadata.download_url,
  };
}

async function fetchUpstreamSpec(downloadUrl) {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download OKF spec: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

async function runRefreshOkfSpec(args) {
  const forceRefresh = args.includes("--force");
  const skillRoot = path.dirname(fileURLToPath(import.meta.url));
  const referencePath = path.join(skillRoot, "references", "OKF-SPEC.md");
  const localReference = await readFile(referencePath, "utf8");
  const { metadata, body } = parseFrontmatter(localReference);

  if (!shouldRefresh(metadata.checkedAt, forceRefresh)) {
    console.log(`OKF spec was checked at ${metadata.checkedAt}. Skipping refresh.`);
    return;
  }

  const upstream = await fetchUpstreamMetadata();
  const checkedAt = buildTimestamp();

  if (upstream.hash === metadata.okfSpecHash) {
    await writeFile(referencePath, buildReferenceFile(body, upstream.hash, checkedAt));
    console.log("OKF spec hash is unchanged. Updated checkedAt metadata.");
    return;
  }

  const upstreamSpec = await fetchUpstreamSpec(upstream.downloadUrl);
  await writeFile(referencePath, buildReferenceFile(upstreamSpec, upstream.hash, checkedAt));
  console.log("OKF spec reference refreshed. Review dependent skills for policy changes.");
}

async function runMain() {
  try {
    await runRefreshOkfSpec(process.argv.slice(2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

void runMain();
