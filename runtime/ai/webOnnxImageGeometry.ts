import type {
  BodyPartLayer,
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

export const WEB_ONNX_PARTS: Array<{
  id: string;
  name: string;
  joints: string[];
  anchor: string;
  color: string;
  z: number;
  fixed?: boolean;
}> = [
  { id: 'head', name: 'Head', joints: ['neck', 'head_top'], anchor: 'neck', color: '#f59e0b', z: 10 },
  { id: 'torso', name: 'Torso', joints: ['neck', 'torso', 'hip', 'left_shoulder', 'right_shoulder'], anchor: 'torso', color: '#8b5cf6', z: 0, fixed: true },
  { id: 'left_arm_upper', name: 'Left upper arm', joints: ['left_shoulder', 'left_elbow'], anchor: 'left_shoulder', color: '#38bdf8', z: 5 },
  { id: 'left_arm_lower', name: 'Left lower arm', joints: ['left_elbow', 'left_hand'], anchor: 'left_elbow', color: '#0ea5e9', z: 4 },
  { id: 'right_arm_upper', name: 'Right upper arm', joints: ['right_shoulder', 'right_elbow'], anchor: 'right_shoulder', color: '#38bdf8', z: 5 },
  { id: 'right_arm_lower', name: 'Right lower arm', joints: ['right_elbow', 'right_hand'], anchor: 'right_elbow', color: '#0ea5e9', z: 4 },
  { id: 'left_leg_upper', name: 'Left upper leg', joints: ['left_hip', 'left_knee'], anchor: 'left_hip', color: '#10b981', z: 3 },
  { id: 'left_leg_lower', name: 'Left lower leg', joints: ['left_knee', 'left_foot'], anchor: 'left_knee', color: '#059669', z: 2 },
  { id: 'right_leg_upper', name: 'Right upper leg', joints: ['right_hip', 'right_knee'], anchor: 'right_hip', color: '#10b981', z: 3 },
  { id: 'right_leg_lower', name: 'Right lower leg', joints: ['right_knee', 'right_foot'], anchor: 'right_knee', color: '#059669', z: 2 },
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

export type WebOnnxPartPlan = {
  definition: (typeof WEB_ONNX_PARTS)[number];
  partMask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  scale: number;
  crop: Bounds;
  contourPoints: Point[];
  center: Point;
  anchor: Point;
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

const bboxFromMask = (mask: Uint8Array, width: number, height: number): Bounds | null => {
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
    bbox: bboxFromMask(data, width, height) ?? { x: 0, y: 0, width, height },
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

const toScene = (point: Point, width: number, height: number): Point => ({
  x: point.x - width / 2,
  y: height / 2 - point.y,
});

const toImage = (point: Point, width: number, height: number): Point => ({
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
    position: toScene(point, width, height),
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
  const points = Object.values(skeleton.joints).map((joint) => toImage(joint.position, width, height));
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
    const point = toImage(joint.position, width, height);
    return {
      ...joint,
      position: toScene({
        x: skeletonCenter.x + (point.x - skeletonCenter.x) * scale + (maskCenter.x - skeletonCenter.x),
        y: skeletonCenter.y + (point.y - skeletonCenter.y) * scale + (maskCenter.y - skeletonCenter.y),
      }, width, height),
    };
  });
  const repaired = buildSkeleton(joints);
  repaired.metadata = { ...skeleton.metadata, normalization: `${skeleton.metadata.normalization};mask-reconciled` };
  return repaired;
};

const distanceToSegment = (point: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
};

const contourFromPartMask = (
  mask: WebOnnxMask,
  partMask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  scale: number,
  crop: Bounds,
): Point[] => {
  const x0 = Math.max(0, Math.floor(crop.x));
  const y0 = Math.max(0, Math.floor(crop.y));
  const width = Math.max(24, Math.ceil(crop.width));
  const height = Math.max(24, Math.ceil(crop.height));
  const alphaAt = (x: number, y: number) => {
    const imageX = Math.min(mask.width - 1, x0 + x);
    const imageY = Math.min(mask.height - 1, y0 + y);
    const partX = Math.min(maskWidth - 1, Math.round(imageX * scale));
    const partY = Math.min(maskHeight - 1, Math.round(imageY * scale));
    return Boolean(partMask[partY * maskWidth + partX] && mask.data[imageY * mask.width + imageX]);
  };
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!alphaAt(x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return [];
  const angleCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const bins: Array<{ x: number; y: number; distance: number } | null> = Array(48).fill(null);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!alphaAt(x, y)) continue;
      const dx = x - angleCenter.x;
      const dy = y - angleCenter.y;
      const distance = dx * dx + dy * dy;
      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const bin = Math.min(47, Math.floor((angle / (Math.PI * 2)) * 48));
      if (!bins[bin] || distance > bins[bin]!.distance) bins[bin] = { x, y, distance };
    }
  }
  if (bins.filter(Boolean).length < 3) return [];
  return bins.map((point, index) => {
    if (point) return { x: point.x - width / 2, y: height / 2 - point.y };
    for (let radius = 1; radius < bins.length; radius += 1) {
      const left = bins[(index - radius + bins.length) % bins.length];
      const right = bins[(index + radius) % bins.length];
      if (left && right) {
        return {
          x: (left.x + right.x) / 2 - width / 2,
          y: height / 2 - (left.y + right.y) / 2,
        };
      }
      const nearby = left ?? right;
      if (nearby) return { x: nearby.x - width / 2, y: height / 2 - nearby.y };
    }
    return { x: 0, y: 0 };
  });
};

export const buildWebOnnxPartPlans = (
  skeleton: StandardSkeleton,
  mask: WebOnnxMask,
): WebOnnxPartPlan[] => {
  const maxDimension = Math.max(mask.width, mask.height);
  const scale = maxDimension > 1024 ? 512 / maxDimension : maxDimension > 512 ? 0.7 : 1;
  const maskWidth = Math.max(1, Math.round(mask.width * scale));
  const maskHeight = Math.max(1, Math.round(mask.height * scale));
  const masks = Object.fromEntries(WEB_ONNX_PARTS.map((part) => [part.id, new Uint8Array(maskWidth * maskHeight)]));
  const joints = Object.fromEntries(Object.entries(skeleton.joints).map(([id, joint]) => [id, toImage(joint.position, mask.width, mask.height)]));
  for (let y = 0; y < maskHeight; y += 1) {
    for (let x = 0; x < maskWidth; x += 1) {
      const imageX = Math.min(mask.width - 1, Math.round(x / scale));
      const imageY = Math.min(mask.height - 1, Math.round(y / scale));
      if (!mask.data[imageY * mask.width + imageX]) continue;
      let bestPart = WEB_ONNX_PARTS[0];
      let bestScore = -Infinity;
      for (const part of WEB_ONNX_PARTS) {
        const points = part.joints.map((joint) => joints[joint]).filter(Boolean);
        let score = 0;
        for (let index = 0; index < points.length; index += 1) {
          const distance = Math.hypot(imageX - points[index].x, imageY - points[index].y);
          score = Math.max(score, Math.exp(-(distance * distance) / (2 * 30 * 30)));
          if (points[index + 1]) {
            const boneDistance = distanceToSegment({ x: imageX, y: imageY }, points[index], points[index + 1]);
            score = Math.max(score, Math.exp(-(boneDistance * boneDistance) / (2 * 24 * 24)));
          }
        }
        if (part.id === 'head') score *= 1 + Math.max(0, (mask.height - imageY) / mask.height) * 0.5;
        if (part.id === 'torso') score *= 1.2;
        if (score > bestScore) {
          bestScore = score;
          bestPart = part;
        }
      }
      masks[bestPart.id][y * maskWidth + x] = 255;
    }
  }
  for (const definition of WEB_ONNX_PARTS) {
    const partMask = masks[definition.id];
    let area = 0;
    partMask.forEach((value) => {
      if (value) area += 1;
    });
    if (area >= 24) continue;
    const points = definition.joints
      .map((joint) => joints[joint])
      .filter(Boolean)
      .map((point) => ({ x: Math.round(point.x * scale), y: Math.round(point.y * scale) }));
    if (points.length < 2) continue;
    const start = points[0];
    const end = points.at(-1)!;
    const thickness = Math.max(3, Math.round(Math.min(maskWidth, maskHeight) * 0.03));
    for (
      let y = Math.max(0, Math.min(start.y, end.y) - thickness);
      y <= Math.min(maskHeight - 1, Math.max(start.y, end.y) + thickness);
      y += 1
    ) {
      for (
        let x = Math.max(0, Math.min(start.x, end.x) - thickness);
        x <= Math.min(maskWidth - 1, Math.max(start.x, end.x) + thickness);
        x += 1
      ) {
        const imageX = Math.min(mask.width - 1, Math.round(x / scale));
        const imageY = Math.min(mask.height - 1, Math.round(y / scale));
        if (
          mask.data[imageY * mask.width + imageX]
          && distanceToSegment({ x, y }, start, end) <= thickness
        ) {
          partMask[y * maskWidth + x] = 255;
        }
      }
    }
  }
  return WEB_ONNX_PARTS.flatMap((definition) => {
    const points = definition.joints.map((joint) => joints[joint]).filter(Boolean);
    if (!points.length) return [];
    const maskBounds = bboxFromMask(masks[definition.id], maskWidth, maskHeight);
    const crop = maskBounds
      ? { x: maskBounds.x / scale, y: maskBounds.y / scale, width: Math.max(24, maskBounds.width / scale), height: Math.max(24, maskBounds.height / scale) }
      : {
          x: Math.max(0, Math.min(...points.map((point) => point.x)) - 28),
          y: Math.max(0, Math.min(...points.map((point) => point.y)) - 28),
          width: Math.max(24, Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)) + 56),
          height: Math.max(24, Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)) + 56),
        };
    const safeCrop = {
      x: Math.max(0, Math.floor(crop.x)),
      y: Math.max(0, Math.floor(crop.y)),
      width: Math.max(24, Math.min(mask.width - Math.max(0, Math.floor(crop.x)), Math.ceil(crop.width))),
      height: Math.max(24, Math.min(mask.height - Math.max(0, Math.floor(crop.y)), Math.ceil(crop.height))),
    };
    const center = { x: safeCrop.x + safeCrop.width / 2, y: safeCrop.y + safeCrop.height / 2 };
    return [{
      definition,
      partMask: masks[definition.id],
      maskWidth,
      maskHeight,
      scale,
      crop: safeCrop,
      contourPoints: contourFromPartMask(mask, masks[definition.id], maskWidth, maskHeight, scale, safeCrop),
      center,
      anchor: joints[definition.anchor] ?? center,
    }];
  });
};

export const partLayerFromPlan = (
  plan: WebOnnxPartPlan,
  width: number,
  height: number,
  textureUrl: string,
  maskUrl: string,
): BodyPartLayer => ({
  id: plan.definition.id,
  name: plan.definition.name,
  textureUrl,
  maskUrl,
  sourceImageFrame: { x: -plan.crop.x - plan.crop.width / 2, y: -plan.crop.y - plan.crop.height / 2, width, height },
  contourPoints: plan.contourPoints,
  contourSource: plan.contourPoints.length >= 3 ? 'onnx-mask' : undefined,
  anchorJointId: plan.definition.anchor,
  transform: { ...toScene(plan.center, width, height), rotation: 0, scale: 1 },
  zIndex: plan.definition.z,
  opacity: 0.96,
  visible: true,
  locked: Boolean(plan.definition.fixed),
  selectable: true,
  bounds: { x: -plan.crop.width / 2, y: -plan.crop.height / 2, width: plan.crop.width, height: plan.crop.height },
  localPivotOffset: { x: plan.anchor.x - plan.center.x, y: plan.center.y - plan.anchor.y },
  localPivotJointId: plan.definition.anchor,
  group: plan.definition.id.split('_')[0],
  fillColor: plan.definition.color,
});
