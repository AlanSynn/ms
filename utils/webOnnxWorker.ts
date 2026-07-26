import type { Tensor as OrtTensor } from 'onnxruntime-web';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { BodyPartLayer, Bounds, Point, StandardJoint, StandardSkeleton } from '../types';
import { boundedImageSize, encodedImageSize } from './imageDimensions';
import { buildSkeleton } from './project';

export interface WebOnnxResult {
    skeleton: StandardSkeleton;
    parts: BodyPartLayer[];
    textureUrl: string;
    maskUrl: string;
    keypoints: Array<Point & { confidence: number; name: string }>;
    metrics: {
        inputWidth: number;
        inputHeight: number;
        workingWidth: number;
        workingHeight: number;
        provider: 'wasm';
        model: 'fp32';
    };
}

const COCO = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
];

const PARTS: Array<{ id: string; name: string; joints: string[]; anchor: string; color: string; z: number; fixed?: boolean }> = [
    { id: 'head', name: 'Head', joints: ['neck', 'head_top'], anchor: 'neck', color: '#f59e0b', z: 10 },
    { id: 'torso', name: 'Torso', joints: ['neck', 'torso', 'hip', 'left_shoulder', 'right_shoulder'], anchor: 'torso', color: '#8b5cf6', z: 0, fixed: true },
    { id: 'left_arm_upper', name: 'Left upper arm', joints: ['left_shoulder', 'left_elbow'], anchor: 'left_shoulder', color: '#38bdf8', z: 5 },
    { id: 'left_arm_lower', name: 'Left lower arm', joints: ['left_elbow', 'left_hand'], anchor: 'left_elbow', color: '#0ea5e9', z: 4 },
    { id: 'right_arm_upper', name: 'Right upper arm', joints: ['right_shoulder', 'right_elbow'], anchor: 'right_shoulder', color: '#38bdf8', z: 5 },
    { id: 'right_arm_lower', name: 'Right lower arm', joints: ['right_elbow', 'right_hand'], anchor: 'right_elbow', color: '#0ea5e9', z: 4 },
    { id: 'left_leg_upper', name: 'Left upper leg', joints: ['left_hip', 'left_knee'], anchor: 'left_hip', color: '#10b981', z: 3 },
    { id: 'left_leg_lower', name: 'Left lower leg', joints: ['left_knee', 'left_foot'], anchor: 'left_knee', color: '#059669', z: 2 },
    { id: 'right_leg_upper', name: 'Right upper leg', joints: ['right_hip', 'right_knee'], anchor: 'right_hip', color: '#10b981', z: 3 },
    { id: 'right_leg_lower', name: 'Right lower leg', joints: ['right_knee', 'right_foot'], anchor: 'right_knee', color: '#059669', z: 2 }
];

type ImageMask = { width: number; height: number; data: Uint8Array; url: string; bbox: Bounds };
type OrtRuntime = typeof import('onnxruntime-web/wasm');
type PoseInput = { tensor: OrtTensor; bbox: Bounds };
type WorkerImage = ImageBitmap;

const MAX_WORKING_EDGE = 1_024;
const MAX_WORKING_PIXELS = 1_000_000;
const MAX_SOURCE_TEXTURE_EDGE = 512;
const MAX_SOURCE_TEXTURE_BYTES = 256 * 1_024;
const MAX_PART_TEXTURE_BYTES = 256 * 1_024;
const MAX_MASK_BYTES = 128 * 1_024;

const readImage = async (file: File) => {
    const encoded = await encodedImageSize(file);
    if (encoded?.width && encoded.height) {
        const size = boundedImageSize(encoded.width, encoded.height, MAX_WORKING_EDGE, MAX_WORKING_PIXELS);
        return {
            img: await createImageBitmap(file, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' }),
            inputWidth: encoded.width,
            inputHeight: encoded.height
        };
    }
    const decoded = await createImageBitmap(file);
    const size = boundedImageSize(decoded.width, decoded.height, MAX_WORKING_EDGE, MAX_WORKING_PIXELS);
    if (size.width === decoded.width && size.height === decoded.height) return { img: decoded, inputWidth: decoded.width, inputHeight: decoded.height };
    const inputWidth = decoded.width;
    const inputHeight = decoded.height;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.drawImage(decoded, 0, 0, size.width, size.height);
    decoded.close();
    return { img: await createImageBitmap(canvas), inputWidth, inputHeight };
};

const blobToDataUrl = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    return `data:${blob.type};base64,${btoa(chunks.join(''))}`;
};

