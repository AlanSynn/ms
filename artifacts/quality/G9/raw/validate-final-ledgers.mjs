import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const readTsv = (path) => {
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((line, index) => {
    const fields = line.split("\t");
    assert.equal(
      fields.length,
      header.length,
      `${path}:${index + 2} has ${fields.length} fields; expected ${header.length}`,
    );
    return Object.fromEntries(header.map((name, field) => [name, fields[field]]));
  });
  return { header, rows };
};

const runGit = (...args) =>
  Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
const unique = (values) => new Set(values);
const dispositionCounts = (rows) =>
  Object.fromEntries(
    [...rows.reduce((counts, row) => {
      counts.set(row.disposition, (counts.get(row.disposition) ?? 0) + 1);
      return counts;
    }, new Map())].sort(([left], [right]) => left.localeCompare(right)),
  );

const originalCommits = readTsv("artifacts/quality/commit-ledger.tsv").rows;
const originalHunks = readTsv("artifacts/quality/hunk-ledger.tsv").rows;
const finalCommits = readTsv("artifacts/quality/final-commit-ledger.tsv").rows;
const finalHunks = readTsv("artifacts/quality/final-hunk-ledger.tsv").rows;

assert.equal(originalCommits.length, 82);
assert.equal(finalCommits.length, 82);
assert.equal(originalHunks.length, 346);
assert.equal(finalHunks.length, 346);

const originalCommitIds = unique(originalCommits.map((row) => row.historical_sha));
const finalCommitIds = unique(finalCommits.map((row) => row.historical_sha));
const originalHunkIds = unique(originalHunks.map((row) => row.hunk_id));
const finalHunkIds = unique(finalHunks.map((row) => row.hunk_id));
assert.equal(originalCommitIds.size, 82);
assert.equal(finalCommitIds.size, 82);
assert.deepEqual([...finalCommitIds].sort(), [...originalCommitIds].sort());
assert.equal(originalHunkIds.size, 346);
assert.equal(finalHunkIds.size, 346);
assert.deepEqual([...finalHunkIds].sort(), [...originalHunkIds].sort());

const allowed = new Set([
  "DROP_INTENTIONAL",
  "REPLACED_BY_LEAN_TELEMETRY",
  "REWORK_REQUIRED",
  "VERIFIED_CLEAN_IMPLEMENTATION",
]);
for (const row of [...finalCommits, ...finalHunks]) {
  assert(allowed.has(row.disposition), `invalid disposition ${row.disposition}`);
  assert(!/PENDING|TODO|TBD|UNKNOWN/.test(row.disposition));
  assert(row.primary_lane.length > 0);
  assert(row.rationale?.length > 0 || row.notes?.length > 0);
}

const evidencePaths = new Set();
const acceptedCommits = new Set();
for (const row of [...finalCommits, ...finalHunks]) {
  assert(row.evidence.length > 0, `missing evidence for ${row.hunk_id ?? row.historical_sha}`);
  for (const path of row.evidence.split(";")) {
    assert(path.length > 0);
    assert(existsSync(path), `missing evidence path ${path}`);
    evidencePaths.add(path);
  }
  assert(row.accepted_commit.length > 0);
  if (row.accepted_commit === "-") continue;
  acceptedCommits.add(row.accepted_commit);
}

for (const sha of acceptedCommits) {
  const object = runGit("cat-file", "-e", `${sha}^{commit}`);
  assert.equal(object.exitCode, 0, `accepted commit ${sha} is not a commit`);
  const ancestor = runGit("merge-base", "--is-ancestor", sha, "HEAD");
  assert.equal(ancestor.exitCode, 0, `accepted commit ${sha} is not integrated`);
}

console.log(
  JSON.stringify(
    {
      commitRows: finalCommits.length,
      uniqueHistoricalCommits: finalCommitIds.size,
      commitDispositions: dispositionCounts(finalCommits),
      hunkRows: finalHunks.length,
      uniqueHistoricalHunks: finalHunkIds.size,
      hunkDispositions: dispositionCounts(finalHunks),
      evidencePaths: evidencePaths.size,
      acceptedCommits: acceptedCommits.size,
      pending: 0,
      exactOriginalIdSets: true,
      evidencePathsExist: true,
      acceptedCommitsIntegrated: true,
    },
    null,
    2,
  ),
);
