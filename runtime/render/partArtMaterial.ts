import * as THREE from "three";

import type { BodyPartLayer } from "../../types";

type PartArtBitmapLoader = {
  load: (
    url: string,
    onLoad: (bitmap: ImageBitmap) => void,
    onError: () => void,
  ) => void;
  abort: () => void;
};

type PartArtMaterialOptions = {
  bitmapSupported?: boolean;
  createBitmapLoader?: () => PartArtBitmapLoader;
  scheduleInstall?: (install: () => void) => () => void;
};

type QueuedInstall = { active: boolean; run: () => void };
const queuedInstalls: QueuedInstall[] = [];
let installFrame: number | undefined;

const scheduleNextInstall = () => {
  if (installFrame !== undefined || queuedInstalls.length === 0) return;
  installFrame = requestAnimationFrame(() => {
    installFrame = undefined;
    let next: QueuedInstall | undefined;
    while (!next && queuedInstalls.length) {
      const candidate = queuedInstalls.shift();
      if (candidate?.active) next = candidate;
    }
    next?.run();
    scheduleNextInstall();
  });
};

const schedulePartArtTextureInstall = (run: () => void) => {
  const queued = { active: true, run };
  queuedInstalls.push(queued);
  scheduleNextInstall();
  return () => {
    queued.active = false;
  };
};

const configureTexture = (texture: THREE.Texture) => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
};

const defaultBitmapLoader = (): PartArtBitmapLoader => {
  const loader = new THREE.ImageBitmapLoader();
  loader.setCrossOrigin("anonymous");
  loader.setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" });
  return {
    load: (url, onLoad, onError) => {
      loader.load(url, onLoad, undefined, onError);
    },
    abort: () => {
      loader.abort();
    },
  };
};

const materialIsDisposed = (material: THREE.MeshBasicMaterial) =>
  material.userData.partArtDisposed === true;

const loadFallbackTexture = (
  material: THREE.MeshBasicMaterial,
  url: string,
  onLoaded: () => void,
) => {
  const texture = new THREE.TextureLoader().load(url, () => {
    if (!materialIsDisposed(material)) onLoaded();
  });
  configureTexture(texture);
  material.map = texture;
  material.needsUpdate = true;
};

export const createPartArtMaterial = (
  part: BodyPartLayer,
  onLoaded: () => void,
  options: PartArtMaterialOptions = {},
) => {
  const material = new THREE.MeshBasicMaterial({
    color: part.textureUrl ? "#ffffff" : part.fillColor,
    transparent: true,
    opacity: part.textureUrl
      ? Math.max(0.35, Math.min(1, part.opacity ?? 1))
      : 0.6,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  material.userData.ownedByPartArt = true;
  if (!part.textureUrl) return material;

  const bitmapSupported = options.bitmapSupported ?? (
    typeof createImageBitmap === "function" && typeof fetch === "function"
  );
  if (!bitmapSupported) {
    loadFallbackTexture(material, part.textureUrl, onLoaded);
    return material;
  }

  const loader = (options.createBitmapLoader ?? defaultBitmapLoader)();
  material.userData.partArtBitmapLoader = loader;
  loader.load(
    part.textureUrl,
    (bitmap) => {
      if (materialIsDisposed(material)) {
        bitmap.close();
        return;
      }
      let retainedBitmap: ImageBitmap | undefined = bitmap;
      const cancelInstall = (options.scheduleInstall ?? schedulePartArtTextureInstall)(() => {
        material.userData.cancelPartArtTextureInstall = undefined;
        if (!retainedBitmap) return;
        if (materialIsDisposed(material)) {
          retainedBitmap.close();
          retainedBitmap = undefined;
          return;
        }
        const texture = new THREE.Texture(retainedBitmap);
        retainedBitmap = undefined;
        configureTexture(texture);
        material.map = texture;
        material.needsUpdate = true;
        onLoaded();
      });
      material.userData.cancelPartArtTextureInstall = () => {
        cancelInstall();
        retainedBitmap?.close();
        retainedBitmap = undefined;
      };
    },
    () => {
      if (!materialIsDisposed(material)) {
        loadFallbackTexture(material, part.textureUrl!, onLoaded);
      }
    },
  );
  return material;
};

export const disposePartArtMaterial = (material: THREE.Material) => {
  if (material.userData.ownedByPartArt !== true) return;
  material.userData.partArtDisposed = true;
  (material.userData.partArtBitmapLoader as PartArtBitmapLoader | undefined)?.abort();
  (material.userData.cancelPartArtTextureInstall as (() => void) | undefined)?.();
  material.userData.cancelPartArtTextureInstall = undefined;
  const texture = (material as THREE.MeshBasicMaterial).map;
  const bitmap = texture?.image as { close?: () => void } | undefined;
  bitmap?.close?.();
  texture?.dispose();
  (material as THREE.MeshBasicMaterial).map = null;
};