const canvasDataUrl = async (canvas: OffscreenCanvas, type: 'image/webp' | 'image/png', maxBytes: number) => {
    const qualities = type === 'image/webp' ? [0.82, 0.68, 0.52, 0.38] : [undefined];
    for (const quality of qualities) {
        const blob = await canvas.convertToBlob({ type, quality });
        if (blob.size <= maxBytes) return blobToDataUrl(blob);
    }
    throw new Error(`image-output-too-large:${type}:${maxBytes}`);
};

const imageToDataUrl = async (img: WorkerImage) => {
    const scale = Math.min(1, MAX_SOURCE_TEXTURE_EDGE / Math.max(img.width, img.height));
    const canvas = new OffscreenCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasDataUrl(canvas, 'image/webp', MAX_SOURCE_TEXTURE_BYTES);
};

const bboxFromMask = (mask: Uint8Array, width: number, height: number): Bounds | null => {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!mask[y * width + x]) continue;
            minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
    }
    return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const keepSignificantComponents = (mask: Uint8Array, width: number, height: number) => {
    const labels = new Int32Array(width * height).fill(-1);
    const areas: number[] = [];
    const queue = new Int32Array(width * height);
    let label = 0;
    for (let i = 0; i < mask.length; i++) {
        if (!mask[i] || labels[i] !== -1) continue;
        let head = 0, tail = 0, area = 0;
        labels[i] = label;
        queue[tail++] = i;
        while (head < tail) {
            const idx = queue[head++];
            area++;
            const x = idx % width;
            const y = Math.floor(idx / width);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                const ni = ny * width + nx;
                if (mask[ni] && labels[ni] === -1) {
                    labels[ni] = label;
                    queue[tail++] = ni;
                }
            }
        }
        areas[label++] = area;
    }
    if (!areas.length) return mask;
    const largest = Math.max(...areas);
    const total = areas.reduce((a, b) => a + b, 0);
    const threshold = Math.max(64, total * 0.003, largest * 0.01);
    const keep = new Uint8Array(mask.length);
    for (let i = 0; i < labels.length; i++) if (labels[i] >= 0 && areas[labels[i]] >= threshold) keep[i] = 255;
    return keep.some(Boolean) ? keep : mask;
};

