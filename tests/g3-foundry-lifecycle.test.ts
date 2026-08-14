import { strict as assert } from "node:assert";
import * as THREE from "three";
import {
  disposeFoundryDynamicRoot,
  replaceFoundryDynamicRoot,
  type FoundryDynamicRootCandidateStatus,
  type FoundryDynamicRootLifecycleState,
} from "../components/stages/foundry/foundryThreeRenderLayers";

const candidate = (name: string) => {
  const root = new THREE.Group();
  root.name = name;
  root.add(new THREE.Object3D());
  return root;
};

const disposalRecorder = () => {
  const disposed: string[] = [];
  return {
    disposed,
    dispose: (root: THREE.Group) => disposed.push(root.name),
  };
};

const test = (name: string, fn: () => void) => {
  fn();
  console.log(`ok - ${name}`);
};

const observedStates = new Set<FoundryDynamicRootLifecycleState>();
const observe = (state: FoundryDynamicRootLifecycleState) => {
  observedStates.add(state);
};

test("initial valid candidate attaches as the first root", () => {
  const scene = new THREE.Scene();
  const next = candidate("next");
  const recorder = disposalRecorder();
  const result = replaceFoundryDynamicRoot({
    scene,
    previousRoot: null,
    candidateRoot: next,
    status: "valid",
    onLifecycleState: observe,
    disposeRoot: recorder.dispose,
  });
  assert.deepEqual(result.transitions, ["valid-mounted"]);
  assert.equal(result.root, next);
  assert.equal(next.parent, scene);
  assert.deepEqual(recorder.disposed, []);
});

test("valid replacement attaches before disposing the prior root", () => {
  const scene = new THREE.Scene();
  const previous = candidate("previous");
  const next = candidate("next");
  scene.add(previous);
  const recorder = disposalRecorder();
  const order: string[] = [];
  const result = replaceFoundryDynamicRoot({
    scene,
    previousRoot: previous,
    candidateRoot: next,
    status: "valid",
    onLifecycleState: (state) => {
      observe(state);
      if (state === "replacement-staged") {
        assert.equal(next.parent, null);
        assert.equal(previous.parent, scene);
      }
      if (state === "replacement-committed") {
        assert.equal(next.parent, scene);
        assert.equal(previous.parent, scene);
      }
    },
    disposeRoot: (root) => {
      order.push(`${next.parent === scene ? "attached" : "detached"}:${root.name}`);
      recorder.dispose(root);
    },
  });
  assert.deepEqual(result.transitions, ["replacement-staged", "replacement-committed"]);
  assert.equal(result.root, next);
  assert.equal(next.parent, scene);
  assert.equal(previous.parent, null);
  assert.deepEqual(order, ["attached:previous"]);
  assert.deepEqual(recorder.disposed, ["previous"]);
});

test("authoritative invalid replacement clears and disposes the prior root", () => {
  const scene = new THREE.Scene();
  const previous = candidate("previous");
  const invalid = candidate("invalid");
  scene.add(previous);
  const recorder = disposalRecorder();
  const result = replaceFoundryDynamicRoot({
    scene,
    previousRoot: previous,
    candidateRoot: invalid,
    status: "invalid",
    onLifecycleState: observe,
    disposeRoot: recorder.dispose,
  });
  assert.deepEqual(result.transitions, ["empty"]);
  assert.equal(result.root, null);
  assert.equal(previous.parent, null);
  assert.equal(invalid.parent, null);
  assert.deepEqual(recorder.disposed, ["invalid", "previous"]);
});

test("authoritative invalid replacement with no prior root stays empty", () => {
  const scene = new THREE.Scene();
  const invalid = candidate("invalid");
  const recorder = disposalRecorder();
  const result = replaceFoundryDynamicRoot({
    scene,
    previousRoot: null,
    candidateRoot: invalid,
    status: "invalid",
    onLifecycleState: observe,
    disposeRoot: recorder.dispose,
  });
  assert.deepEqual(result.transitions, ["empty"]);
  assert.equal(result.root, null);
  assert.deepEqual(recorder.disposed, ["invalid"]);
});

test("rejected edit retains only the prior valid root", () => {
  const scene = new THREE.Scene();
  const previous = candidate("previous");
  const rejected = candidate("rejected");
  scene.add(previous);
  const recorder = disposalRecorder();
  const status: FoundryDynamicRootCandidateStatus = "rejected";
  const result = replaceFoundryDynamicRoot({
    scene,
    previousRoot: previous,
    candidateRoot: rejected,
    status,
    onLifecycleState: observe,
    disposeRoot: recorder.dispose,
  });
  assert.deepEqual(result.transitions, ["rejected-retained"]);
  assert.equal(result.root, previous);
  assert.equal(previous.parent, scene);
  assert.equal(rejected.parent, null);
  assert.deepEqual(recorder.disposed, ["rejected"]);
});

test("unmount removes and disposes the active root", () => {
  const scene = new THREE.Scene();
  const active = candidate("active");
  scene.add(active);
  const recorder = disposalRecorder();
  disposeFoundryDynamicRoot({
    scene,
    root: active,
    onLifecycleState: observe,
    disposeRoot: recorder.dispose,
  });
  assert.equal(active.parent, null);
  assert.deepEqual(recorder.disposed, ["active"]);
});

assert.deepEqual(
  [...observedStates].sort(),
  [
    "disposed",
    "empty",
    "rejected-retained",
    "replacement-committed",
    "replacement-staged",
    "valid-mounted",
  ],
  "renderer lifecycle contract covers all six explicit states",
);

console.log("g3 foundry lifecycle contracts passed");
