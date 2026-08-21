import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export type ChromebookAuditProvenance = {
  sourceRevision: string;
  sourceTreeDirty: boolean;
  distSha256: string;
  buildProfile: "e2e-diagnostics";
  baseURL: string;
};

const gitOutput = (args: string[]) => execFileSync("git", args, {
  cwd: process.cwd(),
  encoding: "utf8",
}).trim();

const filesBelow = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return files.flat().sort();
};

const hashDist = async () => {
  const root = resolve(process.cwd(), "dist");
  const hash = createHash("sha256");
  for (const path of await filesBelow(root)) {
    hash.update(relative(root, path));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
};

export const collectChromebookAuditProvenance = async (
  baseURL: string,
): Promise<ChromebookAuditProvenance> => ({
  sourceRevision: gitOutput(["rev-parse", "HEAD"]),
  sourceTreeDirty: gitOutput([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)artifacts/chromebook-audit",
    ":(exclude)test-results",
    ":(exclude)playwright-report",
  ]).length > 0,
  distSha256: await hashDist(),
  buildProfile: "e2e-diagnostics",
  baseURL,
});
