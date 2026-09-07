import { Plus, Trash2 } from "lucide-react";

import type { BodyPartLayer, ProjectAction, ProjectState } from "../../../types";
import { uid } from "../../../utils/project";
import { PartInspector } from "./PartInspector";
import { SkeletonInspector } from "./SkeletonInspector";

export const CharacterSetupPanel = ({
  selectedEditablePart,
  partPanelProject,
  partPanelDisabled,
  project,
  dispatch,
}: {
  selectedEditablePart?: BodyPartLayer;
  partPanelProject: ProjectState;
  partPanelDisabled: boolean;
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
}) => {
  const sortedParts = partPanelProject.partOrder
    .map((id) => partPanelProject.parts[id])
    .filter((part): part is BodyPartLayer => Boolean(part));
  const addLayer = () => {
    const base = selectedEditablePart;
    const id = uid("part");
    const anchorJointId =
      base?.anchorJointId ??
      project.skeleton?.rootJointIds[0] ??
      Object.keys(project.skeleton?.joints ?? {})[0] ??
      "root";
    dispatch({
      type: "upsert_part",
      part: base
        ? {
            ...base,
            id,
            name: `${base.name} copy`,
            transform: {
              ...base.transform,
              x: base.transform.x + 24,
              y: base.transform.y - 24,
            },
            zIndex: Math.max(0, ...sortedParts.map((p) => p.zIndex)) + 1,
          }
        : {
            id,
            name: "New layer",
            anchorJointId,
            transform: { x: 0, y: 0, rotation: 0, scale: 1 },
            zIndex: sortedParts.length,
            opacity: 0.9,
            visible: true,
            locked: false,
            selectable: true,
            bounds: { x: -40, y: -40, width: 80, height: 80 },
            fillColor: "#64748b",
          },
    });
  };

  return (
    <section
      className="character-setup-panel"
      data-testid="character-setup-panel"
      aria-label="Character part settings"
    >
      <div className="section-title">Part</div>
      <div className="mt-1 text-sm font-extrabold text-slate-800">
        {selectedEditablePart?.name ?? "No part"}
      </div>
      {!partPanelDisabled && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="character-rig-actions">
          <button className="btn-secondary" onClick={addLayer}>
            <Plus size={16} /> Add layer
          </button>
          {selectedEditablePart && (
            <button
              className="btn-secondary"
              disabled={selectedEditablePart.locked}
              onClick={() =>
                dispatch({
                  type: "delete_part",
                  partId: selectedEditablePart.id,
                })
              }
            >
              <Trash2 size={16} /> Remove layer
            </button>
          )}
        </div>
      )}
      {partPanelDisabled ? (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
          Choose new character.
        </div>
      ) : (
        selectedEditablePart && (
          <PartInspector
            project={partPanelProject}
            part={selectedEditablePart}
            skeleton={partPanelProject.skeleton}
            sourceTextureUrl={partPanelProject.characterPackage?.sourceTextureUrl}
            dispatch={dispatch}
            compact
          />
        )
      )}
      <details className="advanced-panel mt-3" open={!partPanelDisabled}>
        <summary>Anchors</summary>
        {partPanelDisabled ? (
          <div className="mt-2 text-xs font-bold text-slate-500">
            Choose new character first.
          </div>
        ) : (
          <SkeletonInspector project={project} dispatch={dispatch} />
        )}
      </details>
    </section>
  );
};
