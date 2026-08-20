#!/usr/bin/env node
import { access, readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const mode = process.argv[2] ?? "--all";

const forbiddenSourcePaths = [
  "public/onnx",
  "runtime/ai",
  "utils/webOnnx.ts",
  "workers/webOnnxCacheWorker.ts",
  "workers/webOnnxInferenceWorker.ts",
  "hooks/useAppOnnxBootstrap.ts",
  "components/shell/OnnxCacheStatusPill.tsx",
  "resources/starterImageTemplates.ts",
  "resources/examples/raw/boy.png",
  "resources/examples/raw/girl.png",
];

const activeSourceDirectories = [
  "components",
  "hooks",
  "public",
  "resources",
  "runtime",
  "utils",
  "workers",
];

const forbiddenSourceNames = [/onnx/i, /imageRecognition/i, /pose[_-]?model/i];

const forbiddenBundleNames = [
  /\.onnx$/i,
  /onnxruntime/i,
  /webonnx/i,
  /ort(?:-wasm|\.bundle)/i,
  /pose_model/i,
];

const forbiddenBundleText = [
  /onnxruntime-web/i,
  /InferenceSession\.create/,
  /webOnnx(?:Cache|Inference)Worker/,
  /pose_model\.onnx/i,
  /ort-wasm[^"'\s]*\.wasm/i,
];

const forbiddenSourceText = [
  ...forbiddenBundleText,
  /data-testid=["'](?:onnx-input|onnx-cache-status|getting-started-onnx-input)["']/i,
  />\s*Create from image\s*</i,
];

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

const checkSource = async () => {
  const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  };
  if (dependencies["onnxruntime-web"]) {
    throw new Error("onnxruntime-web must not be installed in the classroom app");
  }
  const present = [];
  for (const path of forbiddenSourcePaths) {
    if (await exists(join(ROOT, path))) present.push(path);
  }
  if (present.length) {
    throw new Error(`Image-recognition source/assets must not ship: ${present.join(", ")}`);
  }
  const activeFiles = [];
  for (const directory of activeSourceDirectories) {
    const path = join(ROOT, directory);
    if (await exists(path)) activeFiles.push(...await walk(path));
  }
  const forbiddenNames = activeFiles
    .map((file) => relative(ROOT, file))
    .filter((file) => forbiddenSourceNames.some((pattern) => pattern.test(file)));
  const forbiddenText = [];
  for (const file of activeFiles) {
    if (![".html", ".js", ".mjs", ".ts", ".tsx"].includes(extname(file))) continue;
    const source = await readFile(file, "utf8");
    const pattern = forbiddenSourceText.find((candidate) => candidate.test(source));
    if (pattern) forbiddenText.push(`${relative(ROOT, file)} (${pattern.source})`);
  }
  if (forbiddenNames.length || forbiddenText.length) {
    throw new Error([
      "Image-recognition code found in active source.",
      ...forbiddenNames.map((file) => `file: ${file}`),
      ...forbiddenText.map((file) => `content: ${file}`),
    ].join("\n"));
  }
};

const checkDist = async () => {
  if (!await exists(DIST)) throw new Error("dist is missing; build before checking it");
  const files = await walk(DIST);
  const forbiddenNames = files
    .map((file) => relative(DIST, file))
    .filter((file) => forbiddenBundleNames.some((pattern) => pattern.test(file)));
  const forbiddenText = [];
  for (const file of files) {
    if (![".html", ".js", ".css", ".json", ".map"].includes(extname(file))) continue;
    const source = await readFile(file, "utf8");
    const pattern = forbiddenBundleText.find((candidate) => candidate.test(source));
    if (pattern) forbiddenText.push(`${relative(DIST, file)} (${pattern.source})`);
  }
  if (forbiddenNames.length || forbiddenText.length) {
    throw new Error([
      "Image-recognition runtime found in production output.",
      ...forbiddenNames.map((file) => `file: ${file}`),
      ...forbiddenText.map((file) => `content: ${file}`),
    ].join("\n"));
  }
};

if (mode !== "--dist") await checkSource();
if (mode !== "--source") await checkDist();

console.log(`Image-recognition exclusion passed (${mode.slice(2)}).`);
