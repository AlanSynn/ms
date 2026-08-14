import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const auditDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(auditDirectory, "../../..");
const packageVersion = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
).version as string;

type Target = readonly [name: string, label: string];

const TARGETS: Record<string, readonly Target[]> = {
  "components/ThreePuppetPreview.tsx": [
    ["collectViewerScreenTargets", "three.collectViewerScreenTargets"],
    ["render", "three.puppetRender"],
  ],
  "components/stages/assembly/AssemblyCanvasPane.tsx": [
    ["AssemblyCanvasPane", "stage.AssemblyCanvasPane.render"],
  ],
  "components/stages/assembly/AssemblyGuide.tsx": [
    ["AssemblyGuide", "stage.AssemblyGuide.render"],
  ],
  "components/stages/assembly/AssemblyThreePreview.tsx": [
    ["AssemblyCharacterThreePreview", "stage.AssemblyCharacterThreePreview.render"],
    ["AssemblyMechanismThreePreview", "stage.AssemblyMechanismThreePreview.render"],
  ],
  "components/stages/assembly/assemblyGuideModel.ts": [
    ["buildAssemblyGuideModel", "assembly.buildGuideModel"],
  ],
  "components/stages/blueprint/BlueprintExport.tsx": [
    ["BlueprintExport", "stage.BlueprintExport.render"],
  ],
  "components/stages/foundry/FoundryInspectorPanel.tsx": [
    ["FoundryInspectorPanel", "stage.FoundryInspectorPanel.render"],
  ],
  "components/stages/foundry/FoundryWorkflowPanel.tsx": [
    ["FoundryWorkflowPanel", "stage.FoundryWorkflowPanel.render"],
  ],
  "components/stages/foundry/MechanismFoundry.tsx": [
    ["MechanismFoundry", "stage.MechanismFoundry.render"],
  ],
  "components/stages/foundry/ThreeFoundryPreview.tsx": [
    ["writeFoundryAutomataScreenTargets", "three.writeAutomataScreenTargets"],
    ["writeFoundryCameraDiagnostics", "three.writeFoundryCameraDiagnostics"],
    ["ThreeFoundryPreview", "stage.ThreeFoundryPreview.render"],
  ],
  "components/stages/mechanism/DesignFoundryPreview.tsx": [
    ["DesignFoundryPreview", "stage.DesignFoundryPreview.render"],
  ],
  "components/stages/mechanism/DesignInspectorPanel.tsx": [
    ["DesignInspectorPanel", "stage.DesignInspectorPanel.render"],
  ],
  "components/stages/mechanism/MechanismConnectionOverlay.tsx": [
    ["projectMechanismConnectionHoleHandles", "connection.projectHandles"],
  ],
  "components/stages/mechanism/MechanismDesign.tsx": [
    ["MechanismDesign", "stage.MechanismDesign.render"],
  ],
  "components/stages/mechanism/MechanismParametricEditor.tsx": [
    ["MechanismParametricEditor", "stage.MechanismParametricEditor.render"],
  ],
  "components/stages/path/PathEditor.tsx": [
    ["PathEditor", "stage.PathEditor.render"],
  ],
  "components/stages/path/SceneSketch.tsx": [
    ["SceneSketch", "stage.SceneSketch.render"],
  ],
  "utils/assemblySceneFrame.ts": [
    ["withAssemblySceneProgress", "assembly.withSceneProgress"],
    ["buildMechanismAssemblySceneFrame", "assembly.buildMechanismSceneFrame"],
    ["buildCharacterAssemblySceneFrame", "assembly.buildCharacterSceneFrame"],
  ],
  "utils/automataSceneModel.ts": [
    ["prepareAutomataSceneModel", "motion.prepareAutomataScene"],
    ["samplePreparedAutomataSceneModel", "motion.samplePreparedAutomataScene"],
  ],
  "utils/fabrication.ts": [
    ["validateForFabrication", "blueprint.validateForFabrication"],
    ["createFabricationPackage", "blueprint.createFabricationPackage"],
  ],
  "utils/fabricationBlueprintSvg.ts": [
    ["makeBlueprintPreviewSvg", "blueprint.makePreviewSvg"],
  ],
  "utils/fabricationReadiness.ts": [
    ["sampleFeasibleRange", "inspector.sampleFeasibleRange"],
  ],
  "utils/foundryPreviewModel.ts": [
    ["prepareFoundryMechanismPreviewModel", "motion.prepareFoundryPreview"],
    ["samplePreparedFoundryMechanismPreviewModel", "motion.samplePreparedFoundryPreview"],
  ],
  "utils/foundryPlayback.ts": [
    ["createPreparedFoundryPlaybackFrame", "motion.createPreparedFoundryPlaybackFrame"],
    ["createFoundryPlaybackFrame", "motion.createFoundryPlaybackFrame"],
    ["generatePreparedFoundryPlaybackPointTraces", "motion.generatePreparedFoundryPlaybackTraces"],
    ["generateFoundryPlaybackPointTraces", "motion.generateFoundryPlaybackTraces"],
  ],
  "utils/kinematics.ts": [
    ["mechanismSafetyPhaseSchedule", "safety.phaseSchedule"],
    ["prepareMechanismKinematics", "motion.prepareMechanismKinematics"],
    ["calculatePreparedLinkage", "motion.calculatePreparedLinkage"],
    ["calculateLinkage", "safety.calculateLinkage"],
  ],
  "utils/mechanismCompiler.ts": [
    ["compileMechanismGraphFabrication", "inspector.compileMechanismGraphFabrication"],
  ],
  "utils/mechanismConnectionSelections.ts": [
    ["mechanismConnectionHoleCandidates", "connection.enumerateRawCandidates"],
    ["projectMechanismConnectionHoleCandidates", "connection.projectCandidates"],
  ],
  "utils/mechanismEditAuthority.ts": [
    ["mechanismHasFiniteValidStates", "safety.phaseLinkageEvaluationSet"],
    ["mechanismEditIsSafe", "safety.mechanismEditIsSafe"],
    ["motionSafeParamRange", "inspector.motionSafeParamRange"],
  ],
  "utils/mechanismPhysicalCandidates.ts": [
    ["resolveMechanismPhysicalSelectionAttempt", "connection.preflightSelection"],
    ["mechanismPhysicalConnectionCandidates", "connection.enumeratePhysicalCandidates"],
  ],
  "utils/mechanismReadiness.ts": [
    ["mechanismReadiness", "inspector.mechanismReadiness"],
    ["projectMechanismReadiness", "inspector.projectMechanismReadiness"],
  ],
  "utils/mechanismSceneContract.ts": [
    ["buildProjectMechanismSceneContract", "scene.buildMechanismContract"],
  ],
  "utils/motion.ts": [
    ["motionPreviewForPath", "motion.motionPreviewForPath"],
    ["prepareMotionPreviewForProject", "motion.prepareProjectPreview"],
    ["samplePreparedMotionPreview", "motion.samplePreparedMotionPreview"],
  ],
  "utils/project.ts": [
    ["serializeProject", "autosave.serializeProject"],
  ],
  "utils/projectAutosaveTransactions.ts": [
    ["prepareAutosaveSnapshot", "autosave.prepareSnapshot"],
    ["commitAutosaveSnapshot", "autosave.commitSnapshot"],
    ["writeAutosaveSnapshot", "autosave.writeSnapshot"],
  ],
};

