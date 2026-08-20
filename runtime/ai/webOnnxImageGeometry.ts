import type {
  Bounds,
  Point,
  StandardJoint,
  StandardSkeleton,
} from '../../types';

export const WEB_ONNX_IMAGE_MAX_EDGE = 1280;

const COCO = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee',
  'right_knee', 'left_ankle', 'right_ankle',
];

export type WebOnnxMask = {
  width: number;
  height: number;
  data: Uint8Array;
  bbox: Bounds;
};

export type WebOnnxKeypoint = Point & {
  confidence: number;
  name: string;
};

export const fitWebOnnxImageDimensions = (width: number, height: number) => {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const scale = Math.min(1, WEB_ONNX_IMAGE_MAX_EDGE / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
};

export const webOnnxMaskBounds = (
  mask: Uint8Array,
  width: number,
  height: number,
): Bounds | null => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return maxX < 0
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const keepSignificantComponents = (mask: Uint8Array, width: number, height: number) => {
  const labels = new Int32Array(mask.length).fill(-1);
  const queue = new Int32Array(mask.length);
  const areas: number[] = [];
  let label = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    labels[start] = label;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      area += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (mask[next] && labels[next] === -1) {
            labels[next] = label;
            queue[tail++] = next;
          }
        }
      }
    }
    areas[label++] = area;
  }
  if (!areas.length) return mask;
  const largest = Math.max(...areas);
  const total = areas.reduce((sum, area) => sum + area, 0);
  const threshold = Math.max(64, total * 0.003, largest * 0.01);
  const clean = new Uint8Array(mask.length);
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] >= 0 && areas[labels[index]] >= threshold) clean[index] = 255;
  }
  return clean.some(Boolean) ? clean : mask;
};

export const createWebOnnxMask = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): WebOnnxMask => {
  const mask = new Uint8Array(width * height);
  let alphaVariance = 0;
  let whitePixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    alphaVariance += Math.abs(pixels[offset + 3] - 255);
    const luma = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
    if (luma > 240) whitePixels += 1;
  }
  const alphaDriven = alphaVariance > pixels.length * 0.01;
  const lineArt = whitePixels / mask.length > 0.4;
  for (let pixel = 0, offset = 0; offset < pixels.length; pixel += 1, offset += 4) {
    const luma = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
    const foreground = alphaDriven
      ? pixels[offset + 3] > 10
      : lineArt
        ? luma < 242
        : luma < 245 && luma > 8;
    mask[pixel] = foreground ? 255 : 0;
  }
  const data = keepSignificantComponents(mask, width, height);
  return {
    width,
    height,
    data,
    bbox: webOnnxMaskBounds(data, width, height) ?? { x: 0, y: 0, width, height },
  };
};

export const webOnnxPoseBounds = (mask: WebOnnxMask): Bounds => {
  const margin = 0.2;
  const x = Math.max(0, mask.bbox.x - mask.bbox.width * margin);
  const y = Math.max(0, mask.bbox.y - mask.bbox.height * margin);
  const right = Math.min(mask.width, mask.bbox.x + mask.bbox.width * (1 + margin));
  const bottom = Math.min(mask.height, mask.bbox.y + mask.bbox.height * (1 + margin));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
};

export const extractWebOnnxKeypoints = (
  data: Float32Array,
  dims: number[],
  bbox: Bounds,
): WebOnnxKeypoint[] => {
  const offset = dims.length === 4 ? 1 : 0;
  const joints = dims[offset];
  const heatmapHeight = dims[offset + 1];
  const heatmapWidth = dims[offset + 2];
  if (!joints || !heatmapHeight || !heatmapWidth || joints < 16) {
    throw new Error(`Unexpected pose heatmap dimensions: ${dims.join('x')}`);
  }
  return Array.from({ length: joints }, (_, joint) => {
    let confidence = -Infinity;
    let bestIndex = 0;
    const base = joint * heatmapHeight * heatmapWidth;
    for (let index = 0; index < heatmapHeight * heatmapWidth; index += 1) {
      if (data[base + index] > confidence) {
        confidence = data[base + index];
        bestIndex = index;
      }
    }
    const y = Math.floor(bestIndex / heatmapWidth);
    const x = bestIndex % heatmapWidth;
    return {
      name: COCO[joint] ?? `joint_${joint}`,
      x: bbox.x + (x / Math.max(1, heatmapWidth - 1)) * bbox.width,
      y: bbox.y + (y / Math.max(1, heatmapHeight - 1)) * bbox.height,
      confidence,
    };
  });
};

export const webOnnxPointToScene = (
  point: Point,
  width: number,
  height: number,
): Point => ({
  x: point.x - width / 2,
  y: height / 2 - point.y,
});

export const webOnnxPointToImage = (
  point: Point,
  width: number,
  height: number,
): Point => ({
  x: point.x + width / 2,
  y: height / 2 - point.y,
});

