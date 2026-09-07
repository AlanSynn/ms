import { useEffect, useMemo, useState } from "react";
import type { BodyPartLayer, Point, ProjectAction, ProjectState } from "../../../types";
import {
  fabricablePartOutlinePoints,
  partLandmarkLocalPoints,
} from "../../../utils/partGeometry";
import { artworkForOwner } from '../../../utils/artwork';
import { characterFabricationHoles } from '../../../utils/characterFabricationHoles';
import { validatePhysicalOutline } from '../../../utils/shapeEditing';
import { MiniNumber, Toggle } from "../../ui/InspectorControls";
import { ShapeEditor } from './ShapeEditor';

const CompactNumber = ({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) => (
  <label className={`compact-number ${disabled ? "opacity-50" : ""}`}>
    <span>{label}</span>
    <input
      aria-label={`${label} number`}
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={Number.isFinite(value) ? value : 0}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </label>
);

export const PartInspector = ({
  part,
  project,
  skeleton,
  sourceTextureUrl,
  dispatch,
  compact = false,
}: {
  part: BodyPartLayer;
  project: ProjectState;
  skeleton?: ProjectState["skeleton"];
  sourceTextureUrl?: string;
  dispatch: (action: ProjectAction) => void;
  compact?: boolean;
}) => {
  const updateTransform = (updates: Partial<BodyPartLayer["transform"]>) =>
    dispatch({
      type: "update_part",
      partId: part.id,
      updates: { transform: { ...part.transform, ...updates } },
    });
  const updateBounds = (updates: Partial<BodyPartLayer["bounds"]>) =>
    dispatch({
      type: "update_part",
      partId: part.id,
      updates: { bounds: { ...part.bounds, ...updates } },
    });
  const landmarks = useMemo(
    () => partLandmarkLocalPoints(part, skeleton),
    [part, skeleton],
  );
  const editableCutPoints = useMemo(() => fabricablePartOutlinePoints(part, landmarks), [part, landmarks]);
  const attachments = characterFabricationHoles(project).get(part.id) ?? [];
  const [shapeSource, setShapeSource] = useState<BodyPartLayer | null>(null);
  useEffect(() => {
    if (shapeSource && shapeSource !== part) setShapeSource(null);
  }, [part, shapeSource]);
  const commitShape = (points: Point[]) => {
    if (part !== shapeSource || part.locked) throw new Error('Part changed. Open Change shape again.');
    const result = validatePhysicalOutline(points, { attachments });
    if (!result.ok) throw new Error(result.blocker);
    dispatch({
      type: "update_part",
      partId: part.id,
      updates: { contourPoints: result.points, contourSource: "user", artwork: artworkForOwner(part) },
    });
    setShapeSource(null);
  };
  const cutSource =
    part.contourSource === "user"
      ? "Custom"
      : part.contourSource === "onnx-mask"
        ? "Imported"
        : part.contourSource === "imported"
          ? "Imported"
          : "Starter";
  return (
    <div className={`${compact ? "mt-3" : "mt-4"} space-y-3`}>
      <div className="grid grid-cols-2 gap-2">
        <Toggle
          label="Visible"
          checked={part.visible}
          disabled={part.locked}
          onChange={(visible) =>
            dispatch({
              type: "update_part",
              partId: part.id,
              updates: { visible },
            })
          }
        />
        <Toggle
          label="Locked"
          checked={part.locked}
          onChange={(locked) =>
            dispatch({
              type: "update_part",
              partId: part.id,
              updates: { locked },
            })
          }
        />
      </div>
      <div className="part-art-controls" data-testid="part-cut-controls">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="section-title">Shape</div>
            <div
              className="mt-1 text-xs font-black uppercase tracking-wider text-slate-500"
              data-testid="part-cut-summary"
            >
              {cutSource}
            </div>
          </div>
          <button
            type="button"
            data-testid="part-cut-bake"
            className="btn-secondary"
            disabled={part.locked}
            onClick={() => setShapeSource(part)}
          >
            Change shape
          </button>
        </div>
      </div>
      {shapeSource && (
        <ShapeEditor
          key={shapeSource.id}
          owner={shapeSource}
          sourceTextureUrl={sourceTextureUrl}
          outline={editableCutPoints}
          attachments={attachments}
          onCommit={commitShape}
          onClose={() => setShapeSource(null)}
        />
      )}
      <div className="grid grid-cols-3 gap-2">
        <CompactNumber
          label="X"
          value={part.transform.x}
          min={-320}
          max={320}
          disabled={part.locked}
          onChange={(x) => updateTransform({ x })}
        />
        <CompactNumber
          label="Y"
          value={part.transform.y}
          min={-320}
          max={320}
          disabled={part.locked}
          onChange={(y) => updateTransform({ y })}
        />
        <CompactNumber
          label="Rotation"
          value={part.transform.rotation}
          min={-180}
          max={180}
          disabled={part.locked}
          onChange={(rotation) => updateTransform({ rotation })}
        />
      </div>
      <details className="advanced-panel" data-testid="part-art-controls">
        <summary>Artwork</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <MiniNumber
            label="Art opacity"
            value={part.opacity}
            min={0.15}
            max={1}
            step={0.05}
            disabled={part.locked}
            onChange={(opacity) =>
              dispatch({
                type: "update_part",
                partId: part.id,
                updates: { opacity },
              })
            }
          />
          <MiniNumber
            label="Scale"
            value={part.transform.scale}
            min={0.2}
            max={2.5}
            step={0.05}
            disabled={part.locked}
            onChange={(scale) => updateTransform({ scale })}
          />
          {!part.artwork && <><MiniNumber
            label="Art width"
            value={part.bounds.width}
            min={8}
            max={520}
            disabled={part.locked}
            onChange={(width) => updateBounds({ width })}
          />
          <MiniNumber
            label="Art height"
            value={part.bounds.height}
            min={8}
            max={520}
            disabled={part.locked}
            onChange={(height) => updateBounds({ height })}
          />
          <MiniNumber
            label="Art offset X"
            value={part.bounds.x}
            min={-260}
            max={260}
            disabled={part.locked}
            onChange={(x) => updateBounds({ x })}
          />
          <MiniNumber
            label="Art offset Y"
            value={part.bounds.y}
            min={-260}
            max={260}
            disabled={part.locked}
            onChange={(y) => updateBounds({ y })}
          /></>}
        </div>
      </details>
      <div className="flex gap-2">
        <button
          className="btn-secondary"
          disabled={part.locked}
          onClick={() =>
            dispatch({ type: "reorder_part", partId: part.id, direction: -1 })
          }
        >
          Back
        </button>
        <button
          className="btn-secondary"
          disabled={part.locked}
          onClick={() =>
            dispatch({ type: "reorder_part", partId: part.id, direction: 1 })
          }
        >
          Front
        </button>
      </div>
    </div>
  );
};