const JSON_LABELS: Record<string, string> = {
  "components/ThreePuppetPreview.tsx": "diagnostic-json.ThreePuppetPreview",
  "components/stages/blueprint/BlueprintExport.tsx": "diagnostic-json.BlueprintExport",
  "components/stages/foundry/FoundryPreviewStateProbe.tsx": "diagnostic-json.FoundryPreviewStateProbe",
  "components/stages/foundry/ThreeFoundryPreview.tsx": "diagnostic-json.ThreeFoundryPreview",
  "utils/project.ts": "project-json.serializeProjectModule",
  "utils/projectAutosaveTransactions.ts": "autosave-json.transactionMetadata",
};

const helperSource = `
const __msAuditHit = (label: string) => (globalThis as any).__MS_AUDIT__?.hit(label);
const __msAuditStringify = (label: string, ...args: any[]) => {
  const serialized = JSON.stringify(...args);
  (globalThis as any).__MS_AUDIT__?.json(label, serialized);
  return serialized;
};
`;

const skipWhitespace = (source: string, index: number) => {
  let cursor = index;
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
};

const expressionEnd = (source: string, start: number) => {
  let cursor = start;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  const closers: string[] = [];
  while (cursor < source.length) {
    const char = source[cursor]!;
    const next = source[cursor + 1] ?? "";
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      cursor += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      cursor += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const newline = source.indexOf("\n", cursor + 2);
      cursor = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      closers.push(char === "(" ? ")" : char === "[" ? "]" : "}");
      cursor += 1;
      continue;
    }
    if (closers.length && char === closers[closers.length - 1]) {
      closers.pop();
      cursor += 1;
      continue;
    }
    if (char === ";" && closers.length === 0) return cursor;
    cursor += 1;
  }
  return -1;
};

