import type { Tensor as OrtTensor } from "onnxruntime-web";
import type {
  BodyPartLayer,
  Bounds,
  Point,
  StandardJoint,
  StandardSkeleton,
} from "../types";
import { buildSkeleton } from "./project";
import { boundedImageSize, encodedImageSize, WEB_IMAGE_LIMITS } from "./imageDimensions";
import type { OrtRuntime } from "./webOnnxModelRuntime";
import { foregroundMaskFromRgba, poseCropBounds, bboxFromMask } from "./webOnnxPreprocess";
import type { WebOnnxKeypoint } from "./webOnnxProtocol";

type WorkerImage = ImageBitmap;
type ImageMask = {
  width: number;
  height: number;
  data: Uint8Array;
  url: string;
  bbox: Bounds;
};

const PARTS: Array<{
  id: string;
  name: string;
  joints: string[];
  anchor: string;
  color: string;
  z: number;
  fixed?: boolean;
}> = [
  { id: "head", name: "Head", joints: ["neck", "head_top"], anchor: "neck", color: "#f59e0b", z: 10 },
  { id: "torso", name: "Torso", joints: ["neck", "torso", "hip", "left_shoulder", "right_shoulder"], anchor: "torso", color: "#8b5cf6", z: 0, fixed: true },
  { id: "left_arm_upper", name: "Left upper arm", joints: ["left_shoulder", "left_elbow"], anchor: "left_shoulder", color: "#38bdf8", z: 5 },
  { id: "left_arm_lower", name: "Left lower arm", joints: ["left_elbow", "left_hand"], anchor: "left_elbow", color: "#0ea5e9", z: 4 },
  { id: "right_arm_upper", name: "Right upper arm", joints: ["right_shoulder", "right_elbow"], anchor: "right_shoulder", color: "#38bdf8", z: 5 },
  { id: "right_arm_lower", name: "Right lower arm", joints: ["right_elbow", "right_hand"], anchor: "right_elbow", color: "#0ea5e9", z: 4 },
  { id: "left_leg_upper", name: "Left upper leg", joints: ["left_hip", "left_knee"], anchor: "left_hip", color: "#10b981", z: 3 },
  { id: "left_leg_lower", name: "Left lower leg", joints: ["left_knee", "left_foot"], anchor: "left_knee", color: "#059669", z: 2 },
  { id: "right_leg_upper", name: "Right upper leg", joints: ["right_hip", "right_knee"], anchor: "right_hip", color: "#10b981", z: 3 },
  { id: "right_leg_lower", name: "Right lower leg", joints: ["right_knee", "right_foot"], anchor: "right_knee", color: "#059669", z: 2 },
];

const MAX_WORKING_EDGE = WEB_IMAGE_LIMITS.maxWorkingEdge;
const MAX_WORKING_PIXELS = WEB_IMAGE_LIMITS.maxWorkingPixels;
const MAX_SOURCE_TEXTURE_EDGE = WEB_IMAGE_LIMITS.maxSourceTextureEdge;
const MAX_SOURCE_TEXTURE_BYTES = WEB_IMAGE_LIMITS.maxSourceTextureBytes;
const MAX_MASK_BYTES = WEB_IMAGE_LIMITS.maxMaskBytes;

const blobToDataUrl = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return `data:${blob.type};base64,${btoa(chunks.join(""))}`;
};

const canvasDataUrl = async (
  canvas: OffscreenCanvas,
  type: "image/webp" | "image/png",
  maxBytes: number,
) => {
  const qualities = type === "image/webp" ? [0.82, 0.68, 0.52, 0.38] : [undefined];
  for (const quality of qualities) {
    const blob = await canvas.convertToBlob({ type, quality });
    if (blob.size <= maxBytes) return blobToDataUrl(blob);
  }
  throw new Error(`image-output-too-large:${type}:${maxBytes}`);
};

export const readImage = async (file: File) => {
  const encoded = await encodedImageSize(file);
  if (encoded?.width && encoded.height) {
    const size = boundedImageSize(encoded.width, encoded.height, MAX_WORKING_EDGE, MAX_WORKING_PIXELS);
    return {
      img: await createImageBitmap(file, {
        resizeWidth: size.width,
        resizeHeight: size.height,
        resizeQuality: "high",
      }),
      inputWidth: encoded.width,
      inputHeight: encoded.height,
    };
  }
  throw new Error("unsupported-image-format: use PNG, JPEG, or WebP");
};

