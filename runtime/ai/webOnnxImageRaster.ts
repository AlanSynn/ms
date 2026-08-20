import type { BodyPartLayer, StandardSkeleton } from '../../types';
import {
  buildWebOnnxPartPlans,
  createWebOnnxMask,
  fitWebOnnxImageDimensions,
  partLayerFromPlan,
  webOnnxPoseBounds,
  type WebOnnxMask,
} from './webOnnxImageGeometry';
import {
  readWebOnnxImageMetadata,
  WEB_ONNX_IMAGE_HEADER_SCAN_BYTES,
  WEB_ONNX_IMAGE_MAX_COMPRESSED_BYTES,
} from './webOnnxImageDecodePolicy';

export type PreparedWebOnnxImage = {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  mask: WebOnnxMask;
  poseData: Float32Array;
  poseDims: number[];
  poseBounds: { x: number; y: number; width: number; height: number };
};

const canvasContext = (canvas: OffscreenCanvas, readFrequently = false) => {
  const context = canvas.getContext('2d', {
    willReadFrequently: readFrequently,
  });
  if (!context) throw new Error('Offscreen Canvas 2D is unavailable.');
  return context;
};

const blobToDataUrl = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(chunks.join(''))}`;
};

const decodeWebOnnxImage = async (file: Blob) => {
  if (file.size > WEB_ONNX_IMAGE_MAX_COMPRESSED_BYTES) {
    throw new Error('Images must be 32MB or smaller.');
  }
  const header = new Uint8Array(
    await file.slice(0, WEB_ONNX_IMAGE_HEADER_SCAN_BYTES).arrayBuffer(),
  );
  const metadata = readWebOnnxImageMetadata(header);
  const dimensions = fitWebOnnxImageDimensions(metadata.width, metadata.height);

  if (
    typeof ImageDecoder !== 'undefined'
    && await ImageDecoder.isTypeSupported(metadata.type)
  ) {
    const decoder = new ImageDecoder({
      data: file.stream(),
      type: metadata.type,
      preferAnimation: false,
      desiredWidth: dimensions.width,
      desiredHeight: dimensions.height,
    });
    try {
      await decoder.tracks.ready;
      const decoded = await decoder.decode({
        frameIndex: 0,
        completeFramesOnly: true,
      });
      return {
        source: decoded.image,
        dimensions,
        close: () => {
          decoded.image.close();
          decoder.close();
        },
      };
    } catch (error) {
      decoder.close();
      throw error;
    }
  }

  if (metadata.width !== dimensions.width || metadata.height !== dimensions.height) {
    throw new Error('This browser cannot safely decode images above 1280px.');
  }
  const bitmap = await createImageBitmap(file);
  return {
    source: bitmap,
    dimensions,
    close: () => bitmap.close(),
  };
};

export const prepareWebOnnxImage = async (
  file: Blob,
): Promise<PreparedWebOnnxImage> => {
  const decoded = await decodeWebOnnxImage(file);
  try {
    const { dimensions } = decoded;
    const canvas = new OffscreenCanvas(dimensions.width, dimensions.height);
    const context = canvasContext(canvas, true);
    context.drawImage(decoded.source, 0, 0, dimensions.width, dimensions.height);
    const pixels = context.getImageData(0, 0, dimensions.width, dimensions.height);
    const mask = createWebOnnxMask(pixels.data, dimensions.width, dimensions.height);
    const poseBounds = webOnnxPoseBounds(mask);
    const poseCanvas = new OffscreenCanvas(192, 256);
    const poseContext = canvasContext(poseCanvas, true);
    poseContext.drawImage(
      canvas,
      poseBounds.x,
      poseBounds.y,
      poseBounds.width,
      poseBounds.height,
      0,
      0,
      192,
      256,
    );
    const posePixels = poseContext.getImageData(0, 0, 192, 256).data;
    const poseData = new Float32Array(3 * 192 * 256);
    const mean = [0.485, 0.456, 0.406];
    const deviation = [0.229, 0.224, 0.225];
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 192; x += 1) {
        const source = (y * 192 + x) * 4;
        const destination = y * 192 + x;
        poseData[destination] = (posePixels[source] / 255 - mean[0]) / deviation[0];
        poseData[256 * 192 + destination] = (posePixels[source + 1] / 255 - mean[1]) / deviation[1];
        poseData[2 * 256 * 192 + destination] = (posePixels[source + 2] / 255 - mean[2]) / deviation[2];
      }
    }
    return {
      canvas,
      ...dimensions,
      mask,
      poseData,
      poseDims: [1, 3, 256, 192],
      poseBounds,
    };
  } finally {
    decoded.close();
  }
};

const maskDataUrl = async (mask: WebOnnxMask) => {
  const canvas = new OffscreenCanvas(mask.width, mask.height);
  const context = canvasContext(canvas);
  const image = context.createImageData(mask.width, mask.height);
  for (let pixel = 0, offset = 0; pixel < mask.data.length; pixel += 1, offset += 4) {
    image.data[offset] = mask.data[pixel];
    image.data[offset + 1] = mask.data[pixel];
    image.data[offset + 2] = mask.data[pixel];
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
};

const cropPart = async (
  prepared: PreparedWebOnnxImage,
  plan: ReturnType<typeof buildWebOnnxPartPlans>[number],
) => {
  const width = Math.round(plan.crop.width);
  const height = Math.round(plan.crop.height);
  const textureCanvas = new OffscreenCanvas(width, height);
  const textureContext = canvasContext(textureCanvas, true);
  textureContext.drawImage(
    prepared.canvas,
    plan.crop.x,
    plan.crop.y,
    width,
    height,
    0,
    0,
    width,
    height,
  );
  const texture = textureContext.getImageData(0, 0, width, height);
  const maskCanvas = new OffscreenCanvas(width, height);
  const maskContext = canvasContext(maskCanvas);
  const maskImage = maskContext.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const imageX = Math.min(prepared.width - 1, Math.round(plan.crop.x + x));
      const imageY = Math.min(prepared.height - 1, Math.round(plan.crop.y + y));
      const partX = Math.min(plan.maskWidth - 1, Math.round(imageX * plan.scale));
      const partY = Math.min(plan.maskHeight - 1, Math.round(imageY * plan.scale));
      const visible = plan.partMask[partY * plan.maskWidth + partX]
        && prepared.mask.data[imageY * prepared.width + imageX]
        ? 255
        : 0;
      const offset = (y * width + x) * 4;
      texture.data[offset + 3] = visible;
      maskImage.data[offset] = visible;
      maskImage.data[offset + 1] = visible;
      maskImage.data[offset + 2] = visible;
      maskImage.data[offset + 3] = 255;
    }
  }
  textureContext.putImageData(texture, 0, 0);
  maskContext.putImageData(maskImage, 0, 0);
  const [textureUrl, partMaskUrl] = await Promise.all([
    textureCanvas.convertToBlob({ type: 'image/png' }).then(blobToDataUrl),
    maskCanvas.convertToBlob({ type: 'image/png' }).then(blobToDataUrl),
  ]);
  return partLayerFromPlan(
    plan,
    prepared.width,
    prepared.height,
    textureUrl,
    partMaskUrl,
  );
};

export const finishWebOnnxImage = async (
  prepared: PreparedWebOnnxImage,
  skeleton: StandardSkeleton,
): Promise<{
  parts: BodyPartLayer[];
  textureUrl: string;
  maskUrl: string;
}> => {
  const plans = buildWebOnnxPartPlans(skeleton, prepared.mask);
  const parts: BodyPartLayer[] = [];
  for (const plan of plans) {
    parts.push(await cropPart(prepared, plan));
  }
  if (!parts.length) {
    throw new Error('ONNX pose succeeded but no body parts could be extracted.');
  }
  const textureUrl = await prepared.canvas
    .convertToBlob({ type: 'image/png' })
    .then(blobToDataUrl);
  return {
    parts,
    textureUrl,
    maskUrl: await maskDataUrl(prepared.mask),
  };
};
