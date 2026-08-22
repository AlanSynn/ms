import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { CHROMEBOOK_FEATURE_NAMES } from "./chromebookFeatureAuditReport";
import {
  CHROMEBOOK_AUDIT_PROFILE_NAMES,
  type ChromebookAuditProfileName,
} from "./chromebookAuditProfiles";

export const CHROMEBOOK_AUDIT_SCOPES = ["feature", "full"] as const;
export type ChromebookAuditScope = (typeof CHROMEBOOK_AUDIT_SCOPES)[number];

const sharedReports = [
  "entry/chromebook-classroom-entry-audit.json",
  ...CHROMEBOOK_FEATURE_NAMES.map(
    (name) => `features/chromebook-feature-${name}-audit.json`,
  ),
  "playback/chromebook-playback-audit.json",
  "playback/chromebook-path-playback-audit.json",
  "playback/chromebook-design-playback-audit.json",
  "playback/chromebook-assembly-playback-audit.json",
  "stages/chromebook-stage-switch-audit.json",
  "high-resolution/chromebook-high-resolution-audit.json",
] as const;

export const expectedChromebookAuditReports = (
  scope: ChromebookAuditScope,
) => [
  ...sharedReports,
  ...(scope === "full" ? ["workflow/chromebook-audit.json"] : []),
].sort();

type AuditArtifactManifest = {
  schemaVersion: 1;
  generatedAt: string;
  scope: ChromebookAuditScope;
  profile: ChromebookAuditProfileName;
  outputRoot: string;
  expectedReports: string[];
  observedReports: string[];
  missingReports: string[];
  unexpectedReports: string[];
  preparedEmpty: boolean;
  validation: "prepared" | "passed" | "failed";
};

const manifestPath = (root: string) => join(root, "manifest.json");

const assertSafeOutputRoot = (value: string) => {
  const root = resolve(value);
  const allowedParents = [
    resolve(process.env.RUNNER_TEMP ?? tmpdir(), "chromebook-audit"),
    resolve(process.cwd(), "artifacts/chromebook-audit/runs"),
  ];
  const isStrictDescendant = (parent: string) => {
    const child = relative(parent, root);
    return child !== "" && !child.startsWith(`..${sep}`) && child !== ".." &&
      !isAbsolute(child);
  };
  if (!allowedParents.some(isStrictDescendant)) {
    throw new Error(`Refusing unsafe Chromebook audit output root: ${root}`);
  }
  return root;
};

const filesBelow = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return files.flat();
};

const writeManifest = async (manifest: AuditArtifactManifest) => {
  const path = manifestPath(manifest.outputRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

export const prepareChromebookAuditArtifacts = async (
  outputRoot: string,
  scope: ChromebookAuditScope,
  profile: ChromebookAuditProfileName,
) => {
  const root = assertSafeOutputRoot(outputRoot);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const manifest: AuditArtifactManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope,
    profile,
    outputRoot: root,
    expectedReports: expectedChromebookAuditReports(scope),
    observedReports: [],
    missingReports: [],
    unexpectedReports: [],
    preparedEmpty: (await readdir(root)).length === 0,
    validation: "prepared",
  };
  await writeManifest(manifest);
  return manifest;
};

export const validateChromebookAuditArtifacts = async (
  outputRoot: string,
  scope: ChromebookAuditScope,
  profile: ChromebookAuditProfileName,
) => {
  const root = assertSafeOutputRoot(outputRoot);
  const prepared = JSON.parse(
    await readFile(manifestPath(root), "utf8"),
  ) as AuditArtifactManifest;
  if (
    prepared.scope !== scope ||
    prepared.profile !== profile ||
    !prepared.preparedEmpty
  ) {
    throw new Error("Chromebook artifact manifest does not match this run");
  }
  const expectedReports = expectedChromebookAuditReports(scope);
  const observedReports = (await filesBelow(root))
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => path !== "manifest.json" && path.endsWith(".json"))
    .sort();
  const missingReports = expectedReports.filter(
    (path) => !observedReports.includes(path),
  );
  const unexpectedReports = observedReports.filter(
    (path) => !expectedReports.includes(path),
  );
  const invalidReports: string[] = [];
  for (const reportPath of observedReports) {
    try {
      const report = JSON.parse(
        await readFile(join(root, reportPath), "utf8"),
      ) as Record<string, unknown>;
      const provenance = report.provenance as Record<string, unknown> | undefined;
      const invocation = provenance?.invocation as
        | Record<string, unknown>
        | undefined;
      if (
        report.schemaVersion !== 3 ||
        report.profile !== profile ||
        report.productionBuild !== true ||
        report.actualChromebookTested !== false ||
        typeof provenance?.sourceRevision !== "string" ||
        typeof provenance?.distSha256 !== "string" ||
        invocation?.auditProfile !== profile ||
        typeof invocation?.command !== "string"
      ) invalidReports.push(reportPath);
    } catch {
      invalidReports.push(reportPath);
    }
  }
  const passed =
    missingReports.length === 0 &&
    unexpectedReports.length === 0 &&
    invalidReports.length === 0;
  const manifest: AuditArtifactManifest & { invalidReports: string[] } = {
    ...prepared,
    generatedAt: new Date().toISOString(),
    expectedReports,
    observedReports,
    missingReports,
    unexpectedReports,
    invalidReports,
    validation: passed ? "passed" : "failed",
  };
  await writeManifest(manifest);
  if (!passed) {
    throw new Error(
      `Chromebook audit artifacts failed validation: missing=${missingReports.join(
        ",",
      ) || "none"}; unexpected=${unexpectedReports.join(
        ",",
      ) || "none"}; invalid=${invalidReports.join(",") || "none"}`,
    );
  }
  return manifest;
};

const parseScope = (value: string | undefined): ChromebookAuditScope => {
  if (!CHROMEBOOK_AUDIT_SCOPES.includes(value as ChromebookAuditScope)) {
    throw new Error(`Audit scope must be ${CHROMEBOOK_AUDIT_SCOPES.join(" or ")}`);
  }
  return value as ChromebookAuditScope;
};

const parseProfile = (value: string | undefined): ChromebookAuditProfileName => {
  if (!CHROMEBOOK_AUDIT_PROFILE_NAMES.includes(
    value as ChromebookAuditProfileName,
  )) {
    throw new Error(
      `Audit profile must be ${CHROMEBOOK_AUDIT_PROFILE_NAMES.join(" or ")}`,
    );
  }
  return value as ChromebookAuditProfileName;
};

if (import.meta.main) {
  const [command, outputRoot, scopeValue, profileValue] = process.argv.slice(2);
  if (!outputRoot) {
    throw new Error(
      "Usage: bun tests/browser/chromebookAuditArtifacts.ts <prepare|validate> <output-root> <feature|full> <regression-4x|acceptance-6x>",
    );
  }
  const scope = parseScope(scopeValue);
  const profile = parseProfile(profileValue);
  const manifest = command === "prepare"
    ? await prepareChromebookAuditArtifacts(outputRoot, scope, profile)
    : command === "validate"
      ? await validateChromebookAuditArtifacts(outputRoot, scope, profile)
      : (() => { throw new Error("Command must be prepare or validate"); })();
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
