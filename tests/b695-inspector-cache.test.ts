import { strict as assert } from "node:assert";
import { createSampleProject } from "../utils/project";
import {
  BoundedInspectorCache,
  clearInspectorAnalysisCaches,
  getInspectorBindingWarnings,
  getInspectorFeasibleRange,
  getInspectorParametricModel,
  getInspectorStackSummary,
  inspectorAnalysisCacheSizes,
  inspectorSemanticRevisionFor,
} from "../utils/mechanismInspectorAnalysis";
import {
  fabricationStackSummary,
  readableFabricationStackSummary,
  sampleFeasibleRange,
} from "../utils/fabrication";
import { mechanismBindingWarnings } from "../utils/motion";

const project = createSampleProject({ includeMechanism: true });
const mechanism = project.mechanisms[0];
if (!mechanism) throw new Error("sample project did not create a mechanism");

clearInspectorAnalysisCaches();
assert.equal(
  inspectorSemanticRevisionFor(mechanism),
  inspectorSemanticRevisionFor(mechanism),
  "the same immutable mechanism keeps one semantic revision",
);
assert.notEqual(
  inspectorSemanticRevisionFor(mechanism),
  inspectorSemanticRevisionFor({ ...mechanism, phase: (mechanism.phase ?? 0) + 0.1 }),
  "an authored mechanism phase revision gets a new semantic token",
);

const cachedRange = getInspectorFeasibleRange(mechanism);
assert.deepEqual(cachedRange, sampleFeasibleRange(mechanism));
assert.strictEqual(
  getInspectorFeasibleRange(mechanism),
  cachedRange,
  "feasible-range analysis is reused for a stable revision",
);

const cachedBindings = getInspectorBindingWarnings(project);
assert.deepEqual(cachedBindings, mechanismBindingWarnings(project));
assert.strictEqual(
  getInspectorBindingWarnings(project),
  cachedBindings,
  "binding analysis is reused for a stable project revision",
);

const cachedStack = getInspectorStackSummary(mechanism);
assert.equal(cachedStack.raw, fabricationStackSummary(mechanism));
assert.equal(cachedStack.readable, readableFabricationStackSummary(mechanism));
assert.strictEqual(getInspectorStackSummary(mechanism), cachedStack);

const cachedParametric = getInspectorParametricModel(mechanism);
assert.strictEqual(getInspectorParametricModel(mechanism), cachedParametric);
assert.deepEqual(
  getInspectorParametricModel({ ...mechanism, phase: (mechanism.phase ?? 0) + 0.1 }).radii,
  cachedParametric.radii,
  "phase does not alter static control geometry, while its new revision remains cache-distinct",
);

const bounded = new BoundedInspectorCache<number>(2);
bounded.set("a", 1);
bounded.set("b", 2);
bounded.get("a");
bounded.set("c", 3);
assert.equal(bounded.get("b"), undefined, "inspector caches evict the oldest revision");
assert.equal(bounded.size, 2);
assert(Object.values(inspectorAnalysisCacheSizes()).every((size) => size <= 32));

console.log("b695 inspector cache ok");
