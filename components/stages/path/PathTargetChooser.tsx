import { useState } from "react";
import type { ProjectMotionPath, ProjectState } from "../../../types";
import { pathHasExactOwner, pathOwnerLabel, type PathTargetKind } from "../../../utils/pathTargets";

export const PathTargetChooser = ({ project, paths, initialTarget, onAdd, onSelect, onCancel }: {
  project: ProjectState;
  paths: ProjectMotionPath[];
  initialTarget: string;
  onAdd: (kind: PathTargetKind, id: string) => void;
  onSelect: (id: string) => void;
  onCancel: () => void;
}) => {
  const targets = [
    ...project.partOrder.flatMap(id => project.parts[id] ? [{ kind: "part" as const, ...project.parts[id] }] : []),
    ...project.sceneObjectOrder.flatMap(id => project.sceneObjects[id] ? [{ kind: "scene-object" as const, ...project.sceneObjects[id] }] : []),
  ];
  const key = (target: typeof targets[number]) => `${target.kind}:${target.id}`;
  const [selected, setSelected] = useState(initialTarget || (targets[0] ? key(targets[0]) : ""));
  const target = targets.find(candidate => key(candidate) === selected);
  const existing = target ? paths.filter(path => pathHasExactOwner(path, target.kind, target.id)) : [];
  return <div className="mt-2 space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3" role="region" aria-label="Add path" data-testid="add-path-chooser" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onCancel(); }
  }}>
    <label className="block text-xs font-bold text-slate-600">
      Target
      <select className="field mt-1" aria-label="New path target" value={selected} onChange={event => setSelected(event.target.value)} autoFocus>
        {targets.map(candidate => <option key={key(candidate)} value={key(candidate)} disabled={candidate.locked}>
          {candidate.name}{candidate.locked ? " · locked" : ""}
        </option>)}
      </select>
    </label>
    {existing.length > 0 && <div className="space-y-1" data-testid="add-path-existing">
      <span className="text-xs font-bold text-slate-500">Existing paths</span>
      {existing.map((path, index) => <button key={path.id} type="button" className="btn-secondary w-full" onClick={() => onSelect(path.id)}>
        Edit {pathOwnerLabel(project, path)}{existing.length > 1 ? ` ${index + 1}` : ""}
      </button>)}
    </div>}
    <div className="flex gap-2">
      <button type="button" className="btn-primary flex-1" disabled={!target || target.locked} onClick={() => target && onAdd(target.kind, target.id)}>Create path</button>
      <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
    </div>
  </div>;
};
