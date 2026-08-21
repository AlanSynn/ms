export const VIEWER_CLICK_MAX_DISTANCE_PX = 4;

export type ViewerDragDistanceState = {
  readonly x: number;
  readonly y: number;
  maxDistance: number;
};

export const recordViewerDragDistance = (
  drag: ViewerDragDistanceState,
  clientX: number,
  clientY: number,
) => {
  drag.maxDistance = Math.max(
    drag.maxDistance,
    Math.hypot(clientX - drag.x, clientY - drag.y),
  );
  return drag.maxDistance;
};
