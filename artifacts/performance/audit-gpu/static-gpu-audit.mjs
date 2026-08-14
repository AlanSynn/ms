import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const output = process.argv[2] ? resolve(process.argv[2]) : join(here, "raw", "static-source-audit.json");
const files = [
  "components/ThreePuppetPreview.tsx",
  "components/stages/foundry/ThreeFoundryPreview.tsx",
  "components/stages/path/PathCanvasPane.tsx",
  "components/stages/path/SceneSketch.tsx",
  "components/AppStageRouter.tsx",
  "utils/animationClock.ts",
  "hooks/useWorkspacePlaybackLoop.ts",
];
const patterns = {
  webglRendererCreation: /new THREE\.WebGLRenderer\(/g,
  rendererDispose: /renderer\.dispose\(/g,
  rendererSubmission: /(?:queuedRenderer|renderer)\.render\(/g,
  rendererInfo: /renderer\.info(?:\.|\[)/g,
  shaderPrecompile: /\.compileAsync\(|\.compile\(/g,
  contextEvents: /webglcontextlost|webglcontextrestored/g,
  loseContext: /WEBGL_lose_context|forceContextLoss/g,
  visibilityHandling: /visibilitychange|document\.hidden|visibilityState/g,
  rawRaf: /requestAnimationFrame\(/g,
};

const positions = (source, expression) => {
  const result = [];
  for (const match of source.matchAll(expression)) {
    const index = match.index ?? 0;
    const line = source.slice(0, index).split("\n").length;
    const excerpt = source.split("\n")[line - 1]?.trim() ?? "";
    result.push({ line, excerpt });
  }
  return result;
};

const result = { repository, generatedAt: new Date().toISOString(), files: {}, totals: {} };
for (const file of files) {
  const source = await readFile(join(repository, file), "utf8");
  result.files[file] = Object.fromEntries(
    Object.entries(patterns).map(([name, expression]) => [name, positions(source, expression)]),
  );
}
for (const name of Object.keys(patterns)) {
  result.totals[name] = Object.values(result.files).reduce((count, matches) => count + matches[name].length, 0);
}
result.summary = {
  rendererCreationFiles: Object.entries(result.files)
    .filter(([, matches]) => matches.webglRendererCreation.length)
    .map(([file]) => relative(repository, join(repository, file))),
  noRuntimeContextRecoveryHandlers: result.totals.contextEvents === 0 && result.totals.loseContext === 0,
  noVisibilityHandlerInRuntime: result.totals.visibilityHandling === 0,
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, totals: result.totals, summary: result.summary }, null, 2));
