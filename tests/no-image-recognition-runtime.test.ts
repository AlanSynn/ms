import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const packageJson = JSON.parse(read("package.json"));
const dependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
  ...packageJson.optionalDependencies,
};

assert.equal(dependencies["onnxruntime-web"], undefined, "ORT is not installed");
for (const path of [
  "public/onnx",
  "runtime/ai",
  "utils/webOnnx.ts",
  "workers/webOnnxCacheWorker.ts",
  "workers/webOnnxInferenceWorker.ts",
  "hooks/useAppOnnxBootstrap.ts",
]) {
  assert.equal(existsSync(join(root, path)), false, `${path} stays absent`);
}

const runtimeSurface = [
  read("components/shell/GettingStartedDialog.tsx"),
  read("components/stages/character/CharacterImportControls.tsx"),
  read("components/AppWorkspaceShell.tsx"),
  read("hooks/useMotionSmithAppController.ts"),
].join("\n");

assert.doesNotMatch(runtimeSurface, /Create from image|Get AI|onnx-input|onnx-cache-status/);
assert.match(runtimeSurface, /Character file/);
assert.match(runtimeSurface, /Add object/);

const scripts = packageJson.scripts as Record<string, string>;
assert.match(scripts.build, /check-no-image-recognition\.mjs --source/);
assert.match(scripts.build, /check-no-image-recognition\.mjs --dist/);
assert.match(scripts["build:tauri-frontend"], /check-no-image-recognition\.mjs --dist/);
assert.equal(scripts["test:chromebook-audit:real-ai"], undefined);

console.log("Image-recognition runtime exclusion contract passed.");