const matchingClose = (source: string, start: number) => {
  const opening = source[start];
  const firstCloser = opening === "(" ? ")" : opening === "[" ? "]" : opening === "{" ? "}" : undefined;
  if (!firstCloser) return -1;
  const closers = [firstCloser];
  let cursor = start + 1;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  while (cursor < source.length) {
    const char = source[cursor]!;
    const next = source[cursor + 1] ?? "";
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      cursor += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      cursor += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const newline = source.indexOf("\n", cursor + 2);
      cursor = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      closers.push(char === "(" ? ")" : char === "[" ? "]" : "}");
      cursor += 1;
      continue;
    }
    if (char === closers[closers.length - 1]) {
      closers.pop();
      if (!closers.length) return cursor;
    }
    cursor += 1;
  }
  return -1;
};

const instrumentArrow = (source: string, name: string, label: string) => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declarationMatch = new RegExp(
    `(?:^|\\n)\\s*(?:export\\s+)?const\\s+${escapedName}\\b`,
  ).exec(source);
  const declaration = declarationMatch?.index ?? -1;
  if (declaration < 0) throw new Error(`audit target ${name} was not found`);
  const assignment = source.indexOf("=", declaration);
  const parameterStart = skipWhitespace(source, assignment + 1);
  const parameterEnd = matchingClose(source, parameterStart);
  if (parameterEnd < 0) throw new Error(`audit target ${name} parameter list was not found`);
  const arrow = source.indexOf("=>", parameterEnd);
  if (arrow < 0) throw new Error(`audit target ${name} has no arrow body`);
  const bodyStart = skipWhitespace(source, arrow + 2);
  const hit = `__msAuditHit(${JSON.stringify(label)});`;
  if (source[bodyStart] === "{") {
    return `${source.slice(0, bodyStart + 1)}${hit}${source.slice(bodyStart + 1)}`;
  }
  const end = expressionEnd(source, bodyStart);
  if (end < 0) throw new Error(`audit target ${name} expression end was not found`);
  return `${source.slice(0, bodyStart)}(__msAuditHit(${JSON.stringify(label)}), ${source.slice(bodyStart, end)})${source.slice(end)}`;
};

const instrumentBox3Calls = (source: string, relativePath: string) => {
  const target = "new THREE.Box3().setFromObject(object)";
  const count = source.split(target).length - 1;
  if (!count) return source;
  return source.replaceAll(
    target,
    `(__msAuditHit("three.Box3.setFromObject:${relativePath}"), ${target})`,
  );
};

const auditInstrumentation = (): Plugin => ({
  name: "motionsmith-cpu-audit-instrumentation",
  enforce: "pre",
  transform(source, id) {
    const relativePath = path.relative(repositoryRoot, id.split("?")[0]!).replaceAll(path.sep, "/");
    const targets = TARGETS[relativePath];
    const jsonLabel = JSON_LABELS[relativePath];
    if (!targets && !jsonLabel) return null;
    let transformed = source;
    for (const [name, label] of targets ?? []) {
      transformed = instrumentArrow(transformed, name, label);
    }
    if (jsonLabel) transformed = transformed.replaceAll("JSON.stringify(", `__msAuditStringify(${JSON.stringify(jsonLabel)}, `);
    transformed = instrumentBox3Calls(transformed, relativePath);
    return `${helperSource}\n${transformed}`;
  },
});

export default defineConfig({
  root: repositoryRoot,
  base: "/",
  envPrefix: ["VITE_", "TAURI_"],
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
    __MOTIONSMITH_STUDY_SUMMARY_ENABLED__: "false",
    __MOTIONSMITH_STUDY_SUMMARY_TARGET__: JSON.stringify(""),
    __MOTIONSMITH_BUILD_SHA__: JSON.stringify(""),
  },
  plugins: [auditInstrumentation(), react()],
  publicDir: path.join(repositoryRoot, "public"),
  resolve: {
    alias: { "@": repositoryRoot },
  },
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    outDir: path.join(auditDirectory, "instrumented-dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2400,
  },
});
