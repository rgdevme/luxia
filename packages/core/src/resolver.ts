import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { downloadTemplate } from "giget";
import type { SourceResolver } from "./types/public.js";

interface ResolverOptions {
  projectRoot: string;
  cacheDir: string;
}

export function createSourceResolver({ projectRoot, cacheDir }: ResolverOptions): SourceResolver {
  return {
    async resolve(source, destDir, opts) {
      await fs.mkdir(destDir, { recursive: true });
      const cachePath = path.join(cacheDir, hashKey(source));

      if (source.startsWith("file:")) {
        const rel = source.slice("file:".length);
        const abs = path.resolve(projectRoot, rel);
        await copyRecursive(abs, destDir);
        return { path: destDir };
      }

      if (source.startsWith("github:") || source.startsWith("npm:") || source.startsWith("http://") || source.startsWith("https://")) {
        const giSource = normalizeForGiget(source);
        await fs.rm(destDir, { recursive: true, force: true });
        await downloadTemplate(giSource, {
          dir: destDir,
          force: true,
          forceClean: true,
          install: false,
          offline: false,
          preferOffline: !opts?.noCache,
          cwd: projectRoot,
          registry: cachePath,
        }).catch(async (err) => {
          // giget cache poisoning workaround: retry once with cache disabled
          if (opts?.noCache) throw err;
          await downloadTemplate(giSource, {
            dir: destDir,
            force: true,
            forceClean: true,
            install: false,
            offline: false,
            preferOffline: false,
            cwd: projectRoot,
          });
        });
        return { path: destDir };
      }

      throw new Error(`Unsupported source scheme: ${source}`);
    },
  };
}

function normalizeForGiget(source: string): string {
  // giget accepts: 'github:owner/repo/subdir#ref', 'npm:pkg', 'http(s)://...'
  return source;
}

async function copyRecursive(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.cp(src, dest, { recursive: true, force: true });
  } else {
    await fs.mkdir(path.dirname(path.join(dest, path.basename(src))), { recursive: true });
    await fs.copyFile(src, path.join(dest, path.basename(src)));
  }
}

function hashKey(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}