const makeCharacterMask = async (img: WorkerImage): Promise<ImageMask> => {
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D unavailable for mask');
    ctx.drawImage(img, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const mask = new Uint8Array(canvas.width * canvas.height);
    let alphaVariance = 0;
    let whitePixels = 0;
    for (let i = 0; i < data.length; i += 4) {
        alphaVariance += Math.abs(data[i + 3] - 255);
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (luma > 240) whitePixels++;
    }
    const alphaDriven = alphaVariance > data.length * 0.01;
    const lineArt = whitePixels / mask.length > 0.4;
    for (let p = 0, i = 0; i < data.length; i += 4, p++) {
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const fg = alphaDriven ? data[i + 3] > 10 : lineArt ? luma < 242 : luma < 245 && luma > 8;
        mask[p] = fg ? 255 : 0;
    }
    const clean = keepSignificantComponents(mask, canvas.width, canvas.height);
    for (let p = 0, i = 0; i < data.length; i += 4, p++) {
        data[i] = data[i + 1] = data[i + 2] = clean[p];
        data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const bbox = bboxFromMask(clean, canvas.width, canvas.height) ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
    return { width: canvas.width, height: canvas.height, data: clean, url: await canvasDataUrl(canvas, 'image/png', MAX_MASK_BYTES), bbox };
};

const poseBbox = (mask: ImageMask): Bounds => {
    const margin = 0.2;
    const x = Math.max(0, mask.bbox.x - mask.bbox.width * margin);
    const y = Math.max(0, mask.bbox.y - mask.bbox.height * margin);
    const right = Math.min(mask.width, mask.bbox.x + mask.bbox.width * (1 + margin));
    const bottom = Math.min(mask.height, mask.bbox.y + mask.bbox.height * (1 + margin));
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
};

const preprocessForPose = (img: WorkerImage, mask: ImageMask, ort: OrtRuntime): PoseInput => {
    const width = 192;
    const height = 256;
    const bbox = poseBbox(mask);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D unavailable for ONNX preprocessing');
    ctx.drawImage(img, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const data = new Float32Array(1 * 3 * height * width);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const src = (y * width + x) * 4;
            const dst = y * width + x;
            data[dst] = (pixels[src] / 255 - mean[0]) / std[0];
            data[height * width + dst] = (pixels[src + 1] / 255 - mean[1]) / std[1];
            data[2 * height * width + dst] = (pixels[src + 2] / 255 - mean[2]) / std[2];
        }
    }
    return { tensor: new ort.Tensor('float32', data, [1, 3, height, width]), bbox };
};

const extractKeypoints = (output: OrtTensor, pose: PoseInput) => {
    const dims = output.dims.map(Number);
    const data = output.data as Float32Array;
    const offset = dims.length === 4 ? 1 : 0;
    const joints = dims[offset];
    const heatmapH = dims[offset + 1];
    const heatmapW = dims[offset + 2];
    if (!joints || !heatmapH || !heatmapW || joints < 16) throw new Error(`Unexpected pose heatmap dimensions: ${dims.join('x')}`);
    const result: Array<Point & { confidence: number; name: string }> = [];
    for (let j = 0; j < joints; j++) {
        let best = -Infinity;
        let bestIndex = 0;
        const base = j * heatmapH * heatmapW;
        for (let i = 0; i < heatmapH * heatmapW; i++) {
            const value = data[base + i];
            if (value > best) { best = value; bestIndex = i; }
        }
        const y = Math.floor(bestIndex / heatmapW);
        const x = bestIndex % heatmapW;
        result.push({
            name: COCO[j] ?? `joint_${j}`,
            x: pose.bbox.x + (x / Math.max(1, heatmapW - 1)) * pose.bbox.width,
            y: pose.bbox.y + (y / Math.max(1, heatmapH - 1)) * pose.bbox.height,
            confidence: best
        });
    }
    return result;
};

const toScene = (p: Point, img: WorkerImage): Point => ({ x: p.x - img.width / 2, y: img.height / 2 - p.y });
const toImage = (p: Point, img: WorkerImage): Point => ({ x: p.x + img.width / 2, y: img.height / 2 - p.y });

const makeJoint = (id: string, source: Point, img: WorkerImage, parentId: string | null): StandardJoint => ({
    id,
    name: id.replaceAll('_', ' '),
    position: toScene(source, img),
    parentId,
    locked: false,
    bendDirection: 1
});

const skeletonImageBounds = (skeleton: StandardSkeleton, img: WorkerImage) => {
    const pts = Object.values(skeleton.joints).map(j => toImage(j.position, img));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

const reconcileSkeletonToMask = (skeleton: StandardSkeleton, mask: ImageMask, img: WorkerImage): StandardSkeleton => {
    const sb = skeletonImageBounds(skeleton, img);
    const mb = mask.bbox;
    const sw = Math.max(1, sb.width), sh = Math.max(1, sb.height), mw = Math.max(1, mb.width), mh = Math.max(1, mb.height);
    const mc = { x: mb.x + mw / 2, y: mb.y + mh / 2 };
    const sc = { x: sb.x + sw / 2, y: sb.y + sh / 2 };
    const centerDist = Math.hypot(mc.x - sc.x, mc.y - sc.y);
    const maskDiag = Math.max(1, Math.hypot(mw, mh));
    const needs = sh / mh < 0.55 || sh / mh > 1.45 || sw / mw < 0.35 || sw / mw > 1.8 || centerDist > maskDiag * 0.18;
    if (!needs) return skeleton;
    const scale = Math.max(0.05, Math.min(8, Math.min(mw / sw, mh / sh)));
    const joints = Object.values(skeleton.joints).map(j => {
        const p = toImage(j.position, img);
        const x = sc.x + (p.x - sc.x) * scale + (mc.x - sc.x);
        const y = sc.y + (p.y - sc.y) * scale + (mc.y - sc.y);
        return { ...j, position: toScene({ x, y }, img) };
    });
    const fixed = buildSkeleton(joints);
    fixed.metadata = { ...skeleton.metadata, normalization: `${skeleton.metadata.normalization};mask-reconciled` };
    return fixed;
};

const buildPoseSkeleton = (keypoints: Array<Point & { confidence: number; name: string }>, img: WorkerImage, mask: ImageMask): StandardSkeleton => {
    const byName = Object.fromEntries(keypoints.map(k => [k.name, k]));
    const mid = (name: string, a: string, b: string, parentId: string | null) => {
        const pa = byName[a]; const pb = byName[b];
        const p = pa && pb ? { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } : { x: mask.bbox.x + mask.bbox.width / 2, y: mask.bbox.y + mask.bbox.height / 2 };
        return makeJoint(name, p, img, parentId);
    };
    const make = (name: string, source: string, parentId: string | null) => makeJoint(name, byName[source] ?? { x: mask.bbox.x + mask.bbox.width / 2, y: mask.bbox.y + mask.bbox.height / 2 }, img, parentId);
    const joints: StandardJoint[] = [
        mid('root', 'left_hip', 'right_hip', null), mid('hip', 'left_hip', 'right_hip', 'root'), mid('torso', 'left_shoulder', 'right_shoulder', 'hip'),
        make('neck', 'nose', 'torso'), makeJoint('head_top', { x: byName.nose?.x ?? mask.bbox.x + mask.bbox.width / 2, y: Math.max(0, (byName.nose?.y ?? mask.bbox.y) - mask.bbox.height * 0.12) }, img, 'neck'),
        make('left_shoulder', 'left_shoulder', 'torso'), make('left_elbow', 'left_elbow', 'left_shoulder'), make('left_hand', 'left_wrist', 'left_elbow'),
        make('right_shoulder', 'right_shoulder', 'torso'), make('right_elbow', 'right_elbow', 'right_shoulder'), make('right_hand', 'right_wrist', 'right_elbow'),
        make('left_hip', 'left_hip', 'root'), make('left_knee', 'left_knee', 'left_hip'), make('left_foot', 'left_ankle', 'left_knee'),
        make('right_hip', 'right_hip', 'root'), make('right_knee', 'right_knee', 'right_hip'), make('right_foot', 'right_ankle', 'right_knee')
    ];
    const skeleton = buildSkeleton(joints);
    skeleton.metadata = { sourceFormat: 'web-onnx-coco-heatmap', scale: 1, imageBounds: { x: 0, y: 0, width: img.width, height: img.height }, normalization: 'bbox-pose-image-center-to-scene', model: modelUrl() };
    return reconcileSkeletonToMask(skeleton, mask, img);
};

const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const x = ax + t * dx, y = ay + t * dy;
    return Math.hypot(px - x, py - y);
};

const buildPartMasks = (skeleton: StandardSkeleton, mask: ImageMask, img: WorkerImage) => {
    const maxDim = Math.max(mask.width, mask.height);
    const scale = maxDim > 1024 ? 512 / maxDim : maxDim > 512 ? 0.7 : 1;
    const sw = Math.max(1, Math.round(mask.width * scale));
    const sh = Math.max(1, Math.round(mask.height * scale));
    const partMasks = Object.fromEntries(PARTS.map(p => [p.id, new Uint8Array(sw * sh)]));
    const joints = Object.fromEntries(Object.entries(skeleton.joints).map(([id, joint]) => [id, toImage(joint.position, img)]));
    const scores = new Float32Array(PARTS.length);
    for (let sy = 0; sy < sh; sy++) {
        for (let sx = 0; sx < sw; sx++) {
            const x = Math.min(mask.width - 1, Math.round(sx / scale));
            const y = Math.min(mask.height - 1, Math.round(sy / scale));
            if (!mask.data[y * mask.width + x]) continue;
            let best = 0, bestScore = -Infinity;
            for (let i = 0; i < PARTS.length; i++) {
                const def = PARTS[i];
                const pts = def.joints.map(j => joints[j]).filter(Boolean);
                let score = 0;
                for (let j = 0; j < pts.length; j++) {
                    const d = Math.hypot(x - pts[j].x, y - pts[j].y);
                    score = Math.max(score, Math.exp(-(d * d) / (2 * 30 * 30)));
                    if (pts[j + 1]) {
                        const bd = distToSegment(x, y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y);
                        score = Math.max(score, Math.exp(-(bd * bd) / (2 * 24 * 24)));
                    }
                }
                if (def.id.includes('head')) score *= 1 + Math.max(0, (mask.height - y) / mask.height) * 0.5;
                if (def.id.includes('torso')) score *= 1.2;
                scores[i] = score;
                if (score > bestScore) { bestScore = score; best = i; }
            }
            partMasks[PARTS[best].id][sy * sw + sx] = 255;
        }
    }
    for (const def of PARTS) {
        const current = partMasks[def.id];
        let area = 0;
        current.forEach(v => { if (v) area++; });
        if (area >= 24) continue;
        const pts = def.joints.map(j => joints[j]).filter(Boolean).map(p => ({ x: Math.round(p.x * scale), y: Math.round(p.y * scale) }));
        if (pts.length < 2) continue;
        const [a, b] = [pts[0], pts.at(-1)!];
        const thickness = Math.max(3, Math.round(Math.min(sw, sh) * 0.03));
        for (let y = Math.max(0, Math.min(a.y, b.y) - thickness); y <= Math.min(sh - 1, Math.max(a.y, b.y) + thickness); y++) {
            for (let x = Math.max(0, Math.min(a.x, b.x) - thickness); x <= Math.min(sw - 1, Math.max(a.x, b.x) + thickness); x++) {
                const ix = Math.min(mask.width - 1, Math.round(x / scale));
                const iy = Math.min(mask.height - 1, Math.round(y / scale));
                if (mask.data[iy * mask.width + ix] && distToSegment(x, y, a.x, a.y, b.x, b.y) <= thickness) current[y * sw + x] = 255;
            }
        }
    }
    return { masks: partMasks, width: sw, height: sh, scale };
};

const partMaskBBox = (partMask: Uint8Array, width: number, height: number, scale: number, fallbackPoints: Point[]): Bounds => {
    const b = bboxFromMask(partMask, width, height);
    if (b) return { x: b.x / scale, y: b.y / scale, width: Math.max(24, b.width / scale), height: Math.max(24, b.height / scale) };
    const xs = fallbackPoints.map(p => p.x), ys = fallbackPoints.map(p => p.y);
    const pad = 28;
    return { x: Math.max(0, Math.min(...xs) - pad), y: Math.max(0, Math.min(...ys) - pad), width: Math.max(24, Math.max(...xs) - Math.min(...xs) + pad * 2), height: Math.max(24, Math.max(...ys) - Math.min(...ys) + pad * 2) };
};

const contourFromCropMask = (
    mask: ImageMask,
    partMask: Uint8Array,
    maskWidth: number,
    maskHeight: number,
    scale: number,
    crop: Bounds,
    sampleCount = 48
): Point[] => {
    const x0 = Math.max(0, Math.floor(crop.x));
    const y0 = Math.max(0, Math.floor(crop.y));
    const width = Math.max(24, Math.ceil(crop.width));
    const height = Math.max(24, Math.ceil(crop.height));
    const alphaAt = (px: number, py: number) => {
        const ix = Math.min(mask.width - 1, x0 + px);
        const iy = Math.min(mask.height - 1, y0 + py);
        const sx = Math.min(maskWidth - 1, Math.round(ix * scale));
        const sy = Math.min(maskHeight - 1, Math.round(iy * scale));
        return Boolean(partMask[sy * maskWidth + sx] && mask.data[iy * mask.width + ix]);
    };
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let py = 0; py < height; py += 1) for (let px = 0; px < width; px += 1) {
        if (!alphaAt(px, py)) continue;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
    }
    if (maxX < 0) return [];
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const bins: Array<{ x: number; y: number; d2: number } | null> = Array(sampleCount).fill(null);
    for (let py = minY; py <= maxY; py += 1) for (let px = minX; px <= maxX; px += 1) {
        if (!alphaAt(px, py)) continue;
        const dx = px - center.x;
        const dy = py - center.y;
        const d2 = dx * dx + dy * dy;
        const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
        const index = Math.min(sampleCount - 1, Math.floor((angle / (Math.PI * 2)) * sampleCount));
        if (!bins[index] || d2 > bins[index]!.d2) bins[index] = { x: px, y: py, d2 };
    }
    if (bins.filter(Boolean).length < 3) return [];
    return bins.map((point, index) => {
        if (point) return point;
        for (let radius = 1; radius < sampleCount; radius += 1) {
            const left = bins[(index - radius + sampleCount) % sampleCount];
            const right = bins[(index + radius) % sampleCount];
            if (left && right) return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, d2: 0 };
            if (left) return left;
            if (right) return right;
        }
        return { x: center.x, y: center.y, d2: 0 };
    }).map(point => ({ x: point.x - width / 2, y: height / 2 - point.y }));
};

