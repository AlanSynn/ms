import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  PROJECT_IMPORT_LIMITS,
  validateCharacterPackageFiles,
  validateProjectImportFile,
  validateProjectImportShape,
} from "../runtime/import/projectImportPolicy";
import {
  runProjectImportJob,
  validateCharacterPackageProjectPersistence,
  validateImportedProjectPersistence,
  type ProjectImportWorkerResponse,
} from "../runtime/import/projectImportJob";
import {
  PROJECT_RASTER_IMPORT_LIMITS,
  validateCharacterPackageRasterFiles,
  validateProjectRasterSources,
} from "../runtime/import/projectRasterImportPolicy";
import {
  createProjectImportWorkerClient,
  type ProjectImportFrameScheduler,
  type ProjectImportWorkerPort,
} from "../runtime/import/projectImportWorkerClient";
import { createSampleProject, serializeProject } from "../utils/project";
import { mechanismBoardPlacementErrors } from "../utils/fabrication";
import {
  AUTOSAVE_SNAPSHOT_MAX_BYTES,
  type AutosaveStorage,
} from "../utils/projectAutosaveFormat";
import { writeAutosaveSnapshot } from "../utils/projectAutosaveTransactions";
import { serializeProjectCompact } from "../utils/projectSerialization";
import {
  createProjectFromPackageData,
  validateCharacterPackageAssetReferences,
} from "../utils/packageLoader";

const pngBytes = (
  width: number,
  height: number,
  totalBytes = 25,
  marker = 0,
) => {
  const bytes = Buffer.alloc(Math.max(25, totalBytes));
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = marker;
  return bytes;
};

const pngHeaderDataUrl = (width: number, height: number, marker = 0) =>
  `data:image/png;base64,${pngBytes(width, height, 25, marker).toString("base64")}`;

assert.throws(
  () => validateProjectImportFile({
    name: "large.motionsmith.json",
    size: PROJECT_IMPORT_LIMITS.projectBytes + 1,
  }),
  /12 MB classroom limit/,
);
assert.throws(
  () => validateCharacterPackageFiles([{
    name: "body.png",
    size: PROJECT_IMPORT_LIMITS.packageAssetBytes + 1,
  }]),
  /2 MB image limit/,
);
assert.throws(
  () => validateCharacterPackageFiles([
    { name: "body.png", size: PROJECT_IMPORT_LIMITS.packageAssetBytes },
    {
      name: "hand.png",
      size:
        PROJECT_IMPORT_LIMITS.packageTotalAssetBytes -
        PROJECT_IMPORT_LIMITS.packageAssetBytes +
        1,
    },
  ]),
  /images exceed the 3 MB classroom limit/,
);
assert.throws(
  () => validateCharacterPackageFiles(Array.from(
    { length: PROJECT_IMPORT_LIMITS.packageFileCount + 1 },
    (_, index) => ({ name: `${index}.txt`, size: 1 }),
  )),
  /more than 96 files/,
);
assert.throws(
  () => validateCharacterPackageFiles([
    { name: "parts_info.json", size: 256 * 1024 },
    { name: "char_cfg.json", size: 256 * 1024 + 1 },
  ]),
  /configs exceed the 512 KB classroom limit/,
);
assert.throws(
  () => validateCharacterPackageFiles([{
    name: "notes.txt",
    size: PROJECT_IMPORT_LIMITS.packageTotalBytes + 1,
  }]),
  /4 MB classroom limit/,
);

