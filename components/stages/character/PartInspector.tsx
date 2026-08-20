import { useEffect, useMemo, useState } from "react";
import type { BodyPartLayer, Point, ProjectAction, ProjectState } from "../../../types";
import {
  fabricablePartOutlinePoints,
  isUsableContourPoints,
  partLandmarkLocalPoints,
  scaleContour,
} from "../../../utils/partGeometry";
import { MiniNumber, Toggle } from "../../ui/InspectorControls";
import { CutOutlineEditorDialog } from "./CutOutlineEditorDialog";

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
  skeleton,
  sourceTextureUrl,
  dispatch,
  compact = false,
}: {
  part: BodyPartLayer;
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
  const autoCutPoints = useMemo(
    () =>
      fabricablePartOutlinePoints(
        { ...part, contourPoints: undefined, contourSource: undefined },
        landmarks,
      ),
    [part, landmarks],
  );
  const activeContourPoints =
    part.contourPoints?.filter(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ) ?? [];
  const editableCutPoints = isUsableContourPoints(activeContourPoints)
    ? activeContourPoints
    : fabricablePartOutlinePoints(part, landmarks);
  const [selectedCutPointIndex, setSelectedCutPointIndex] = useState(0);
  const selectedIndex = editableCutPoints.length
    ? Math.min(selectedCutPointIndex, editableCutPoints.length - 1)
    : 0;
  const [cutEditorOpen, setCutEditorOpen] = useState(false);
  useEffect(() => {
    if (selectedCutPointIndex >= editableCutPoints.length)
      setSelectedCutPointIndex(Math.max(0, editableCutPoints.length - 1));
  }, [editableCutPoints.length, selectedCutPointIndex]);
  const commitCut = (points: Point[]) =>
    dispatch({
      type: "update_part",
      partId: part.id,
      updates: { contourPoints: points, contourSource: "user" },
    });
  const updateCutPointAt = (targetIndex: number, updates: Partial<Point>) =>
    commitCut(
      editableCutPoints.map((point, index) =>
        index === targetIndex ? { ...point, ...updates } : point,
      ),
    );
  const replaceCutPoints = (points: Point[], nextSelectedIndex = 0) => {
    if (!isUsableContourPoints(points)) return;
    commitCut(points);
    setSelectedCutPointIndex(
      Math.max(0, Math.min(nextSelectedIndex, points.length - 1)),
    );
  };
  const openCutEditor = () => {
    commitCut(editableCutPoints);
    setCutEditorOpen(true);
  };
  const addCutPoint = () => {
    if (editableCutPoints.length < 2) return;
    const nextIndex = (selectedIndex + 1) % editableCutPoints.length;
    const a = editableCutPoints[selectedIndex];
    const b = editableCutPoints[nextIndex];
    const point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    commitCut([
      ...editableCutPoints.slice(0, selectedIndex + 1),
      point,
      ...editableCutPoints.slice(selectedIndex + 1),
    ]);
    setSelectedCutPointIndex(selectedIndex + 1);
  };
  const removeCutPoint = () => {
    if (editableCutPoints.length <= 3) return;
    commitCut(editableCutPoints.filter((_, index) => index !== selectedIndex));
    setSelectedCutPointIndex(Math.max(0, selectedIndex - 1));
  };
  const cutSource =
    part.contourSource === "user"
      ? "user cut"
      : part.contourSource === "onnx-mask"
        ? "legacy detected cut"
        : part.contourSource === "imported"
          ? "imported cut"
          : "auto joint cut";
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
            <div className="section-title">Cut</div>
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
            onClick={openCutEditor}
          >
            Edit cut
          </button>
        </div>
      </div>
      {cutEditorOpen && (
        <CutOutlineEditorDialog
          part={part}
          sourceTextureUrl={sourceTextureUrl}
          points={editableCutPoints}
          autoPoints={autoCutPoints}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedCutPointIndex}
          updatePointAt={updateCutPointAt}
          replacePoints={replaceCutPoints}
          addPoint={addCutPoint}
          removePoint={removeCutPoint}
          onUseAuto={() => commitCut(autoCutPoints)}
          onExpand={() => commitCut(scaleContour(editableCutPoints, 1.06))}
          onShrink={() => commitCut(scaleContour(editableCutPoints, 0.94))}
          onClose={() => setCutEditorOpen(false)}
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
          <MiniNumber
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
          />
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
