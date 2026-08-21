const MEBIBYTE = 1024 * 1024;

export const PROJECT_IMPORT_LIMITS = Object.freeze({
  projectBytes: 12 * MEBIBYTE,
  packageFileCount: 96,
  packageConfigBytes: 512 * 1024,
  packageTotalConfigBytes: 512 * 1024,
  packageAssetBytes: 2 * MEBIBYTE,
  packageTotalAssetBytes: 3 * MEBIBYTE,
  packageTotalBytes: 4 * MEBIBYTE,
  parts: 256,
  sceneObjects: 128,
  joints: 256,
  bones: 512,
  mechanisms: 64,
  paths: 64,
  pathPoints: 1_200,
  totalPathPoints: 4_096,
  contourPoints: 512,
  totalContourPoints: 4_096,
  objectGraphDepth: 32,
  objectGraphContainers: 50_000,
  metadataDepth: 8,
  metadataContainers: 2_048,
});

const packageAssetPattern = /\.(?:png|jpe?g|webp|svg)$/i;

export const isCharacterPackageAsset = (file: Pick<File, "name">) =>
  packageAssetPattern.test(file.name);

export const validateProjectImportFile = (file: Pick<File, "name" | "size">) => {
  if (file.size > PROJECT_IMPORT_LIMITS.projectBytes) {
    throw new Error("Project file is larger than the 12 MB classroom limit.");
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const assertMaximum = (count: number, maximum: number, label: string) => {
  if (count > maximum) {
    throw new Error(`${label} exceeds the classroom limit of ${maximum}.`);
  }
};

const validateOrder = (value: unknown, maximum: number, label: string) => {
  if (!Array.isArray(value)) return;
  assertMaximum(value.length, maximum, label);
  const ids = value.filter((item): item is string => typeof item === "string");
  if (ids.length !== value.length || new Set(ids).size !== ids.length) {
    throw new Error(`${label} must contain unique text ids.`);
  }
};

const validateObjectGraph = (
  value: unknown,
  maximumDepth: number,
  maximumContainers: number,
  label: string,
) => {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let containers = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (current.value === null || typeof current.value !== "object") continue;
    containers += 1;
    assertMaximum(containers, maximumContainers, `${label} containers`);
    if (current.depth >= maximumDepth) {
      throw new Error(`${label} exceeds the classroom depth limit of ${maximumDepth}.`);
    }
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of children) {
      if (child !== null && typeof child === "object") {
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
};

export const validateProjectImportShape = (value: unknown) => {
  const project = asRecord(value);
  const parts = asRecord(project.parts);
  const sceneObjects = asRecord(project.sceneObjects);
  const paths = asRecord(project.paths);
  const skeleton = asRecord(project.skeleton);
  const skeletonJoints = Array.isArray(skeleton.skeleton)
    ? skeleton.skeleton
    : Object.values(asRecord(skeleton.joints));
  const bones = Array.isArray(skeleton.bones) ? skeleton.bones : [];
  const mechanisms = Array.isArray(project.mechanisms)
    ? project.mechanisms
    : [];

  assertMaximum(Object.keys(parts).length, PROJECT_IMPORT_LIMITS.parts, "Parts");
  assertMaximum(
    Object.keys(sceneObjects).length,
    PROJECT_IMPORT_LIMITS.sceneObjects,
    "Scene objects",
  );
  assertMaximum(skeletonJoints.length, PROJECT_IMPORT_LIMITS.joints, "Joints");
  assertMaximum(bones.length, PROJECT_IMPORT_LIMITS.bones, "Bones");
  assertMaximum(
    mechanisms.length,
    PROJECT_IMPORT_LIMITS.mechanisms,
    "Mechanisms",
  );
  assertMaximum(Object.keys(paths).length, PROJECT_IMPORT_LIMITS.paths, "Paths");
  validateOrder(project.partOrder, PROJECT_IMPORT_LIMITS.parts, "Part order");
  validateOrder(
    project.sceneObjectOrder,
    PROJECT_IMPORT_LIMITS.sceneObjects,
    "Scene object order",
  );

  let totalPathPoints = 0;
  for (const path of Object.values(paths)) {
    const record = asRecord(path);
    const points = Array.isArray(record.points) ? record.points.length : 0;
    const timedPoints = Array.isArray(record.timedPoints)
      ? record.timedPoints.length
      : 0;
    assertMaximum(points, PROJECT_IMPORT_LIMITS.pathPoints, "Path points");
    assertMaximum(
      timedPoints,
      PROJECT_IMPORT_LIMITS.pathPoints,
      "Timed path points",
    );
    totalPathPoints += Math.max(points, timedPoints);
  }
  for (const mechanism of mechanisms) {
    const generatedPath = asRecord(mechanism).generatedPath;
    const count = Array.isArray(generatedPath) ? generatedPath.length : 0;
    assertMaximum(
      count,
      PROJECT_IMPORT_LIMITS.pathPoints,
      "Generated path points",
    );
    totalPathPoints += count;
  }
  assertMaximum(
    totalPathPoints,
    PROJECT_IMPORT_LIMITS.totalPathPoints,
    "Total path points",
  );

  let totalContourPoints = 0;
  for (const item of [...Object.values(parts), ...Object.values(sceneObjects)]) {
    const record = asRecord(item);
    const contour = record.contourPoints ?? record.contour_points;
    const count = Array.isArray(contour) ? contour.length : 0;
    assertMaximum(
      count,
      PROJECT_IMPORT_LIMITS.contourPoints,
      "Part contour points",
    );
    totalContourPoints += count;
  }
  assertMaximum(
    totalContourPoints,
    PROJECT_IMPORT_LIMITS.totalContourPoints,
    "Total contour points",
  );
  validateObjectGraph(
    project,
    PROJECT_IMPORT_LIMITS.objectGraphDepth,
    PROJECT_IMPORT_LIMITS.objectGraphContainers,
    "Project data",
  );
  validateObjectGraph(
    project.metadata,
    PROJECT_IMPORT_LIMITS.metadataDepth,
    PROJECT_IMPORT_LIMITS.metadataContainers,
    "Project metadata",
  );
};

export const validateCharacterPackageFiles = <
  T extends Pick<File, "name" | "size">,
>(files: readonly T[]) => {
  if (files.length > PROJECT_IMPORT_LIMITS.packageFileCount) {
    throw new Error("Character package has more than 96 files.");
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > PROJECT_IMPORT_LIMITS.packageTotalBytes) {
    throw new Error("Character package is larger than the 4 MB classroom limit.");
  }
  const configs = files.filter((file) => /\.(?:json|ya?ml)$/i.test(file.name));
  const oversizedConfig = configs.find(
    (file) => file.size > PROJECT_IMPORT_LIMITS.packageConfigBytes,
  );
  if (oversizedConfig) {
    throw new Error(`${oversizedConfig.name} is larger than the 512 KB config limit.`);
  }
  const totalConfigBytes = configs.reduce((sum, file) => sum + file.size, 0);
  if (totalConfigBytes > PROJECT_IMPORT_LIMITS.packageTotalConfigBytes) {
    throw new Error("Character package configs exceed the 512 KB classroom limit.");
  }
  const assets = files.filter(isCharacterPackageAsset);
  const oversizedAsset = assets.find(
    (file) => file.size > PROJECT_IMPORT_LIMITS.packageAssetBytes,
  );
  if (oversizedAsset) {
    throw new Error(`${oversizedAsset.name} is larger than the 2 MB image limit.`);
  }
  const totalAssetBytes = assets.reduce((sum, file) => sum + file.size, 0);
  if (totalAssetBytes > PROJECT_IMPORT_LIMITS.packageTotalAssetBytes) {
    throw new Error("Character package images exceed the 3 MB classroom limit.");
  }
  return { assets, totalAssetBytes, totalBytes };
};
