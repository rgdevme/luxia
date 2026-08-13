import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type FileImportMethod = "clone" | "hardlink" | "copy";

export interface CopyTreeResult {
  methods: Set<FileImportMethod>;
}

export async function copyRegularTree(
  source: string,
  destination: string,
  importFiles = false,
): Promise<CopyTreeResult> {
  const methods = new Set<FileImportMethod>();
  await copyDirectory(source, destination, importFiles, methods);
  return { methods };
}

async function copyDirectory(
  source: string,
  destination: string,
  importFiles: boolean,
  methods: Set<FileImportMethod>,
): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        await copyDirectory(sourcePath, destinationPath, importFiles, methods);
        return;
      }
      if (!entry.isFile()) return;
      const method = importFiles
        ? await importFile(sourcePath, destinationPath)
        : await cloneOrCopyFile(sourcePath, destinationPath);
      methods.add(method);
      const stat = await fs.stat(sourcePath);
      await fs.chmod(destinationPath, stat.mode);
    }),
  );
}

async function importFile(source: string, destination: string): Promise<FileImportMethod> {
  try {
    await fs.copyFile(source, destination, constants.COPYFILE_FICLONE_FORCE);
    return "clone";
  } catch {
    try {
      await fs.link(source, destination);
      return "hardlink";
    } catch {
      await fs.copyFile(source, destination);
      return "copy";
    }
  }
}

async function cloneOrCopyFile(source: string, destination: string): Promise<FileImportMethod> {
  await fs.copyFile(source, destination, constants.COPYFILE_FICLONE);
  return "copy";
}