assert.throws(
  () => validateProjectImportShape({
    mechanisms: Array.from(
      { length: PROJECT_IMPORT_LIMITS.mechanisms + 1 },
      (_, index) => ({ id: `mechanism-${index}` }),
    ),
  }),
  /Mechanisms exceeds the classroom limit/,
);
assert.throws(
  () => validateProjectImportShape({ parts: [{ id: "arm" }] }),
  /Parts must be an object/,
  "an array cannot evade the part cardinality gate and expand during migration",
);
assert.throws(
  () => validateProjectImportShape({
    skeleton: { joints: Array.from({ length: 1_000 }, () => ({ id: "joint" })) },
  }),
  /Skeleton joints must be an object/,
  "an array cannot evade the joint cardinality gate and expand during migration",
);
assert.throws(
  () => validateProjectImportShape({ paths: [], mechanisms: {} }),
  /Paths must be an object/,
  "domain containers must match the ProjectState storage schema before migration",
);
assert.throws(
  () => validateProjectImportShape({
    parts: { arm: {} },
    partOrder: ["arm", "arm"],
  }),
  /Part order must contain unique text ids/,
);
assert.throws(
  () => validateProjectImportShape({
    paths: {
      hand: {
        points: Array.from(
          { length: PROJECT_IMPORT_LIMITS.pathPoints + 1 },
          () => ({ x: 0, y: 0 }),
        ),
      },
    },
  }),
  /Path points exceeds the classroom limit/,
);
for (const [field, label] of [
  ["warnings", "Mechanism warnings"],
  ["activeVisualPartIds", "Mechanism visual part ids"],
  ["gearTrainRadii", "Mechanism gear radii"],
  ["camProfileSamples", "Mechanism cam samples"],
] as const) {
  assert.throws(
    () => validateProjectImportShape({
      mechanisms: [{
        [field]: Array.from(
          { length: PROJECT_IMPORT_LIMITS.auxiliaryListEntries + 1 },
          () => 0,
        ),
      }],
    }),
    new RegExp(`${label} exceeds the classroom limit`),
    `${field} is bounded before migration maps and truncates it`,
  );
}
assert.throws(
  () => validateProjectImportShape({
    paths: {
      hand: {
        warnings: Array.from(
          { length: PROJECT_IMPORT_LIMITS.auxiliaryListEntries + 1 },
          () => "warning",
        ),
      },
    },
  }),
  /Path warnings exceeds the classroom limit/,
  "path warnings are bounded before migration maps and truncates them",
);
let deepMetadata: Record<string, unknown> = {};
const deepMetadataRoot = deepMetadata;
for (let depth = 0; depth <= PROJECT_IMPORT_LIMITS.metadataDepth; depth += 1) {
  deepMetadata.next = {};
  deepMetadata = deepMetadata.next as Record<string, unknown>;
}
assert.throws(
  () => validateProjectImportShape({ metadata: deepMetadataRoot }),
  /Project metadata exceeds the classroom depth limit/,
);
let fanoutReads = 0;
let adversarialFanout: unknown = {};
const fanoutDepth = Math.ceil(
  PROJECT_IMPORT_LIMITS.objectGraphContainers /
    PROJECT_IMPORT_LIMITS.objectGraphArrayEntries,
);
for (let depth = 0; depth < fanoutDepth; depth += 1) {
  const next: unknown[] = Array.from(
    { length: PROJECT_IMPORT_LIMITS.objectGraphArrayEntries },
    () => ({}),
  );
  next[next.length - 1] = adversarialFanout;
  adversarialFanout = new Proxy(next, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        fanoutReads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });
}
assert.throws(
  () => validateProjectImportShape({
    characterPackage: { partsInfo: adversarialFanout },
  }),
  /Project data containers exceeds the classroom limit/,
  "wide container graphs fail while children are discovered, before an oversized pending queue is built",
);
assert(
  fanoutReads <= PROJECT_IMPORT_LIMITS.objectGraphContainers,
  "object graph traversal stops reading a wide input at the container ceiling",
);
let primitiveArrayReads = 0;
const primitiveArray = new Proxy(
  new Array(PROJECT_IMPORT_LIMITS.objectGraphArrayEntries + 1),
  {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        primitiveArrayReads += 1;
        return 0;
      }
      return Reflect.get(target, property, receiver);
    },
  },
);
assert.throws(
  () => validateProjectImportShape({
    characterPackage: { partsInfo: { padding: primitiveArray } },
  }),
  /Project data array entries exceeds the classroom limit/,
  "large primitive arrays fail from length before every value is visited",
);
assert.equal(
  primitiveArrayReads,
  0,
  "oversized primitive arrays are rejected without scanning their entries",
);
let primitiveRecordReads = 0;
const primitiveRecordTarget: Record<string, number> = {};
for (
  let index = 0;
  index < PROJECT_IMPORT_LIMITS.objectGraphRecordEntries + 1;
  index += 1
) {
  primitiveRecordTarget[`value-${index}`] = index;
}
const primitiveRecord = new Proxy(primitiveRecordTarget, {
  get(target, property, receiver) {
    if (typeof property === "string" && property.startsWith("value-")) {
      primitiveRecordReads += 1;
    }
    return Reflect.get(target, property, receiver);
  },
});
assert.throws(
  () => validateProjectImportShape({
    characterPackage: { partsInfo: { padding: primitiveRecord } },
  }),
  /Project data record entries exceeds the classroom limit/,
  "large primitive records stop at the per-container entry ceiling",
);
assert.equal(
  primitiveRecordReads,
  PROJECT_IMPORT_LIMITS.objectGraphRecordEntries,
  "the entry beyond the record ceiling is rejected before its value is read",
);

