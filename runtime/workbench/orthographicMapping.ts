import type { CanvasViewport, Point } from "../../types";
import { SCENE_VIEW } from "../../utils/coordinates";

export const WORKBENCH_CANONICAL_VIEW = SCENE_VIEW;
export const WORKBENCH_CANONICAL_PLANE_Z = 0 as const;

export type WorkbenchClientRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type WorkbenchRenderRect = WorkbenchClientRect;

const assertViewport = (viewport: CanvasViewport) => {
  if (
    !Number.isFinite(viewport.offset.x) ||
    !Number.isFinite(viewport.offset.y) ||
    !Number.isFinite(viewport.zoom) ||
    viewport.zoom <= 0
  )
    throw new Error("Workbench viewport must contain finite offsets and positive zoom");
};

export const fitWorkbenchRenderRect = (
  host: WorkbenchClientRect,
): WorkbenchRenderRect => {
  if (
    !Number.isFinite(host.left) ||
    !Number.isFinite(host.top) ||
    !Number.isFinite(host.width) ||
    !Number.isFinite(host.height) ||
    host.width <= 0 ||
    host.height <= 0
  )
    throw new Error("Workbench host rectangle must be finite and positive");
  const sceneAspect =
    WORKBENCH_CANONICAL_VIEW.width / WORKBENCH_CANONICAL_VIEW.height;
  const hostAspect = host.width / host.height;
  if (hostAspect > sceneAspect) {
    const width = host.height * sceneAspect;
    return {
      left: host.left + (host.width - width) / 2,
      top: host.top,
      width,
      height: host.height,
    };
  }
  const height = host.width / sceneAspect;
  return {
    left: host.left,
    top: host.top + (host.height - height) / 2,
    width: host.width,
    height,
  };
};

export type OrthographicCameraFrame = Readonly<{
  center: Point;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}>;

export const orthographicCameraFrame = (
  viewport: CanvasViewport,
): OrthographicCameraFrame => {
  assertViewport(viewport);
  const width = WORKBENCH_CANONICAL_VIEW.width / viewport.zoom;
  const height = WORKBENCH_CANONICAL_VIEW.height / viewport.zoom;
  const center = {
    x: -viewport.offset.x / viewport.zoom,
    y: viewport.offset.y / viewport.zoom,
  };
  return {
    center,
    width,
    height,
    left: center.x - width / 2,
    right: center.x + width / 2,
    top: center.y + height / 2,
    bottom: center.y - height / 2,
  };
};

export type WorkbenchCanonicalPointer = Readonly<{
  scene: Point;
  ndc: Point;
  renderRect: WorkbenchRenderRect;
}>;

export const workbenchClientPointToCanonical = ({
  clientX,
  clientY,
  host,
  viewport,
}: {
  clientX: number;
  clientY: number;
  host: WorkbenchClientRect;
  viewport: CanvasViewport;
}): WorkbenchCanonicalPointer | null => {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const renderRect = fitWorkbenchRenderRect(host);
  if (
    clientX < renderRect.left ||
    clientX > renderRect.left + renderRect.width ||
    clientY < renderRect.top ||
    clientY > renderRect.top + renderRect.height
  )
    return null;
  const fx = (clientX - renderRect.left) / renderRect.width;
  const fy = (clientY - renderRect.top) / renderRect.height;
  const ndc = { x: fx * 2 - 1, y: 1 - fy * 2 };
  const camera = orthographicCameraFrame(viewport);
  return {
    scene: {
      x: camera.center.x + (ndc.x * camera.width) / 2,
      y: camera.center.y + (ndc.y * camera.height) / 2,
    },
    ndc,
    renderRect,
  };
};