export const imageToDataUrl = async (img: WorkerImage) => {
  const scale = Math.min(1, MAX_SOURCE_TEXTURE_EDGE / Math.max(img.width, img.height));
  const canvas = new OffscreenCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasDataUrl(canvas, "image/webp", MAX_SOURCE_TEXTURE_BYTES);
};

export const makeCharacterMask = async (img: WorkerImage): Promise<ImageMask> => {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D unavailable for mask");
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const { data: clean, bbox } = foregroundMaskFromRgba(data, canvas.width, canvas.height);
  for (let p = 0, i = 0; i < data.length; i += 4, p += 1) {
    data[i] = data[i + 1] = data[i + 2] = clean[p]; data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return {
    width: canvas.width,
    height: canvas.height,
    data: clean,
    url: await canvasDataUrl(canvas, "image/png", MAX_MASK_BYTES),
    bbox,
  };
};

const poseBbox = (mask: ImageMask): Bounds => poseCropBounds(mask.bbox, mask.width, mask.height);

export const preprocessForPose = (img: WorkerImage, mask: ImageMask, ort: OrtRuntime) => {
  const width = 192, height = 256, bbox = poseBbox(mask);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D unavailable for ONNX preprocessing");
  ctx.drawImage(img, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const data = new Float32Array(3 * height * width);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const source = (y * width + x) * 4, target = y * width + x;
    data[target] = (pixels[source] / 255 - mean[0]) / std[0];
    data[height * width + target] = (pixels[source + 1] / 255 - mean[1]) / std[1];
    data[2 * height * width + target] = (pixels[source + 2] / 255 - mean[2]) / std[2];
  }
  return { tensor: new ort.Tensor("float32", data, [1, 3, height, width]), bbox };
};

const COCO = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"];

export const extractKeypoints = (output: OrtTensor, pose: { bbox: Bounds }): WebOnnxKeypoint[] => {
  const dims = output.dims.map(Number), data = output.data as Float32Array;
  const offset = dims.length === 4 ? 1 : 0, joints = dims[offset], heatmapH = dims[offset + 1], heatmapW = dims[offset + 2];
  if (!joints || !heatmapH || !heatmapW || joints < 16) throw new Error(`Unexpected pose heatmap dimensions: ${dims.join("x")}`);
  const result: WebOnnxKeypoint[] = [];
  for (let joint = 0; joint < joints; joint += 1) {
    let best = -Infinity, bestIndex = 0;
    for (let index = 0; index < heatmapH * heatmapW; index += 1) {
      const value = data[joint * heatmapH * heatmapW + index];
      if (value > best) { best = value; bestIndex = index; }
    }
    const y = Math.floor(bestIndex / heatmapW), x = bestIndex % heatmapW;
    result.push({ name: COCO[joint] ?? `joint_${joint}`, x: pose.bbox.x + (x / Math.max(1, heatmapW - 1)) * pose.bbox.width, y: pose.bbox.y + (y / Math.max(1, heatmapH - 1)) * pose.bbox.height, confidence: best });
  }
  return result;
};

const toScene = (p: Point, img: WorkerImage): Point => ({ x: p.x - img.width / 2, y: img.height / 2 - p.y });
const toImage = (p: Point, img: WorkerImage): Point => ({ x: p.x + img.width / 2, y: img.height / 2 - p.y });
const makeJoint = (id: string, source: Point, img: WorkerImage, parentId: string | null): StandardJoint => ({ id, name: id.replaceAll("_", " "), position: toScene(source, img), parentId, locked: false, bendDirection: 1 });

const skeletonImageBounds = (skeleton: StandardSkeleton, img: WorkerImage) => {
  const points = Object.values(skeleton.joints).map((joint) => toImage(joint.position, img));
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

const reconcileSkeletonToMask = (skeleton: StandardSkeleton, mask: ImageMask, img: WorkerImage) => {
  const sb = skeletonImageBounds(skeleton, img), mb = mask.bbox;
  const sw = Math.max(1, sb.width), sh = Math.max(1, sb.height), mw = Math.max(1, mb.width), mh = Math.max(1, mb.height);
  const mc = { x: mb.x + mw / 2, y: mb.y + mh / 2 }, sc = { x: sb.x + sw / 2, y: sb.y + sh / 2 };
  const needs = sh / mh < 0.55 || sh / mh > 1.45 || sw / mw < 0.35 || sw / mw > 1.8 || Math.hypot(mc.x - sc.x, mc.y - sc.y) > Math.hypot(mw, mh) * 0.18;
  if (!needs) return skeleton;
  const scale = Math.max(0.05, Math.min(8, Math.min(mw / sw, mh / sh)));
  const joints = Object.values(skeleton.joints).map((joint) => {
    const point = toImage(joint.position, img);
    return { ...joint, position: toScene({ x: sc.x + (point.x - sc.x) * scale + (mc.x - sc.x), y: sc.y + (point.y - sc.y) * scale + (mc.y - sc.y) }, img) };
  });
  const fixed = buildSkeleton(joints);
  fixed.metadata = { ...skeleton.metadata, normalization: `${skeleton.metadata.normalization};mask-reconciled` };
  return fixed;
};

export const buildPoseSkeleton = (keypoints: WebOnnxKeypoint[], img: WorkerImage, mask: ImageMask, modelPath: string): StandardSkeleton => {
  const byName = Object.fromEntries(keypoints.map((keypoint) => [keypoint.name, keypoint]));
  const mid = (name: string, a: string, b: string, parentId: string | null) => makeJoint(name, byName[a] && byName[b] ? { x: (byName[a].x + byName[b].x) / 2, y: (byName[a].y + byName[b].y) / 2 } : { x: mask.bbox.x + mask.bbox.width / 2, y: mask.bbox.y + mask.bbox.height / 2 }, img, parentId);
  const make = (name: string, source: string, parentId: string | null) => makeJoint(name, byName[source] ?? { x: mask.bbox.x + mask.bbox.width / 2, y: mask.bbox.y + mask.bbox.height / 2 }, img, parentId);
  const joints = [
    mid("root", "left_hip", "right_hip", null), mid("hip", "left_hip", "right_hip", "root"), mid("torso", "left_shoulder", "right_shoulder", "hip"), make("neck", "nose", "torso"), makeJoint("head_top", { x: byName.nose?.x ?? mask.bbox.x + mask.bbox.width / 2, y: Math.max(0, (byName.nose?.y ?? mask.bbox.y) - mask.bbox.height * 0.12) }, img, "neck"),
    make("left_shoulder", "left_shoulder", "torso"), make("left_elbow", "left_elbow", "left_shoulder"), make("left_hand", "left_wrist", "left_elbow"), make("right_shoulder", "right_shoulder", "torso"), make("right_elbow", "right_elbow", "right_shoulder"), make("right_hand", "right_wrist", "right_elbow"),
    make("left_hip", "left_hip", "root"), make("left_knee", "left_knee", "left_hip"), make("left_foot", "left_ankle", "left_knee"), make("right_hip", "right_hip", "root"), make("right_knee", "right_knee", "right_hip"), make("right_foot", "right_ankle", "right_knee"),
  ];
  const skeleton = buildSkeleton(joints);
  skeleton.metadata = { sourceFormat: "web-onnx-coco-heatmap", scale: 1, imageBounds: { x: 0, y: 0, width: img.width, height: img.height }, normalization: "bbox-pose-image-center-to-scene", model: modelPath };
  return reconcileSkeletonToMask(skeleton, mask, img);
};

const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

const buildPartMasks = (skeleton: StandardSkeleton, mask: ImageMask, img: WorkerImage) => {
  const maxDim = Math.max(mask.width, mask.height), scale = maxDim > 1024 ? 512 / maxDim : maxDim > 512 ? 0.7 : 1;
  const sw = Math.max(1, Math.round(mask.width * scale)), sh = Math.max(1, Math.round(mask.height * scale));
  const partMasks = Object.fromEntries(PARTS.map((part) => [part.id, new Uint8Array(sw * sh)])) as Record<string, Uint8Array>;
  const joints = Object.fromEntries(Object.entries(skeleton.joints).map(([id, joint]) => [id, toImage(joint.position, img)])) as Record<string, Point>;
  for (let sy = 0; sy < sh; sy += 1) for (let sx = 0; sx < sw; sx += 1) {
    const x = Math.min(mask.width - 1, Math.round(sx / scale)), y = Math.min(mask.height - 1, Math.round(sy / scale));
    if (!mask.data[y * mask.width + x]) continue;
    let best = 0, bestScore = -Infinity;
    PARTS.forEach((part, partIndex) => {
      const points = part.joints.map((id) => joints[id]).filter((point): point is Point => Boolean(point));
      let score = 0;
      points.forEach((point, index) => {
        score = Math.max(score, Math.exp(-(Math.hypot(x - point.x, y - point.y) ** 2) / (2 * 30 * 30)));
        const next = points[index + 1];
        if (next) score = Math.max(score, Math.exp(-(distToSegment(x, y, point.x, point.y, next.x, next.y) ** 2) / (2 * 24 * 24)));
      });
      if (part.id.includes("head")) score *= 1 + Math.max(0, (mask.height - y) / mask.height) * 0.5;
      if (part.id.includes("torso")) score *= 1.2;
      if (score > bestScore) { bestScore = score; best = partIndex; }
    });
    partMasks[PARTS[best].id][sy * sw + sx] = 255;
  }
  PARTS.forEach((part) => {
    const current = partMasks[part.id];
    if (current.reduce((sum, value) => sum + (value ? 1 : 0), 0) >= 24) return;
    const points = part.joints.map((id) => joints[id]).filter((point): point is Point => Boolean(point)).map((point) => ({ x: Math.round(point.x * scale), y: Math.round(point.y * scale) }));
    if (points.length < 2) return;
    const [a, b] = [points[0], points.at(-1)!], thickness = Math.max(3, Math.round(Math.min(sw, sh) * 0.03));
    for (let y = Math.max(0, Math.min(a.y, b.y) - thickness); y <= Math.min(sh - 1, Math.max(a.y, b.y) + thickness); y += 1) for (let x = Math.max(0, Math.min(a.x, b.x) - thickness); x <= Math.min(sw - 1, Math.max(a.x, b.x) + thickness); x += 1) {
      const ix = Math.min(mask.width - 1, Math.round(x / scale)), iy = Math.min(mask.height - 1, Math.round(y / scale));
      if (mask.data[iy * mask.width + ix] && distToSegment(x, y, a.x, a.y, b.x, b.y) <= thickness) current[y * sw + x] = 255;
    }
  });
  return { masks: partMasks, width: sw, height: sh, scale };
};

const partMaskBBox = (partMask: Uint8Array, width: number, height: number, scale: number, fallbackPoints: Point[]): Bounds => {
  const bounds = bboxFromMask(partMask, width, height);
  if (bounds) return { x: bounds.x / scale, y: bounds.y / scale, width: Math.max(24, bounds.width / scale), height: Math.max(24, bounds.height / scale) };
  const xs = fallbackPoints.map((point) => point.x), ys = fallbackPoints.map((point) => point.y), pad = 28;
  return { x: Math.max(0, Math.min(...xs) - pad), y: Math.max(0, Math.min(...ys) - pad), width: Math.max(24, Math.max(...xs) - Math.min(...xs) + pad * 2), height: Math.max(24, Math.max(...ys) - Math.min(...ys) + pad * 2) };
};

const contourFromCropMask = (mask: ImageMask, partMask: Uint8Array, maskWidth: number, maskHeight: number, scale: number, crop: Bounds, sampleCount = 48): Point[] => {
  const x0 = Math.max(0, Math.floor(crop.x)), y0 = Math.max(0, Math.floor(crop.y)), width = Math.max(24, Math.ceil(crop.width)), height = Math.max(24, Math.ceil(crop.height));
  const alphaAt = (px: number, py: number) => {
    const ix = Math.min(mask.width - 1, x0 + px), iy = Math.min(mask.height - 1, y0 + py), sx = Math.min(maskWidth - 1, Math.round(ix * scale)), sy = Math.min(maskHeight - 1, Math.round(iy * scale));
    return Boolean(partMask[sy * maskWidth + sx] && mask.data[iy * mask.width + ix]);
  };
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let py = 0; py < height; py += 1) for (let px = 0; px < width; px += 1) if (alphaAt(px, py)) { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
  if (maxX < 0) return [];
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, bins: Array<{ x: number; y: number; d2: number } | null> = Array(sampleCount).fill(null);
  for (let py = minY; py <= maxY; py += 1) for (let px = minX; px <= maxX; px += 1) if (alphaAt(px, py)) {
    const dx = px - center.x, dy = py - center.y, d2 = dx * dx + dy * dy, index = Math.min(sampleCount - 1, Math.floor((((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * sampleCount));
    if (!bins[index] || d2 > bins[index]!.d2) bins[index] = { x: px, y: py, d2 };
  }
  if (bins.filter(Boolean).length < 3) return [];
  return bins.map((point, index) => {
    if (point) return point;
    for (let radius = 1; radius < sampleCount; radius += 1) {
      const left = bins[(index - radius + sampleCount) % sampleCount], right = bins[(index + radius) % sampleCount];
      if (left && right) return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, d2: 0 };
      if (left) return left; if (right) return right;
    }
    return { x: center.x, y: center.y, d2: 0 };
  }).map((point) => ({ x: point.x - width / 2, y: height / 2 - point.y }));
};

const cropPart = async (img: WorkerImage, mask: ImageMask, partMask: Uint8Array, maskWidth: number, maskHeight: number, scale: number, bbox: Bounds) => {
  const x = Math.max(0, Math.floor(bbox.x)), y = Math.max(0, Math.floor(bbox.y)), width = Math.max(24, Math.min(img.width - x, Math.ceil(bbox.width))), height = Math.max(24, Math.min(img.height - y, Math.ceil(bbox.height)));
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D unavailable for part crop");
  ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height), maskCanvas = new OffscreenCanvas(width, height), maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) throw new Error("Canvas 2D unavailable for part mask");
  const maskImage = maskCtx.createImageData(width, height);
  for (let py = 0; py < height; py += 1) for (let px = 0; px < width; px += 1) {
    const ix = Math.min(mask.width - 1, x + px), iy = Math.min(mask.height - 1, y + py), sx = Math.min(maskWidth - 1, Math.round(ix * scale)), sy = Math.min(maskHeight - 1, Math.round(iy * scale)), value = partMask[sy * maskWidth + sx] && mask.data[iy * mask.width + ix] ? 255 : 0, offset = (py * width + px) * 4;
    image.data[offset + 3] = value; maskImage.data[offset] = maskImage.data[offset + 1] = maskImage.data[offset + 2] = value; maskImage.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0); maskCtx.putImageData(maskImage, 0, 0);
  return { textureUrl: await canvasDataUrl(canvas, "image/webp", MAX_SOURCE_TEXTURE_BYTES), maskUrl: await canvasDataUrl(maskCanvas, "image/png", MAX_MASK_BYTES), contourPoints: contourFromCropMask(mask, partMask, maskWidth, maskHeight, scale, { x, y, width, height }), x, y, width, height };
};

export const buildParts = async (skeleton: StandardSkeleton, img: WorkerImage, mask: ImageMask): Promise<BodyPartLayer[]> => {
  const imagePoint = (jointId: string): Point | null => skeleton.joints[jointId] ? toImage(skeleton.joints[jointId].position, img) : null;
  const segmented = buildPartMasks(skeleton, mask, img), parts: BodyPartLayer[] = [];
  for (const def of PARTS) {
    const points = def.joints.map(imagePoint).filter((point): point is Point => Boolean(point));
    if (!points.length) continue;
    const cropBox = partMaskBBox(segmented.masks[def.id], segmented.width, segmented.height, segmented.scale, points);
    const crop = await cropPart(img, mask, segmented.masks[def.id], segmented.width, segmented.height, segmented.scale, cropBox);
    const center = { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 }, anchor = imagePoint(def.anchor) ?? center;
    parts.push({ id: def.id, name: def.name, textureUrl: crop.textureUrl, maskUrl: crop.maskUrl, sourceImageFrame: { x: -crop.x - crop.width / 2, y: -crop.y - crop.height / 2, width: img.width, height: img.height }, contourPoints: crop.contourPoints, contourSource: crop.contourPoints.length >= 3 ? "onnx-mask" : undefined, anchorJointId: def.anchor, transform: { ...toScene(center, img), rotation: 0, scale: 1 }, zIndex: def.z, opacity: 0.96, visible: true, locked: Boolean(def.fixed), selectable: true, bounds: { x: -crop.width / 2, y: -crop.height / 2, width: crop.width, height: crop.height }, localPivotOffset: { x: anchor.x - center.x, y: center.y - anchor.y }, localPivotJointId: def.anchor, group: def.id.split("_")[0], fillColor: def.color });
  }
  return parts;
};