const sample = createSampleProject();
const imported = await runProjectImportJob({
  kind: "project",
  file: new File([JSON.stringify(sample)], "sample.motionsmith.json", {
    type: "application/json",
  }),
});
assert.equal(imported.sourceName, "sample.motionsmith.json");
assert.equal(imported.project.partOrder.length, sample.partOrder.length);
assert.equal(imported.project.mechanisms.length, sample.mechanisms.length);

const offBoardImportSource = createSampleProject({ includeMechanism: true });
const offBoardImported = await runProjectImportJob({
  kind: "project",
  file: new File([JSON.stringify({
    ...offBoardImportSource,
    mechanisms: offBoardImportSource.mechanisms.map((mechanism) => ({
      ...mechanism,
      anchorX: 9_999,
      anchorY: 9_999,
    })),
  })], "off-board.motionsmith.json", { type: "application/json" }),
});
assert(
  offBoardImported.project.mechanisms.every((mechanism) =>
    mechanism.anchorX === 9_999 && mechanism.anchorY === 9_999
  ),
  "portable project import preserves authored mechanism placement without a hidden refit",
);
const reopenedBoardFit = await runProjectImportJob({
  kind: "project",
  file: new File(
    [JSON.stringify(offBoardImported.project)],
    "off-board-fitted.motionsmith.json",
    { type: "application/json" },
  ),
});
assert.deepEqual(
  reopenedBoardFit.project.mechanisms.map(({ anchorX, anchorY }) => ({
    anchorX,
    anchorY,
  })),
  offBoardImported.project.mechanisms.map(({ anchorX, anchorY }) => ({
    anchorX,
    anchorY,
  })),
  "authored mechanism placement is stable across project reopen",
);

const unplaceableImported = await runProjectImportJob({
  kind: "project",
  file: new File([JSON.stringify({
    ...offBoardImportSource,
    mechanisms: offBoardImportSource.mechanisms.map((mechanism) => ({
      ...mechanism,
      anchorX: 9_999,
      anchorY: 9_999,
      crankLength: 5_000,
      groundLength: 5_000,
      couplerLength: 5_000,
      rockerLength: 5_000,
      couplerPointDist: 5_000,
    })),
  })], "unplaceable.motionsmith.json", { type: "application/json" }),
});
assert(
  unplaceableImported.project.mechanisms.some((mechanism) =>
    mechanismBoardPlacementErrors(unplaceableImported.project, mechanism).length > 0
  ),
  "an unplaceable authored mechanism opens unchanged and remains a fabrication blocker",
);

const unknownFieldsImported = await runProjectImportJob({
  kind: "project",
  file: new File([JSON.stringify({
    ...sample,
    arbitraryTopLevelPayload: "must-not-survive",
    metadata: {
      ...sample.metadata,
      arbitraryMetadataPayload: "must-not-survive",
    },
  })], "canonical-shape.motionsmith.json", { type: "application/json" }),
});
assert.equal(
  "arbitraryTopLevelPayload" in unknownFieldsImported.project,
  false,
  "post-migration ProjectState has no arbitrary top-level spread",
);
assert.equal(
  "arbitraryMetadataPayload" in unknownFieldsImported.project.metadata,
  false,
  "post-migration metadata contains only declared ProjectState fields",
);

