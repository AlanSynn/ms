type StudyImageRequest = { id: number; source: Blob };

self.onmessage = async ({ data }: MessageEvent<StudyImageRequest>) => {
  try {
    const bitmap = await createImageBitmap(data.source);
    let scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("canvas_unavailable");
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.68 });
      if (blob.size <= 192 * 1024) {
        bitmap.close();
        self.postMessage({ id: data.id, type: "result", blob, width, height });
        return;
      }
      scale *= 0.72;
    }
    bitmap.close();
    throw new Error("asset_too_large");
  } catch {
    self.postMessage({ id: data.id, type: "error", code: "normalize_failed" });
  }
};