const cropPart = async (img: WorkerImage, mask: ImageMask, partMask: Uint8Array, maskWidth: number, maskHeight: number, scale: number, bbox: Bounds) => {
    const x = Math.max(0, Math.floor(bbox.x));
    const y = Math.max(0, Math.floor(bbox.y));
    const width = Math.max(24, Math.min(img.width - x, Math.ceil(bbox.width)));
    const height = Math.max(24, Math.min(img.height - y, Math.ceil(bbox.height)));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D unavailable for part crop');
    ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const maskCanvas = new OffscreenCanvas(width, height);
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) throw new Error('Canvas 2D unavailable for part mask');
    const maskImage = maskCtx.createImageData(width, height);
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        const ix = Math.min(mask.width - 1, x + px);
        const iy = Math.min(mask.height - 1, y + py);
        const sx = Math.min(maskWidth - 1, Math.round(ix * scale));
        const sy = Math.min(maskHeight - 1, Math.round(iy * scale));
        const v = partMask[sy * maskWidth + sx] && mask.data[iy * mask.width + ix] ? 255 : 0;
        const o = (py * width + px) * 4;
        image.data[o + 3] = v;
        maskImage.data[o] = maskImage.data[o + 1] = maskImage.data[o + 2] = v;
        maskImage.data[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    maskCtx.putImageData(maskImage, 0, 0);
    const contourPoints = contourFromCropMask(mask, partMask, maskWidth, maskHeight, scale, { x, y, width, height });
    return {
        textureUrl: await canvasDataUrl(canvas, 'image/webp', MAX_PART_TEXTURE_BYTES),
        maskUrl: await canvasDataUrl(maskCanvas, 'image/png', MAX_MASK_BYTES),
        contourPoints,
        x,
        y,
        width,
        height
    };
};