const remoteCharacterArtworkImported = await runProjectImportJob({
  kind: "project",
  file: new File([JSON.stringify({
    ...sample,
    characterPackage: {
      id: "remote-artwork",
      createdAt: new Date(0).toISOString(),
      sourceImageName: "remote.png",
      outputDir: "https://example.com/package",
      partsInfo: {},
      charCfg: {},
      sourceTextureUrl: "https://example.com/huge.png",
      maskUrl: "//example.com/huge-mask.png",
    },
  })], "remote-artwork.motionsmith.json", { type: "application/json" }),
});
assert.equal(
  remoteCharacterArtworkImported.project.characterPackage?.sourceTextureUrl,
  undefined,
  "portable projects cannot retain remotely fetched character artwork",
);
assert.equal(
  remoteCharacterArtworkImported.project.characterPackage?.maskUrl,
  undefined,
  "portable projects cannot retain remotely fetched character masks",
);

const oversizedMigratedProject = {
  ...sample,
  characterPackage: {
    id: "oversized-import",
    createdAt: new Date(0).toISOString(),
    sourceImageName: "oversized.png",
    outputDir: "portable",
    partsInfo: { padding: "x".repeat(7 * 1024 * 1024) },
    charCfg: {},
  },
};
const largePortableImport = await runProjectImportJob({
    kind: "project",
    file: new File(
      [JSON.stringify(oversizedMigratedProject)],
      "oversized-expanded.motionsmith.json",
      { type: "application/json" },
    ),
  });
assert.equal(
  (largePortableImport.project.characterPackage?.partsInfo as { padding: string }).padding.length,
  7 * 1024 * 1024,
  "portable file validity is independent of browser backup capacity",
);
assert(
  validateImportedProjectPersistence(sample) < AUTOSAVE_SNAPSHOT_MAX_BYTES,
  "a canonical ordinary project remains below the persistence ceiling",
);

const sharedRasterUrl = pngHeaderDataUrl(2_000, 2_000);
assert.deepEqual(
  validateProjectRasterSources({
    parts: {
      first: { textureUrl: sharedRasterUrl, maskUrl: sharedRasterUrl },
      second: { textureUrl: sharedRasterUrl },
    },
    sceneObjects: {
      prop: { textureUrl: sharedRasterUrl },
    },
  }),
  { uniqueSourceCount: 1, totalSourcePixels: 4_000_000 },
  "one embedded source shared by parts, masks, and objects consumes the raster budget once",
);
assert.throws(
  () => validateProjectRasterSources({
    parts: {
      first: { textureUrl: pngHeaderDataUrl(2_000, 2_000, 1) },
      second: { textureUrl: pngHeaderDataUrl(2_000, 2_000, 2) },
      third: { textureUrl: pngHeaderDataUrl(1, 1, 3) },
    },
  }),
  /combined 8 megapixel classroom texture limit/,
  "distinct artwork cannot exceed the aggregate decoded-pixel budget",
);
assert.throws(
  () => validateProjectRasterSources({
    parts: { body: { textureUrl: pngHeaderDataUrl(8_192, 8_192) } },
  }),
  /2048 px or 4 megapixel classroom texture limit/,
  "a tiny compressed header cannot admit an 8192 by 8192 texture",
);
assert.throws(
  () => validateProjectRasterSources({
    parts: { body: { textureUrl: "data:image/png;base64,AAAA" } },
  }),
  /dimensions could not be read safely/,
  "unknown raster headers are rejected before browser image decode",
);
assert.equal(PROJECT_RASTER_IMPORT_LIMITS.maxSourceEdge, 2_048);
assert.equal(PROJECT_RASTER_IMPORT_LIMITS.maxAggregateSourcePixels, 8_000_000);