const buildSkeleton = (joints: StandardJoint[]): StandardSkeleton => {
  const map: Record<string, StandardJoint> = {};
  const hierarchy: Record<string, string[]> = {};
  const bones: [string, string][] = [];
  const rootJointIds: string[] = [];
  const jointMap: Record<string, string> = {};
  for (const joint of joints) {
    map[joint.id] = { ...joint, bendDirection: joint.bendDirection ?? 1 };
    jointMap[joint.name.replaceAll(' ', '_')] = joint.id;
    if (joint.parentId && joints.some((candidate) => candidate.id === joint.parentId)) {
      bones.push([joint.parentId, joint.id]);
      hierarchy[joint.parentId] = [...(hierarchy[joint.parentId] ?? []), joint.id];
    } else {
      rootJointIds.push(joint.id);
    }
  }
  return {
    joints: map,
    bones,
    rootJointIds,
    jointMap,
    hierarchy,
    metadata: { sourceFormat: 'web-port', scale: 1, normalization: 'letter-sheet-scene' },
  };
};

export const buildWebOnnxSkeleton = (
  keypoints: WebOnnxKeypoint[],
  width: number,
  height: number,
  mask: WebOnnxMask,
  modelUrl: string,
): StandardSkeleton => {
  const byName = Object.fromEntries(keypoints.map((point) => [point.name, point]));
  const makeJoint = (id: string, point: Point, parentId: string | null): StandardJoint => ({
    id,
    name: id.replaceAll('_', ' '),
    position: webOnnxPointToScene(point, width, height),
    parentId,
    locked: false,
    bendDirection: 1,
  });
  const fallback = { x: mask.bbox.x + mask.bbox.width / 2, y: mask.bbox.y + mask.bbox.height / 2 };
  const make = (id: string, source: string, parentId: string | null) =>
    makeJoint(id, byName[source] ?? fallback, parentId);
  const midpoint = (id: string, left: string, right: string, parentId: string | null) => {
    const a = byName[left];
    const b = byName[right];
    return makeJoint(id, a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : fallback, parentId);
  };
  const joints: StandardJoint[] = [
    midpoint('root', 'left_hip', 'right_hip', null), midpoint('hip', 'left_hip', 'right_hip', 'root'),
    midpoint('torso', 'left_shoulder', 'right_shoulder', 'hip'), make('neck', 'nose', 'torso'),
    makeJoint('head_top', { x: byName.nose?.x ?? fallback.x, y: Math.max(0, (byName.nose?.y ?? mask.bbox.y) - mask.bbox.height * 0.12) }, 'neck'),
    make('left_shoulder', 'left_shoulder', 'torso'), make('left_elbow', 'left_elbow', 'left_shoulder'), make('left_hand', 'left_wrist', 'left_elbow'),
    make('right_shoulder', 'right_shoulder', 'torso'), make('right_elbow', 'right_elbow', 'right_shoulder'), make('right_hand', 'right_wrist', 'right_elbow'),
    make('left_hip', 'left_hip', 'root'), make('left_knee', 'left_knee', 'left_hip'), make('left_foot', 'left_ankle', 'left_knee'),
    make('right_hip', 'right_hip', 'root'), make('right_knee', 'right_knee', 'right_hip'), make('right_foot', 'right_ankle', 'right_knee'),
  ];
  const skeleton = buildSkeleton(joints);
  skeleton.metadata = {
    sourceFormat: 'web-onnx-coco-heatmap',
    scale: 1,
    imageBounds: { x: 0, y: 0, width, height },
    normalization: 'bbox-pose-image-center-to-scene',
    model: modelUrl,
  };
  return reconcileSkeletonToMask(skeleton, mask, width, height);
};

const reconcileSkeletonToMask = (
  skeleton: StandardSkeleton,
  mask: WebOnnxMask,
  width: number,
  height: number,
) => {
  const points = Object.values(skeleton.joints).map((joint) =>
    webOnnxPointToImage(joint.position, width, height),
  );
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const sw = Math.max(1, bounds.width);
  const sh = Math.max(1, bounds.height);
  const mw = Math.max(1, mask.bbox.width);
  const mh = Math.max(1, mask.bbox.height);
  const maskCenter = { x: mask.bbox.x + mw / 2, y: mask.bbox.y + mh / 2 };
  const skeletonCenter = { x: bounds.x + sw / 2, y: bounds.y + sh / 2 };
  const centerDistance = Math.hypot(maskCenter.x - skeletonCenter.x, maskCenter.y - skeletonCenter.y);
  const needsRepair = sh / mh < 0.55 || sh / mh > 1.45 || sw / mw < 0.35 || sw / mw > 1.8 || centerDistance > Math.hypot(mw, mh) * 0.18;
  if (!needsRepair) return skeleton;
  const scale = Math.max(0.05, Math.min(8, Math.min(mw / sw, mh / sh)));
  const joints = Object.values(skeleton.joints).map((joint) => {
    const point = webOnnxPointToImage(joint.position, width, height);
    return {
      ...joint,
      position: webOnnxPointToScene({
        x: skeletonCenter.x + (point.x - skeletonCenter.x) * scale + (maskCenter.x - skeletonCenter.x),
        y: skeletonCenter.y + (point.y - skeletonCenter.y) * scale + (maskCenter.y - skeletonCenter.y),
      }, width, height),
    };
  });
  const repaired = buildSkeleton(joints);
  repaired.metadata = { ...skeleton.metadata, normalization: `${skeleton.metadata.normalization};mask-reconciled` };
  return repaired;
};