const buildParts = async (skeleton: StandardSkeleton, img: WorkerImage, mask: ImageMask): Promise<BodyPartLayer[]> => {
    const imagePoint = (jointId: string): Point | null => skeleton.joints[jointId] ? toImage(skeleton.joints[jointId].position, img) : null;
    const segmented = buildPartMasks(skeleton, mask, img);
    const parts: BodyPartLayer[] = [];
    for (const def of PARTS) {
        const points = def.joints.map(imagePoint).filter((p): p is Point => !!p);
        if (!points.length) continue;
        const cropBox = partMaskBBox(segmented.masks[def.id], segmented.width, segmented.height, segmented.scale, points);
        const crop = await cropPart(img, mask, segmented.masks[def.id], segmented.width, segmented.height, segmented.scale, cropBox);
        const center = { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 };
        const anchor = imagePoint(def.anchor) ?? center;
        parts.push({
            id: def.id,
            name: def.name,
            textureUrl: crop.textureUrl,
            maskUrl: crop.maskUrl,
            sourceImageFrame: { x: -crop.x - crop.width / 2, y: -crop.y - crop.height / 2, width: img.width, height: img.height },
            contourPoints: crop.contourPoints,
            contourSource: crop.contourPoints.length >= 3 ? 'onnx-mask' : undefined,
            anchorJointId: def.anchor,
            transform: { ...toScene(center, img), rotation: 0, scale: 1 },
            zIndex: def.z,
            opacity: 0.96,
            visible: true,
            locked: Boolean(def.fixed),
            selectable: true,
            bounds: { x: -crop.width / 2, y: -crop.height / 2, width: crop.width, height: crop.height },
            localPivotOffset: { x: anchor.x - center.x, y: center.y - anchor.y },
            localPivotJointId: def.anchor,
            group: def.id.split('_')[0],
            fillColor: def.color
        });
    }
    return parts;
};

const publicAssetUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, self.location.href).href;
const bundledAssetUrl = (path: string) => new URL(path, self.location.href).href;

export const modelUrl = () => publicAssetUrl('onnx/pose_model.onnx');
export const ortRuntimeWasmUrl = () => bundledAssetUrl(ortWasmUrl);

export type WebOnnxCacheStage = 'checking' | 'missing' | 'downloading' | 'cached' | 'error';

export interface WebOnnxCacheStatus {
    stage: WebOnnxCacheStage;
    label: string;
    progress: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    error?: string;
}

const MODEL_CACHE_NAME = 'motionsmith-web-onnx-v2';
const LEGACY_MODEL_CACHE_NAME = 'motionsmith-web-onnx-v1';
const MODEL_LABEL = 'AI pose model';
const MIN_MODEL_BYTES = 1_000_000;
const MODEL_BYTES_HEADER = 'x-motionsmith-model-bytes';
const GIT_LFS_POINTER_PREFIX = 'version https://git-lfs';
const MODEL_DOWNLOAD_STALL_MS = 30_000;
const supportsCacheApi = () => 'caches' in self;

const cacheStatus = (stage: WebOnnxCacheStage, progress: number, extra: Partial<WebOnnxCacheStatus> = {}): WebOnnxCacheStatus => ({
    stage,
    label: MODEL_LABEL,
    progress,
    ...extra
});

const cachedModelResponse = async () => {
    if (!supportsCacheApi()) return undefined;
    const cache = await caches.open(MODEL_CACHE_NAME);
    return cache.match(modelUrl());
};

const deleteCachedModel = async () => {
    if (!supportsCacheApi()) return;
    const cache = await caches.open(MODEL_CACHE_NAME);
    await cache.delete(modelUrl());
};

const bufferLooksLikeGitLfsPointer = (buffer: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64))).startsWith(GIT_LFS_POINTER_PREFIX);
const isUsableModelBuffer = (buffer: ArrayBuffer) => buffer.byteLength > MIN_MODEL_BYTES && !bufferLooksLikeGitLfsPointer(buffer);

const assertUsableModelBuffer = (buffer: ArrayBuffer, source: string) => {
    if (isUsableModelBuffer(buffer)) return;
    if (bufferLooksLikeGitLfsPointer(buffer)) throw new Error(`${source} is a Git LFS pointer, not ONNX model bytes. Redeploy with Git LFS assets fetched.`);
    throw new Error(`${source} is only ${buffer.byteLength} bytes; expected real ONNX model bytes.`);
};

const assertCompleteModelDownload = (buffer: ArrayBuffer, total?: number) => {
    if (!total || buffer.byteLength === total) return;
    throw new Error(`${MODEL_LABEL} download disconnected after ${buffer.byteLength}/${total} bytes. Try again.`);
};

