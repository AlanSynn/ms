import { useMemo, useRef, useState, useEffect, type PointerEventHandler, type WheelEventHandler } from 'react';
import type { Point } from '../../../types';
import { FOUNDRY_VIEW_PRESETS, clampFoundryPitch, type FoundryCamera, type FoundryViewPreset } from '../../../utils/foundryCamera';
import { clampWorkingPreviewZoom, type WorkingPreviewFit } from '../../../utils/workingPreviewCamera';
import { highResolutionSessionController } from '../../../runtime/render/adaptiveHighResolutionController';
import { createTransientValueController } from '../../../runtime/render/transientValueController';

export type WorkingPreviewCameraProps = {
  camera?: FoundryCamera;
  onCameraChange?: (camera: FoundryCamera) => void;
};

export const useWorkingPreviewCamera = (props: WorkingPreviewCameraProps) => {
  const [localCamera, setLocalCamera] = useState<FoundryCamera>(() => ({
    ...FOUNDRY_VIEW_PRESETS.iso, yaw: -24, pitch: 18, preset: 'iso', pan: { x: 0, y: 0 },
  }));
  const camera = props.camera ?? localCamera;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const setCamera = (next: FoundryCamera) => {
    setLocalCamera(next);
    props.onCameraChange?.(next);
  };
  const [fitRequest, setFitRequest] = useState<WorkingPreviewFit | undefined>(() =>
    props.camera ? undefined : { id: 0, scope: 'content' });
  const previousControlledCamera = useRef(props.camera);
  useEffect(() => {
    if (previousControlledCamera.current && !props.camera) {
      setFitRequest(previous => ({ id: (previous?.id ?? 0) + 1, scope: 'content' }));
    }
    previousControlledCamera.current = props.camera;
  }, [props.camera]);
  const [gesture, setGesture] = useState<'orbit' | 'zoom' | 'pan' | null>(null);
  const startRef = useRef<{
    pointerId: number; x: number; y: number; camera: FoundryCamera;
    mode: 'orbit' | 'zoom' | 'pan';
  } | null>(null);
  const owner = useRef<object>({});
  const transientCamera = useMemo(() => createTransientValueController<FoundryCamera>({
    onActiveChange: (active) => {
      if (active) highResolutionSessionController.resetSubmissionWindow();
      highResolutionSessionController.setGestureActive(owner.current, active);
    },
  }), []);
  useEffect(() => () => transientCamera.dispose(), [transientCamera]);
  const requestFit = (scope: WorkingPreviewFit['scope']) =>
    setFitRequest(previous => ({ id: (previous?.id ?? 0) + 1, scope }));
  const setCameraPreset = (preset: Exclude<FoundryViewPreset, 'custom'>) => {
    setCamera({ ...cameraRef.current, ...FOUNDRY_VIEW_PRESETS[preset], preset });
    requestFit('content');
  };
  const onPointerDown: PointerEventHandler<HTMLDivElement> = event => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const mode = event.shiftKey || event.button === 1 ? 'pan' : event.altKey || event.button === 2 ? 'zoom' : 'orbit';
    startRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera, mode };
    transientCamera.begin(camera);
    setGesture(mode);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove: PointerEventHandler<HTMLDivElement> = event => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    const initial = start.camera;
    const pan: Point = initial.pan ?? { x: 0, y: 0 };
    transientCamera.update(start.mode === 'zoom'
      ? { ...initial, zoom: clampWorkingPreviewZoom(initial.zoom * (1 - dy * 0.006)), preset: 'custom' }
      : start.mode === 'pan'
        ? { ...initial, pan: { x: pan.x - dx * 0.018, y: pan.y + dy * 0.018 }, preset: 'custom' }
        : { ...initial, yaw: initial.yaw + dx * 0.38, pitch: clampFoundryPitch(initial.pitch + dy * 0.28), preset: 'custom' });
  };
  const finishPointerMove: PointerEventHandler<HTMLDivElement> = event => {
    if (startRef.current?.pointerId !== event.pointerId) return;
    const finalCamera = transientCamera.finish();
    startRef.current = null;
    setGesture(null);
    if (finalCamera) setCamera(finalCamera);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onWheel: WheelEventHandler<HTMLDivElement> = event => {
    event.preventDefault();
    event.stopPropagation();
    setCamera({ ...camera, zoom: clampWorkingPreviewZoom(camera.zoom * (event.deltaY < 0 ? 1.1 : 0.9)), preset: 'custom' });
  };
  return {
    camera, setCamera, transientCamera, fitRequest, requestFit, setCameraPreset,
    isOrbiting: gesture === 'orbit', isZooming: gesture === 'zoom', isPanning: gesture === 'pan',
    onPointerDown, onPointerMove, onPointerUp: finishPointerMove, onPointerCancel: finishPointerMove, onWheel,
  };
};
