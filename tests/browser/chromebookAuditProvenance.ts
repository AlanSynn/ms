import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { arch, cpus, platform, release } from "node:os";

import { CHROMEBOOK_AUDIT_PROFILE } from "./chromebookAuditProfiles";

export type ChromebookAuditProvenance = {
  sourceRevision: string;
  sourceTreeDirty: boolean;
  distSha256: string;
  buildProfile: "e2e-diagnostics";
  baseURL: string;
  invocation: {
    command: string;
    commandSource: "explicit-environment" | "playwright-process";
    auditProfile: typeof CHROMEBOOK_AUDIT_PROFILE.name;
    auditScope: string;
  };
  host: {
    platform: string;
    release: string;
    architecture: string;
    logicalCpuCount: number;
    cpuModel: string;
    runtime: string;
  };
  ci: {
    provider: "github-actions" | "local";
    runId?: string;
    runAttempt?: string;
    job?: string;
    workflow?: string;
    ref?: string;
    sha?: string;
    runnerName?: string;
    runnerOs?: string;
    runnerArch?: string;
  };
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
): Promise<ChromebookAuditProvenance> => {
  const explicitCommand = process.env.CHROMEBOOK_AUDIT_INVOCATION;
  const cpu = cpus();
  const githubActions = process.env.GITHUB_ACTIONS === "true";
  return {
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
    invocation: {
      command: explicitCommand ?? process.argv.join(" "),
      commandSource: explicitCommand
        ? "explicit-environment"
        : "playwright-process",
      auditProfile: CHROMEBOOK_AUDIT_PROFILE.name,
      auditScope: process.env.CHROMEBOOK_AUDIT_SCOPE ?? "unspecified",
    },
    host: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      logicalCpuCount: cpu.length,
      cpuModel: cpu[0]?.model ?? "unknown",
      runtime: `${process.release.name} ${process.version}`,
    },
    ci: githubActions
      ? {
          provider: "github-actions",
          runId: process.env.GITHUB_RUN_ID,
          runAttempt: process.env.GITHUB_RUN_ATTEMPT,
          job: process.env.GITHUB_JOB,
          workflow: process.env.GITHUB_WORKFLOW,
          ref: process.env.GITHUB_REF,
          sha: process.env.GITHUB_SHA,
          runnerName: process.env.RUNNER_NAME,
          runnerOs: process.env.RUNNER_OS,
          runnerArch: process.env.RUNNER_ARCH,
        }
      : { provider: "local" },
  };
};
