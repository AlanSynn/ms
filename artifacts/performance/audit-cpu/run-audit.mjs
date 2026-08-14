import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const auditDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(auditDirectory, "../../..");
const rawDirectory = path.join(auditDirectory, "raw");
const configPath = path.join(auditDirectory, "vite.audit.config.ts");
const browserAuditPath = path.join(auditDirectory, "run-browser-audit.ts");
const staticAuditPath = path.join(auditDirectory, "static-audit.mjs");
const port = Number(process.env.MS_AUDIT_PORT ?? "5207");
const previewUrl = `http://127.0.0.1:${port}`;
const previewCommand = [
  "bunx",
  "vite",
  "preview",
  "--config",
  configPath,
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
  "--strictPort",
];

if (!Number.isInteger(port) || port < 1 || port > 65_535)
  throw new Error("MS_AUDIT_PORT must be a valid TCP port");

await mkdir(rawDirectory, { recursive: true });

const commandRecords = [];
const streamText = async (stream) => new Response(stream).text();

const run = async (label, cmd, extraEnv = {}) => {
  const startedAt = new Date().toISOString();
  const childProcess = Bun.spawn({
    cmd,
    cwd: repositoryRoot,
    env: { ...process.env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    streamText(childProcess.stdout),
    streamText(childProcess.stderr),
    childProcess.exited,
  ]);
  await Promise.all([
    writeFile(path.join(rawDirectory, `${label}.stdout.log`), stdout),
    writeFile(path.join(rawDirectory, `${label}.stderr.log`), stderr),
  ]);
  const record = { label, cmd, startedAt, endedAt: new Date().toISOString(), exitCode };
  commandRecords.push(record);
  if (exitCode !== 0) throw new Error(`${label} exited ${exitCode}`);
  return record;
};

const waitForPreview = async () => {
  const deadline = Date.now() + 120_000;
  let lastError = "preview did not respond";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(previewUrl);
      if (response.ok) return;
      lastError = `preview returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(250);
  }
  throw new Error(`preview did not become ready: ${lastError}`);
};

let preview;
let previewStdout;
let previewStderr;
let failure;
try {
  await run("dependency-install", ["bun", "install", "--frozen-lockfile"]);
  await run("static-audit", ["bun", "run", staticAuditPath]);
  await run("typecheck", ["bunx", "tsc", "--noEmit"]);
  await run("audit-build", ["bunx", "vite", "build", "--config", configPath]);

  preview = Bun.spawn({
    cmd: previewCommand,
    cwd: repositoryRoot,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  previewStdout = streamText(preview.stdout);
  previewStderr = streamText(preview.stderr);
  await waitForPreview();
  await run("browser-audit", ["bun", "run", browserAuditPath], {
    MS_AUDIT_URL: previewUrl,
  });
} catch (error) {
  failure = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
} finally {
  if (preview) {
    try {
      preview.kill();
      const exitCode = await preview.exited;
      const [stdout, stderr] = await Promise.all([previewStdout, previewStderr]);
      await Promise.all([
        writeFile(path.join(rawDirectory, "preview.stdout.log"), stdout),
        writeFile(path.join(rawDirectory, "preview.stderr.log"), stderr),
      ]);
      commandRecords.push({
        label: "preview",
        cmd: previewCommand,
        startedAt: null,
        endedAt: new Date().toISOString(),
        exitCode,
        terminatedByAudit: true,
      });
    } catch (finalizerError) {
      failure ??= {
        message: finalizerError instanceof Error ? finalizerError.message : String(finalizerError),
        stack: finalizerError instanceof Error ? finalizerError.stack : undefined,
      };
    }
  }
  try {
    await writeFile(
      path.join(rawDirectory, "command-exit-codes.json"),
      `${JSON.stringify({
        baseline: "97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af",
        records: commandRecords,
        failure: failure ?? null,
      }, null, 2)}\n`,
    );
  } catch (finalizerError) {
    failure ??= {
      message: finalizerError instanceof Error ? finalizerError.message : String(finalizerError),
      stack: finalizerError instanceof Error ? finalizerError.stack : undefined,
    };
  }
}

if (failure) {
  console.error(failure.stack ?? failure.message);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "passed", commands: commandRecords.map(({ label, exitCode }) => ({ label, exitCode })) }));
}