const sharedPackageConfig = {
  width: 100,
  height: 100,
  joints: { root: { position: [50, 50] } },
};
const sharedHeader = pngBytes(160, 220);
const sharedPackageFile = new File([sharedHeader], "shared.png", {
  type: "image/png",
});
assert.deepEqual(
  await validateCharacterPackageRasterFiles([
    sharedPackageFile,
    sharedPackageFile,
  ]),
  { uniqueSourceCount: 1, totalSourcePixels: 160 * 220 },
  "one shared package file is scanned and charged once",
);

const unsafeHeader = pngBytes(8_192, 8_192);
await assert.rejects(
  runProjectImportJob({
    kind: "character-package",
    files: [
      new File([JSON.stringify({
        parts: {
          body: {
            name: "Body",
            roi: [0, 0, 50, 50],
            texture_path: "body.png",
            anchor_joint_id: "root",
          },
        },
      })], "parts_info.json", { type: "application/json" }),
      new File([JSON.stringify(sharedPackageConfig)], "char_cfg.json", {
        type: "application/json",
      }),
      new File([unsafeHeader], "body.png", { type: "image/png" }),
    ],
  }),
  /2048 px or 4 megapixel classroom texture limit/,
  "the character-package worker blocks an unsafe compressed raster before returning ProjectState",
);

const boundaryParts = {
  parts: {
    body: {
      name: "Body",
      roi: [0, 0, 50, 50],
      texture_path: "body.png",
      anchor_joint_id: "root",
    },
    hand: {
      name: "Hand",
      roi: [50, 0, 50, 50],
      texture_path: "hand.png",
      anchor_joint_id: "root",
    },
  },
};
const boundaryConfig = {
  width: 100,
  height: 100,
  joints: { root: { position: [50, 50] } },
};
const boundaryFiles = [
  { name: "parts_info.json", size: Buffer.byteLength(JSON.stringify(boundaryParts)) },
  { name: "char_cfg.json", size: Buffer.byteLength(JSON.stringify(boundaryConfig)) },
  { name: "body.png", size: PROJECT_IMPORT_LIMITS.packageAssetBytes },
  {
    name: "hand.png",
    size:
      PROJECT_IMPORT_LIMITS.packageTotalAssetBytes -
      PROJECT_IMPORT_LIMITS.packageAssetBytes,
  },
];
assert.doesNotThrow(() => validateCharacterPackageFiles(boundaryFiles));
assert.equal(
  validateCharacterPackageAssetReferences(boundaryParts, boundaryFiles.slice(2)),
  PROJECT_IMPORT_LIMITS.packageTotalAssetBytes,
  "one reference per image preserves the 3 MB package persistence boundary",
);
const boundaryProject = createProjectFromPackageData(
  boundaryParts,
  boundaryConfig,
  {
    "body.png": `data:image/png;base64,${pngBytes(
      1_600,
      1_000,
      PROJECT_IMPORT_LIMITS.packageAssetBytes,
      1,
    ).toString("base64")}`,
    "hand.png": `data:image/png;base64,${pngBytes(
      1_200,
      1_000,
      PROJECT_IMPORT_LIMITS.packageTotalAssetBytes -
        PROJECT_IMPORT_LIMITS.packageAssetBytes,
      2,
    ).toString("base64")}`,
  },
  "boundary-package",
);
const boundaryCompact = serializeProjectCompact(boundaryProject);
const boundaryPortable = serializeProject(boundaryProject);
assert(
  validateCharacterPackageProjectPersistence(boundaryProject) <
    AUTOSAVE_SNAPSHOT_MAX_BYTES,
  "the accepted package passes the worker's exact persistence guard",
);
assert(
  Buffer.byteLength(boundaryCompact) < AUTOSAVE_SNAPSHOT_MAX_BYTES,
  "a valid 3 MB binary package leaves room for base64 and ProjectState overhead",
);
assert(
  Buffer.byteLength(boundaryPortable) < PROJECT_IMPORT_LIMITS.projectBytes,
  "the valid package leaves room inside the portable project reopen limit",
);
const boundaryStorageValues = new Map<string, string>();
const boundaryStorage: AutosaveStorage = {
  getItem: (key) => boundaryStorageValues.get(key) ?? null,
  setItem: (key, value) => boundaryStorageValues.set(key, value),
  removeItem: (key) => boundaryStorageValues.delete(key),
};
assert.equal(
  writeAutosaveSnapshot(boundaryProject, boundaryStorage).status,
  "saved",
  "the valid package fits the browser autosave contract",
);
const boundaryReopened = await runProjectImportJob({
  kind: "project",
  file: new File([boundaryPortable], "boundary.motionsmith.json", {
    type: "application/json",
  }),
});
assert.equal(boundaryReopened.project.partOrder.length, 2);
assert.equal(
  boundaryReopened.project.parts.body.textureUrl,
  boundaryProject.parts.body.textureUrl,
  "package artwork survives portable Save and Open",
);

