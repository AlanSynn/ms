import React from 'react';
import type { AppStage, BodyPartLayer, MechanismConfig, ProjectMotionPath } from '../types';
import type { PhysicsSession } from '../utils/physicsSession';
import type { ToonSceneProjection } from '../utils/sceneProjection';
import { cameraForLens, lockCameraToStudio, resetCameraForLens, unlockCameraPreview, VIEW_LENS_LABELS, type CameraSessionState, type ViewLensState } from '../utils/viewLens';
import { ToonRendererShell } from './ToonRendererShell';

const LENSES: ViewLensState[] = ['studio', 'depth', 'toy-stage', 'assembly', 'physics', 'blueprint', 'inspect'];

export const ViewLensHud = ({
  stage,
  lens,
  setLens,
  camera,
  setCamera,
  projection,
  physics,
  selectedPart,
  selectedPath,
  selectedMechanism,
  drawMode
}: {
  stage: AppStage;
  lens: ViewLensState;
  setLens: (lens: ViewLensState) => void;
  camera: CameraSessionState;
  setCamera: React.Dispatch<React.SetStateAction<CameraSessionState>>;
  projection: ToonSceneProjection;
  physics: PhysicsSession;
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  selectedMechanism?: MechanismConfig;
  drawMode: boolean;
}) => {
  const selectedLabel = selectedPart?.name ?? selectedMechanism?.id ?? selectedPath?.id ?? 'Nothing selected';
  const chooseLens = (next: ViewLensState) => {
    if (drawMode && next !== 'studio') return;
    setLens(next);
    setCamera(cameraForLens(projection, next));
  };
  const front = () => { setLens('studio'); setCamera(lockCameraToStudio(projection)); };
  const iso = () => { if (drawMode) return; setLens('toy-stage'); setCamera(unlockCameraPreview(projection)); };
  const explode = () => { if (drawMode) return; setLens('assembly'); setCamera(cameraForLens(projection, 'assembly')); };
  const reset = () => setCamera(resetCameraForLens(projection, lens));
  const toggleLock = () => {
    if (drawMode) return;
    if (camera.locked) {
      setLens('toy-stage');
      setCamera(unlockCameraPreview(projection));
    } else {
      front();
    }
  };

  return <div className={`view-lens-hud ${drawMode ? 'is-drawing' : ''}`} data-testid="view-lens-hud" aria-label="Canvas view lens controls">
    <div className="view-lens-main">
      <div className="view-lens-title">
        <span>Canvas lens</span>
        <strong data-testid="view-lens-status">{VIEW_LENS_LABELS[lens]}</strong>
      </div>
      <div className="view-lens-buttons" role="group" aria-label="View lenses">
        {LENSES.map(item => <button
          key={item}
          type="button"
          data-testid={`view-lens-${item}`}
          aria-pressed={lens === item}
          className={lens === item ? 'active' : ''}
          disabled={drawMode && item !== 'studio'}
          onClick={() => chooseLens(item)}
        >{VIEW_LENS_LABELS[item]}</button>)}
      </div>
      <div className="camera-session-row" role="group" aria-label="Camera session">
        <button type="button" data-testid="camera-lock-toggle" disabled={drawMode} onClick={toggleLock}>{camera.locked ? 'Unlock camera' : 'Lock to 2.5D'}</button>
        <button type="button" data-testid="camera-front" onClick={front}>Front</button>
        <button type="button" data-testid="camera-iso" disabled={drawMode} onClick={iso}>Iso</button>
        <button type="button" data-testid="camera-explode" disabled={drawMode} onClick={explode}>Explode</button>
        <button type="button" data-testid="camera-reset" aria-label="Camera home view" onClick={reset}>↺</button>
      </div>
      <div className="view-lens-chips">
        <span><b>Stage</b> {stage}</span>
        <span><b>Selected</b> {selectedLabel}</span>
        <span><b>Camera</b> {camera.label} · {camera.locked ? 'locked' : 'orbit preview'}</span>
        <span><b>Warnings</b> {projection.warnings.length}</span>
      </div>
      {lens === 'physics' && <div className="physics-session-summary" data-testid="physics-session-summary">
        Physics replay: {physics.summary.bodyCount} bodies · {physics.summary.constraintCount} constraints · {physics.summary.activeMechanismCount} active mechanisms · max speed {physics.summary.maxSpeed.toFixed(1)} px/s · view-only.
      </div>}
      {drawMode && <div className="view-lens-draw-guard" data-testid="view-lens-draw-guard">Drawing locks the camera to the 2.5D plane so free paths stay exact.</div>}
    </div>
    <ToonRendererShell projection={projection} lens={lens} camera={camera} physics={physics} />
  </div>;
};