const readCachedModel = async () => {
    const response = await cachedModelResponse();
    if (!response) return undefined;
    const markedBytes = Number(response.headers.get(MODEL_BYTES_HEADER)) || undefined;
    const buffer = await response.arrayBuffer();
    if (markedBytes && markedBytes !== buffer.byteLength) {
        await deleteCachedModel();
        return undefined;
    }
    if (!isUsableModelBuffer(buffer)) {
        await deleteCachedModel();
        return undefined;
    }
    if (!response.headers.has(MODEL_BYTES_HEADER)) await cacheModelBuffer(buffer);
    return buffer;
};

const fetchModelWithProgress = async (onStatus: (status: WebOnnxCacheStatus) => void = () => {}) => {
    const response = await fetch(modelUrl(), { cache: 'reload' });
    if (!response.ok) throw new Error(`Could not download ${MODEL_LABEL}: ${response.status}`);
    const total = Number(response.headers.get('content-length')) || undefined;
    if (!response.body) {
        const buffer = await response.arrayBuffer();
        assertCompleteModelDownload(buffer, total);
        onStatus(cacheStatus('downloading', 100, { bytesLoaded: buffer.byteLength, bytesTotal: total }));
        return buffer;
    }
    let loaded = 0;
    let stallTimer = 0;
    const resetStallTimer = (controller: TransformStreamDefaultController<Uint8Array>) => {
        self.clearTimeout(stallTimer);
        stallTimer = self.setTimeout(() => controller.error(new Error('model-download-stalled')), MODEL_DOWNLOAD_STALL_MS);
    };
    const monitored = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        start: resetStallTimer,
        transform(value, controller) {
            resetStallTimer(controller);
            loaded += value.byteLength;
            onStatus(cacheStatus('downloading', total ? Math.round((loaded / total) * 100) : 50, { bytesLoaded: loaded, bytesTotal: total }));
            controller.enqueue(value);
        },
        flush() {
            self.clearTimeout(stallTimer);
        }
    }));
    try {
        const buffer = await new Response(monitored).arrayBuffer();
        assertCompleteModelDownload(buffer, total);
        return buffer;
    } finally {
        self.clearTimeout(stallTimer);
    }
};

const cacheModelBuffer = async (buffer: ArrayBuffer) => {
    assertUsableModelBuffer(buffer, MODEL_LABEL);
    if (!supportsCacheApi()) return;
    const cache = await caches.open(MODEL_CACHE_NAME);
    await cache.put(modelUrl(), new Response(buffer, { headers: { 'content-type': 'application/octet-stream', [MODEL_BYTES_HEADER]: String(buffer.byteLength) } }));
};

export const checkWebOnnxCache = async (): Promise<WebOnnxCacheStatus> => {
    try {
        if (supportsCacheApi()) await caches.delete(LEGACY_MODEL_CACHE_NAME);
        const cached = await cachedModelResponse();
        if (!cached) return cacheStatus('missing', 0);
        const cachedBytes = Number(cached.headers.get(MODEL_BYTES_HEADER));
        if (cachedBytes > MIN_MODEL_BYTES) return cacheStatus('cached', 100, { bytesLoaded: cachedBytes, bytesTotal: cachedBytes });
        await deleteCachedModel();
        return cacheStatus('missing', 0);
    } catch (error) {
        return cacheStatus('error', 0, { error: error instanceof Error ? error.message : String(error) });
    }
};

export const warmWebOnnxCache = async (onStatus: (status: WebOnnxCacheStatus) => void = () => {}): Promise<WebOnnxCacheStatus> => {
    try {
        onStatus(cacheStatus('checking', 0));
        const cached = await checkWebOnnxCache();
        if (cached.stage === 'cached') {
            const ready = cacheStatus('cached', 100, { bytesLoaded: cached.bytesLoaded, bytesTotal: cached.bytesTotal });
            onStatus(ready);
            return ready;
        }
        const buffer = await fetchModelWithProgress(onStatus);
        await cacheModelBuffer(buffer);
        const ready = cacheStatus('cached', 100, { bytesLoaded: buffer.byteLength, bytesTotal: buffer.byteLength });
        onStatus(ready);
        return ready;
    } catch (error) {
        const failed = cacheStatus('error', 0, { error: error instanceof Error ? error.message : String(error) });
        onStatus(failed);
        return failed;
    }
};

const loadWebOnnxModelBuffer = async (onStatus: (status: WebOnnxCacheStatus) => void = () => {}) => {
    const cached = await readCachedModel();
    if (cached) {
        onStatus(cacheStatus('cached', 100, { bytesLoaded: cached.byteLength, bytesTotal: cached.byteLength }));
        return cached;
    }
    const buffer = await fetchModelWithProgress(onStatus);
    await cacheModelBuffer(buffer);
    onStatus(cacheStatus('cached', 100, { bytesLoaded: buffer.byteLength, bytesTotal: buffer.byteLength }));
    return buffer;
};