const sharedAssetParts = {
  parts: Object.fromEntries(
    Array.from({ length: 4 }, (_, index) => [
      `shared-${index}`,
      {
        name: `Shared ${index}`,
        roi: [index * 20, 0, 20, 20],
        texture_path: "shared.png",
        anchor_joint_id: "root",
      },
    ]),
  ),
};
assert.throws(
  () => validateCharacterPackageAssetReferences(sharedAssetParts, [{
    name: "shared.png",
    size: PROJECT_IMPORT_LIMITS.packageAssetBytes,
  }]),
  /image references exceed the 3 MB classroom limit/,
  "a policy-valid shared file cannot multiply past the serialized asset budget",
);

class FakeWorker implements ProjectImportWorkerPort {
  onmessage: ((event: MessageEvent<ProjectImportWorkerResponse>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const scheduler: ProjectImportFrameScheduler = {
  requestFrame(callback) {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  },
  cancelFrame(handle) {
    frames.delete(handle);
  },
};
const flushFrame = () => {
  const entry = frames.entries().next().value as
    | [number, FrameRequestCallback]
    | undefined;
  if (!entry) throw new Error("Expected a scheduled import frame");
  frames.delete(entry[0]);
  entry[1](performance.now());
};

const workers: FakeWorker[] = [];
const client = createProjectImportWorkerClient(() => {
  const worker = new FakeWorker();
  workers.push(worker);
  return worker;
}, scheduler);
const completions: string[] = [];
const failures: string[] = [];
const callbacks = {
  complete: (result: Extract<ProjectImportWorkerResponse, { type: "result" }>) =>
    completions.push(result.sourceName),
  failed: (error: Error) => failures.push(error.message),
};

const firstGeneration = client.requestProject(
  new File(["{}"], "first.json"),
  callbacks,
);
assert.equal(workers.length, 0, "import worker waits for two paints");
flushFrame();
flushFrame();
assert.equal(workers.length, 1);
assert.equal(workers[0].posted.length, 1);
const staleHandler = workers[0].onmessage;

const secondGeneration = client.requestCharacterPackage(
  [new File(["{}"], "parts_info.json")],
  callbacks,
);
assert.equal(workers[0].terminated, true, "new import terminates the superseded worker");
flushFrame();
flushFrame();
assert.equal(workers.length, 2);
staleHandler?.({
  data: {
    type: "result",
    generationId: firstGeneration,
    project: sample,
    sourceName: "stale.json",
  },
} as MessageEvent<ProjectImportWorkerResponse>);
assert.deepEqual(completions, [], "superseded results cannot reach app state");

workers[1].onmessage?.({
  data: {
    type: "result",
    generationId: secondGeneration,
    project: sample,
    sourceName: "Character package",
  },
} as MessageEvent<ProjectImportWorkerResponse>);
assert.deepEqual(completions, ["Character package"]);
assert.deepEqual(failures, []);
assert.equal(workers[1].terminated, true, "completed import releases its worker");

client.dispose();
console.log("project import worker and classroom limits ok");
