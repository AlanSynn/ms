import { artworkForOwner, type ArtworkOwner } from '../../utils/artwork';
import { validateProjectRasterSources } from '../import/projectRasterImportPolicy';
import {
  compositeArtwork, type ArtworkCanvas, type ArtworkCompositeInput,
} from './artworkCompositor';

export { disposeArtworkCanvas } from './artworkCompositor';

export type LoadedArtworkImage = { image: CanvasImageSource; dispose: () => void };
const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Artwork rendering was canceled.', 'AbortError');
};

/** Source bytes stay in ProjectState. This caller-owned decode is always disposable. */
export const loadArtworkImage = async (textureUrl: string, signal?: AbortSignal): Promise<LoadedArtworkImage> => {
  aborted(signal);
  if (!textureUrl.startsWith('data:image/')) throw new Error('Original artwork must be embedded in the project file.');
  validateProjectRasterSources({ parts: { artwork: { textureUrl } } });
  if (typeof Image !== 'undefined') {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const cleanup = () => {
        signal?.removeEventListener('abort', cancel);
        image.onload = null;
        image.onerror = null;
      };
      const cancel = () => {
        cleanup();
        image.src = '';
        reject(new DOMException('Artwork rendering was canceled.', 'AbortError'));
      };
      image.onload = () => {
        cleanup();
        resolve({ image, dispose: () => { image.src = ''; } });
      };
      image.onerror = () => {
        cleanup();
        reject(new Error('Original artwork could not be loaded. Your painting is unchanged.'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      image.src = textureUrl;
    });
  }
  const response = await fetch(textureUrl, { signal });
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none' });
  if (signal?.aborted) { bitmap.close(); aborted(signal); }
  return { image: bitmap, dispose: () => bitmap.close() };
};

export type RasterizeOwnerArtworkInput = Omit<ArtworkCompositeInput, 'document' | 'assets'> & {
  owner: ArtworkOwner;
  signal?: AbortSignal;
};

export const rasterizeOwnerArtwork = async ({ owner, signal, ...input }: RasterizeOwnerArtworkInput): Promise<ArtworkCanvas> => {
  aborted(signal);
  const document = artworkForOwner(owner);
  const source = document.sourceImage && owner.textureUrl ? await loadArtworkImage(owner.textureUrl, signal) : undefined;
  try {
    aborted(signal);
    return compositeArtwork({ ...input, baseColor: input.baseColor ?? owner.fillColor,
      document, assets: { texture: source?.image } });
  } finally {
    source?.dispose();
  }
};

export const artworkCanvasPng = async (canvas: ArtworkCanvas): Promise<string> => {
  if ('toDataURL' in canvas) {
    const result = canvas.toDataURL('image/png');
    if (!result.startsWith('data:image/png')) throw new Error('Painted image export failed. Your painting is unchanged.');
    return result;
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return `data:image/png;base64,${btoa(binary)}`;
};
