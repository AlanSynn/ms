import * as THREE from "three";

import type { Bounds, Point } from "../../types";
import { artworkOwnerFrame } from "../../utils/artwork";
import {
  disposeArtworkCanvas,
  rasterizeOwnerArtwork,
} from "../artwork/artworkRaster";
import { artworkSurfaceFrameKey, type ArtworkSurfaceOwner } from "./artworkSurface";

type PartArtBitmapLoader = {
  load: (
    url: string,
    onLoad: (bitmap: ImageBitmap) => void,
    onError: () => void,
  ) => void;
  abort: () => void;
};

export type PartArtMaterialOptions = {
  bitmapSupported?: boolean;
  createBitmapLoader?: () => PartArtBitmapLoader;
  scheduleInstall?: (install: () => void) => () => void;
  targetFrame?: Bounds;
  clip?: { kind: "contour"; points: readonly Point[]; holes?: readonly { center: Point; radius: number }[] } | { kind: "none" };
  resolution?: { width: number; height: number };
  opacity?: number;
  rasterize?: typeof rasterizeOwnerArtwork;
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

const releasePartArtTexture = (material: THREE.MeshBasicMaterial) => {
  const texture = material.map;
  const bitmap = texture?.image as { close?: () => void } | undefined;
  bitmap?.close?.();
  (material.userData.disposePartArtCanvas as (() => void) | undefined)?.();
  material.userData.disposePartArtCanvas = undefined;
  texture?.dispose();
  material.map = null;
};

const cancelPartArtLoad = (material: THREE.MeshBasicMaterial) => {
  (material.userData.partArtAbort as AbortController | undefined)?.abort();
  (material.userData.partArtBitmapLoader as PartArtBitmapLoader | undefined)?.abort();
  (material.userData.cancelPartArtTextureInstall as (() => void) | undefined)?.();
  material.userData.partArtAbort = undefined;
  material.userData.partArtBitmapLoader = undefined;
  material.userData.cancelPartArtTextureInstall = undefined;
};

export const isInitialSceneMaterialResourcePending = (material: THREE.Material) =>
  material.userData.initialSceneResourcePending === true;

const settlePartArtMaterial = (
  material: THREE.MeshBasicMaterial,
  onSettled: () => void,
) => {
  if (
    materialIsDisposed(material) ||
    !isInitialSceneMaterialResourcePending(material)
  ) return;
  material.userData.initialSceneResourcePending = false;
  onSettled();
};

const loadFallbackTexture = (
  material: THREE.MeshBasicMaterial,
  url: string,
  onSettled: () => void,
  current: () => boolean,
) => {
  const fail = () => {
    if (!current()) return;
    if (material.map === texture) material.map = null;
    texture.dispose();
    material.needsUpdate = true;
    material.userData.partArtError = "Artwork preview unavailable";
    settlePartArtMaterial(material, onSettled);
  };
  const texture = new THREE.TextureLoader().load(
    url,
    () => {
      if (!current()) { texture.dispose(); return; }
      // Some browsers decode viewBox-only SVGs but reject their direct WebGL
      // upload. Rasterize that fallback while preserving its legacy UV frame.
      if (url.startsWith('data:image/svg+xml')) {
        let canvas: HTMLCanvasElement | undefined;
        try {
          const image = texture.image as HTMLImageElement;
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          const ratio = Math.min(1, 1024 / Math.max(width, height));
          canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.ceil(width * ratio));
          canvas.height = Math.max(1, Math.ceil(height * ratio));
          const context = canvas.getContext('2d');
          if (!context) { disposeArtworkCanvas(canvas); fail(); return; }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          (texture as THREE.Texture).image = canvas;
          texture.needsUpdate = true;
          const installedCanvas = canvas;
          material.userData.disposePartArtCanvas = () => disposeArtworkCanvas(installedCanvas);
        } catch {
          if (canvas) disposeArtworkCanvas(canvas);
          fail(); return;
        }
      }
      settlePartArtMaterial(material, onSettled);
    },
    undefined,
    fail,
  );
  configureTexture(texture);
  material.map = texture;
  material.needsUpdate = true;
};

const interactiveArtworkResolution = (frame: Bounds) => {
  // Two pixels per scene unit, at most one 1024-square surface per owner.
  const ratio = Math.min(2, 1024 / Math.max(frame.width, frame.height));
  return { width: Math.max(1, Math.ceil(frame.width * ratio)), height: Math.max(1, Math.ceil(frame.height * ratio)) };
};