let ortRuntimePromise: Promise<OrtRuntime> | null = null;
const loadOrtRuntime = () => {
    ortRuntimePromise ??= import('onnxruntime-web/wasm');
    return ortRuntimePromise;
};

const configureOrtWasm = (ort: OrtRuntime) => {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { wasm: ortRuntimeWasmUrl() };
};

export const processImageWithWebOnnx = async (
    file: File,
    onProgress: (stage: string, progress: number) => void = () => {}
): Promise<WebOnnxResult> => {
    let runtimeStage = 'decode-image';
    let img: WorkerImage | undefined;
    let session: Awaited<ReturnType<OrtRuntime['InferenceSession']['create']>> | undefined;
    try {
        const decoded = await readImage(file);
        img = decoded.img;
        onProgress('preparing-image', 6);
        runtimeStage = 'segment-character';
        const mask = await makeCharacterMask(img);
        runtimeStage = 'downloading-model';
        onProgress('downloading-model', 12);
        const modelBuffer = await loadWebOnnxModelBuffer(status => onProgress('downloading-model', Math.max(12, Math.min(34, Math.round(status.progress * 0.22 + 12)))));
        runtimeStage = 'loading-model';
        onProgress('loading-model', 35);
        const ort = await loadOrtRuntime();
        configureOrtWasm(ort);
        session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), { executionProviders: ['wasm'] });
        runtimeStage = 'preprocess-image';
        const input = preprocessForPose(img, mask, ort);
        runtimeStage = 'running-onnx';
        onProgress('running-onnx', 45);
        const outputs = await session.run({ [session.inputNames[0]]: input.tensor });
        const output = Object.values(outputs)[0];
        if (!output) throw new Error('Pose model returned no output tensor');
        runtimeStage = 'extracting-keypoints';
        const keypoints = extractKeypoints(output, input);
        runtimeStage = 'extracting-parts';
        onProgress('extracting-parts', 75);
        const skeleton = buildPoseSkeleton(keypoints, img, mask);
        const parts = await buildParts(skeleton, img, mask);
        if (!parts.length) throw new Error('ONNX pose succeeded but no body parts could be extracted');
        runtimeStage = 'normalizing';
        onProgress('normalizing', 90);
        return {
            skeleton,
            parts,
            textureUrl: await imageToDataUrl(img),
            maskUrl: mask.url,
            keypoints,
            metrics: {
                inputWidth: decoded.inputWidth,
                inputHeight: decoded.inputHeight,
                workingWidth: img.width,
                workingHeight: img.height,
                provider: 'wasm',
                model: 'fp32'
            }
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (runtimeStage === 'loading-model') {
            try {
                await deleteCachedModel();
            } catch {
                // Preserve the ONNX Runtime failure as the actionable error.
            }
        }
        const retryHint = runtimeStage === 'loading-model' ? ' Cached model bytes were cleared; try the image again to redownload them.' : '';
        throw new Error(`Web ONNX image processing failed during ${runtimeStage} at ${modelUrl()}: ${message}${retryHint}`);
    } finally {
        await session?.release();
        img?.close();
    }
};

type WorkerRequest =
    | { id: number; type: 'process'; file: File }
    | { id: number; type: 'warm' };

const errorCode = (stage: string, message: string) => {
    if (message.includes('model-download-stalled')) return 'model-download-stalled';
    if (message.includes('Git LFS pointer') || message.includes('expected real ONNX')) return 'model-invalid';
    if (message.includes('image-output-too-large')) return 'image-output-too-large';
    if (stage === 'decode-image' || stage === 'segment-character') return 'unsupported-image';
    if (stage === 'downloading-model') return 'model-download-failed';
    if (stage === 'loading-model') return 'wasm-unavailable';
    if (stage === 'running-onnx' || stage === 'extracting-keypoints') return 'inference-failed';
    return 'image-processing-failed';
};

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
    const post = (message: unknown) => self.postMessage({ id: data.id, ...message as object });
    try {
        if (data.type === 'warm') {
            const status = await warmWebOnnxCache(status => post({ type: 'cache', status }));
            post({ type: 'result', result: status });
            return;
        }
        let stage = 'preparing-image';
        const result = await processImageWithWebOnnx(data.file, (nextStage, progress) => {
            stage = nextStage;
            post({ type: 'progress', stage: nextStage, progress });
        });
        post({ type: 'result', result });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stageMatch = message.match(/failed during ([a-z-]+)/);
        const stage = stageMatch?.[1] ?? 'image-processing';
        post({ type: 'error', code: errorCode(stage, message), message });
    }
};
