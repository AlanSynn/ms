import type {
  BodyPartLayer,
  Bounds,
  Point,
  StandardSkeleton,
} from '../../types';
import {
  webOnnxMaskBounds,
  webOnnxPointToImage,
  webOnnxPointToScene,
  type WebOnnxMask,
} from './webOnnxImageGeometry';

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

const distanceToSegment = (point: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
    ),
  );
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
    return Boolean(
      partMask[partY * maskWidth + partX]
      && mask.data[imageY * mask.width + imageX],
    );
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
  const bins: Array<{ x: number; y: number; distance: number } | null> =
    Array(48).fill(null);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!alphaAt(x, y)) continue;
      const dx = x - angleCenter.x;
      const dy = y - angleCenter.y;
      const distance = dx * dx + dy * dy;
      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const bin = Math.min(47, Math.floor((angle / (Math.PI * 2)) * 48));
      if (!bins[bin] || distance > bins[bin]!.distance) {
        bins[bin] = { x, y, distance };
      }
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
      if (nearby) {
        return { x: nearby.x - width / 2, y: height / 2 - nearby.y };
      }
    }
    return { x: 0, y: 0 };
  });
};

export const buildWebOnnxPartPlans = (
  skeleton: StandardSkeleton,
  mask: WebOnnxMask,
): WebOnnxPartPlan[] => {
  const maxDimension = Math.max(mask.width, mask.height);
  const scale = maxDimension > 1024
    ? 512 / maxDimension
    : maxDimension > 512
      ? 0.7
      : 1;
  const maskWidth = Math.max(1, Math.round(mask.width * scale));
  const maskHeight = Math.max(1, Math.round(mask.height * scale));
  const masks = Object.fromEntries(
    WEB_ONNX_PARTS.map((part) => [
      part.id,
      new Uint8Array(maskWidth * maskHeight),
    ]),
  );
  const joints = Object.fromEntries(
    Object.entries(skeleton.joints).map(([id, joint]) => [
      id,
      webOnnxPointToImage(joint.position, mask.width, mask.height),
    ]),
  );
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
          const distance = Math.hypot(
            imageX - points[index].x,
            imageY - points[index].y,
          );
          score = Math.max(
            score,
            Math.exp(-(distance * distance) / (2 * 30 * 30)),
          );
          if (points[index + 1]) {
            const boneDistance = distanceToSegment(
              { x: imageX, y: imageY },
              points[index],
              points[index + 1],
            );
            score = Math.max(
              score,
              Math.exp(-(boneDistance * boneDistance) / (2 * 24 * 24)),
            );
          }
        }
        if (part.id === 'head') {
          score *= 1 + Math.max(0, (mask.height - imageY) / mask.height) * 0.5;
        }
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
      .map((point) => ({
        x: Math.round(point.x * scale),
        y: Math.round(point.y * scale),
      }));
    if (points.length < 2) continue;
    const start = points[0];
    const end = points.at(-1)!;
    const thickness = Math.max(
      3,
      Math.round(Math.min(maskWidth, maskHeight) * 0.03),
    );
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
    const points = definition.joints
      .map((joint) => joints[joint])
      .filter(Boolean);
    if (!points.length) return [];
    const maskBounds = webOnnxMaskBounds(
      masks[definition.id],
      maskWidth,
      maskHeight,
    );
    const crop = maskBounds
      ? {
          x: maskBounds.x / scale,
          y: maskBounds.y / scale,
          width: Math.max(24, maskBounds.width / scale),
          height: Math.max(24, maskBounds.height / scale),
        }
      : {
          x: Math.max(0, Math.min(...points.map((point) => point.x)) - 28),
          y: Math.max(0, Math.min(...points.map((point) => point.y)) - 28),
          width: Math.max(
            24,
            Math.max(...points.map((point) => point.x))
              - Math.min(...points.map((point) => point.x))
              + 56,
          ),
          height: Math.max(
            24,
            Math.max(...points.map((point) => point.y))
              - Math.min(...points.map((point) => point.y))
              + 56,
          ),
        };
    const safeCrop = {
      x: Math.max(0, Math.floor(crop.x)),
      y: Math.max(0, Math.floor(crop.y)),
      width: Math.max(
        24,
        Math.min(
          mask.width - Math.max(0, Math.floor(crop.x)),
          Math.ceil(crop.width),
        ),
      ),
      height: Math.max(
        24,
        Math.min(
          mask.height - Math.max(0, Math.floor(crop.y)),
          Math.ceil(crop.height),
        ),
      ),
    };
    const center = {
      x: safeCrop.x + safeCrop.width / 2,
      y: safeCrop.y + safeCrop.height / 2,
    };
    return [{
      definition,
      partMask: masks[definition.id],
      maskWidth,
      maskHeight,
      scale,
      crop: safeCrop,
      contourPoints: contourFromPartMask(
        mask,
        masks[definition.id],
        maskWidth,
        maskHeight,
        scale,
        safeCrop,
      ),
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
  sourceImageFrame: {
    x: -plan.crop.x - plan.crop.width / 2,
    y: -plan.crop.y - plan.crop.height / 2,
    width,
    height,
  },
  contourPoints: plan.contourPoints,
  contourSource: plan.contourPoints.length >= 3 ? 'onnx-mask' : undefined,
  anchorJointId: plan.definition.anchor,
  transform: {
    ...webOnnxPointToScene(plan.center, width, height),
    rotation: 0,
    scale: 1,
  },
  zIndex: plan.definition.z,
  opacity: 0.96,
  visible: true,
  locked: Boolean(plan.definition.fixed),
  selectable: true,
  bounds: {
    x: -plan.crop.width / 2,
    y: -plan.crop.height / 2,
    width: plan.crop.width,
    height: plan.crop.height,
  },
  localPivotOffset: {
    x: plan.anchor.x - plan.center.x,
    y: plan.center.y - plan.anchor.y,
  },
  localPivotJointId: plan.definition.anchor,
  group: plan.definition.id.split('_')[0],
  fillColor: plan.definition.color,
});
