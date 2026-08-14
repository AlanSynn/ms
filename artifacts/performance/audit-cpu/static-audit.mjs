import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const auditDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(auditDirectory, "../../..");
const rawDirectory = path.join(auditDirectory, "raw");
const baseline = "97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af";

const assertions = [
  {
    id: "path-svg-duplicate-motion-preview",
    files: [
      "components/stages/path/PathEditor.tsx",
      "components/stages/path/SceneSketch.tsx",
    ],
    pattern: /motionPreviewForPath\(/g,
    interpretation:
      "One call site exists in each 2D Path component, so a visible selected path has two independent application-level preview solve call sites per parent render.",
  },
  {
    id: "foundry-inspector-compiles-on-render",
    files: ["components/stages/foundry/FoundryInspectorPanel.tsx"],
    pattern: /compileMechanismGraphFabrication\(/g,
    interpretation:
      "Foundry inspector has an unconditional graph fabrication compile call site in its render function.",
  },
  {
    id: "foundry-inspector-safe-range-in-hidden-details",
    files: ["components/stages/foundry/FoundryInspectorPanel.tsx"],
    pattern: /motionSafeParamRange\(/g,
    interpretation:
      "Foundry inspector computes safe parameter ranges in a component that also contains a details disclosure; closed disclosure state does not prevent the parent render function from executing.",
  },
  {
    id: "design-inspector-readiness-and-range",
    files: ["components/stages/mechanism/DesignInspectorPanel.tsx"],
    pattern: /(?:projectMechanismReadiness|sampleFeasibleRange|motionSafeParamRange)\(/g,
    interpretation:
      "Design inspector owns call sites for project readiness, feasible range sampling, and safe parameter ranges.",
  },
  {
    id: "connection-candidates-preflight",
    files: [
      "components/stages/mechanism/MechanismConnectionOverlay.tsx",
      "utils/mechanismPhysicalCandidates.ts",
    ],
    pattern: /(?:mechanismPhysicalConnectionCandidates|mechanismEditIsSafe|compileMechanismGraphFabrication)\(/g,
    interpretation:
      "Connection overlay reaches physical candidate enumeration, whose implementation preflights candidates with safety and fabrication calls.",
  },
  {
    id: "safety-phase-linkage",
    files: ["utils/mechanismEditAuthority.ts", "utils/kinematics.ts"],
    pattern: /(?:mechanismSafetyPhaseSchedule|calculateLinkage|prepareMechanismKinematics)\(/g,
    interpretation:
      "Safety checks construct phase schedules and linkage calculations; standalone linkage calculation reaches kinematics preparation.",
  },
  {
    id: "three-box-and-diagnostics",
    files: [
      "components/ThreePuppetPreview.tsx",
      "components/stages/foundry/ThreeFoundryPreview.tsx",
    ],
    pattern: /(?:new THREE\.Box3\(\)\.setFromObject|JSON\.stringify)\(/g,
    interpretation:
      "The shared Three previews contain Box3 scene-bound and diagnostic JSON serialization call sites.",
  },
  {
    id: "autosave-serializes-project",
    files: ["hooks/useProjectAutosave.ts", "utils/projectAutosaveTransactions.ts", "utils/project.ts"],
    pattern: /(?:writeAutosaveSnapshot|serializeProject)\(/g,
    interpretation:
      "Project changes can reach the autosave transaction and project serialization call sites.",
  },
  {
    id: "blueprint-and-assembly-validation",
    files: [
      "components/stages/blueprint/BlueprintExport.tsx",
      "components/stages/assembly/AssemblyGuide.tsx",
    ],
    pattern: /validateForFabrication\(/g,
    interpretation:
      "Blueprint entry and Assembly guide each call fabrication validation from their stage components.",
  },
];

const lineOf = (source, offset) => source.slice(0, offset).split("\n").length;
const sourceEvidence = [];

for (const assertion of assertions) {
  const matches = [];
  for (const relativePath of assertion.files) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    const regex = new RegExp(assertion.pattern.source, assertion.pattern.flags);
    let match;
    while ((match = regex.exec(source))) {
      matches.push({
        file: relativePath,
        line: lineOf(source, match.index),
        token: match[0],
      });
    }
  }
  if (!matches.length) throw new Error(`Static assertion ${assertion.id} did not match`);
  sourceEvidence.push({
    id: assertion.id,
    interpretation: assertion.interpretation,
    matches,
  });
}

await mkdir(rawDirectory, { recursive: true });
const evidence = {
  schema: "motionsmith-cpu-static-audit-v1",
  baseline,
  capturedAt: new Date().toISOString(),
  qualification:
    "Static source evidence locates call sites only. It is not timing, allocation, frame, or executed-call evidence.",
  assertions: sourceEvidence,
};
await writeFile(
  path.join(rawDirectory, "static-evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify({ status: "passed", assertions: sourceEvidence.length }));