/** Update only this owner's surface. Older async generations cannot install. */
export const updatePartArtMaterial = (
  material: THREE.MeshBasicMaterial,
  part: ArtworkSurfaceOwner,
  onLoaded: () => void,
  options: PartArtMaterialOptions = {},
) => {
  if (materialIsDisposed(material)) return false;
  const targetFrame = options.targetFrame ?? (part.bounds ? artworkOwnerFrame(part) : { x: 0, y: 0, width: 1, height: 1 });
  const resolution = options.resolution ?? interactiveArtworkResolution(targetFrame);
  const opacity = options.opacity ?? (part.artwork
    ? Math.max(0, Math.min(1, part.opacity ?? 1))
    : part.textureUrl ? Math.max(0.35, Math.min(1, part.opacity ?? 1)) : 0.6);
  const identity = [part.id, part.artwork?.revision, part.textureUrl, part.fillColor,
    opacity, artworkSurfaceFrameKey(targetFrame), JSON.stringify(options.clip ?? { kind: "none" }), resolution.width, resolution.height];
  const previous = material.userData.partArtSourceIdentity as unknown[] | undefined;
  if (previous && identity.every((value, index) => value === previous[index])) return false;
  material.userData.partArtSourceIdentity = identity;
  const generation = (material.userData.partArtGeneration ?? 0) + 1;
  material.userData.partArtGeneration = generation;
  const current = () => !materialIsDisposed(material) && material.userData.partArtGeneration === generation;
  cancelPartArtLoad(material);
  releasePartArtTexture(material);
  material.color.set(part.artwork || part.textureUrl ? "#ffffff" : part.fillColor);
  material.opacity = opacity;
  material.needsUpdate = true;
  material.userData.partArtOwnerId = part.id;
  material.userData.partArtRevision = part.artwork?.revision ?? "legacy";
  material.userData.partArtInstalledRevision = undefined;
  material.userData.partArtError = undefined;
  material.userData.initialSceneResourcePending = Boolean(part.artwork || part.textureUrl);
  if (part.artwork) {
    const controller = new AbortController();
    material.userData.partArtAbort = controller;
    void (options.rasterize ?? rasterizeOwnerArtwork)({
      owner: part, targetFrame, clip: options.clip ?? { kind: "none" }, resolution,
      baseColor: part.fillColor, signal: controller.signal,
    }).then((canvas) => {
      if (!current()) { disposeArtworkCanvas(canvas); return; }
      let retained = true;
      let installed = false;
      const cancel = (options.scheduleInstall ?? schedulePartArtTextureInstall)(() => {
        installed = true;
        if (current()) material.userData.cancelPartArtTextureInstall = undefined;
        if (!retained) return;
        retained = false;
        if (!current()) { disposeArtworkCanvas(canvas); return; }
        const texture = new THREE.CanvasTexture(canvas);
        configureTexture(texture);
        material.map = texture;
        material.userData.disposePartArtCanvas = () => disposeArtworkCanvas(canvas);
        material.userData.partArtInstalledRevision = part.artwork!.revision;
        material.needsUpdate = true;
        settlePartArtMaterial(material, onLoaded);
      });
      if (!installed) material.userData.cancelPartArtTextureInstall = () => {
        cancel();
        if (retained) disposeArtworkCanvas(canvas);
        retained = false;
      };
    }).catch(() => {
      if (!current()) return;
      material.color.set(part.fillColor);
      material.userData.partArtError = "Artwork preview unavailable";
      settlePartArtMaterial(material, onLoaded);
    });
    return true;
  }
  if (!part.textureUrl) return true;

  const bitmapSupported = options.bitmapSupported ?? (
    typeof createImageBitmap === "function" && typeof fetch === "function"
  );
  if (!bitmapSupported) {
    loadFallbackTexture(material, part.textureUrl, onLoaded, current);
    return true;
  }

  const loader = (options.createBitmapLoader ?? defaultBitmapLoader)();
  material.userData.partArtBitmapLoader = loader;
  loader.load(
    part.textureUrl,
    (bitmap) => {
      if (!current()) {
        bitmap.close();
        return;
      }
      let retainedBitmap: ImageBitmap | undefined = bitmap;
      let installed = false;
      const cancelInstall = (options.scheduleInstall ?? schedulePartArtTextureInstall)(() => {
        installed = true;
        if (current()) material.userData.cancelPartArtTextureInstall = undefined;
        if (!retainedBitmap) return;
        if (!current()) {
          retainedBitmap.close();
          retainedBitmap = undefined;
          return;
        }
        const texture = new THREE.Texture(retainedBitmap);
        retainedBitmap = undefined;
        configureTexture(texture);
        material.map = texture;
        material.needsUpdate = true;
        settlePartArtMaterial(material, onLoaded);
      });
      if (!installed) material.userData.cancelPartArtTextureInstall = () => {
        cancelInstall();
        retainedBitmap?.close();
        retainedBitmap = undefined;
      };
    },
    () => {
      if (current()) {
        loadFallbackTexture(material, part.textureUrl!, onLoaded, current);
      }
    },
  );
  return true;
};

export const createPartArtMaterial = (
  part: ArtworkSurfaceOwner,
  onLoaded: () => void,
  options: PartArtMaterialOptions = {},
) => {
  const material = new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: -1,
  });
  material.userData.ownedByPartArt = true;
  updatePartArtMaterial(material, part, onLoaded, options);
  return material;
};

export const disposePartArtMaterial = (material: THREE.Material) => {
  if (material.userData.ownedByPartArt !== true) return;
  material.userData.partArtDisposed = true;
  material.userData.initialSceneResourcePending = false;
  cancelPartArtLoad(material as THREE.MeshBasicMaterial);
  releasePartArtTexture(material as THREE.MeshBasicMaterial);
};
