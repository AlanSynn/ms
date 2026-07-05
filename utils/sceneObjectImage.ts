import type { Point, SceneObject } from "../types";

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Object image could not load."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Object image could not load."));
    reader.readAsDataURL(file);
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Object image could not load."));
    img.src = src;
  });

const decodedDataUrlText = (dataUrl: string) => {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return "";
  const header = dataUrl.slice(0, comma).toLowerCase();
  const body = dataUrl.slice(comma + 1);
  try {
    return header.includes(";base64") ? atob(body) : decodeURIComponent(body);
  } catch {
    return "";
  }
};

const isSvgFile = (file: File) =>
  file.type === "image/svg+xml" || /\.svg$/i.test(file.name);

const assertLocalSvg = (file: File, sourceUrl: string) => {
  if (!isSvgFile(file)) return;
  const svgText = decodedDataUrlText(sourceUrl).toLowerCase();
  const unsafePattern =
    /<script|<foreignobject|javascript:|data:text\/html|href\s*=\s*["']?\s*(https?:|\/\/)|xlink:href\s*=\s*["']?\s*(https?:|\/\/)|url\(\s*["']?\s*(https?:|\/\/)|@import/i;
  if (!svgText || unsafePattern.test(svgText)) {
    throw new Error("Object SVG must be local artwork only.");
  }
};

const imageTextureDataUrl = (img: HTMLImageElement) => {
  const maxSide = 768;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
};

const fallbackContour = (width: number, height: number): Point[] => [
  { x: -width / 2, y: -height / 2 },
  { x: width / 2, y: -height / 2 },
  { x: width / 2, y: height / 2 },
  { x: -width / 2, y: height / 2 },
];

const imageContour = (img: HTMLImageElement, width: number, height: number) => {
  const canvas = document.createElement("canvas");
  const maxSide = 192;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return fallbackContour(width, height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return fallbackContour(width, height);
  }
  let alphaVariance = 0;
  for (let i = 3; i < pixels.length; i += 4) alphaVariance += Math.abs(pixels[i] - 255);
  const alphaDriven = alphaVariance > pixels.length * 0.002;
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
  const isForeground = (x: number, y: number) => {
    const i = (y * canvas.width + x) * 4;
    const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    return alphaDriven ? pixels[i + 3] > 12 : pixels[i + 3] > 12 && luma < 246;
  };
  for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
    if (!isForeground(x, y)) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) return fallbackContour(width, height);
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const bins: Array<{ x: number; y: number; d2: number } | null> = Array(48).fill(null);
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    if (!isForeground(x, y)) continue;
    const dx = x - center.x;
    const dy = y - center.y;
    const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
    const index = Math.min(bins.length - 1, Math.floor((angle / (Math.PI * 2)) * bins.length));
    const d2 = dx * dx + dy * dy;
    if (!bins[index] || d2 > bins[index]!.d2) bins[index] = { x, y, d2 };
  }
  const points = bins.flatMap((point) =>
    point ? [{ x: (point.x / canvas.width - 0.5) * width, y: (0.5 - point.y / canvas.height) * height }] : [],
  );
  return points.length >= 3 ? points : fallbackContour(width, height);
};

export const sceneObjectFromImageFile = async (file: File, id: string): Promise<SceneObject> => {
  const sourceUrl = await readDataUrl(file);
  assertLocalSvg(file, sourceUrl);
  const img = await loadImage(sourceUrl);
  const textureUrl = imageTextureDataUrl(img);
  if (!textureUrl?.startsWith("data:image/png")) {
    throw new Error("Object image could not be saved locally.");
  }
  const size = 118;
  const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const bounds = ratio >= 1
    ? { width: size, height: size / ratio }
    : { width: size * ratio, height: size };
  return {
    id,
    name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Object",
    shape: "block",
    textureUrl,
    contourPoints: imageContour(img, bounds.width, bounds.height),
    contourSource: "imported",
    sourceImageName: file.name,
    transform: { x: 112, y: 142, rotation: 0, scale: 1 },
    bounds,
    fillColor: "#c4b5fd",
    opacity: 0.96,
    visible: true,
    locked: false,
    zIndex: 20,
  };
};
