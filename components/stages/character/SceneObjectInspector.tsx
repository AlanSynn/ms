import type { ProjectAction, SceneObject } from "../../../types";
import { MiniNumber, Toggle } from "../../ui/InspectorControls";

const SHAPE_LABELS: Record<SceneObject["shape"], string> = {
  "piggy-bank": "Piggy bank",
  cloud: "Cloud",
  star: "Star",
  block: "Block",
};

export const SceneObjectInspector = ({
  object,
  dispatch,
}: {
  object: SceneObject;
  dispatch: (action: ProjectAction) => void;
}) => {
  const update = (updates: Partial<SceneObject>) =>
    dispatch({ type: "update_scene_object", objectId: object.id, updates });
  const updateTransform = (updates: Partial<SceneObject["transform"]>) =>
    update({ transform: { ...object.transform, ...updates } });
  const updateBounds = (updates: Partial<SceneObject["bounds"]>) =>
    update({ bounds: { ...object.bounds, ...updates } });

  return (
    <section className="workspace p-5" data-testid="scene-object-inspector">
      <div className="section-title">Scene object</div>
      <h3>{object.name}</h3>
      <div className="mt-4 space-y-3">
        <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
          Name
          <input
            className="field mt-1"
            aria-label="Object name"
            disabled={object.locked}
            value={object.name}
            onChange={(event) => update({ name: event.currentTarget.value })}
          />
        </label>
        <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
          Type
          <select
            className="field mt-1"
            aria-label="Object type"
            disabled={object.locked}
            value={object.shape}
            onChange={(event) =>
              update({ shape: event.currentTarget.value as SceneObject["shape"] })
            }
          >
            {Object.entries(SHAPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Toggle
          label="Visible"
          checked={object.visible}
          disabled={object.locked}
          onChange={(visible) => update({ visible })}
        />
        <Toggle
          label="Locked"
          checked={object.locked}
          onChange={(locked) => update({ locked })}
        />
        <div className="grid grid-cols-2 gap-3">
          <MiniNumber
            label="X"
            value={object.transform.x}
            min={-360}
            max={360}
            disabled={object.locked}
            onChange={(x) => updateTransform({ x })}
          />
          <MiniNumber
            label="Y"
            value={object.transform.y}
            min={-360}
            max={360}
            disabled={object.locked}
            onChange={(y) => updateTransform({ y })}
          />
          <MiniNumber
            label="Scale"
            value={object.transform.scale}
            min={0.2}
            max={3}
            step={0.05}
            disabled={object.locked}
            onChange={(scale) => updateTransform({ scale })}
          />
          <MiniNumber
            label="Rotation"
            value={object.transform.rotation}
            min={-180}
            max={180}
            disabled={object.locked}
            onChange={(rotation) => updateTransform({ rotation })}
          />
          <MiniNumber
            label="Width"
            value={object.bounds.width}
            min={8}
            max={520}
            disabled={object.locked}
            onChange={(width) => updateBounds({ width })}
          />
          <MiniNumber
            label="Height"
            value={object.bounds.height}
            min={8}
            max={520}
            disabled={object.locked}
            onChange={(height) => updateBounds({ height })}
          />
        </div>
        <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
          Color
          <input
            className="mt-1 h-10 w-full rounded-2xl border border-slate-200 bg-white p-1"
            aria-label="Object color"
            type="color"
            disabled={object.locked}
            value={object.fillColor}
            onChange={(event) => update({ fillColor: event.currentTarget.value })}
          />
        </label>
        <button
          type="button"
          className="btn-secondary w-full"
          disabled={object.locked}
          onClick={() => dispatch({ type: "delete_scene_object", objectId: object.id })}
        >
          Delete object
        </button>
      </div>
    </section>
  );
};
