import type { BodyPartLayer, ProjectAction, ProjectState } from "../../../types";
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
}) => (
  <section
    className="character-setup-panel"
    data-testid="character-setup-panel"
    aria-label="Character part settings"
  >
    <div className="section-title">Part</div>
    <div className="mt-1 text-sm font-extrabold text-slate-800">
      {selectedEditablePart?.name ?? "No part"}
    </div>
    {partPanelDisabled ? (
      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
        Choose new character.
      </div>
    ) : (
      selectedEditablePart && (
        <PartInspector
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
